import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { runInTransaction, type TransactionRunner } from "../database/transaction";
import { AppError } from "../errors/app-error";
import { listOpportunitiesQuerySchema } from "./opportunities.schemas";
import { createOpportunitiesService, type OpportunityListItem } from "./opportunities.service";

// Teste de integração com PostgreSQL REAL (migrations 001, 002 e 003 aplicadas).
//
// Só roda quando TEST_DATABASE_URL está definida; sem ela, todos os casos são pulados.
// Por segurança, o nome do banco precisa terminar em "_test" (ex.: edital_test).
// Os dados usam source_name e um marcador exclusivos desta execução, e as consultas filtram
// pelo marcador, então dados já existentes no banco não interferem. Ao final, apaga somente
// o que criou.

const DATABASE_URL = process.env.TEST_DATABASE_URL?.trim() || undefined;
const SKIP = DATABASE_URL ? false : "TEST_DATABASE_URL não definida (teste de integração com PostgreSQL pulado)";
const RUN_SOURCE = `integration-test-${randomUUID()}`;
// Marcador exclusivo da execução, presente em título e instituição. Começa com letras para que
// toUpperCase()/toLowerCase() sempre mudem o texto (o teste de maiúsculas não fica trivial).
const TOKEN = `marcador${randomUUID().slice(0, 8)}`;

let pool: Pool;
let runner: TransactionRunner;
const ids: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };
const analysisIds = { aOld: "", aNew: "", c: "" };

// Evidências da análise mais recente de A (formato de source_references, migrations 001/002).
const A_REFERENCES = [
  { field: "title", document_url: "https://exemplo.gov.br/alfa.pdf", page: 1, section: "1", excerpt: "Edital Alfa", basis: "stated" },
  { field: "funding_amount", document_url: null, excerpt: "R$ 1.500.000,50 por projeto", basis: "inferred" },
];

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

const q = (query: Record<string, unknown> = {}) => listOpportunitiesQuerySchema.parse({ institution: TOKEN, ...query });

async function list(query: Record<string, unknown> = {}) {
  return createOpportunitiesService(runner).listOpportunities(q(query));
}

const titles = (items: OpportunityListItem[]) => items.map((item) => item.title);

async function insertOpportunity(values: Record<string, unknown>): Promise<string> {
  const columns = ["source_name", ...Object.keys(values)];
  const params = [RUN_SOURCE, ...Object.values(values)];
  const result = await pool.query<{ id: string }>(
    `INSERT INTO opportunities (${columns.join(", ")})
     VALUES (${params.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING id`,
    params,
  );
  return result.rows[0]?.id as string;
}

// needs_review dispensa referências stated (constraint da 003), o que simplifica o cenário.
async function insertAnalysis(opportunityId: string, values: Record<string, unknown>): Promise<string> {
  const columns = ["opportunity_id", "analysis_status", ...Object.keys(values)];
  const params = [opportunityId, "needs_review", ...Object.values(values)];
  const result = await pool.query<{ id: string }>(
    `INSERT INTO opportunity_analyses (${columns.join(", ")})
     VALUES (${params.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING id`,
    params,
  );
  return result.rows[0]?.id as string;
}

describe("opportunities service + PostgreSQL real", { skip: SKIP }, () => {
  before(async () => {
    const url = DATABASE_URL as string;
    if (!databaseName(url).endsWith("_test")) {
      throw new Error("TEST_DATABASE_URL precisa apontar para um banco cujo nome termine em _test.");
    }
    pool = new Pool({ connectionString: url, max: 5 });
    runner = (work) => runInTransaction({ connect: () => pool.connect() }, work);

    const migrated = await pool.query("SELECT 1 FROM opportunity_categories WHERE code = 'unclassified'");
    if (migrated.rows.length === 0) {
      throw new Error("Migration 003 não aplicada no banco de teste.");
    }

    // A: categoria e status oficiais preenchidos, duas análises.
    ids.a = await insertOpportunity({
      title: `Alfa ${TOKEN}`,
      institution: `Fundação Alfa ${TOKEN}`,
      category: "grant",
      category_verified_at: "2026-11-01T12:00:00Z",
      status: "open",
      deadline: "2026-12-31T23:59:00-03:00",
      publication_date: "2026-10-01",
      external_id: "A",
      created_at: "2026-11-01T10:00:00Z",
    });
    // B: como o n8n grava hoje (unclassified, unknown), sem análise.
    ids.b = await insertOpportunity({
      title: `Beta ${TOKEN}`,
      institution: `Instituto Beta ${TOKEN}`,
      category: "unclassified",
      external_id: "B",
      created_at: "2026-11-02T10:00:00Z",
    });
    // C: status oficial closed; a IA sugere 'award', que NÃO deve contar como categoria.
    ids.c = await insertOpportunity({
      title: `Gama ${TOKEN}`,
      institution: `Fundação Gama ${TOKEN}`,
      category: "unclassified",
      status: "closed",
      deadline: "2026-06-30T23:59:00-03:00",
      external_id: "C",
      created_at: "2026-11-03T10:00:00Z",
    });

    analysisIds.aOld = await insertAnalysis(ids.a, {
      opportunity_category: "scholarship",
      closing_date: "2026-11-30",
      model_name: "gemini-old",
      created_at: "2026-11-01T11:00:00Z",
    });
    analysisIds.aNew = await insertAnalysis(ids.a, {
      opportunity_category: "grant",
      opening_date: "2026-10-01",
      closing_date: "2026-12-31",
      analysis_summary: "Resumo extraído.",
      title: "Edital Alfa (extraído)",
      institution: "Fundação Alfa (extraída)",
      objective: "Apoiar projetos de inovação.",
      observations: "Inscrições até 18h.",
      target_audience: JSON.stringify(["startup"]),
      requirements: JSON.stringify({ business_sizes: ["micro", "small"] }),
      eligible_locations: JSON.stringify([{ scope: "state", state: "SP" }]),
      required_documents: JSON.stringify(["Contrato social"]),
      funding_amount: "1500000.50",
      funding_currency: "BRL",
      counterpart_required: false,
      missing_information: JSON.stringify([]),
      source_references: JSON.stringify(A_REFERENCES),
      model_name: "gemini-new",
      analyzed_at: "2026-11-05T09:00:00Z",
      created_at: "2026-11-05T10:00:00Z",
    });
    analysisIds.c = await insertAnalysis(ids.c, {
      opportunity_category: "award",
      closing_date: "2026-06-30",
      model_name: "gemini-new",
      created_at: "2026-11-04T10:00:00Z",
    });
  });

  after(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM opportunities WHERE source_name = $1", [RUN_SOURCE]);
    const left = await pool.query("SELECT 1 FROM opportunities WHERE source_name = $1", [RUN_SOURCE]);
    await pool.end();
    assert.equal(left.rows.length, 0, "limpeza deveria remover os dados do teste");
  });

  it("lista com ordenação padrão (created_at desc) e paginação", async () => {
    const result = await list();
    assert.deepEqual(titles(result.items), [`Gama ${TOKEN}`, `Beta ${TOKEN}`, `Alfa ${TOKEN}`]);
    assert.deepEqual(result.pagination, { page: 1, page_size: 20, total: 3, total_pages: 1 });

    const page1 = await list({ page_size: "2" });
    const page2 = await list({ page_size: "2", page: "2" });
    const page3 = await list({ page_size: "2", page: "3" });
    assert.deepEqual(titles(page1.items), [`Gama ${TOKEN}`, `Beta ${TOKEN}`]);
    assert.deepEqual(titles(page2.items), [`Alfa ${TOKEN}`]);
    assert.deepEqual(page3.items, []);
    assert.deepEqual(page2.pagination, { page: 2, page_size: 2, total: 3, total_pages: 2 });
  });

  it("filtra por categoria oficial, nunca pela sugestão da IA", async () => {
    assert.deepEqual(titles((await list({ category: "grant" })).items), [`Alfa ${TOKEN}`]);
    // C tem sugestão 'award' e A teve 'scholarship' numa análise antiga: nenhum conta.
    assert.equal((await list({ category: "award" })).pagination.total, 0);
    assert.equal((await list({ category: "scholarship" })).pagination.total, 0);
    assert.deepEqual(titles((await list({ category: "unclassified" })).items), [`Gama ${TOKEN}`, `Beta ${TOKEN}`]);
  });

  it("filtra por status oficial", async () => {
    assert.deepEqual(titles((await list({ status: "closed" })).items), [`Gama ${TOKEN}`]);
    assert.deepEqual(titles((await list({ status: "unknown" })).items), [`Beta ${TOKEN}`]);
    assert.equal((await list({ status: "suspended" })).pagination.total, 0);
  });

  it("filtra instituição por trecho, sem diferenciar maiúsculas, com curingas escapados", async () => {
    // Toda consulta contém o marcador exclusivo desta execução: dados já existentes no banco
    // ou de outras execuções nunca entram no resultado.
    const sameRun = (items: OpportunityListItem[]) =>
      assert.ok(items.every((item) => item.source_name === RUN_SOURCE), "só dados desta execução");

    // Maiúsculas/minúsculas trocadas nas letras ASCII e no marcador (gravado em minúsculas).
    const upper = await list({ institution: `FUNDAção ALFA ${TOKEN.toUpperCase()}` });
    assert.notEqual(TOKEN.toUpperCase(), TOKEN);
    assert.deepEqual(titles(upper.items), [`Alfa ${TOKEN}`]);
    sameRun(upper.items);

    const mixed = await list({ institution: `fUNDAção aLFA ${TOKEN.slice(0, 4).toUpperCase()}${TOKEN.slice(4)}` });
    assert.deepEqual(titles(mixed.items), [`Alfa ${TOKEN}`]);

    // Trecho: só o marcador, em maiúsculas, encontra as três instituições desta execução.
    const all = await list({ institution: TOKEN.toUpperCase() });
    assert.deepEqual(titles(all.items), [`Gama ${TOKEN}`, `Beta ${TOKEN}`, `Alfa ${TOKEN}`]);
    sameRun(all.items);

    // % e _ são literais, não curingas.
    assert.deepEqual(titles((await list({ institution: `Fundação % ${TOKEN}` })).items), []);
    assert.deepEqual(titles((await list({ institution: `Fundação ____ ${TOKEN}` })).items), []);
    assert.deepEqual(titles((await list({ institution: `Fundação ${TOKEN}` })).items), []);
  });

  it("combina filtros", async () => {
    assert.deepEqual(titles((await list({ category: "unclassified", status: "closed" })).items), [`Gama ${TOKEN}`]);
    assert.equal((await list({ category: "grant", status: "closed" })).pagination.total, 0);
  });

  it("ordena por deadline com NULL por último, nos dois sentidos", async () => {
    assert.deepEqual(titles((await list({ sort: "deadline", order: "asc" })).items), [`Gama ${TOKEN}`, `Alfa ${TOKEN}`, `Beta ${TOKEN}`]);
    assert.deepEqual(titles((await list({ sort: "deadline", order: "desc" })).items), [`Alfa ${TOKEN}`, `Gama ${TOKEN}`, `Beta ${TOKEN}`]);
    assert.deepEqual(titles((await list({ sort: "title", order: "asc" })).items), [`Alfa ${TOKEN}`, `Beta ${TOKEN}`, `Gama ${TOKEN}`]);
  });

  it("devolve dados oficiais e a última análise marcada como não confirmada", async () => {
    const { items } = await list({ sort: "title", order: "asc" });
    const [a, b, c] = items;
    assert.ok(a && b && c);

    assert.equal(a.id, ids.a);
    assert.equal(a.category, "grant");
    assert.equal(a.category_name, "Fomento");
    assert.ok(a.category_verified_at instanceof Date);
    assert.equal(a.title_verified_at, null);
    assert.equal(a.status, "open");
    assert.equal(a.publication_date, "2026-10-01");
    assert.equal(a.deadline?.toISOString(), "2027-01-01T02:59:00.000Z");
    assert.deepEqual(a.latest_analysis, {
      confirmed: false,
      id: analysisIds.aNew,
      analysis_status: "needs_review",
      suggested_category: "grant",
      opening_date: "2026-10-01",
      closing_date: "2026-12-31",
      model_name: "gemini-new",
      analyzed_at: new Date("2026-11-05T09:00:00Z"),
    });

    assert.equal(b.category, "unclassified");
    assert.equal(b.category_name, "Não classificada");
    assert.equal(b.status, "unknown");
    assert.equal(b.latest_analysis, null);

    assert.equal(c.category, "unclassified");
    assert.equal(c.latest_analysis?.id, analysisIds.c);
    assert.equal(c.latest_analysis?.suggested_category, "award");
  });

  it("consulta individual: opportunity oficial (mesmo contrato da listagem) e última análise completa", async () => {
    const service = createOpportunitiesService(runner);
    const detail = await service.getOpportunity(ids.a);
    const listed = (await list({ sort: "title", order: "asc" })).items[0];
    assert.ok(listed);

    const { latest_analysis: _summary, ...listedOpportunity } = listed;
    assert.deepEqual(detail.opportunity, listedOpportunity);
    assert.equal(detail.opportunity.title, `Alfa ${TOKEN}`);
    assert.equal(detail.opportunity.category, "grant");

    // A análise mais recente (aNew), nunca a antiga (aOld).
    assert.deepEqual(detail.latest_analysis, {
      confirmed: false,
      id: analysisIds.aNew,
      analysis_status: "needs_review",
      analysis_summary: "Resumo extraído.",
      suggested_category: "grant",
      title: "Edital Alfa (extraído)",
      institution: "Fundação Alfa (extraída)",
      objective: "Apoiar projetos de inovação.",
      observations: "Inscrições até 18h.",
      opening_date: "2026-10-01",
      closing_date: "2026-12-31",
      target_audience: ["startup"],
      requirements: { business_sizes: ["micro", "small"] },
      eligible_locations: [{ scope: "state", state: "SP" }],
      required_documents: ["Contrato social"],
      funding_amount: 1500000.5,
      funding_currency: "BRL",
      counterpart_required: false,
      missing_information: [],
      source_references: A_REFERENCES,
      model_name: "gemini-new",
      analyzed_at: new Date("2026-11-05T09:00:00Z"),
      created_at: new Date("2026-11-05T10:00:00Z"),
    });
  });

  it("consulta individual sem análise devolve latest_analysis null", async () => {
    const detail = await createOpportunitiesService(runner).getOpportunity(ids.b);
    assert.equal(detail.opportunity.id, ids.b);
    assert.equal(detail.opportunity.status, "unknown");
    assert.equal(detail.latest_analysis, null);
  });

  it("consulta individual de UUID inexistente lança 404 opportunity_not_found", async () => {
    await assert.rejects(
      createOpportunitiesService(runner).getOpportunity(randomUUID()),
      (error: unknown) => error instanceof AppError && error.statusCode === 404 && error.code === "opportunity_not_found",
    );
  });
});
