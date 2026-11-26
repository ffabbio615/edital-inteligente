import { useCallback, useEffect, useState } from 'react'
import type { OpportunityDetailData } from '../../../types/opportunity'
import { getOpportunity } from '../opportunities.service'

export type OpportunityDetailState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'success'; data: OpportunityDetailData }

interface StoredResult {
  key: string
  state: Exclude<OpportunityDetailState, { status: 'loading' }>
}

/**
 * Carrega GET /api/opportunities/:id. Mesmo padrão de useOpportunityList: a requisição anterior
 * é cancelada e só o resultado da requisição atual é exibido.
 */
export function useOpportunityDetail(id: string) {
  const [reloadCount, setReloadCount] = useState(0)
  const [result, setResult] = useState<StoredResult | null>(null)
  const requestKey = JSON.stringify([id, reloadCount])

  useEffect(() => {
    const controller = new AbortController()

    getOpportunity(id, controller.signal).then(
      (data) => setResult({ key: requestKey, state: { status: 'success', data } }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, state: { status: 'error', error } })
        }
      },
    )

    return () => controller.abort()
  }, [id, requestKey])

  const reload = useCallback(() => setReloadCount((count) => count + 1), [])

  const state: OpportunityDetailState =
    result && result.key === requestKey ? result.state : { status: 'loading' }

  return { state, reload }
}
