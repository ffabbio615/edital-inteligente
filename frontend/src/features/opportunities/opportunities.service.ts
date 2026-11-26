import { ApiError, apiRequest } from '../../services/api'
import type {
  OpportunityDetailData,
  OpportunityDetailResponse,
  OpportunityListData,
  OpportunityListParams,
  OpportunityListResponse,
} from '../../types/opportunity'

/** Monta a query string só com os parâmetros definidos (vazio ou ausente não é enviado). */
function buildQuery(params: OpportunityListParams): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value))
    }
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

/** GET /api/opportunities. Devolve `data` do envelope: { items, pagination }. */
export async function listOpportunities(
  params: OpportunityListParams = {},
  signal?: AbortSignal,
): Promise<OpportunityListData> {
  const response = await apiRequest<OpportunityListResponse>(`/opportunities${buildQuery(params)}`, {
    signal,
  })

  if (response?.success !== true || !Array.isArray(response.data?.items) || !response.data.pagination) {
    throw new ApiError({
      status: 200,
      code: 'invalid_response',
      message: 'A API retornou uma listagem em formato inesperado.',
    })
  }

  return response.data
}

/**
 * GET /api/opportunities/:id. Devolve `data` do envelope: { opportunity, latest_analysis }.
 * Id inexistente: ApiError 404 'opportunity_not_found'. A rota não aceita parâmetros de query.
 */
export async function getOpportunity(id: string, signal?: AbortSignal): Promise<OpportunityDetailData> {
  const response = await apiRequest<OpportunityDetailResponse>(`/opportunities/${encodeURIComponent(id)}`, {
    signal,
  })

  if (response?.success !== true || !response.data?.opportunity || !('latest_analysis' in response.data)) {
    throw new ApiError({
      status: 200,
      code: 'invalid_response',
      message: 'A API retornou o detalhe da oportunidade em formato inesperado.',
    })
  }

  return response.data
}
