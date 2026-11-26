import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, it, mock } from "node:test";
import express from "express";
import { DatabaseNotConfiguredError } from "../database/connection";
import { DatabaseUnavailableError } from "../database/transaction";
import { AppError } from "../errors/app-error";
import { errorHandler, notFoundHandler } from "../middlewares/error.middleware";
import { createOpportunitiesRouter } from "./opportunities.routes";
import type { ListOpportunitiesQuery } from "./opportunities.schemas";
import type { OpportunitiesService, OpportunityDetailResult, OpportunityListResult } from "./opportunities.service";

// Teste ponta a ponta HTTP: Express real, roteador, Zod e middleware de erros.
// O serviço é substituído, então nenhum banco é necessário.

const URL_PATH = "/api/opportunities";

const listed: OpportunityListResult = {
  items: [],
  pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 },
};

let behavior: (query: ListOpportunitiesQuery) => Promise<OpportunityListResult> = async () => listed;
const calls: ListOpportunitiesQuery[] = [];

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111";
const date = new Date("2026-11-20T12:00:00Z");

const detail: OpportunityDetailResult = {
  opportunity: {
    id: OPPORTUNITY_ID,
    title: "Edital",
    title_verified_at: null,
    institution: "FINEP",
    institution_verified_at: null,
    category: "unclassified",
    category_name: "Não classificada",
    category_verified_at: null,
    status: "unknown",
    publication_date: null,
    opening_date: null,
    deadline: null,
    eligibility_verified_at: null,
    source_name: "finep",
    source_url: null,
    document_url: null,
    created_at: date,
    updated_at: date,
  },
  latest_analysis: null,
};

let detailBehavior: (id: string) => Promise<OpportunityDetailResult> = async () => detail;
const detailCalls: string[] = [];

const service: OpportunitiesService = {
  async listOpportunities(query) {
    calls.push(query);
    return behavior(query);
  },
  async getOpportunity(id) {
    detailCalls.push(id);
    return detailBehavior(id);
  },
};

let baseUrl = "";
let server: ReturnType<express.Application["listen"]>;

async function get(search = "") {
  const response = await fetch(`${baseUrl}${URL_PATH}${search}`);
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(URL_PATH, createOpportunitiesRouter({ service }));
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

describe("GET /api/opportunities", () => {
  it("retorna 200 com success, items e pagination", async () => {
    behavior = async () => listed;
    const { status, json } = await get();
    assert.equal(status, 200);
    assert.deepEqual(json, { success: true, data: listed });
  });

  it("repassa ao serviço a query validada com padrões", async () => {
    const before = calls.length;
    await get("?category=grant&status=open&institution=Finep&page=2&page_size=10&sort=title&order=asc");
    assert.equal(calls.length, before + 1);
    assert.deepEqual(calls.at(-1), {
      category: "grant",
      status: "open",
      institution: "Finep",
      page: 2,
      page_size: 10,
      sort: "title",
      order: "asc",
    });
  });

  it("serializa datas como ISO 8601", async () => {
    const date = new Date("2026-11-20T12:00:00Z");
    behavior = async () => ({
      items: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          title: "Edital",
          title_verified_at: null,
          institution: null,
          institution_verified_at: null,
          category: "unclassified",
          category_name: "Não classificada",
          category_verified_at: null,
          status: "unknown",
          publication_date: null,
          opening_date: null,
          deadline: null,
          eligibility_verified_at: null,
          source_name: "finep",
          source_url: null,
          document_url: null,
          created_at: date,
          updated_at: date,
          latest_analysis: null,
        },
      ],
      pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
    });
    const { json } = await get();
    const item = (json.data as OpportunityListResult).items[0] as unknown as Record<string, unknown>;
    assert.equal(item.created_at, "2026-11-20T12:00:00.000Z");
  });

  it("retorna 400 validation_error para parâmetros inválidos, sem chamar o serviço", async () => {
    const before = calls.length;
    for (const search of ["?page=0", "?page_size=500", "?status=aberto", "?sort=closing_date", "?suggested_category=grant", "?status=open&status=closed"]) {
      const { status, json } = await get(search);
      assert.equal(status, 400, search);
      assert.equal((json.error as { code: string }).code, "validation_error", search);
    }
    assert.equal(calls.length, before);
  });

  it("retorna 503 quando o banco não está configurado ou indisponível", async () => {
    behavior = async () => {
      throw new DatabaseNotConfiguredError();
    };
    const notConfigured = await get();
    assert.equal(notConfigured.status, 503);
    assert.equal((notConfigured.json.error as { code: string }).code, "database_not_configured");

    behavior = async () => {
      throw new DatabaseUnavailableError();
    };
    const unavailable = await get();
    assert.equal(unavailable.status, 503);
    assert.equal((unavailable.json.error as { code: string }).code, "database_unavailable");
  });

  it("retorna 500 genérico para erro inesperado, sem vazar a mensagem", async () => {
    const consoleError = mock.method(console, "error", () => undefined);
    try {
      behavior = async () => {
        throw new Error("password=hunter2");
      };
      const { status, json } = await get();
      assert.equal(status, 500);
      assert.ok(!JSON.stringify(json).includes("hunter2"));
    } finally {
      consoleError.mock.restore();
    }
  });

  it("retorna 404 para POST na listagem", async () => {
    const response = await fetch(`${baseUrl}${URL_PATH}`, { method: "POST" });
    assert.equal(response.status, 404);
  });
});

describe("GET /api/opportunities/:id", () => {
  it("retorna 200 com opportunity e latest_analysis separados", async () => {
    detailBehavior = async () => detail;
    const before = detailCalls.length;
    const { status, json } = await get(`/${OPPORTUNITY_ID}`);
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(json.data as object), ["opportunity", "latest_analysis"]);
    assert.equal(json.success, true);
    const data = json.data as Record<string, Record<string, unknown> | null>;
    assert.equal(data.opportunity?.id, OPPORTUNITY_ID);
    assert.equal(data.opportunity?.created_at, "2026-11-20T12:00:00.000Z");
    assert.equal(data.latest_analysis, null);
    assert.deepEqual(detailCalls.slice(before), [OPPORTUNITY_ID]);
  });

  it("retorna 404 opportunity_not_found quando o serviço não encontra o id", async () => {
    detailBehavior = async () => {
      throw new AppError(404, "opportunity_not_found", "Opportunity not found.");
    };
    const { status, json } = await get(`/${OPPORTUNITY_ID}`);
    assert.equal(status, 404);
    assert.deepEqual(json, {
      success: false,
      status: "error",
      error: { code: "opportunity_not_found", message: "Opportunity not found." },
    });
  });

  it("retorna 400 validation_error para id que não é UUID, sem chamar o serviço", async () => {
    const before = detailCalls.length;
    for (const id of ["abc", "123", `${OPPORTUNITY_ID}0`, "11111111-1111-1111-1111", "%20"]) {
      const { status, json } = await get(`/${id}`);
      assert.equal(status, 400, id);
      assert.equal((json.error as { code: string }).code, "validation_error", id);
      assert.ok(JSON.stringify(json).includes("id"), id);
    }
    assert.equal(detailCalls.length, before);
  });

  it("retorna 400 validation_error para parâmetros de query desnecessários, sem chamar o serviço", async () => {
    const before = detailCalls.length;
    for (const search of ["?include=history", "?page=1", "?id=x"]) {
      const { status, json } = await get(`/${OPPORTUNITY_ID}${search}`);
      assert.equal(status, 400, search);
      assert.equal((json.error as { code: string }).code, "validation_error", search);
    }
    assert.equal(detailCalls.length, before);
  });

  it("retorna 404 not_found para métodos não permitidos (padrão do backend), sem chamar o serviço", async () => {
    const before = detailCalls.length;
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await fetch(`${baseUrl}${URL_PATH}/${OPPORTUNITY_ID}`, { method });
      assert.equal(response.status, 404, method);
      const json = (await response.json()) as { error: { code: string } };
      assert.equal(json.error.code, "not_found", method);
    }
    assert.equal(detailCalls.length, before);
  });

  it("retorna 503 quando o banco não está configurado", async () => {
    detailBehavior = async () => {
      throw new DatabaseNotConfiguredError();
    };
    const { status, json } = await get(`/${OPPORTUNITY_ID}`);
    assert.equal(status, 503);
    assert.equal((json.error as { code: string }).code, "database_not_configured");
  });

  it("retorna 503 quando o banco está indisponível", async () => {
    detailBehavior = async () => {
      throw new DatabaseUnavailableError();
    };
    const { status, json } = await get(`/${OPPORTUNITY_ID}`);
    assert.equal(status, 503);
    assert.equal((json.error as { code: string }).code, "database_unavailable");
  });

  it("retorna 500 genérico para erro inesperado, sem vazar a mensagem", async () => {
    const consoleError = mock.method(console, "error", () => undefined);
    try {
      detailBehavior = async () => {
        throw new Error("relation secret_table does not exist");
      };
      const { status, json } = await get(`/${OPPORTUNITY_ID}`);
      assert.equal(status, 500);
      assert.equal((json.error as { code: string }).code, "internal_error");
      assert.ok(!JSON.stringify(json).includes("secret_table"));
    } finally {
      consoleError.mock.restore();
    }
  });
});
