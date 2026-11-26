import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { n8nIngestSchema } from "./n8n.schemas";

const baseReference = {
  field: "target_audience",
  document_url: "https://exemplo.gov.br/edital.pdf",
  excerpt: "Podem participar startups.",
  basis: "stated",
};

function validBody(
  analysis: Record<string, unknown> = {},
  source: Record<string, unknown> = {},
  root: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source: {
      source_name: "finep",
      external_id: "EDITAL-2026-01",
      source_url: "https://www.finep.gov.br/edital/1",
      ...source,
    },
    model_name: "gemini-2.5-flash-lite",
    analysis: {
      title: "Edital de Inovação",
      institution: "Finep",
      objective: "Apoiar projetos de inovação.",
      opportunity_category: "grant",
      target_audience: ["startup"],
      eligibility_criteria: { business_sizes: ["micro", "small"], min_organization_age_months: 6 },
      funding_amount: 500000,
      funding_currency: "BRL",
      opening_date: "2026-03-01",
      closing_date: "2026-04-30",
      required_documents: ["Plano de negócios"],
      counterpart_required: false,
      source_references: [baseReference],
      missing_information: ["eligible_locations"],
      observations: "Prazo sujeito a prorrogação.",
      ...analysis,
    },
    ...root,
  };
}

function paths(body: unknown): string[] {
  const result = n8nIngestSchema.safeParse(body);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

function accepts(body: unknown): boolean {
  return n8nIngestSchema.safeParse(body).success;
}

function withReference(reference: Record<string, unknown>): Record<string, unknown> {
  return validBody({ source_references: [reference] });
}

describe("n8nIngestSchema: requisição válida e normalização", () => {
  it("aceita um payload completo", () => {
    assert.equal(accepts(validBody()), true);
  });

  it("normaliza textos, códigos, moeda e listas", () => {
    const result = n8nIngestSchema.safeParse(
      validBody({
        title: "  Edital X  ",
        opportunity_category: " GRANT ",
        target_audience: [" Startup ", "startup", "COMPANY"],
        funding_currency: "brl",
        institution: "   ",
        required_documents: [],
        eligible_locations: [],
        missing_information: ["a", "a", "b"],
      }),
    );
    assert.ok(result.success);
    const analysis = result.data.analysis;
    assert.equal(analysis.title, "Edital X");
    assert.equal(analysis.opportunity_category, "grant");
    assert.deepEqual(analysis.target_audience, ["startup", "company"]);
    assert.equal(analysis.funding_currency, "BRL");
    assert.equal(analysis.institution, undefined);
    assert.equal(analysis.required_documents, undefined);
    assert.equal(analysis.eligible_locations, undefined);
    assert.deepEqual(analysis.missing_information, ["a", "b"]);
  });

  it("trata null como ausente e preserva [] em missing_information", () => {
    const result = n8nIngestSchema.safeParse(
      validBody({
        institution: null,
        target_audience: null,
        eligibility_criteria: null,
        funding_amount: null,
        funding_currency: null,
        counterpart_required: null,
        source_references: null,
        missing_information: [],
      }),
    );
    assert.ok(result.success);
    assert.equal(result.data.analysis.institution, undefined);
    assert.equal(result.data.analysis.target_audience, undefined);
    assert.equal(result.data.analysis.eligibility_criteria, undefined);
    assert.equal(result.data.analysis.funding_amount, undefined);
    assert.equal(result.data.analysis.counterpart_required, undefined);
    assert.equal(result.data.analysis.source_references, undefined);
    assert.deepEqual(result.data.analysis.missing_information, []);
  });

  it("rejeita chaves desconhecidas na raiz, na análise e nos critérios", () => {
    assert.equal(accepts(validBody({}, {}, { extra: 1 })), false);
    assert.equal(accepts(validBody({ confidence: 0.9 })), false);
    assert.equal(accepts(validBody({ eligibility_criteria: { unknown_key: ["x"] } })), false);
  });

  it("rejeita payload sem os campos obrigatórios", () => {
    assert.equal(accepts({}), false);
    assert.ok(paths(validBody({ title: "" })).includes("analysis.title"));
    assert.ok(paths(validBody({ title: null })).includes("analysis.title"));
    assert.ok(paths(validBody({ opportunity_category: "Fomento Público" })).includes("analysis.opportunity_category"));
    assert.ok(paths(validBody({}, {}, { model_name: "" })).includes("model_name"));
    assert.ok(paths(validBody({}, {}, { analyzed_at: "ontem" })).includes("analyzed_at"));
  });
});

describe("n8nIngestSchema: identificação da oportunidade (source)", () => {
  it("exige external_id ou source_url", () => {
    assert.equal(accepts(validBody({}, { external_id: null, source_url: null })), false);
    assert.ok(paths(validBody({}, { external_id: null, source_url: null })).includes("source.external_id"));
    assert.equal(accepts(validBody({}, { external_id: null })), true);
    assert.equal(accepts(validBody({}, { source_url: null })), true);
  });

  it("rejeita source_url que não seja http ou https", () => {
    assert.equal(accepts(validBody({}, { source_url: "ftp://exemplo.gov.br/x" })), false);
  });
});

describe("n8nIngestSchema: source_references e document_url", () => {
  it("aceita document_url com URL http ou https", () => {
    assert.equal(accepts(withReference({ ...baseReference, document_url: "https://exemplo.gov.br/e.pdf" })), true);
    assert.equal(accepts(withReference({ ...baseReference, document_url: "http://exemplo.gov.br/e.pdf" })), true);
  });

  it("aceita document_url null e preserva o null", () => {
    const result = n8nIngestSchema.safeParse(withReference({ ...baseReference, document_url: null }));
    assert.ok(result.success);
    assert.equal(result.data.analysis.source_references?.[0]?.document_url, null);
  });

  it("aceita referência sem document_url e não cria a chave", () => {
    const { document_url: _omitted, ...withoutUrl } = baseReference;
    const result = n8nIngestSchema.safeParse(withReference(withoutUrl));
    assert.ok(result.success);
    const reference = result.data.analysis.source_references?.[0];
    assert.ok(reference);
    assert.equal("document_url" in reference, false);
  });

  it("rejeita document_url com formato inválido", () => {
    const invalid = [
      "exemplo.gov.br/e.pdf",
      "ftp://exemplo.gov.br/e.pdf",
      "javascript:alert(1)",
      "https:/exemplo.gov.br",
      "https://",
      "",
      "   ",
      123,
      true,
      {},
    ];
    for (const value of invalid) {
      const body = withReference({ ...baseReference, document_url: value });
      assert.equal(accepts(body), false, `document_url ${JSON.stringify(value)} deveria ser rejeitado`);
      assert.ok(paths(body).includes("analysis.source_references.0.document_url"));
    }
  });

  it("mantém a exigência de field, excerpt e basis", () => {
    const { basis: _basis, ...withoutBasis } = baseReference;
    const { excerpt: _excerpt, ...withoutExcerpt } = baseReference;
    const { field: _field, ...withoutField } = baseReference;
    assert.equal(accepts(withReference(withoutBasis)), false);
    assert.equal(accepts(withReference(withoutExcerpt)), false);
    assert.equal(accepts(withReference(withoutField)), false);
    assert.equal(accepts(withReference({ ...baseReference, excerpt: "   " })), false);
    assert.equal(accepts(withReference({ ...baseReference, field: "outro_campo" })), false);
  });

  it("aceita somente stated ou inferred como string em basis", () => {
    assert.equal(accepts(withReference({ ...baseReference, basis: "stated" })), true);
    assert.equal(accepts(withReference({ ...baseReference, basis: "inferred" })), true);
    for (const value of ["guess", "STATED", 1, null, true, ["stated"]]) {
      assert.equal(accepts(withReference({ ...baseReference, basis: value })), false);
    }
  });

  it("aceita funding_currency e requirements.* como field", () => {
    assert.equal(accepts(withReference({ ...baseReference, field: "funding_currency" })), true);
    assert.equal(accepts(withReference({ ...baseReference, field: "requirements.business_sizes" })), true);
  });

  it("aceita os campos de identificação, conteúdo e datas como field", () => {
    for (const field of [
      "title",
      "institution",
      "opportunity_category",
      "objective",
      "observations",
      "opening_date",
      "closing_date",
    ]) {
      assert.equal(accepts(withReference({ ...baseReference, field })), true, field);
    }
  });

  it("rejeita field fora do contrato (inclusive nomes antigos ou de colunas confirmadas)", () => {
    for (const field of ["deadline", "category", "eligibility_criteria", "requirements", "analysis_summary"]) {
      assert.equal(accepts(withReference({ ...baseReference, field })), false, field);
    }
  });

  it("valida page e section opcionais e rejeita chaves extras", () => {
    assert.equal(accepts(withReference({ ...baseReference, page: 4, section: "3.2" })), true);
    assert.equal(accepts(withReference({ ...baseReference, page: null, section: null })), true);
    assert.equal(accepts(withReference({ ...baseReference, page: 0 })), false);
    assert.equal(accepts(withReference({ ...baseReference, extra: "x" })), false);
  });
});

describe("n8nIngestSchema: valores financeiros", () => {
  it("exige moeda quando há valor", () => {
    const body = validBody({ funding_amount: 1000, funding_currency: null });
    assert.equal(accepts(body), false);
    assert.ok(paths(body).includes("analysis.funding_currency"));
    assert.equal(accepts(validBody({ funding_amount: null, funding_currency: null })), true);
  });

  it("rejeita valor negativo, texto e mais de duas casas decimais", () => {
    assert.equal(accepts(validBody({ funding_amount: -1 })), false);
    assert.equal(accepts(validBody({ funding_amount: "1000" })), false);
    assert.equal(accepts(validBody({ funding_amount: 10.123 })), false);
    assert.equal(accepts(validBody({ funding_amount: 10.5 })), true);
  });

  it("rejeita moeda fora do formato de 3 letras", () => {
    assert.equal(accepts(validBody({ funding_currency: "REAL" })), false);
  });
});

describe("n8nIngestSchema: eligible_locations", () => {
  it("aceita national, state e city com as propriedades corretas", () => {
    const locations = [
      { scope: "national" },
      { scope: "state", state: "RJ" },
      { scope: "city", state: "SP", city: "Campinas" },
    ];
    assert.equal(accepts(validBody({ eligible_locations: locations })), true);
  });

  it("rejeita propriedades incompatíveis com o escopo", () => {
    const invalid = [
      { scope: "national", state: "SP" },
      { scope: "national", city: "Campinas" },
      { scope: "national", state: null },
      { scope: "state" },
      { scope: "state", state: "SP", city: "Campinas" },
      { scope: "city", state: "SP" },
      { scope: "city", city: "Campinas" },
      { scope: "state", state: "XX" },
      { scope: "region", state: "SP" },
    ];
    for (const location of invalid) {
      assert.equal(
        accepts(validBody({ eligible_locations: [location] })),
        false,
        `${JSON.stringify(location)} deveria ser rejeitado`,
      );
    }
  });
});

describe("n8nIngestSchema: eligibility_criteria", () => {
  it("rejeita porte fora do conjunto, idade invertida e estágio fora de snake_case", () => {
    assert.equal(accepts(validBody({ eligibility_criteria: { business_sizes: ["xl"] } })), false);
    assert.equal(
      accepts(validBody({ eligibility_criteria: { min_organization_age_months: 24, max_organization_age_months: 12 } })),
      false,
    );
    assert.equal(accepts(validBody({ eligibility_criteria: { min_organization_age_months: -1 } })), false);
    assert.equal(accepts(validBody({ eligibility_criteria: { organization_stages: ["Early Stage"] } })), false);
    assert.equal(accepts(validBody({ eligibility_criteria: { organization_stages: ["early_stage"] } })), true);
  });
});

describe("n8nIngestSchema: datas (YYYY-MM-DD, sem horário)", () => {
  it("aceita datas ISO de calendário e preserva o valor sem converter", () => {
    const result = n8nIngestSchema.safeParse(validBody({ opening_date: " 2026-03-01 ", closing_date: "2026-04-30" }));
    assert.ok(result.success);
    assert.equal(result.data.analysis.opening_date, "2026-03-01");
    assert.equal(result.data.analysis.closing_date, "2026-04-30");
  });

  it("rejeita outros formatos, datas inexistentes e horários", () => {
    const invalid = [
      "01/03/2026",
      "amanhã",
      "2026-3-1",
      "2026-02-30",
      "2026-13-01",
      "2026-04-30T23:59:00Z",
      "2026-04-30T23:59:00-03:00",
      "2026-04-30 23:59",
      20260430,
    ];
    for (const value of invalid) {
      const body = validBody({ opening_date: null, closing_date: value });
      assert.equal(accepts(body), false, `closing_date ${JSON.stringify(value)} deveria ser rejeitada`);
      assert.ok(paths(body).includes("analysis.closing_date"));
    }
    assert.equal(accepts(validBody({ opening_date: "2028-02-29", closing_date: null })), true);
  });

  it("null ou ausente significa não informado (nunca uma data inventada)", () => {
    const result = n8nIngestSchema.safeParse(validBody({ opening_date: null, closing_date: undefined }));
    assert.ok(result.success);
    assert.equal(result.data.analysis.opening_date, undefined);
    assert.equal(result.data.analysis.closing_date, undefined);
  });

  it("rejeita closing_date anterior a opening_date", () => {
    const body = validBody({ opening_date: "2026-05-01", closing_date: "2026-04-30" });
    assert.equal(accepts(body), false);
    assert.ok(paths(body).includes("analysis.closing_date"));
    assert.equal(accepts(validBody({ opening_date: "2026-04-30", closing_date: "2026-04-30" })), true);
  });
});

describe("n8nIngestSchema: categoria sugerida", () => {
  it("aceita categoria ausente ou null (sem classificação segura)", () => {
    for (const value of [null, undefined]) {
      const result = n8nIngestSchema.safeParse(validBody({ opportunity_category: value }));
      assert.ok(result.success);
      assert.equal(result.data.analysis.opportunity_category, undefined);
    }
  });

  it("rejeita unclassified como sugestão da IA (marcador operacional do banco)", () => {
    for (const value of ["unclassified", " UNCLASSIFIED "]) {
      const body = validBody({ opportunity_category: value });
      assert.equal(accepts(body), false);
      assert.ok(paths(body).includes("analysis.opportunity_category"));
    }
  });

  it("aceita código no formato correto (existência validada pelo serviço)", () => {
    assert.equal(accepts(validBody({ opportunity_category: "acceleration" })), true);
    assert.equal(accepts(validBody({ opportunity_category: "" })), false);
  });
});

describe("n8nIngestSchema: identificação e textos extraídos", () => {
  it("aceita instituição, objetivo e observações ausentes", () => {
    const result = n8nIngestSchema.safeParse(validBody({ institution: null, objective: undefined, observations: "  " }));
    assert.ok(result.success);
    assert.equal(result.data.analysis.institution, undefined);
    assert.equal(result.data.analysis.objective, undefined);
    assert.equal(result.data.analysis.observations, undefined);
  });
});
