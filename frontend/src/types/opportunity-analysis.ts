import type { IsoDateString, IsoDateTimeString } from './api'

/**
 * Última análise de IA (opportunity_analyses), separada dos dados oficiais.
 * Conteúdo extraído automaticamente e NÃO confirmado: confirmed é sempre false.
 */

/** Valores do CHECK opportunity_analyses_status_valid (migration 001). */
export type AnalysisStatus = 'pending' | 'completed' | 'failed' | 'needs_review'

/** stated: escrito no documento; inferred: deduzido pela IA. */
export type ReferenceBasis = 'stated' | 'inferred'

/**
 * Evidência de um campo extraído (source_references).
 * field, excerpt e basis são garantidos pelo banco (check_source_reference_array, migration 002);
 * document_url pode faltar ou ser null; page e section são validados só na ingestão do n8n.
 */
export interface SourceReference {
  field: string
  excerpt: string
  basis: ReferenceBasis
  document_url?: string | null
  page?: number | null
  section?: string | null
}

/** Formatos aceitos por check_location_array (migration 001). state é a sigla da UF. */
export type EligibleLocation =
  | { scope: 'national' }
  | { scope: 'state'; state: string }
  | { scope: 'city'; state: string; city: string }

/** Resumo da última análise, presente em cada item da listagem. */
export interface OpportunityAnalysisSummary {
  confirmed: false
  id: string
  analysis_status: AnalysisStatus
  /** Código de categoria sugerido pela IA. Nunca 'unclassified'. */
  suggested_category: string | null
  opening_date: IsoDateString | null
  closing_date: IsoDateString | null
  model_name: string | null
  analyzed_at: IsoDateTimeString | null
}

/** Última análise completa, com evidências, presente no detalhe. */
export interface OpportunityAnalysis extends OpportunityAnalysisSummary {
  analysis_summary: string | null
  title: string | null
  institution: string | null
  objective: string | null
  observations: string | null
  /** Códigos de profile_types. */
  target_audience: string[] | null
  /** Objeto livre; chaves recomendadas no README do banco (segments, business_sizes etc.). */
  requirements: Record<string, unknown> | null
  eligible_locations: EligibleLocation[] | null
  /** O banco garante apenas que é um array. */
  required_documents: unknown[] | null
  funding_amount: number | null
  /** Código de moeda com 3 letras, ex.: "BRL". */
  funding_currency: string | null
  counterpart_required: boolean | null
  missing_information: string[] | null
  source_references: SourceReference[] | null
  created_at: IsoDateTimeString
}
