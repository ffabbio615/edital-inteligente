import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, it, mock } from "node:test";
import express from "express";
import { DatabaseUnavailableError } from "../../database/transaction";
import { errorHandler, notFoundHandler } from "../../middlewares/error.middleware";
import { createN8nRouter } from "./n8n.routes";
import type { N8nIngestInput } from "./n8n.schemas";
import type { N8nIngestResult, N8nService } from "./n8n.service";

// Teste ponta a ponta HTTP: Express real, roteador, autenticação, Zod e middleware de erros.
// O serviço é substituído, então nenhum banco é necessário.

const SECRET = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
const URL_PATH = "/api/integrations/n8n/opportunities";

const created: N8nIngestResult = {
  opportunity: { id: "opp-1", action: "created" },
  analysis: { id: "analysis-1", action: "created", status: "completed" },
  review: { fields_without_reference: [], fields_inferred_only: [] },
};

let behavior: (input: N8nIngestInput) => Promise<N8nIngestResult> = async () => created;
const calls: N8nIngestInput[] = [];

const service: N8nService = {
  async ingestOpportunityAnalysis(input) {
    calls.push(input);
    return behavior(input);
  },
};

function validBody(documentUrl?: string | null): Record<string, unknown> {
  const reference: Record<string, unknown> = {
    field: "target_audience",
    excerpt: "Podem participar startups.",
    basis: "stated",
  };
  if (documentUrl !== undefined) {
    reference.document_url = documentUrl;
  }
  return {
    source: { source_name: "finep", external_id: "EDITAL-2026-01" },
    model_name: "gemini-test",
    analysis: {
      title: "Edital de Inovação",
      opportunity_category: "grant",
      target_audience: ["startup"],
      source_references: [reference],
    },
  };
}

let baseUrl = "";
let server: ReturnType<express.Application["listen"]>;

async function post(body: unknown, headers: Record<string, string> = { "x-integration-key": SECRET }) {
  const response = await fetch(`${baseUrl}${URL_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/integrations/n8n", createN8nRouter({ secret: SECRET, service }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/integrations/n8n/opportunities", () => {
  it("retorna 401 sem a chave de integração", async () => {
    const callsBefore = calls.length;
    const { status, json } = await post(validBody(), {});
    assert.equal(status, 401);
    assert.equal(json.success, false);
    assert.equal(calls.length, callsBefore);
  });

  it("retorna 401 com chave inválida", async () => {
    const { status, json } = await post(validBody(), { "x-integration-key": "chave-errada" });
    assert.equal(status, 401);
    assert.equal((json.error as { code: string }).code, "unauthorized");
    assert.ok(!JSON.stringify(json).includes(SECRET));
  });

  it("retorna 400 para payload inválido", async () => {
    const { status, json } = await post({ source: {} });
    assert.equal(status, 400);
    assert.equal((json.error as { code: string }).code, "validation_error");
  });

  it("retorna 400 para JSON malformado", async () => {
    const response = await fetch(`${baseUrl}${URL_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-integration-key": SECRET },
      body: "{ invalido",
    });
    assert.equal(response.status, 400);
  });

  it("retorna 201 e success: true para dados válidos", async () => {
    behavior = async () => created;
    const { status, json } = await post(validBody("https://exemplo.gov.br/e.pdf"));
    assert.equal(status, 201);
    assert.deepEqual(json, { success: true, data: created });
  });

  it("aceita referência com document_url null e referência sem document_url", async () => {
    assert.equal((await post(validBody(null))).status, 201);
    assert.equal((await post(validBody())).status, 201);
  });

  it("retorna 400 para referência com URL inválida", async () => {
    const { status, json } = await post(validBody("exemplo.gov.br/e.pdf"));
    assert.equal(status, 400);
    assert.ok(JSON.stringify(json).includes("document_url"));
  });

  it("retorna 400 para categoria unclassified ou data com horário, sem chamar o serviço", async () => {
    const callsBefore = calls.length;
    const withCategory = validBody();
    (withCategory.analysis as Record<string, unknown>).opportunity_category = "unclassified";
    const withDateTime = validBody();
    (withDateTime.analysis as Record<string, unknown>).closing_date = "2026-04-30T23:59:00-03:00";

    const category = await post(withCategory);
    const date = await post(withDateTime);
    assert.equal(category.status, 400);
    assert.ok(JSON.stringify(category.json).includes("analysis.opportunity_category"));
    assert.equal(date.status, 400);
    assert.ok(JSON.stringify(date.json).includes("analysis.closing_date"));
    assert.equal(calls.length, callsBefore);
  });

  it("retorna 200 quando tudo já estava registrado (reenvio)", async () => {
    behavior = async () => ({
      ...created,
      opportunity: { id: "opp-1", action: "unchanged" },
      analysis: { id: "analysis-1", action: "already_registered", status: "completed" },
    });
    const { status } = await post(validBody());
    assert.equal(status, 200);
  });

  it("retorna 503 quando o banco está indisponível, sem detalhes internos", async () => {
    behavior = async () => {
      throw new DatabaseUnavailableError();
    };
    const { status, json } = await post(validBody());
    assert.equal(status, 503);
    assert.equal((json.error as { code: string }).code, "database_unavailable");
  });

  it("retorna 500 genérico para erro inesperado, sem vazar a mensagem", async () => {
    const consoleError = mock.method(console, "error", () => undefined);
    try {
      behavior = async () => {
        throw new Error("password=hunter2");
      };
      const { status, json } = await post(validBody());
      assert.equal(status, 500);
      assert.ok(!JSON.stringify(json).includes("hunter2"));
    } finally {
      consoleError.mock.restore();
    }
  });

  it("retorna 404 para outros métodos na mesma rota", async () => {
    const response = await fetch(`${baseUrl}${URL_PATH}`, { headers: { "x-integration-key": SECRET } });
    assert.equal(response.status, 404);
  });
});
