// Constantes do módulo de consulta. Devem refletir as migrations 001 a 003.

/** Mesmos valores do CHECK opportunities_status_valid (migration 001). */
export const OPPORTUNITY_STATUSES = ["unknown", "upcoming", "open", "closed", "suspended", "cancelled"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/**
 * Campos aceitos em ?sort=. Só colunas oficiais de opportunities: nenhum dado extraído pela IA
 * é usado para filtrar ou ordenar.
 */
export const OPPORTUNITY_SORT_FIELDS = ["created_at", "updated_at", "title", "deadline", "publication_date"] as const;
export type OpportunitySortField = (typeof OPPORTUNITY_SORT_FIELDS)[number];

export const SORT_ORDERS = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/** Limite de página para evitar OFFSET muito grande. */
export const MAX_PAGE = 10_000;
