import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listOpportunitiesQuerySchema,
  opportunityDetailQuerySchema,
  opportunityParamsSchema,
} from "./opportunities.schemas";

const parse = (query: Record<string, unknown>) => listOpportunitiesQuerySchema.safeParse(query);

function issuePaths(query: Record<string, unknown>): string[] {
  const result = parse(query);
  assert.equal(result.success, false, JSON.stringify(query));
  return result.error.issues.map((issue) => issue.path.join(".") || issue.code);
}

describe("listOpportunitiesQuerySchema", () => {
  it("aplica os padrões sem parâmetros", () => {
    assert.deepEqual(listOpportunitiesQuerySchema.parse({}), {
      page: 1,
      page_size: 20,
      sort: "created_at",
      order: "desc",
    });
  });

  it("aceita todos os filtros e normaliza categoria e instituição", () => {
    assert.deepEqual(
      listOpportunitiesQuerySchema.parse({
        category: " Grant ",
        status: "open",
        institution: "  FINEP ",
        page: "3",
        page_size: "50",
        sort: "deadline",
        order: "asc",
      }),
      {
        category: "grant",
        status: "open",
        institution: "FINEP",
        page: 3,
        page_size: 50,
        sort: "deadline",
        order: "asc",
      },
    );
  });

  it("trata parâmetros vazios como ausentes", () => {
    assert.deepEqual(
      listOpportunitiesQuerySchema.parse({ category: "", status: " ", institution: "", page: "", sort: "", order: "" }),
      { category: undefined, status: undefined, institution: undefined, page: 1, page_size: 20, sort: "created_at", order: "desc" },
    );
  });

  it("aceita somente os status do CHECK da migration 001", () => {
    for (const status of ["unknown", "upcoming", "open", "closed", "suspended", "cancelled"]) {
      assert.equal(parse({ status }).success, true, status);
    }
    assert.deepEqual(issuePaths({ status: "aberto" }), ["status"]);
  });

  it("rejeita categoria fora do formato de código", () => {
    assert.deepEqual(issuePaths({ category: "fomento público" }), ["category"]);
    assert.deepEqual(issuePaths({ category: "1grant" }), ["category"]);
  });

  it("valida page e page_size", () => {
    assert.deepEqual(issuePaths({ page: "0" }), ["page"]);
    assert.deepEqual(issuePaths({ page: "-1" }), ["page"]);
    assert.deepEqual(issuePaths({ page: "1.5" }), ["page"]);
    assert.deepEqual(issuePaths({ page: "abc" }), ["page"]);
    assert.deepEqual(issuePaths({ page: "10001" }), ["page"]);
    assert.deepEqual(issuePaths({ page_size: "0" }), ["page_size"]);
    assert.deepEqual(issuePaths({ page_size: "101" }), ["page_size"]);
    assert.equal(listOpportunitiesQuerySchema.parse({ page_size: "100" }).page_size, 100);
  });

  it("aceita só ordenação por colunas oficiais de opportunities", () => {
    for (const sort of ["created_at", "updated_at", "title", "deadline", "publication_date"]) {
      assert.equal(parse({ sort }).success, true, sort);
    }
    // Campos da análise de IA ou inexistentes não são aceitos.
    for (const sort of ["closing_date", "opportunity_category", "id; DROP TABLE opportunities"]) {
      assert.deepEqual(issuePaths({ sort }), ["sort"], sort);
    }
    assert.deepEqual(issuePaths({ order: "up" }), ["order"]);
  });

  it("rejeita filtros por dados da IA, parâmetros desconhecidos e repetidos", () => {
    assert.equal(parse({ suggested_category: "grant" }).success, false);
    assert.equal(parse({ analysis_status: "completed" }).success, false);
    assert.equal(parse({ q: "inovação" }).success, false);
    assert.deepEqual(issuePaths({ status: ["open", "closed"] }), ["status"]);
  });

  it("limita o tamanho do filtro de instituição", () => {
    assert.equal(parse({ institution: "a".repeat(200) }).success, true);
    assert.deepEqual(issuePaths({ institution: "a".repeat(201) }), ["institution"]);
  });
});

describe("opportunityParamsSchema", () => {
  const accepts = (id: unknown) => opportunityParamsSchema.safeParse({ id }).success;

  it("aceita UUID (minúsculas ou maiúsculas)", () => {
    assert.equal(accepts("ced3c182-5b52-4b5a-8566-5c3d03c64f84"), true);
    assert.equal(accepts("CED3C182-5B52-4B5A-8566-5C3D03C64F84"), true);
  });

  it("rejeita o que não é UUID", () => {
    for (const id of ["", "abc", "123", "ced3c182-5b52-4b5a-8566-5c3d03c64f8", "ced3c182-5b52-4b5a-8566-5c3d03c64f84x", "ced3c1825b524b5a85665c3d03c64f84 OR 1=1", 1]) {
      assert.equal(accepts(id), false, String(id));
    }
  });

  it("rejeita parâmetros extras", () => {
    assert.equal(opportunityParamsSchema.safeParse({ id: "ced3c182-5b52-4b5a-8566-5c3d03c64f84", x: "1" }).success, false);
  });
});

describe("opportunityDetailQuerySchema", () => {
  it("aceita query vazia e rejeita qualquer parâmetro", () => {
    assert.equal(opportunityDetailQuerySchema.safeParse({}).success, true);
    assert.equal(opportunityDetailQuerySchema.safeParse({ include: "history" }).success, false);
    assert.equal(opportunityDetailQuerySchema.safeParse({ page: "1" }).success, false);
  });
});
