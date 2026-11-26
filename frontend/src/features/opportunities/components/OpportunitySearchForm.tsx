import { useId, useState, type FormEvent } from 'react'
import Button from '../../../components/ui/Button'
import {
  INSTITUTION_MAX_LENGTH,
  type OpportunityFilters,
  filterCategoryOptions,
  hasActiveFilters,
  normalizeFilters,
  statusOptions,
} from '../filters'
import styles from './OpportunitySearchForm.module.scss'

interface OpportunitySearchFormProps {
  /**
   * Filtros aplicados. Valores iniciais dos campos; a página deve usar
   * `key={filtersKey(appliedFilters)}` para que os campos acompanhem uma limpeza feita fora daqui.
   */
  appliedFilters: OpportunityFilters
  /** Aplica os filtros (somente ao enviar o formulário). */
  onSearch: (filters: OpportunityFilters) => void
  /** Remove todos os filtros. */
  onClear: () => void
}

/**
 * Filtros por instituição, categoria e situação. Não existe busca textual geral: o backend não
 * tem parâmetro q. Os filtros são enviados à API, que filtra todas as oportunidades antes de paginar.
 */
function OpportunitySearchForm({ appliedFilters, onSearch, onClear }: OpportunitySearchFormProps) {
  const id = useId()
  const [institution, setInstitution] = useState(appliedFilters.institution ?? '')
  const [category, setCategory] = useState(appliedFilters.category ?? '')
  const [status, setStatus] = useState<string>(appliedFilters.status ?? '')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSearch(normalizeFilters({ institution, category, status }))
  }

  return (
    <form role="search" className={styles.form} onSubmit={handleSubmit}>
      <label htmlFor={`${id}-institution`} className={styles.label}>
        Instituição
      </label>
      <input
        id={`${id}-institution`}
        type="search"
        className={styles.input}
        placeholder="Instituição (ex.: Finep, CNPq)"
        autoComplete="off"
        maxLength={INSTITUTION_MAX_LENGTH}
        value={institution}
        onChange={(event) => setInstitution(event.target.value)}
      />
      <label htmlFor={`${id}-category`} className={styles.label}>
        Categoria
      </label>
      <select
        id={`${id}-category`}
        className={`${styles.select} ${styles.category}`}
        value={category}
        onChange={(event) => setCategory(event.target.value)}
      >
        <option value="">Todas as categorias</option>
        {filterCategoryOptions.map((option) => (
          <option key={option.code} value={option.code}>
            {option.displayName}
          </option>
        ))}
      </select>

      <label htmlFor={`${id}-status`} className={styles.label}>
        Situação
      </label>
      <select
        id={`${id}-status`}
        className={`${styles.select} ${styles.status}`}
        value={status}
        onChange={(event) => setStatus(event.target.value)}
      >
        <option value="">Todas as situações</option>
        {statusOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <Button type="submit" size="lg" className={styles.submit}>
        Buscar oportunidades
      </Button>

      {hasActiveFilters(appliedFilters) && (
        <Button variant="ghost" className={styles.clear} onClick={onClear}>
          Limpar filtros
        </Button>
      )}
    </form>
  )
}

export default OpportunitySearchForm
