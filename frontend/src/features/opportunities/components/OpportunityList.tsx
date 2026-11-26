import { useEffect } from 'react'
import Button from '../../../components/ui/Button'
import { ApiError } from '../../../services/api'
import { type OpportunityFilters, hasActiveFilters } from '../filters'
import { useOpportunityList } from '../hooks/useOpportunityList'
import { fromListItem } from '../opportunity-card-data'
import OpportunityCard from './OpportunityCard'
import OpportunityPagination from './OpportunityPagination'
import styles from './OpportunityList.module.scss'

const PAGE_SIZE = 6

interface OpportunityListProps {
  /** Classe do grid de cards, definida pela página (mantém o layout atual). */
  gridClassName?: string
  /** Filtros aplicados (vindos da URL da página). */
  filters?: OpportunityFilters
  /** Página atual (vinda da URL da página). */
  page: number
  /**
   * Troca de página. `replace` indica uma correção automática (página além do total),
   * que não deve criar nova entrada no histórico.
   */
  onPageChange: (page: number, options?: { replace?: boolean }) => void
  /** Chamado antes de abrir a página de detalhes de um card. */
  onOpenOpportunity?: () => void
  /** Remove todos os filtros (botão exibido quando a busca não encontra resultados). */
  onClearFilters?: () => void
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'network_error':
        return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.'
      case 'database_not_configured':
      case 'database_unavailable':
        return 'O serviço de oportunidades está temporariamente indisponível. Tente novamente em instantes.'
      case 'configuration_error':
        return 'O endereço da API não está configurado (VITE_API_BASE_URL no arquivo .env.local).'
    }
  }
  return 'Não foi possível carregar as oportunidades. Tente novamente.'
}

/** Listagem pública: dados reais de GET /api/opportunities, com estados e paginação. */
function OpportunityList({
  gridClassName,
  filters = {},
  page,
  onPageChange,
  onClearFilters,
  onOpenOpportunity,
}: OpportunityListProps) {
  const { state, reload } = useOpportunityList({
    page,
    pageSize: PAGE_SIZE,
    category: filters.category,
    status: filters.status,
    institution: filters.institution,
  })

  // Página além do total (os dados diminuíram desde a última consulta): a API responde
  // com items vazio e total_pages menor que a página pedida. Com total_pages 0 não há
  // para onde voltar, e a lista vazia é exibida normalmente.
  const lastAvailablePage =
    state.status === 'success' &&
    state.data.items.length === 0 &&
    state.data.pagination.total_pages > 0 &&
    page > state.data.pagination.total_pages
      ? state.data.pagination.total_pages
      : null

  // A página vem da URL: a correção substitui a entrada atual do histórico.
  useEffect(() => {
    if (lastAvailablePage !== null) {
      onPageChange(lastAvailablePage, { replace: true })
    }
  }, [lastAvailablePage, onPageChange])

  // Enquanto volta para a última página, mostra o carregamento em vez de "lista vazia".
  if (state.status === 'loading' || lastAvailablePage !== null) {
    return (
      <div className={styles.status} role="status" aria-busy="true">
        Carregando oportunidades…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className={styles.status} role="alert">
        <p className={styles.message}>{errorMessage(state.error)}</p>
        <Button variant="secondary" onClick={reload}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  const { items, pagination } = state.data

  if (items.length === 0) {
    if (hasActiveFilters(filters)) {
      return (
        <div className={styles.status} role="status">
          <p className={styles.message}>Nenhuma oportunidade encontrada para os filtros selecionados.</p>
          {onClearFilters && (
            <Button variant="secondary" onClick={onClearFilters}>
              Limpar filtros
            </Button>
          )}
        </div>
      )
    }

    return (
      <div className={styles.status} role="status">
        Nenhuma oportunidade disponível no momento.
      </div>
    )
  }

  return (
    <>
      <ul className={gridClassName}>
        {items.map((item) => (
          <li key={item.id}>
            <OpportunityCard opportunity={fromListItem(item)} onOpen={onOpenOpportunity} />
          </li>
        ))}
      </ul>
      <OpportunityPagination
        page={pagination.page}
        totalPages={pagination.total_pages}
        total={pagination.total}
        onPageChange={onPageChange}
      />
    </>
  )
}

export default OpportunityList
