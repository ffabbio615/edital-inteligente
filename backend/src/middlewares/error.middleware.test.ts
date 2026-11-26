import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { Request, Response } from "express";
import { DatabaseNotConfiguredError } from "../database/connection";
import { DatabaseUnavailableError } from "../database/transaction";
import { AppError } from "../errors/app-error";
import { n8nIngestSchema } from "../integrations/n8n/n8n.schemas";
import { errorHandler, notFoundHandler } from "./error.middleware";

function createResponse(headersSent = false) {
  const state: { statusCode: number; body: unknown } = { statusCode: 0, body: undefined };
  const res = {
    headersSent,
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
  };
  return { res: res as unknown as Response, state };
}

function handle(error: unknown) {
  const { res, state } = createResponse();
  errorHandler(error, {} as Request, res, () => undefined);
  return state;
}

function sqlError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("errorHandler", () => {
  it("formata AppError com status, código e detalhes", () => {
    const state = handle(new AppError(422, "unknown_target_audience", "Mensagem.", [{ path: "a.b", message: "x" }]));
    assert.equal(state.statusCode, 422);
    assert.deepEqual(state.body, {
      success: false,
      status: "error",
      error: {
        code: "unknown_target_audience",
        message: "Mensagem.",
        details: [{ path: "a.b", message: "x" }],
      },
    });
  });

  it("converte ZodError em 400 validation_error com caminho e mensagem", () => {
    const result = n8nIngestSchema.safeParse({});
    assert.equal(result.success, false);
    if (result.success) return;

    const state = handle(result.error);
    assert.equal(state.statusCode, 400);
    const body = state.body as { success: boolean; error: { code: string; details: unknown[] } };
    assert.equal(body.success, false);
    assert.equal(body.error.code, "validation_error");
    assert.ok(body.error.details.length > 0);
  });

  it("converte falhas de banco em 503 sem detalhes internos", () => {
    const notConfigured = handle(new DatabaseNotConfiguredError());
    assert.equal(notConfigured.statusCode, 503);
    assert.equal((notConfigured.body as { error: { code: string } }).error.code, "database_not_configured");

    const unavailable = handle(new DatabaseUnavailableError());
    assert.equal(unavailable.statusCode, 503);
    assert.equal((unavailable.body as { error: { code: string } }).error.code, "database_unavailable");
  });

  it("converte violações de integridade do PostgreSQL sem expor constraint ou valores", () => {
    const check = handle(sqlError("23514", 'violates check constraint "opportunities_x" DETAIL: Failing row contains (segredo)'));
    assert.equal(check.statusCode, 422);
    assert.equal((check.body as { error: { code: string } }).error.code, "data_rejected");
    assert.ok(!JSON.stringify(check.body).includes("opportunities_x"));
    assert.ok(!JSON.stringify(check.body).includes("segredo"));

    const unique = handle(sqlError("23505", "duplicate key value"));
    assert.equal(unique.statusCode, 409);
    assert.equal((unique.body as { error: { code: string } }).error.code, "conflict");
  });

  it("retorna 500 genérico para erro inesperado, sem vazar a mensagem", () => {
    const consoleError = mock.method(console, "error", () => undefined);
    try {
      const state = handle(new Error("password=hunter2 host=10.0.0.5"));
      assert.equal(state.statusCode, 500);
      assert.deepEqual(state.body, {
        success: false,
        status: "error",
        error: { code: "internal_error", message: "Internal server error." },
      });
      assert.ok(!JSON.stringify(state.body).includes("hunter2"));
    } finally {
      consoleError.mock.restore();
    }
  });

  it("encaminha ao próximo handler quando a resposta já foi enviada", () => {
    const { res } = createResponse(true);
    const error = new Error("tarde demais");
    let forwarded: unknown;
    errorHandler(error, {} as Request, res, (received?: unknown) => {
      forwarded = received;
    });
    assert.equal(forwarded, error);
  });
});

describe("notFoundHandler", () => {
  it("retorna 404 no formato padrão", () => {
    const { res, state } = createResponse();
    notFoundHandler({} as Request, res, () => undefined);
    assert.equal(state.statusCode, 404);
    assert.deepEqual(state.body, {
      success: false,
      status: "error",
      error: { code: "not_found", message: "Route not found." },
    });
  });
});
