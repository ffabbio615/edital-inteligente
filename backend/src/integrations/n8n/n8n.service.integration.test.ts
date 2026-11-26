import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool, type QueryResultRow } from "pg";
import { runInTransaction, type Queryable, type TransactionRunner } from "../../database/transaction";
import { AppError } from "../../errors/app-error";
import { n8nIngestSchema, type N8nIngestInput } from "./n8n.schemas";
import { createN8nService } from "./n8n.service";

// Teste de integração com PostgreSQL REAL (migrations 001, 002 e 003 aplicadas).
//
// Só roda quando TEST_DATABASE_URL está definida; sem ela, todos os casos são pulados.
// Por segurança, o nome do banco precisa terminar em "_test" (ex.: edital_test).
// Os casos usam um source_name exclusivo desta execução e apagam ao final somente o que
// criaram: nenhum outro dado do banco é lido para alteração ou removido.

const DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() || undefined;
const SKIP = DATABASE_URL ? false : "TEST_DATABASE_URL não definida (teste de integração com PostgreSQL pulado)";
const RUN_SOURCE = `integration-test-${randomUUID()}`;

let pool: Pool;
let runner: TransactionRunner;

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

async function sql<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}

function body(externalId: string, analysis: Record<string, unknown> = {}, source: Record<string, unknown> = {}) {
  const refs = (fields: string[]) =>
    fields.map((field) => ({ field, document_url: null, excerpt: `Trecho sobre ${field}.`, basis: "stated" }));
  return n8nIngestSchema.parse({
    source: { source_name: RUN_SOURCE, external_id: externalId, ...source },
    model_name: "gemini-integration-test",
    analysis: {
      title: "Edital de Integração",
      institution: "Instituição de Teste",
      opportunity_category: "grant",
      objective: "Objetivo extraído.",
      observations: "Inscrições até 18h.",
      opening_date: "2026-03-01",
      closing_date: "2026-04-30",
      target_audience: ["startup"],
      eligibility_criteria: { business_sizes: ["micro"] },
      source_references: refs([
        "title",
        "institution",
        "opportunity_category",
        "objective",
        "observations",
        "opening_date",
        "closing_date",
        "target_audience",
        "requirements.business_sizes",
      ]),
      ...analysis,
    },
  });
}

interface OpportunityRow {
  id: string;
  title: string;
  institution: string | null;
  category: string;
  status: string;
  title_verified_at: Date | null;
  institution_verified_at: Date | null;
  category_verified_at: Date | null;
  eligibility_verified_at: Date | null;
  identification_analysis_id: string | null;
  target_audience: unknown;
  eligible_business_sizes: unknown;
  opening_date: Date | null;
  deadline: Date | null;
  funding_amount: string | null;
  updated_at: Date;
}

async function opportunitiesOf(externalId: string): Promise<OpportunityRow[]> {
  return sql<OpportunityRow>("SELECT * FROM opportunities WHERE source_name = $1 AND external_id = $2", [
    RUN_SOURCE,
    externalId,
  ]);
}

interface AnalysisRow {
  id: string;
  title: string | null;
  institution: string | null;
  opportunity_category: string | null;
  objective: string | null;
  observations: string | null;
  opening_date: string | null;
  closing_date: string | null;
  analysis_status: string;
  analysis_summary: string | null;
  model_name: string;
}

async function analysesOf(opportunityId: string): Promise<AnalysisRow[]> {
  return sql<AnalysisRow>(
    `SELECT id, title, institution, opportunity_category, objective, observations,
            opening_date::text AS opening_date, closing_date::text AS closing_date,
            analysis_status, analysis_summary, model_name
     FROM opportunity_analyses WHERE opportunity_id = $1 ORDER BY created_at, id`,
    [opportunityId],
  );
}

describe("n8n service + PostgreSQL real", { skip: SKIP }, () => {
  before(async () => {
    const url = DATABASE_URL as string;
    if (!databaseName(url).endsWith("_test")) {
      throw new Error("TEST_DATABASE_URL precisa apontar para um banco cujo nome termine em _test.");
    }
    pool = new Pool({ connectionString: url, max: 10 });
    runner = (work) => runInTransaction({ connect: () => pool.connect() }, work);

    const migrated = await sql("SELECT 1 FROM opportunity_categories WHERE code = 'unclassified'");
    if (migrated.length === 0) {
      throw new Error("Migration 003 não aplicada no banco de teste.");
    }
  });

  after(async () => {
    if (!pool) return;
    // Apaga somente o que esta execução criou (cascata nas análises; FK de procedência adiada).
    await pool.query("DELETE FROM opportunities WHERE source_name = $1", [RUN_SOURCE]);
    const left = await sql("SELECT 1 FROM opportunities WHERE source_name = $1", [RUN_SOURCE]);
    await pool.end();
    assert.equal(left.length, 0, "limpeza deveria remover os dados do teste");
  });

  it("cria oportunidade provisória (unclassified, nada verificado) e análise completa", async () => {
    const service = createN8nService(runner);
    const result = await service.ingestOpportunityAnalysis(body("CREATE-1"));

    assert.equal(result.opportunity.action, "created");
    assert.equal(result.analysis.status, "completed");

    const [opportunity] = await opportunitiesOf("CREATE-1");
    assert.ok(opportunity);
    assert.equal(opportunity.title, "Edital de Integração");
    assert.equal(opportunity.institution, "Instituição de Teste");
    assert.equal(opportunity.category, "unclassified");
    assert.equal(opportunity.status, "unknown");
    assert.equal(opportunity.title_verified_at, null);
    assert.equal(opportunity.institution_verified_at, null);
    assert.equal(opportunity.category_verified_at, null);
    assert.equal(opportunity.eligibility_verified_at, null);
    assert.equal(opportunity.identification_analysis_id, result.analysis.id);
    // Nada promovido: critérios, datas e valores confirmados continuam NULL.
    assert.equal(opportunity.target_audience, null);
    assert.equal(opportunity.eligible_business_sizes, null);
    assert.equal(opportunity.opening_date, null);
    assert.equal(opportunity.deadline, null);
    assert.equal(opportunity.funding_amount, null);

    const analyses = await analysesOf(opportunity.id);
    assert.equal(analyses.length, 1);
    assert.deepEqual(
      { ...analyses[0], id: undefined },
      {
        id: undefined,
        title: "Edital de Integração",
        institution: "Instituição de Teste",
        opportunity_category: "grant",
        objective: "Objetivo extraído.",
        observations: "Inscrições até 18h.",
        opening_date: "2026-03-01",
        closing_date: "2026-04-30",
        analysis_status: "completed",
        analysis_summary: null,
        model_name: "gemini-integration-test",
      },
    );
  });

  it("reenvio idempotente; mudança de conteúdo gera nova análise sem alterar a oportunidade", async () => {
    const service = createN8nService(runner);
    const first = await service.ingestOpportunityAnalysis(body("IDEMP-1"));
    const [before] = await opportunitiesOf("IDEMP-1");

    const again = await service.ingestOpportunityAnalysis(body("IDEMP-1"));
    assert.equal(again.opportunity.action, "unchanged");
    assert.deepEqual(again.analysis, { ...first.analysis, action: "already_registered" });

    const changes: Record<string, unknown>[] = [
      { closing_date: "2026-05-15" },
      { opening_date: null },
      { title: "Título revisado pela IA" },
      { institution: null },
      { opportunity_category: "award" },
      { objective: "Outro objetivo." },
      { observations: null },
    ];
    for (const change of changes) {
      const result = await service.ingestOpportunityAnalysis(body("IDEMP-1", change));
      assert.equal(result.analysis.action, "created", JSON.stringify(change));
      assert.equal(result.opportunity.action, "unchanged");
    }

    const [afterChanges] = await opportunitiesOf("IDEMP-1");
    assert.deepEqual(afterChanges, before, "a oportunidade existente não pode ser alterada");
    assert.equal((await analysesOf(before!.id)).length, 1 + changes.length);

    // Reenviar uma das variações não duplica.
    const repeat = await service.ingestOpportunityAnalysis(body("IDEMP-1", { closing_date: "2026-05-15" }));
    assert.equal(repeat.analysis.action, "already_registered");
    assert.equal((await analysesOf(before!.id)).length, 1 + changes.length);
  });

  it("mudança só de procedência (stated → inferred) gera nova análise needs_review", async () => {
    const service = createN8nService(runner);
    const original = body("PROV-1");
    await service.ingestOpportunityAnalysis(original);

    const inferred = structuredClone(original);
    const reference = inferred.analysis.source_references?.find((item) => item.field === "closing_date");
    assert.ok(reference);
    reference.basis = "inferred";

    const result = await service.ingestOpportunityAnalysis(inferred);
    assert.equal(result.analysis.action, "created");
    assert.equal(result.analysis.status, "needs_review");
    assert.deepEqual(result.review.fields_inferred_only, ["closing_date"]);
  });

  it("campo extraído sem referência própria fica needs_review no banco", async () => {
    const service = createN8nService(runner);
    const input = body("NOREF-1");
    input.analysis.source_references = input.analysis.source_references?.filter((item) => item.field !== "institution");

    const result = await service.ingestOpportunityAnalysis(input);
    assert.equal(result.analysis.status, "needs_review");
    assert.deepEqual(result.review.fields_without_reference, ["institution"]);
    const [opportunity] = await opportunitiesOf("NOREF-1");
    assert.equal((await analysesOf(opportunity!.id))[0]?.analysis_status, "needs_review");
  });

  it("categoria sugerida ausente: análise com NULL e oportunidade unclassified", async () => {
    const service = createN8nService(runner);
    await service.ingestOpportunityAnalysis(body("NOCAT-1", { opportunity_category: null }));

    const [opportunity] = await opportunitiesOf("NOCAT-1");
    assert.equal(opportunity?.category, "unclassified");
    assert.equal((await analysesOf(opportunity!.id))[0]?.opportunity_category, null);
  });

  it("categoria e perfil desconhecidos: 422 e nada gravado", async () => {
    const service = createN8nService(runner);
    await assert.rejects(
      service.ingestOpportunityAnalysis(body("BADCAT-1", { opportunity_category: "inexistente" })),
      (error: unknown) => error instanceof AppError && error.code === "unknown_opportunity_category",
    );
    await assert.rejects(
      service.ingestOpportunityAnalysis(body("BADPROF-1", { target_audience: ["startup", "alienigena"] })),
      (error: unknown) => error instanceof AppError && error.code === "unknown_target_audience",
    );
    assert.equal((await opportunitiesOf("BADCAT-1")).length, 0);
    assert.equal((await opportunitiesOf("BADPROF-1")).length, 0);
  });

  it("rollback: falha ao gravar a análise desfaz também a oportunidade", async () => {
    const failing: TransactionRunner = (work) =>
      runner((tx) => {
        const wrapped: Queryable = {
          query: (text, params) => {
            if (/INSERT INTO opportunity_analyses/.test(text)) {
              return Promise.reject(new Error("falha simulada"));
            }
            return tx.query(text, params);
          },
        };
        return work(wrapped);
      });
    await assert.rejects(createN8nService(failing).ingestOpportunityAnalysis(body("ROLLBACK-1")), /falha simulada/);
    assert.equal((await opportunitiesOf("ROLLBACK-1")).length, 0);
  });

  it("requisições simultâneas idênticas geram uma oportunidade e uma análise", async () => {
    const service = createN8nService(runner);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => service.ingestOpportunityAnalysis(body("CONC-1"))),
    );

    assert.equal(results.filter((result) => result.opportunity.action === "created").length, 1);
    assert.equal(results.filter((result) => result.analysis.action === "created").length, 1);
    const [opportunity] = await opportunitiesOf("CONC-1");
    assert.equal((await opportunitiesOf("CONC-1")).length, 1);
    assert.equal((await analysesOf(opportunity!.id)).length, 1);
  });

  it("deduplica por source_url quando não há external_id", async () => {
    const service = createN8nService(runner);
    const url = `https://exemplo.gov.br/${randomUUID()}`;
    const first = await service.ingestOpportunityAnalysis(body("ignored", {}, { external_id: null, source_url: url }));
    const second = await service.ingestOpportunityAnalysis(
      body("ignored", { closing_date: "2026-06-01" }, { external_id: null, source_url: url }),
    );
    assert.equal(first.opportunity.action, "created");
    assert.equal(second.opportunity.action, "unchanged");
    assert.equal(second.opportunity.id, first.opportunity.id);
  });
});
