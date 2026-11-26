import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  OPPORTUNITY_SORT_FIELDS,
  OPPORTUNITY_STATUSES,
  SORT_ORDERS,
} from "./opportunities.constants";

// Mesmo formato de opportunity_categories_code_format (migration 001).
const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

// Parâmetro enviado vazio (ex.: "?status=" de um formulário) equivale a ausente.
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());

// Inteiro positivo vindo da query string (sempre texto). Rejeita "1.5", "abc", "-1" e "1e3".
const positiveInteger = (max: number, defaultValue: number) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^\d+$/, { message: "Must be a positive integer." })
      .transform(Number)
      .pipe(z.number().int().min(1).max(max))
      .default(String(defaultValue)),
  );

// Query string de GET /api/opportunities. Parâmetro desconhecido ou repetido (array) gera 400.
// Filtros e ordenação usam SOMENTE colunas oficiais de opportunities; nenhum dado extraído
// pela IA (opportunity_analyses) é usado como critério.
export const listOpportunitiesQuerySchema = z.strictObject({
  // Código exato de opportunities.category.
  category: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(CODE_PATTERN, { message: "Must be a category code such as 'grant'." }),
  ),
  // Valor de opportunities.status.
  status: optional(z.enum(OPPORTUNITY_STATUSES)),
  // Trecho de opportunities.institution, sem diferenciar maiúsculas.
  institution: optional(z.string().trim().max(200)),
  page: positiveInteger(MAX_PAGE, 1),
  page_size: positiveInteger(MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
  sort: z.preprocess(emptyToUndefined, z.enum(OPPORTUNITY_SORT_FIELDS).default("created_at")),
  order: z.preprocess(emptyToUndefined, z.enum(SORT_ORDERS).default("desc")),
});

export type ListOpportunitiesQuery = z.infer<typeof listOpportunitiesQuerySchema>;

// Parâmetros de GET /api/opportunities/:id. Um id que não é UUID gera 400 sem consultar o banco.
export const opportunityParamsSchema = z.strictObject({
  id: z.string().uuid({ message: "Must be a valid UUID." }),
});

export type OpportunityParams = z.infer<typeof opportunityParamsSchema>;

// GET /api/opportunities/:id não tem parâmetros de query: qualquer um gera 400.
export const opportunityDetailQuerySchema = z.strictObject({});
