import type { ApiSuccessResponse, IsoDateString, IsoDateTimeString } from './api'
import type { OpportunityCategoryCode } from './opportunity-category'
import type { OpportunityAnalysis, OpportunityAnalysisSummary } from './opportunity-analysis'

export type { OpportunityCategoryCode } from './opportunity-category'

// ---- Contrato da API (GET /api/opportunities e GET /api/opportunities/:id) ----------

/** Valores do CHECK opportunities_status_valid (migration 001). */
export type OpportunityStatus = 'unknown' | 'upcoming' | 'open' | 'closed' | 'suspended' | 'cancelled'

/**
 * Dados oficiais da oportunidade (tabela opportunities). Nenhum campo vem da IA.
 * Campos *_verified_at null indicam valor ainda não confirmado (ex.: título provisório).
 */
export interface Opportunity {
  id: string
  title: string
  title_verified_at: IsoDateTimeString | null
  institution: string | null
  institution_verified_at: IsoDateTimeString | null
  /** Código oficial (opportunity_categories.code). 'unclassified' = sem categoria confirmada. */
  category: string
  /** Nome oficial da categoria, enviado pela API. */
  category_name: string
  category_verified_at: IsoDateTimeString | null
  status: OpportunityStatus
  publication_date: IsoDateString | null
  opening_date: IsoDateTimeString | null
  /** Prazo confirmado. null = fluxo contínuo ou prazo não confirmado. */
  deadline: IsoDateTimeString | null
  eligibility_verified_at: IsoDateTimeString | null
  source_name: string
  source_url: string | null
  document_url: string | null
  created_at: IsoDateTimeString
  updated_at: IsoDateTimeString
}

/** Item da listagem: dados oficiais + resumo da última análise (não confirmada). */
export interface OpportunityListItem extends Opportunity {
  latest_analysis: OpportunityAnalysisSummary | null
}

export interface Pagination {
  page: number
  page_size: number
  total: number
  /** 0 quando não há resultados. */
  total_pages: number
}

export interface OpportunityListData {
  items: OpportunityListItem[]
  pagination: Pagination
}

/** Detalhe: dados oficiais e última análise separados. */
export interface OpportunityDetailData {
  opportunity: Opportunity
  latest_analysis: OpportunityAnalysis | null
}

export type OpportunityListResponse = ApiSuccessResponse<OpportunityListData>
export type OpportunityDetailResponse = ApiSuccessResponse<OpportunityDetailData>

export type OpportunitySortField = 'created_at' | 'updated_at' | 'title' | 'deadline' | 'publication_date'
export type SortOrder = 'asc' | 'desc'

/**
 * Parâmetros aceitos por GET /api/opportunities. Qualquer outro parâmetro gera 400.
 * Padrões do backend: page 1, page_size 20 (máx. 100), sort created_at, order desc.
 */
export interface OpportunityListParams {
  category?: string
  status?: OpportunityStatus
  /** Trecho do nome da instituição, sem diferenciar maiúsculas (máx. 200 caracteres). */
  institution?: string
  page?: number
  page_size?: number
  sort?: OpportunitySortField
  order?: SortOrder
}

// ---- Dados de demonstração da página pública ----------------------------------------

/**
 * Dados mínimos para exibir uma oportunidade FICTÍCIA em cartão (demo-opportunities.ts).
 * Não é o contrato da API: a API não tem summary e envia deadline como data e hora ISO.
 */
export interface OpportunityPreview {
  id: string
  title: string
  institution: string
  category: OpportunityCategoryCode
  summary: string
  /** Data no formato YYYY-MM-DD, ou null quando não informada. */
  deadline: string | null
}
