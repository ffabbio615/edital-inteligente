import type { QueryResult, QueryResultRow } from "pg";

/** Superfície mínima de acesso ao banco usada por serviços (e substituível em testes). */
export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface TransactionClient extends Queryable {
  release(error?: Error | boolean): void;
}

export interface ClientSource {
  connect(): Promise<TransactionClient>;
}

/** Executa o trabalho dentro de uma transação. Serviços recebem uma função deste tipo. */
export type TransactionRunner = <T>(work: (tx: Queryable) => Promise<T>) => Promise<T>;

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Database is unavailable.");
    this.name = "DatabaseUnavailableError";
  }
}

/**
 * BEGIN, trabalho, COMMIT. Qualquer erro dispara ROLLBACK e é relançado.
 * Se o próprio ROLLBACK falhar, a conexão é descartada em vez de devolvida ao pool.
 */
export async function runInTransaction<T>(
  source: ClientSource,
  work: (tx: Queryable) => Promise<T>,
): Promise<T> {
  let client: TransactionClient;
  try {
    client = await source.connect();
  } catch {
    throw new DatabaseUnavailableError();
  }

  let discardError: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      discardError = rollbackError instanceof Error ? rollbackError : new Error("Rollback failed");
    }
    throw error;
  } finally {
    client.release(discardError);
  }
}
