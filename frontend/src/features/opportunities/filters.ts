import type { OpportunityCategoryPresentation } from '../../types/opportunity-category'
import type { OpportunityStatus } from '../../types/opportunity'
import { UNCLASSIFIED_CATEGORY_CODE, opportunityCategories } from './categories'

/**
 * Filtros da listagem pública. Todos correspondem a parâmetros de GET /api/opportunities e
 * são aplicados pelo backend sobre TODAS as oportunidades, antes da paginação.
 * Somente dados oficiais: latest_analysis (IA) nunca é usado como filtro.
 */
export interface OpportunityFilters {
  /** Código oficial de categoria (parâmetro category). */
  category?: string
  /** Situação oficial (parâmetro status). */
  status?: OpportunityStatus
  /** Trecho do nome da instituição, sem diferenciar maiúsculas (parâmetro institution). */
  institution?: string
}

/** Limite do backend para o parâmetro institution. */
export const INSTITUTION_MAX_LENGTH = 200

/** Categorias oferecidas no filtro: as oficiais, sem o marcador 'unclassified'. */
export const filterCategoryOptions: OpportunityCategoryPresentation[] = opportunityCategories.filter(
  (category) => category.code !== UNCLASSIFIED_CATEGORY_CODE,
)

/** Os seis valores aceitos pelo backend (CHECK opportunities_status_valid), com rótulos da interface. */
export const statusOptions: { value: OpportunityStatus; label: string }[] = [
  { value: 'open', label: 'Abertas' },
  { value: 'upcoming', label: 'Em breve' },
  { value: 'closed', label: 'Encerradas' },
  { value: 'suspended', label: 'Suspensas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'unknown', label: 'Não informada' },
]

function isStatus(value: string): value is OpportunityStatus {
  return statusOptions.some((option) => option.value === value)
}

/**
 * Converte os valores do formulário em filtros válidos para a API: remove espaços e
 * campos vazios e descarta valores fora das opções (evita respostas 400).
 */
export function normalizeFilters(input: { category?: string; status?: string; institution?: string }): OpportunityFilters {
  const filters: OpportunityFilters = {}

  const category = input.category?.trim()
  if (category && filterCategoryOptions.some((option) => option.code === category)) {
    filters.category = category
  }

  const status = input.status?.trim()
  if (status && isStatus(status)) {
    filters.status = status
  }

  const institution = input.institution?.trim().slice(0, INSTITUTION_MAX_LENGTH).trim()
  if (institution) {
    filters.institution = institution
  }

  return filters
}

export function hasActiveFilters(filters: OpportunityFilters): boolean {
  return Boolean(filters.category || filters.status || filters.institution)
}

/** Chave estável dos filtros: igual para filtros iguais, diferente quando qualquer um muda. */
export function filtersKey(filters: OpportunityFilters): string {
  return JSON.stringify([filters.category ?? '', filters.status ?? '', filters.institution ?? ''])
}

// ---- Estado da listagem na URL da Home ----------------------------------------------
// Filtros e página ficam na query string (ex.: /?institution=finep&status=open&page=2), com os
// mesmos nomes dos parâmetros da API. Assim, voltar da página de detalhes restaura a listagem.

const MAX_PAGE = 10_000

/** Lê os filtros da URL, descartando valores inválidos (mesmas regras do formulário). */
export function filtersFromSearchParams(params: URLSearchParams): OpportunityFilters {
  return normalizeFilters({
    category: params.get('category') ?? undefined,
    status: params.get('status') ?? undefined,
    institution: params.get('institution') ?? undefined,
  })
}

/** Lê a página da URL. Ausente ou inválida: 1. */
export function pageFromSearchParams(params: URLSearchParams): number {
  const raw = params.get('page')
  if (!raw || !/^\d+$/.test(raw)) {
    return 1
  }
  const page = Number(raw)
  return page >= 1 && page <= MAX_PAGE ? page : 1
}

/** Monta a query string da Home. Página 1 e filtros vazios não aparecem na URL. */
export function listSearchParams(filters: OpportunityFilters, page = 1): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.institution) params.set('institution', filters.institution)
  if (filters.category) params.set('category', filters.category)
  if (filters.status) params.set('status', filters.status)
  if (page > 1) params.set('page', String(page))
  return params
}
