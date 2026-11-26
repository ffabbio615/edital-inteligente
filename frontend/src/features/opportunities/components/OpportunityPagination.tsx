import Button from '../../../components/ui/Button'
import styles from './OpportunityPagination.module.scss'

interface OpportunityPaginationProps {
  page: number
  totalPages: number
  total: number
  onPageChange: (page: number) => void
  disabled?: boolean
}

/** Navegação Anterior/Próxima com base em pagination (page, total_pages, total) da API. */
function OpportunityPagination({ page, totalPages, total, onPageChange, disabled = false }: OpportunityPaginationProps) {
  if (totalPages <= 1) {
    return null
  }

  const totalLabel = total === 1 ? '1 oportunidade' : `${total.toLocaleString('pt-BR')} oportunidades`

  return (
    <nav className={styles.pagination} aria-label="Paginação das oportunidades">
      <Button variant="secondary" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>
        Anterior
      </Button>
      <p className={styles.info} aria-live="polite">
        Página {page} de {totalPages} · {totalLabel}
      </p>
      <Button variant="secondary" disabled={disabled || page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Próxima
      </Button>
    </nav>
  )
}

export default OpportunityPagination
