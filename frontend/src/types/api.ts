/**
 * Tipos comuns às respostas da API REST.
 * Erros chegam como ApiError (src/services/api.ts), não como dados.
 */

/** Envelope de sucesso do backend: { success: true, data }. Usado na listagem e no detalhe. */
export interface ApiSuccessResponse<T> {
  success: true
  data: T
}

/**
 * Data e hora em ISO 8601 (coluna timestamptz serializada em UTC),
 * ex.: "2026-11-20T12:00:00.000Z". Para exibir, converter para America/Sao_Paulo.
 */
export type IsoDateTimeString = string

/** Data de calendário sem horário nem fuso (coluna date), ex.: "2026-03-01". */
export type IsoDateString = string
