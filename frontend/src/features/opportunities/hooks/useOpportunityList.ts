import { useCallback, useEffect, useState } from 'react'
import type { OpportunityListData, OpportunityStatus } from '../../../types/opportunity'
import { listOpportunities } from '../opportunities.service'

export type OpportunityListState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'success'; data: OpportunityListData }

interface UseOpportunityListOptions {
  page: number
  pageSize: number
  category?: string
  status?: OpportunityStatus
  institution?: string
}

interface StoredResult {
  key: string
  state: Exclude<OpportunityListState, { status: 'loading' }>
}

/**
 * Carrega uma página de GET /api/opportunities com os filtros informados.
 * Os filtros são aplicados pelo backend sobre todas as oportunidades, antes da paginação.
 * Cada combinação de página/tamanho/filtros/recarga é uma requisição; a anterior é cancelada
 * (AbortController) e só o resultado da requisição atual é exibido, então respostas
 * atrasadas nunca sobrescrevem a consulta vigente. Repetir os mesmos valores não gera
 * nova requisição.
 */
export function useOpportunityList({ page, pageSize, category, status, institution }: UseOpportunityListOptions) {
  const [reloadCount, setReloadCount] = useState(0)
  const [result, setResult] = useState<StoredResult | null>(null)
  const requestKey = JSON.stringify([page, pageSize, category ?? '', status ?? '', institution ?? '', reloadCount])

  useEffect(() => {
    const controller = new AbortController()

    listOpportunities({ page, page_size: pageSize, category, status, institution }, controller.signal).then(
      (data) => setResult({ key: requestKey, state: { status: 'success', data } }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, state: { status: 'error', error } })
        }
      },
    )

    return () => controller.abort()
  }, [page, pageSize, category, status, institution, requestKey])

  const reload = useCallback(() => setReloadCount((count) => count + 1), [])

  // Enquanto o resultado guardado não for o da requisição atual, a lista está carregando.
  const state: OpportunityListState =
    result && result.key === requestKey ? result.state : { status: 'loading' }

  return { state, reload }
}
