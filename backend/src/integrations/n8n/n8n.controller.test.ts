import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { createN8nController } from "./n8n.controller";
import type { N8nIngestInput } from "./n8n.schemas";
import type { N8nIngestResult, N8nService } from "./n8n.service";

const baseReference = {
  field: "target_audience",
  document_url: "https://exemplo.gov.br/edital.pdf",
  excerpt: "Podem participar startups.",
  basis: "stated",
};

function validBody(references: Record<string, unknown>[] = [baseReference]): Record<string, unknown> {
  return {
    source: { source_name: "finep", external_id: "EDITAL-2026-01" },
    model_name: "gemini-test",
    analysis: {
      title: "Edital de Inovação",
      opportunity_category: "grant",
      target_audience: ["startup"],
      source_references: references,
    },
  };
}

function result(overrides: Partial<N8nIngestResult> = {}): N8nIngestResult {
  return {
    opportunity: { id: "opp-1", action: "created" },
    analysis: { id: "analysis-1", action: "created", status: "completed" },
    review: { fields_without_reference: [], fields_inferred_only: [] },
    ...overrides,
  };
}

function createService(response: N8nIngestResult) {
  const calls: N8nIngestInput[] = [];
  const service: N8nService = {
    async ingestOpportunityAnalysis(input) {
      calls.push(input);
      return response;
    },
  };
  return { service, calls };
}

function createResponse() {
  const state: { statusCode: number; body: unknown } = { statusCode: 0, body: undefined };
  const res = {
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

async function invoke(service: N8nService, body: unknown) {
  const { res, state } = createResponse();
  await createN8nController(service)({ body } as Request, res, () => undefined);
  return state;
}

describe("n8n controller", () => {
  it("responde 201 com success: true quando algo é criado", async () => {
    const { service, calls } = createService(result());
    const state = await invoke(service, validBody());

    assert.equal(state.statusCode, 201);
    assert.deepEqual(state.body, { success: true, data: result() });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.analysis.title, "Edital de Inovação");
  });

  it("responde 200 quando oportunidade e análise já existiam (reenvio)", async () => {
    const { service } = createService(
      result({
        opportunity: { id: "opp-1", action: "unchanged" },
        analysis: { id: "analysis-1", action: "already_registered", status: "completed" },
      }),
    );
    const state = await invoke(service, validBody());
    assert.equal(state.statusCode, 200);
  });

  it("responde 201 quando só a análise é criada em oportunidade existente", async () => {
    const { service } = createService(result({ opportunity: { id: "opp-1", action: "unchanged" } }));
    const state = await invoke(service, validBody());
    assert.equal(state.statusCode, 201);
  });

  it("rejeita payload inválido com ZodError e não chama o serviço", async () => {
    const { service, calls } = createService(result());

    await assert.rejects(invoke(service, { source: {} }), (error: unknown) => error instanceof ZodError);
    await assert.rejects(invoke(service, undefined), (error: unknown) => error instanceof ZodError);
    assert.equal(calls.length, 0);
  });

  it("encaminha ao serviço a referência com document_url null", async () => {
    const { service, calls } = createService(result());
    await invoke(service, validBody([{ ...baseReference, document_url: null }]));

    assert.equal(calls[0]?.analysis.source_references?.[0]?.document_url, null);
  });

  it("encaminha ao serviço a referência sem document_url", async () => {
    const { document_url: _omitted, ...withoutUrl } = baseReference;
    const { service, calls } = createService(result());
    await invoke(service, validBody([withoutUrl]));

    const reference = calls[0]?.analysis.source_references?.[0];
    assert.ok(reference);
    assert.equal("document_url" in reference, false);
  });

  it("rejeita referência com URL inválida e não chama o serviço", async () => {
    const { service, calls } = createService(result());

    await assert.rejects(
      invoke(service, validBody([{ ...baseReference, document_url: "exemplo.gov.br/e.pdf" }])),
      (error: unknown) =>
        error instanceof ZodError &&
        error.issues.some((issue) => issue.path.join(".") === "analysis.source_references.0.document_url"),
    );
    assert.equal(calls.length, 0);
  });
});
