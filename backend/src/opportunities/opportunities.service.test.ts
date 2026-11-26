import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { Queryable, TransactionRunner } from "../database/transaction";
import { AppError } from "../errors/app-error";
import { listOpportunitiesQuerySchema } from "./opportunities.schemas";
import {
  buildOrderBy,
  buildWhere,
  createOpportunitiesService,
  escapeLikePattern,
  numericToNumber,
  totalPages,
} from "./opportunities.service";

// Testes unitários com banco FALSO: verificam o SQL, os parâmetros e o mapeamento.
// O comportamento no PostgreSQL real é coberto por opportunities.service.integration.test.ts.

class FakeTx implements Queryable {
  readonly queries: { text: string; params: unknown[] }[] = [];

  constructor(
    private readonly total: number,
    private readonly rows: object[],
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    this.queries.push({ text, params });
    let rows: object[] = [];
    if (/count\(\*\)/.test(text)) rows = [{ total: String(this.total) }];
    else if (/FROM opportunities o/.test(text)) rows = this.rows;
    return { rows: rows as T[], rowCount: rows.length, command: "", oid: 0, fields: [] };
  }
}

function runnerWith(tx: Queryable): TransactionRunner {
  return (work) => work(tx);
}

const q = (query: Record<string, unknown> = {}) => listOpportunitiesQuerySchema.parse(query);

const created = new Date("2026-11-20T12:00:00Z");

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Edital de Inovação",
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
    source_url: "https://finep.gov.br/edital",
    document_url: null,
    created_at: created,
    updated_at: created,
    analysis_id: "22222222-2222-2222-2222-222222222222",
    analysis_status: "completed",
    analysis_opportunity_category: "grant",
    analysis_opening_date: "2026-03-01",
    analysis_closing_date: "2026-04-30",
    analysis_model_name: "gemini-test",
    analysis_analyzed_at: created,
    ...overrides,
  };
}

describe("regras puras da listagem", () => {
  it("escapeLikePattern escapa curingas e barra invertida", () => {
    assert.equal(escapeLikePattern("50%_a\\b"), "50\\%\\_a\\\\b");
    assert.equal(escapeLikePattern("FINEP"), "FINEP");
  });

  it("buildWhere sem filtros não gera WHERE", () => {
    assert.deepEqual(buildWhere(q()), { sql: "", params: [] });
  });

  it("buildWhere usa somente colunas de opportunities, com parâmetros $n", () => {
    const where = buildWhere(q({ category: "grant", status: "open", institution: "Fin%ep" }));
    assert.equal(
      where.sql,
      "WHERE o.category = $1 AND o.status = $2 AND o.institution ILIKE $3 ESCAPE '\\'",
    );
    assert.deepEqual(where.params, ["grant", "open", "%Fin\\%ep%"]);
    assert.doesNotMatch(where.sql, /opportunity_analyses|la\./);
  });

  it("buildWhere numera os parâmetros conforme os filtros enviados", () => {
    assert.deepEqual(buildWhere(q({ institution: "finep" })), {
      sql: "WHERE o.institution ILIKE $1 ESCAPE '\\'",
      params: ["%finep%"],
    });
  });

  it("buildOrderBy usa o mapa fixo, NULL por último e desempate por id", () => {
    assert.equal(buildOrderBy(q()), "ORDER BY o.created_at DESC NULLS LAST, o.id DESC");
    assert.equal(buildOrderBy(q({ sort: "deadline", order: "asc" })), "ORDER BY o.deadline ASC NULLS LAST, o.id ASC");
    assert.equal(buildOrderBy(q({ sort: "title" })), "ORDER BY o.title DESC NULLS LAST, o.id DESC");
  });

  it("totalPages", () => {
    assert.equal(totalPages(0, 20), 0);
    assert.equal(totalPages(1, 20), 1);
    assert.equal(totalPages(40, 20), 2);
    assert.equal(totalPages(53, 20), 3);
  });
});

describe("listOpportunities (banco falso)", () => {
  it("executa em transação somente leitura e pagina com LIMIT/OFFSET", async () => {
    const tx = new FakeTx(53, [row()]);
    const service = createOpportunitiesService(runnerWith(tx));
    const result = await service.listOpportunities(q({ status: "unknown", page: "3", page_size: "20" }));

    assert.equal(tx.queries[0]?.text, "SET TRANSACTION READ ONLY");
    const count = tx.queries[1];
    assert.match(count?.text ?? "", /SELECT count\(\*\) AS total FROM opportunities o WHERE o\.status = \$1/);
    assert.deepEqual(count?.params, ["unknown"]);

    const items = tx.queries[2];
    assert.match(items?.text ?? "", /WHERE o\.status = \$1/);
    assert.match(items?.text ?? "", /ORDER BY o\.created_at DESC NULLS LAST, o\.id DESC/);
    assert.match(items?.text ?? "", /LIMIT \$2 OFFSET \$3/);
    assert.deepEqual(items?.params, ["unknown", 20, 40]);
    assert.equal(tx.queries.length, 3);

    assert.deepEqual(result.pagination, { page: 3, page_size: 20, total: 53, total_pages: 3 });
  });

  it("busca a última análise por created_at e devolve datas date como texto", async () => {
    const tx = new FakeTx(1, [row()]);
    await createOpportunitiesService(runnerWith(tx)).listOpportunities(q());
    const text = tx.queries[2]?.text ?? "";
    assert.match(text, /LEFT JOIN LATERAL/);
    assert.match(text, /ORDER BY a\.created_at DESC, a\.id DESC\s+LIMIT 1/);
    assert.match(text, /o\.publication_date::text/);
    assert.match(text, /la\.closing_date::text/);
  });

  it("separa dados oficiais da análise de IA, marcada como não confirmada", async () => {
    const tx = new FakeTx(1, [row()]);
    const result = await createOpportunitiesService(runnerWith(tx)).listOpportunities(q());
    const [item] = result.items;
    assert.ok(item);
    assert.equal(item.category, "unclassified");
    assert.equal(item.category_name, "Não classificada");
    assert.equal(item.status, "unknown");
    assert.equal(item.deadline, null);
    assert.deepEqual(item.latest_analysis, {
      confirmed: false,
      id: "22222222-2222-2222-2222-222222222222",
      analysis_status: "completed",
      suggested_category: "grant",
      opening_date: "2026-03-01",
      closing_date: "2026-04-30",
      model_name: "gemini-test",
      analyzed_at: created,
    });
    assert.ok(!("analysis_id" in item));
  });

  it("latest_analysis é null quando a oportunidade não tem análise", async () => {
    const empty = {
      analysis_id: null,
      analysis_status: null,
      analysis_opportunity_category: null,
      analysis_opening_date: null,
      analysis_closing_date: null,
      analysis_model_name: null,
      analysis_analyzed_at: null,
    };
    const tx = new FakeTx(1, [row(empty)]);
    const result = await createOpportunitiesService(runnerWith(tx)).listOpportunities(q());
    assert.equal(result.items[0]?.latest_analysis, null);
  });

  it("página além da última devolve lista vazia com o total correto", async () => {
    const tx = new FakeTx(5, []);
    const result = await createOpportunitiesService(runnerWith(tx)).listOpportunities(q({ page: "9" }));
    assert.deepEqual(result, { items: [], pagination: { page: 9, page_size: 20, total: 5, total_pages: 1 } });
  });
});

// ---- Consulta individual ----------------------------------------------------

class DetailTx implements Queryable {
  readonly queries: { text: string; params: unknown[] }[] = [];

  constructor(
    private readonly opportunityRows: object[],
    private readonly analysisRows: object[],
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    this.queries.push({ text, params });
    let rows: object[] = [];
    if (/FROM opportunity_analyses a\s+WHERE a\.opportunity_id = \$1/.test(text)) rows = this.analysisRows;
    else if (/FROM opportunities o/.test(text)) rows = this.opportunityRows;
    return { rows: rows as T[], rowCount: rows.length, command: "", oid: 0, fields: [] };
  }
}

const ID = "11111111-1111-4111-8111-111111111111";

const opportunityRow = () => {
  const full = row({ id: ID });
  for (const key of Object.keys(full)) if (key.startsWith("analysis_")) delete full[key];
  return full;
};

const references = [
  { field: "title", document_url: "https://finep.gov.br/edital.pdf", page: 1, excerpt: "Edital de Inovação", basis: "stated" },
  { field: "funding_amount", document_url: null, excerpt: "R$ 1.500.000,50", basis: "inferred" },
];

const analysisRow = (overrides: Record<string, unknown> = {}) => ({
  id: "33333333-3333-4333-8333-333333333333",
  analysis_status: "needs_review",
  analysis_summary: "Resumo do edital.",
  opportunity_category: "grant",
  title: "Edital de Inovação",
  institution: "FINEP",
  objective: "Apoiar inovação.",
  observations: "Inscrições até 18h.",
  opening_date: "2026-03-01",
  closing_date: "2026-04-30",
  target_audience: ["startup"],
  requirements: { business_sizes: ["micro"] },
  eligible_locations: [{ scope: "national" }],
  required_documents: ["Contrato social"],
  funding_amount: "1500000.50",
  funding_currency: "BRL",
  counterpart_required: false,
  missing_information: [],
  source_references: references,
  model_name: "gemini-test",
  analyzed_at: created,
  created_at: created,
  ...overrides,
});

describe("getOpportunity (banco falso)", () => {
  it("numericToNumber converte o texto de numeric e preserva NULL", () => {
    assert.equal(numericToNumber("1500000.50"), 1500000.5);
    assert.equal(numericToNumber("0.00"), 0);
    assert.equal(numericToNumber(null), null);
  });

  it("consulta em transação somente leitura, por id parametrizado, a oportunidade e a última análise", async () => {
    const tx = new DetailTx([opportunityRow()], [analysisRow()]);
    await createOpportunitiesService(runnerWith(tx)).getOpportunity(ID);

    assert.equal(tx.queries.length, 3);
    assert.equal(tx.queries[0]?.text, "SET TRANSACTION READ ONLY");
    assert.match(tx.queries[1]?.text ?? "", /FROM opportunities o\s+JOIN opportunity_categories c ON c\.code = o\.category\s+WHERE o\.id = \$1/);
    assert.doesNotMatch(tx.queries[1]?.text ?? "", /opportunity_analyses/);
    assert.deepEqual(tx.queries[1]?.params, [ID]);
    const analysis = tx.queries[2]?.text ?? "";
    assert.match(analysis, /ORDER BY a\.created_at DESC, a\.id DESC\s+LIMIT 1/);
    assert.match(analysis, /a\.closing_date::text/);
    assert.match(analysis, /a\.funding_amount::text/);
    assert.match(analysis, /a\.source_references/);
    assert.deepEqual(tx.queries[2]?.params, [ID]);
  });

  it("separa opportunity (oficial) de latest_analysis (IA, não confirmada) com dados e evidências completos", async () => {
    const tx = new DetailTx([opportunityRow()], [analysisRow()]);
    const result = await createOpportunitiesService(runnerWith(tx)).getOpportunity(ID);

    assert.deepEqual(Object.keys(result), ["opportunity", "latest_analysis"]);
    assert.equal(result.opportunity.id, ID);
    assert.equal(result.opportunity.category, "unclassified");
    assert.ok(!("latest_analysis" in result.opportunity));
    assert.ok(!Object.keys(result.opportunity).some((key) => key.startsWith("analysis_")));

    assert.deepEqual(result.latest_analysis, {
      confirmed: false,
      id: "33333333-3333-4333-8333-333333333333",
      analysis_status: "needs_review",
      analysis_summary: "Resumo do edital.",
      suggested_category: "grant",
      title: "Edital de Inovação",
      institution: "FINEP",
      objective: "Apoiar inovação.",
      observations: "Inscrições até 18h.",
      opening_date: "2026-03-01",
      closing_date: "2026-04-30",
      target_audience: ["startup"],
      requirements: { business_sizes: ["micro"] },
      eligible_locations: [{ scope: "national" }],
      required_documents: ["Contrato social"],
      funding_amount: 1500000.5,
      funding_currency: "BRL",
      counterpart_required: false,
      missing_information: [],
      source_references: references,
      model_name: "gemini-test",
      analyzed_at: created,
      created_at: created,
    });
  });

  it("o contrato de opportunity é o mesmo dos itens da listagem (sem latest_analysis)", async () => {
    const listed = await createOpportunitiesService(runnerWith(new FakeTx(1, [row({ id: ID })]))).listOpportunities(q());
    const detail = await createOpportunitiesService(
      runnerWith(new DetailTx([opportunityRow()], [])),
    ).getOpportunity(ID);
    const { latest_analysis: _ignored, ...listedOpportunity } = listed.items[0] as NonNullable<(typeof listed.items)[0]>;
    assert.deepEqual(detail.opportunity, listedOpportunity);
  });

  it("latest_analysis é null quando não há análise", async () => {
    const tx = new DetailTx([opportunityRow()], []);
    const result = await createOpportunitiesService(runnerWith(tx)).getOpportunity(ID);
    assert.equal(result.latest_analysis, null);
  });

  it("lança AppError 404 opportunity_not_found e não consulta análises quando o id não existe", async () => {
    const tx = new DetailTx([], [analysisRow()]);
    await assert.rejects(
      createOpportunitiesService(runnerWith(tx)).getOpportunity(ID),
      (error: unknown) =>
        error instanceof AppError && error.statusCode === 404 && error.code === "opportunity_not_found",
    );
    assert.equal(tx.queries.length, 2);
  });
});
