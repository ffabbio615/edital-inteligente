import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, RequestHandler, Response } from "express";
import { AppError } from "../errors/app-error";
import { createIntegrationAuth } from "./integration-auth.middleware";

const SECRET = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
const NOT_CALLED = Symbol("next not called");

function run(handler: RequestHandler, headers: Record<string, string>): unknown {
  let received: unknown = NOT_CALLED;
  const req = { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
  handler(req, {} as Response, (error?: unknown) => {
    received = error;
  });
  return received;
}

describe("createIntegrationAuth", () => {
  it("permite a requisição com a chave correta", () => {
    const received = run(createIntegrationAuth(SECRET), { "x-integration-key": SECRET });
    assert.equal(received, undefined);
  });

  it("nega a requisição sem chave (401)", () => {
    const received = run(createIntegrationAuth(SECRET), {});
    assert.ok(received instanceof AppError);
    assert.equal(received.statusCode, 401);
    assert.equal(received.code, "unauthorized");
  });

  it("nega chave inválida (401), inclusive de tamanho diferente, sem lançar exceção", () => {
    for (const key of ["errada", `${SECRET}x`, SECRET.slice(0, -1), "a".repeat(500)]) {
      const received = run(createIntegrationAuth(SECRET), { "x-integration-key": key });
      assert.ok(received instanceof AppError, `chave "${key.slice(0, 10)}..." deveria ser negada`);
      assert.equal(received.statusCode, 401);
    }
  });

  it("usa a mesma mensagem para chave ausente e inválida e nunca a expõe", () => {
    const missing = run(createIntegrationAuth(SECRET), {});
    const invalid = run(createIntegrationAuth(SECRET), { "x-integration-key": "errada" });
    assert.ok(missing instanceof AppError && invalid instanceof AppError);
    assert.equal(missing.message, invalid.message);
    assert.ok(!missing.message.includes(SECRET));
  });

  it("nega tudo (503) quando o segredo não está configurado, mesmo com uma chave enviada", () => {
    for (const secret of [undefined, ""]) {
      const received = run(createIntegrationAuth(secret), { "x-integration-key": "qualquer" });
      assert.ok(received instanceof AppError);
      assert.equal(received.statusCode, 503);
      assert.equal(received.code, "integration_not_configured");
    }
  });
});
