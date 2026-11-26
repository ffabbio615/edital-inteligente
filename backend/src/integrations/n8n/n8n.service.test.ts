import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { Queryable, TransactionRunner } from "../../database/transaction";
import { AppError } from "../../errors/app-error";
import type { N8nIngestInput } from "./n8n.schemas";
import { ANALYSIS_CONTENT_PARAM_COUNT, buildAnalysisRecord, createN8nService } from "./n8n.service";

// Testes unitários com banco FALSO: verificam as regras do serviço e o SQL enviado.
// O comportamento no PostgreSQL real é coberto por n8n.service.integration.test.ts.

const OPPORTUNITY_ID = "11111111-1111-1111-1111-111111111111";
const EXISTING_ANALYSIS_ID = "22222222-2222-2222-2222-222222222222";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Posições dos parâmetros de conteúdo (iguais na busca de equivalente e na inserção).
const P = {
  opportunityId: 0,
  modelName: 1,
  title: 2,
  analysisSummary: 3,
  institution: 4,
  opportunityCategory: 5,
  objective: 6,
  observations: 7,
  openingDate: 8,
  closingDate: 9,
  targetAudience: 10,
  requirements: 11,
  eligibleLocations: 12,
  requiredDocuments: 13,
  fundingAmount: 14,
  fundingCurrency: 15,
  counterpartRequired: 16,
  missingInformation: 17,
  sourceReferences: 18,
  // Somente na inserção:
  analysisId: 19,
  status: 20,
  analyzedAt: 21,
} as const;

// Posições na inserção de opportunities.
const O = { title: 0, institution: 1, category: 2, sourceUrl: 3, sourceName: 4, externalId: 5, analysisId: 6 } as const;

// ---- Banco falso -------------------------------------------------------------

interface Handler {
  match: RegExp;
  rows?: object[] | ((params: unknown[]) => object[]);
  sequence?: object[][];
  error?: Error;
}

class FakeTx implements Queryable {
  readonly queries: { text: string; params: unknown[] }[] = [];

  constructor(private readonly handlers: Handler[]) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    this.queries.push({ text, params });
    const handler = this.handlers.find((candidate) => candidate.match.test(text));
    if (handler?.error) {
      throw handler.error;
    }
    const fixed = typeof handler?.rows === "function" ? handler.rows(params) : handler?.rows;
    const rows = (handler?.sequence ? (handler.sequence.shift() ?? []) : (fixed ?? [])) as T[];
    return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
  }

  find(pattern: RegExp) {
    return this.queries.filter((query) => pattern.test(query.text));
  }

  one(pattern: RegExp) {
    const found = this.find(pattern);
    assert.equal(found.length, 1, `esperava exatamente uma consulta ${pattern}`);
    return found[0] as { text: string; params: unknown[] };
  }
}

function happyHandlers(): Handler[] {
  return [
    { match: /pg_advisory_xact_lock/, rows: [{}] },
    { match: /FROM profile_types/, rows: [{ code: "startup" }, { code: "company" }] },
    { match: /FROM opportunities WHERE/, rows: [] },
    { match: /FROM opportunity_categories/, rows: [{ one: 1 }] },
    { match: /INSERT INTO opportunities/, rows: [{ id: OPPORTUNITY_ID }] },
    { match: /FROM opportunity_analyses/, rows: [] },
    // Devolve o id recebido, como o banco faria.
    { match: /INSERT INTO opportunity_analyses/, rows: (params) => [{ id: params[P.analysisId] }] },
  ];
}

function setup(overrides: Handler[] = []) {
  const tx = new FakeTx([...overrides, ...happyHandlers()]);

  const outcome = { committed: false, rolledBack: false };
  const runInTransaction: TransactionRunner = async (work) => {
    try {
      const result = await work(tx);
      outcome.committed = true;
      return result;
    } catch (error) {
      outcome.rolledBack = true;
      throw error;
    }
  };
  return { tx, outcome, service: createN8nService(runInTransaction) };
}

const existingOpportunity: Handler = { match: /FROM opportunities WHERE/, rows: [{ id: OPPORTUNITY_ID }] };

// ---- Entrada ---------------------------------------------------------------

function reference(field: string, basis: "stated" | "inferred" = "stated") {
  return {
    field: field as never,
    document_url: "https://exemplo.gov.br/edital.pdf",
    excerpt: `Trecho do edital sobre ${field}.`,
    basis,
  };
}

const ALL_FIELDS = [
  "title",
  "institution",
  "opportunity_category",
  "objective",
  "observations",
  "opening_date",
  "closing_date",
  "target_audience",
  "requirements.business_sizes",
  "funding_amount",
  "funding_currency",
  "counterpart_required",
  "required_documents",
];

function baseInput(
  analysis: Partial<N8nIngestInput["analysis"]> = {},
  source: Partial<N8nIngestInput["source"]> = {},
): N8nIngestInput {
  return {
    source: {
      source_name: "finep",
      external_id: "EDITAL-2026-01",
      source_url: "https://www.finep.gov.br/edital/1",
      ...source,
    },
    model_name: "gemini-test",
    analysis: {
      title: "Edital de Inovação",
      analysis_summary: "Resumo do edital.",
      institution: "Finep",
      objective: "Apoiar projetos de inovação.",
      opportunity_category: "grant",
      target_audience: ["startup", "company"],
      eligibility_criteria: { business_sizes: ["micro", "small"] },
      funding_amount: 500000,
      funding_currency: "BRL",
      counterpart_required: false,
      required_documents: ["Plano de negócios"],
      opening_date: "2026-03-01",
      closing_date: "2026-04-30",
      source_references: ALL_FIELDS.map((field) => reference(field)),
      missing_information: ["eligible_locations"],
      observations: "Prazo sujeito a prorrogação.",
      ...analysis,
    },
  };
}

// Só o título (obrigatório) e sua referência.
function minimalInput(analysis: Partial<N8nIngestInput["analysis"]> = {}): N8nIngestInput {
  return {
    source: { source_name: "finep", external_id: "EDITAL-2026-01" },
    model_name: "gemini-test",
    analysis: { title: "Edital de Inovação", source_references: [reference("title")], ...analysis },
  };
}

// ---- Criação da oportunidade -----------------------------------------------

describe("n8n service: criação da oportunidade (identificação provisória)", () => {
  it("cria a oportunidade e registra a análise na mesma transação, sob advisory lock", async () => {
    const { tx, outcome, service } = setup();

    const result = await service.ingestOpportunityAnalysis(baseInput());

    assert.deepEqual(result.opportunity, { id: OPPORTUNITY_ID, action: "created" });
    assert.equal(result.analysis.action, "created");
    assert.equal(result.analysis.status, "completed");
    assert.match(result.analysis.id, UUID_PATTERN);
    assert.equal(outcome.committed, true);
    assert.equal(outcome.rolledBack, false);
    assert.match(tx.queries[0]?.text ?? "", /pg_advisory_xact_lock/);
    assert.equal(tx.queries[0]?.params[0], "ext|finep|EDITAL-2026-01");
    assert.match(tx.one(/INSERT INTO opportunities/).text, /ON CONFLICT DO NOTHING/);
  });

  it("[4][5] cria sem categoria confirmada usando a categoria operacional unclassified", async () => {
    const { tx, service } = setup();
    await service.ingestOpportunityAnalysis(baseInput({ opportunity_category: "grant" }));

    const insert = tx.one(/INSERT INTO opportunities/);
    assert.equal(insert.params[O.category], "unclassified");
    // A sugestão da IA não é promovida.
    assert.ok(!insert.params.includes("grant"));
    assert.doesNotMatch(insert.text, /category_verified_at/);
  });

  it("[6] grava o título como provisório (sem title_verified_at) com procedência na análise", async () => {
    const { tx, service } = setup();
    const result = await service.ingestOpportunityAnalysis(baseInput());

    const insert = tx.one(/INSERT INTO opportunities/);
    assert.equal(insert.params[O.title], "Edital de Inovação");
    assert.doesNotMatch(insert.text, /verified_at/);
    // identification_analysis_id = id da análise inserida em seguida.
    assert.match(insert.text, /identification_analysis_id/);
    assert.equal(insert.params[O.analysisId], result.analysis.id);
    assert.equal(tx.one(/INSERT INTO opportunity_analyses/).params[P.analysisId], result.analysis.id);
  });

  it("[7] grava a instituição como provisória e NULL quando não informada", async () => {
    const withInstitution = setup();
    await withInstitution.service.ingestOpportunityAnalysis(baseInput());
    assert.equal(withInstitution.tx.one(/INSERT INTO opportunities/).params[O.institution], "Finep");

    const without = setup();
    await without.service.ingestOpportunityAnalysis(minimalInput());
    assert.equal(without.tx.one(/INSERT INTO opportunities/).params[O.institution], null);
  });

  it("[10] não grava em opportunities nenhum dado confirmado (critérios, valores, datas, status)", async () => {
    const { tx, service } = setup();
    await service.ingestOpportunityAnalysis(baseInput());

    const insert = tx.one(/INSERT INTO opportunities/);
    assert.doesNotMatch(
      insert.text,
      /funding|deadline|opening_date|eligib|target_audience|status|counterpart|description|publication|verified_at/i,
    );
    assert.deepEqual(insert.params.slice(0, 6), [
      "Edital de Inovação",
      "Finep",
      "unclassified",
      "https://www.finep.gov.br/edital/1",
      "finep",
      "EDITAL-2026-01",
    ]);
    // As datas extraídas não chegam a opportunities.
    assert.ok(!insert.params.includes("2026-03-01"));
    assert.ok(!insert.params.includes("2026-04-30"));
    assert.equal(tx.find(/UPDATE/i).length, 0);
  });

  it("identifica por source_url quando não há external_id", async () => {
    const { tx, service } = setup();
    await service.ingestOpportunityAnalysis(baseInput({}, { external_id: undefined }));

    assert.match(tx.queries[0]?.params[0] as string, /^url\|finep\|https:\/\/www\.finep\.gov\.br/);
    const lookup = tx.find(/FROM opportunities WHERE/)[0];
    assert.match(lookup?.text ?? "", /external_id IS NULL AND source_url = \$2/);
  });
});

// ---- Histórico da análise --------------------------------------------------

describe("n8n service: histórico da análise", () => {
  it("[8][9] preserva identificação, objetivo, observações e datas na análise", async () => {
    const { tx, service } = setup();
    await service.ingestOpportunityAnalysis(baseInput());

    const params = tx.one(/INSERT INTO opportunity_analyses/).params;
    assert.equal(params[P.opportunityId], OPPORTUNITY_ID);
    assert.equal(params[P.modelName], "gemini-test");
    assert.equal(params[P.title], "Edital de Inovação");
    assert.equal(params[P.analysisSummary], "Resumo do edital.");
    assert.equal(params[P.institution], "Finep");
    assert.equal(params[P.opportunityCategory], "grant");
    assert.equal(params[P.objective], "Apoiar projetos de inovação.");
    assert.equal(params[P.observations], "Prazo sujeito a prorrogação.");
    assert.equal(params[P.openingDate], "2026-03-01");
    assert.equal(params[P.closingDate], "2026-04-30");
    assert.match(tx.one(/INSERT INTO opportunity_analyses/).text, /\$9::date, \$10::date/);
  });

  it("grava os critérios como JSON serializado, com status e modelo", async () => {
    const { tx, service } = setup();
    await service.ingestOpportunityAnalysis(baseInput());

    const insert = tx.one(/INSERT INTO opportunity_analyses/);
    assert.equal(insert.params[P.targetAudience], JSON.stringify(["startup", "company"]));
    assert.equal(insert.params[P.requirements], JSON.stringify({ business_sizes: ["micro", "small"] }));
    assert.equal(insert.params[P.eligibleLocations], null);
    assert.equal(insert.params[P.fundingAmount], 500000);
    assert.equal(insert.params[P.fundingCurrency], "BRL");
    assert.equal(insert.params[P.counterpartRequired], false);
    assert.equal(insert.params[P.status], "completed");
    assert.equal(insert.params[P.analyzedAt], null);
    assert.match(insert.text, /analysis_summary/);
    assert.equal(insert.params[P.analysisSummary], "Resumo do edital.");
  });

  it("[1] categoria sugerida ausente: não consulta categorias e grava NULL na análise", async () => {
    const { tx, service } = setup();
    const result = await service.ingestOpportunityAnalysis(minimalInput());

    assert.equal(tx.find(/FROM opportunity_categories/).length, 0);
    assert.equal(tx.one(/INSERT INTO opportunity_analyses/).params[P.opportunityCategory], null);
    assert.equal(tx.one(/INSERT INTO opportunities/).params[O.category], "unclassified");
    // Categoria ausente não exige referência.
    assert.equal(result.analysis.status, "completed");
  });

  it("[2][24] categoria sugerida válida: validada e preservada só na análise", async () => {
    const { tx, service } = setup();
    await service.ingestOpportunityAnalysis(
      minimalInput({
        opportunity_category: "acceleration",
        source_references: [reference("title"), reference("opportunity_category")],
      }),
    );

    assert.deepEqual(tx.one(/FROM opportunity_categories/).params, ["acceleration"]);
    assert.match(tx.one(/FROM opportunity_categories/).text, /is_active/);
    assert.equal(tx.one(/INSERT INTO opportunity_analyses/).params[P.opportunityCategory], "acceleration");
    assert.equal(tx.one(/INSERT INTO opportunities/).params[O.category], "unclassified");
  });

  it("[9] campos ausentes ficam NULL (datas, instituição, objetivo, observações)", async () => {
    const { tx, service } = setup();
    await service.ingestOpportunityAnalysis(minimalInput());

    const params = tx.one(/INSERT INTO opportunity_analyses/).params;
    for (const position of [P.institution, P.objective, P.observations, P.openingDate, P.closingDate]) {
      assert.equal(params[position], null);
    }
  });
});

// ---- Duplicidade, reenvio e idempotência -----------------------------------

describe("n8n service: oportunidade existente, reenvio e idempotência", () => {
  it("[18][19] não altera oportunidade existente e registra uma nova análise no histórico", async () => {
    const { tx, service } = setup([existingOpportunity]);

    const result = await service.ingestOpportunityAnalysis(
      baseInput({ title: "Título diferente", institution: "Outra", opportunity_category: "award" }),
    );

    assert.deepEqual(result.opportunity, { id: OPPORTUNITY_ID, action: "unchanged" });
    assert.equal(result.analysis.action, "created");
    assert.equal(tx.find(/INSERT INTO opportunities/).length, 0);
    assert.equal(tx.find(/UPDATE/i).length, 0);
    // O que a IA extraiu agora fica no histórico, não na oportunidade.
    const params = tx.one(/INSERT INTO opportunity_analyses/).params;
    assert.equal(params[P.title], "Título diferente");
    assert.equal(params[P.institution], "Outra");
    assert.equal(params[P.opportunityCategory], "award");
  });

  it("[24] valida a categoria sugerida também para oportunidade existente (FK da análise)", async () => {
    const { tx, service } = setup([existingOpportunity, { match: /FROM opportunity_categories/, rows: [] }]);

    await assert.rejects(
      service.ingestOpportunityAnalysis(baseInput()),
      (error: unknown) => error instanceof AppError && error.code === "unknown_opportunity_category",
    );
    assert.equal(tx.find(/INSERT/).length, 0);
  });

  it("[20] reenvio idempotente: não duplica a análise de mesmo conteúdo", async () => {
    const { tx, service } = setup([
      existingOpportunity,
      { match: /FROM opportunity_analyses/, rows: [{ id: EXISTING_ANALYSIS_ID, analysis_status: "completed" }] },
    ]);

    const result = await service.ingestOpportunityAnalysis(baseInput());

    assert.equal(result.opportunity.action, "unchanged");
    assert.deepEqual(result.analysis, { id: EXISTING_ANALYSIS_ID, action: "already_registered", status: "completed" });
    assert.equal(tx.find(/INSERT INTO opportunity_analyses/).length, 0);
  });

  it("[21] a busca de equivalente compara TODAS as colunas de conteúdo persistidas", async () => {
    const { tx, service } = setup();
    await service.ingestOpportunityAnalysis(baseInput());

    const search = tx.one(/FROM opportunity_analyses/);
    const insert = tx.one(/INSERT INTO opportunity_analyses/);
    assert.equal(search.params.length, ANALYSIS_CONTENT_PARAM_COUNT);
    assert.deepEqual(search.params, insert.params.slice(0, ANALYSIS_CONTENT_PARAM_COUNT));

    const columns = [
      "model_name", "title", "analysis_summary", "institution", "opportunity_category", "objective", "observations",
      "opening_date", "closing_date", "target_audience", "requirements", "eligible_locations",
      "required_documents", "funding_amount", "funding_currency", "counterpart_required",
      "missing_information", "source_references",
    ];
    for (const column of columns) {
      assert.match(search.text, new RegExp(`AND ${column} IS NOT DISTINCT FROM \\$\\d+::`), column);
    }
    // Toda coluna de conteúdo inserida também é comparada.
    const insertedColumns = /\(([^)]*)\)\s*VALUES/s.exec(insert.text)?.[1]?.split(",").map((c) => c.trim()) ?? [];
    for (const column of insertedColumns) {
      if (["opportunity_id", "id", "analysis_status", "analyzed_at"].includes(column)) continue;
      assert.ok(columns.includes(column), `coluna ${column} inserida mas não comparada`);
    }
  });

  it("[21] mudança de procedência, datas ou identificação muda os parâmetros comparados", () => {
    const base = buildAnalysisRecord(baseInput());
    const variants: Partial<N8nIngestInput["analysis"]>[] = [
      { title: "Outro título" },
      { analysis_summary: "Outro resumo." },
      { institution: "Outra instituição" },
      { opportunity_category: "award" },
      { objective: "Outro objetivo" },
      { observations: "Outra observação" },
      { opening_date: "2026-03-02" },
      { closing_date: "2026-05-01" },
      { source_references: ALL_FIELDS.map((field) => reference(field, field === "title" ? "inferred" : "stated")) },
    ];
    for (const variant of variants) {
      const changed = buildAnalysisRecord(baseInput(variant));
      assert.notDeepEqual(changed, base, JSON.stringify(variant));
    }
  });

  it("recupera a oportunidade quando um insert concorrente vence a corrida", async () => {
    const { service } = setup([
      { match: /FROM opportunities WHERE/, sequence: [[], [{ id: OPPORTUNITY_ID }]] },
      { match: /INSERT INTO opportunities/, rows: [] },
    ]);

    const result = await service.ingestOpportunityAnalysis(baseInput());

    assert.deepEqual(result.opportunity, { id: OPPORTUNITY_ID, action: "unchanged" });
    assert.equal(result.analysis.action, "created");
  });

  it("retorna 409 se o conflito não puder ser resolvido", async () => {
    const { service, outcome } = setup([{ match: /INSERT INTO opportunities/, rows: [] }]);

    await assert.rejects(
      service.ingestOpportunityAnalysis(baseInput()),
      (error: unknown) => error instanceof AppError && error.statusCode === 409,
    );
    assert.equal(outcome.rolledBack, true);
  });
});

// ---- Dados de referência ---------------------------------------------------

describe("n8n service: códigos de referência", () => {
  it("[3][24] rejeita categoria sugerida desconhecida ou inativa (422) sem gravar nada", async () => {
    const { tx, outcome, service } = setup([{ match: /FROM opportunity_categories/, rows: [] }]);

    await assert.rejects(
      service.ingestOpportunityAnalysis(baseInput({ opportunity_category: "inexistente" })),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 422 &&
        error.code === "unknown_opportunity_category" &&
        error.details?.[0]?.path === "analysis.opportunity_category",
    );
    assert.equal(tx.find(/INSERT/).length, 0);
    assert.equal(outcome.rolledBack, true);
  });

  it("[23] rejeita target_audience desconhecido ou inativo (422) sem gravar nada", async () => {
    const { tx, service } = setup([{ match: /FROM profile_types/, rows: [{ code: "startup" }] }]);

    await assert.rejects(service.ingestOpportunityAnalysis(baseInput()), (error: unknown) => {
      return (
        error instanceof AppError &&
        error.statusCode === 422 &&
        error.code === "unknown_target_audience" &&
        error.details?.[0]?.message.includes("company") === true
      );
    });
    assert.equal(tx.find(/INSERT/).length, 0);
  });

  it("[23] valida perfis ativos contra profile_types", async () => {
    const { tx, service } = setup();
    await service.ingestOpportunityAnalysis(baseInput());
    const lookup = tx.one(/FROM profile_types/);
    assert.match(lookup.text, /is_active/);
    assert.deepEqual(lookup.params, [["startup", "company"]]);
  });
});

// ---- Referências e status --------------------------------------------------

describe("n8n service: referências por campo e status", () => {
  it("[12][17] completed quando todos os campos extraídos têm referência stated própria", () => {
    const record = buildAnalysisRecord(baseInput());
    assert.equal(record.status, "completed");
    assert.deepEqual(record.fieldsWithoutReference, []);
    assert.deepEqual(record.fieldsInferredOnly, []);
  });

  it("[13][16] needs_review quando um campo só tem referência inferred", async () => {
    const references = ALL_FIELDS.map((field) => reference(field, field === "closing_date" ? "inferred" : "stated"));
    const { tx, service } = setup();

    const result = await service.ingestOpportunityAnalysis(baseInput({ source_references: references }));

    assert.equal(result.analysis.status, "needs_review");
    assert.deepEqual(result.review.fields_inferred_only, ["closing_date"]);
    assert.deepEqual(result.review.fields_without_reference, []);
    assert.equal(tx.one(/INSERT INTO opportunity_analyses/).params[P.status], "needs_review");
  });

  it("[13] referência stated e inferred para o mesmo campo: stated prevalece", () => {
    const record = buildAnalysisRecord(
      minimalInput({ source_references: [reference("title", "inferred"), reference("title", "stated")] }),
    );
    assert.equal(record.status, "completed");
  });

  it("[14][16] needs_review quando um campo extraído não tem referência", () => {
    const references = ALL_FIELDS.filter((field) => field !== "counterpart_required").map((field) => reference(field));
    const record = buildAnalysisRecord(baseInput({ source_references: references }));
    assert.equal(record.status, "needs_review");
    assert.deepEqual(record.fieldsWithoutReference, ["counterpart_required"]);
  });

  it("[14] o título é sempre extraído e também exige referência", () => {
    const record = buildAnalysisRecord(minimalInput({ source_references: undefined }));
    assert.equal(record.status, "needs_review");
    assert.deepEqual(record.fieldsWithoutReference, ["title"]);
  });

  it("[11][15] referência individual: a de um campo não vale para outro", () => {
    const pairs: [Partial<N8nIngestInput["analysis"]>, string, string][] = [
      [{ funding_amount: 10, funding_currency: "BRL" }, "funding_amount", "funding_currency"],
      [{ opening_date: "2026-03-01", closing_date: "2026-04-30" }, "opening_date", "closing_date"],
      [{ objective: "Objetivo", observations: "Obs" }, "objective", "observations"],
      [{ institution: "Finep", opportunity_category: "grant" }, "institution", "opportunity_category"],
      [{ eligibility_criteria: { segments: ["agro"], business_sizes: ["micro"] } }, "requirements.segments", "requirements.business_sizes"],
    ];
    for (const [fields, referenced, missing] of pairs) {
      const record = buildAnalysisRecord(
        minimalInput({ ...fields, source_references: [reference("title"), reference(referenced)] }),
      );
      assert.deepEqual(record.fieldsWithoutReference, [missing], `${referenced} não cobre ${missing}`);
      assert.equal(record.status, "needs_review");
    }
  });

  it("[11] lista cada campo extraído sem referência, inclusive os novos", () => {
    const record = buildAnalysisRecord(baseInput({ source_references: [reference("title")] }));
    assert.deepEqual([...record.fieldsWithoutReference].sort(), ALL_FIELDS.filter((field) => field !== "title").sort());
  });

  it("campos ausentes não exigem referência", () => {
    const record = buildAnalysisRecord(minimalInput());
    assert.equal(record.status, "completed");
    assert.equal(record.requirements, null);
    assert.equal(record.missingInformation, null);
    assert.equal(record.opportunityCategory, null);
    assert.equal(record.openingDate, null);
  });
});

// ---- Falhas ----------------------------------------------------------------

describe("n8n service: falha de persistência", () => {
  it("[22] propaga o erro e faz rollback de tudo, inclusive da oportunidade já inserida", async () => {
    const failure = new Error("falha ao gravar a análise");
    const { tx, outcome, service } = setup([{ match: /INSERT INTO opportunity_analyses/, error: failure }]);

    await assert.rejects(service.ingestOpportunityAnalysis(baseInput()), (error: unknown) => error === failure);

    assert.equal(tx.find(/INSERT INTO opportunities/).length, 1);
    assert.equal(outcome.rolledBack, true);
    assert.equal(outcome.committed, false);
  });
});
