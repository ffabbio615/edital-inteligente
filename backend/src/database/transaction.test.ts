import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseUnavailableError, runInTransaction, type TransactionClient } from "./transaction";

interface FakeOptions {
  failOn?: string;
  failConnect?: boolean;
}

function createFakeSource(options: FakeOptions = {}) {
  const queries: string[] = [];
  const state: { released: number; releaseArg: Error | boolean | undefined } = {
    released: 0,
    releaseArg: undefined,
  };

  const client: TransactionClient = {
    async query(text: string) {
      queries.push(text);
      if (options.failOn !== undefined && text === options.failOn) {
        throw new Error(`${text} failed`);
      }
      return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
    },
    release(arg) {
      state.released += 1;
      state.releaseArg = arg;
    },
  };

  const source = {
    async connect(): Promise<TransactionClient> {
      if (options.failConnect) {
        throw new Error("connection refused");
      }
      return client;
    },
  };

  return { source, queries, state };
}

describe("runInTransaction", () => {
  it("executa BEGIN, o trabalho e COMMIT, e devolve a conexão", async () => {
    const { source, queries, state } = createFakeSource();

    const result = await runInTransaction(source, async (tx) => {
      await tx.query("SELECT 1");
      return "ok";
    });

    assert.equal(result, "ok");
    assert.deepEqual(queries, ["BEGIN", "SELECT 1", "COMMIT"]);
    assert.equal(state.released, 1);
    assert.equal(state.releaseArg, undefined);
  });

  it("faz ROLLBACK, relança o erro e devolve a conexão quando o trabalho falha", async () => {
    const { source, queries, state } = createFakeSource();

    await assert.rejects(
      runInTransaction(source, async (tx) => {
        await tx.query("INSERT 1");
        throw new Error("falha de persistência");
      }),
      /falha de persistência/,
    );

    assert.deepEqual(queries, ["BEGIN", "INSERT 1", "ROLLBACK"]);
    assert.equal(state.released, 1);
    assert.equal(state.releaseArg, undefined);
  });

  it("faz ROLLBACK quando o COMMIT falha", async () => {
    const { source, queries } = createFakeSource({ failOn: "COMMIT" });

    await assert.rejects(runInTransaction(source, async () => "ok"), /COMMIT failed/);

    assert.deepEqual(queries, ["BEGIN", "COMMIT", "ROLLBACK"]);
  });

  it("descarta a conexão quando o próprio ROLLBACK falha, mantendo o erro original", async () => {
    const { source, state } = createFakeSource({ failOn: "ROLLBACK" });

    await assert.rejects(
      runInTransaction(source, async () => {
        throw new Error("erro original");
      }),
      /erro original/,
    );

    assert.equal(state.released, 1);
    assert.ok(state.releaseArg instanceof Error);
  });

  it("converte falha de conexão em DatabaseUnavailableError sem executar consultas", async () => {
    const { source, queries, state } = createFakeSource({ failConnect: true });

    await assert.rejects(
      runInTransaction(source, async () => "nunca"),
      (error: unknown) => error instanceof DatabaseUnavailableError,
    );

    assert.deepEqual(queries, []);
    assert.equal(state.released, 0);
  });
});
