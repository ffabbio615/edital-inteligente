// Constantes compartilhadas (sem dependência de zod). Devem refletir as migrations 001 a 003.

/** Mesmo conjunto de user_profiles.business_size e opportunities.eligible_business_sizes. */
export const BUSINESS_SIZES = ["mei", "micro", "small", "medium", "large"] as const;

/** Mesmas UFs aceitas por check_location_array. */
export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/** Chaves recomendadas em opportunity_analyses.requirements (database/README.md). */
export const REQUIREMENT_KEYS = [
  "segments",
  "business_sizes",
  "organization_stages",
  "min_organization_age_months",
  "max_organization_age_months",
] as const;
export type RequirementKey = (typeof REQUIREMENT_KEYS)[number];

/** Valores aceitos em source_references[].field (database/README.md). */
export const REFERENCEABLE_FIELDS = [
  // Identificação e conteúdo (colunas de opportunity_analyses desde a migration 003).
  "title",
  "institution",
  "opportunity_category",
  "objective",
  "observations",
  "opening_date",
  "closing_date",
  // Critérios e valores (migration 001).
  "target_audience",
  "eligible_locations",
  "required_documents",
  "funding_amount",
  "funding_currency",
  "counterpart_required",
  "requirements.segments",
  "requirements.business_sizes",
  "requirements.organization_stages",
  "requirements.min_organization_age_months",
  "requirements.max_organization_age_months",
] as const;
export type ReferenceableField = (typeof REFERENCEABLE_FIELDS)[number];

export const REFERENCE_BASES = ["stated", "inferred"] as const;

/**
 * Categoria operacional da migration 003: "ainda sem categoria confirmada".
 * Usada somente pelo backend ao criar uma oportunidade. Nunca é aceita como sugestão da IA.
 */
export const UNCLASSIFIED_CATEGORY = "unclassified";
