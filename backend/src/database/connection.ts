import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";
import { env } from "../config/env";
import { runInTransaction, type TransactionRunner } from "./transaction";

export type DatabaseStatus = "not_configured" | "connected" | "disconnected";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("Database is not configured.");
    this.name = "DatabaseNotConfiguredError";
  }
}

const CONNECTION_TIMEOUT_MS = 3000;
const QUERY_TIMEOUT_MS = 5000;
const IDLE_TIMEOUT_MS = 30000;
const MAX_CLIENTS = 10;

let pool: Pool | null = null;

/** O banco é considerado configurado com DATABASE_URL ou com host, nome e usuário. */
export function isDatabaseConfigured(): boolean {
  return Boolean(env.DATABASE_URL) || Boolean(env.DB_HOST && env.DB_NAME && env.DB_USER);
}

function buildPoolConfig(): PoolConfig | null {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const common: PoolConfig = {
    max: MAX_CLIENTS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    ...(env.DB_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
  };

  // DATABASE_URL tem prioridade sobre as variáveis individuais.
  if (env.DATABASE_URL) {
    return { ...common, connectionString: env.DATABASE_URL };
  }

  return {
    ...common,
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  };
}

// Descrição segura para logs: nunca inclui a mensagem original, que pode conter host ou usuário.
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ? `${error.name} (${code})` : error.name;
  }
  return "UnknownError";
}

// O pool só abre conexões quando a primeira consulta é feita.
function getPool(): Pool | null {
  if (pool) {
    return pool;
  }

  const config = buildPoolConfig();
  if (!config) {
    return null;
  }

  pool = new Pool(config);
  // Sem este listener, um erro em conexão ociosa derrubaria o processo.
  pool.on("error", (error) => {
    console.error(`[database] Idle client error: ${describeError(error)}`);
  });

  return pool;
}

/** Ponto de acesso ao banco para os demais módulos. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const activePool = getPool();
  if (!activePool) {
    throw new DatabaseNotConfiguredError();
  }
  return activePool.query<T>(text, params);
}

/**
 * Executa o trabalho em uma transação (BEGIN/COMMIT, ROLLBACK em erro).
 * Não conecta na inicialização: a conexão só é aberta quando a função é chamada.
 */
export const withTransaction: TransactionRunner = async (work) => {
  const activePool = getPool();
  if (!activePool) {
    throw new DatabaseNotConfiguredError();
  }

  return runInTransaction(
    {
      connect: async () => {
        const client = await activePool.connect();
        return {
          query: <T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) =>
            client.query<T>(text, params),
          release: (error?: Error | boolean) => client.release(error),
        };
      },
    },
    work,
  );
};

/** Verifica a disponibilidade do banco sem lançar exceções. */
export async function checkDatabaseStatus(): Promise<DatabaseStatus> {
  const activePool = getPool();
  if (!activePool) {
    return "not_configured";
  }

  try {
    await activePool.query("SELECT 1");
    return "connected";
  } catch (error) {
    console.error(`[database] Health check failed: ${describeError(error)}`);
    return "disconnected";
  }
}

export async function closeDatabase(): Promise<void> {
  if (!pool) {
    return;
  }

  const activePool = pool;
  pool = null;

  try {
    await activePool.end();
  } catch (error) {
    console.error(`[database] Error while closing pool: ${describeError(error)}`);
  }
}
