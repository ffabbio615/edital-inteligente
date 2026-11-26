import { z } from "zod";
import {
  BRAZILIAN_STATES,
  BUSINESS_SIZES,
  REFERENCEABLE_FIELDS,
  REFERENCE_BASES,
  UNCLASSIFIED_CATEGORY,
} from "./n8n.constants";

const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
const STAGE_PATTERN = /^[a-z0-9_]+$/;
const MAX_FUNDING_AMOUNT = 1_000_000_000_000;

// ---- Auxiliares -------------------------------------------------------------

// O Gemini costuma devolver null para o que não encontra: null equivale a ausente.
function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

// Listas vazias significam "não informado" e viram undefined (gravadas como NULL).
function listOrUndefined<T>(list: T[] | null | undefined): T[] | undefined {
  return list && list.length > 0 ? list : undefined;
}

function uniqueListOrUndefined<T>(list: T[] | null | undefined): T[] | undefined {
  return listOrUndefined(list ? [...new Set(list)] : undefined);
}

const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .nullish()
    .transform((value) => (value ? value : undefined));

// O banco só exige o prefixo http(s)://. Aqui a URL também precisa ser analisável.
function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

const httpUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(isHttpUrl, { message: "Must be a valid http or https URL." });

// Data de calendário ISO YYYY-MM-DD existente (rejeita 2026-02-30). Sem horário: a coluna
// é date e nenhum horário é inventado. Horário-limite informado pela fonte vai em observations.
function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const isoDateSchema = z
  .string()
  .trim()
  .refine(isIsoCalendarDate, { message: "Must be an ISO calendar date (YYYY-MM-DD)." })
  .nullish()
  .transform(orUndefined);

function hasAtMostTwoDecimals(value: number): boolean {
  const cents = value * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6;
}

// ---- Critérios --------------------------------------------------------------

const stateSchema = z.enum(BRAZILIAN_STATES);

// Mesmas regras de check_location_array: propriedades compatíveis com o escopo.
const locationSchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("national") }),
  z.strictObject({ scope: z.literal("state"), state: stateSchema }),
  z.strictObject({
    scope: z.literal("city"),
    state: stateSchema,
    city: z.string().trim().min(1).max(120),
  }),
]);

// eligibility_criteria vira opportunity_analyses.requirements. Só as chaves
// documentadas são aceitas, pois cada uma precisa de uma referência própria.
const requirementsSchema = z
  .strictObject({
    segments: z
      .array(z.string().trim().min(1).max(100))
      .max(50)
      .nullish()
      .transform(uniqueListOrUndefined),
    business_sizes: z
      .array(z.enum(BUSINESS_SIZES))
      .max(BUSINESS_SIZES.length)
      .nullish()
      .transform(uniqueListOrUndefined),
    organization_stages: z
      .array(
        z
          .string()
          .trim()
          .regex(STAGE_PATTERN, { message: "Must be snake_case (letters, numbers and '_')." }),
      )
      .max(20)
      .nullish()
      .transform(uniqueListOrUndefined),
    min_organization_age_months: z.number().int().min(0).max(1200).nullish().transform(orUndefined),
    max_organization_age_months: z.number().int().min(0).max(1200).nullish().transform(orUndefined),
  })
  .superRefine((value, ctx) => {
    const min = value.min_organization_age_months;
    const max = value.max_organization_age_months;
    if (min !== undefined && max !== undefined && max < min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max_organization_age_months"],
        message: "Must be greater than or equal to min_organization_age_months.",
      });
    }
  });

// ---- Referências (source_references) ---------------------------------------

// Estrutura exata. document_url pode ser URL http(s), null ou ausente (migration 002).
const referenceSchema = z.strictObject({
  field: z.enum(REFERENCEABLE_FIELDS),
  document_url: httpUrlSchema.nullish(),
  excerpt: z.string().trim().min(1).max(500),
  basis: z.enum(REFERENCE_BASES),
  page: z.number().int().min(1).nullish(),
  section: z.string().trim().min(1).max(200).nullish(),
});

// ---- Análise do Gemini ------------------------------------------------------

const codeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(CODE_PATTERN, { message: "Must be a lowercase code such as 'startup'." });

const analysisSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(500),
    analysis_summary: optionalText(3000),
    institution: optionalText(300),
    objective: optionalText(5000),
    // Sugestão da IA. null = sem classificação segura. 'unclassified' é marcador do banco,
    // não uma sugestão: é rejeitado aqui (e por constraint na migration 003).
    opportunity_category: codeSchema
      .refine((code) => code !== UNCLASSIFIED_CATEGORY, {
        message: "Use null when the category is unknown; 'unclassified' is reserved for the database.",
      })
      .nullish()
      .transform(orUndefined),
    target_audience: z.array(codeSchema).max(50).nullish().transform(uniqueListOrUndefined),
    eligibility_criteria: requirementsSchema.nullish().transform(orUndefined),
    eligible_locations: z.array(locationSchema).max(100).nullish().transform(listOrUndefined),
    funding_amount: z
      .number()
      .min(0)
      .max(MAX_FUNDING_AMOUNT)
      .refine(hasAtMostTwoDecimals, { message: "Must have at most 2 decimal places." })
      .nullish()
      .transform(orUndefined),
    funding_currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, { message: "Must be a 3-letter currency code such as 'BRL'." })
      .nullish()
      .transform(orUndefined),
    opening_date: isoDateSchema,
    closing_date: isoDateSchema,
    required_documents: z
      .array(z.string().trim().min(1).max(300))
      .max(100)
      .nullish()
      .transform(uniqueListOrUndefined),
    counterpart_required: z.boolean().nullish().transform(orUndefined),
    source_references: z.array(referenceSchema).max(200).nullish().transform(listOrUndefined),
    // [] é significativo ("nada ausente") e é preservado; null/ausente = não avaliado.
    missing_information: z
      .array(z.string().trim().min(1).max(100))
      .max(100)
      .nullish()
      .transform((list) => (list ? [...new Set(list)] : undefined)),
    observations: optionalText(5000),
  })
  .superRefine((value, ctx) => {
    // Espelha opportunity_analyses_funding_amount_requires_currency: a moeda nunca é assumida.
    if (value.funding_amount !== undefined && value.funding_currency === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["funding_currency"],
        message: "funding_currency is required when funding_amount is provided.",
      });
    }
    // Espelha opportunity_analyses_dates_order (003). Strings YYYY-MM-DD comparam como datas.
    if (value.opening_date !== undefined && value.closing_date !== undefined && value.closing_date < value.opening_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["closing_date"],
        message: "closing_date must be on or after opening_date.",
      });
    }
  });

// ---- Requisição -------------------------------------------------------------

const sourceSchema = z
  .strictObject({
    source_name: z.string().trim().min(1).max(100),
    external_id: z.string().trim().min(1).max(200).nullish().transform(orUndefined),
    source_url: httpUrlSchema.nullish().transform(orUndefined),
  })
  .refine((value) => value.external_id !== undefined || value.source_url !== undefined, {
    path: ["external_id"],
    message: "Provide external_id or source_url to identify the opportunity.",
  });

export const n8nIngestSchema = z.strictObject({
  source: sourceSchema,
  model_name: z.string().trim().min(1).max(100),
  analyzed_at: z.string().datetime({ offset: true }).nullish().transform(orUndefined),
  analysis: analysisSchema,
});

export type N8nIngestInput = z.infer<typeof n8nIngestSchema>;
export type N8nReference = z.infer<typeof referenceSchema>;
