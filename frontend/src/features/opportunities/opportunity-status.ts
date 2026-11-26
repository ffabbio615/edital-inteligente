import type { OpportunityStatus } from '../../types/opportunity'

/** Rótulo de uma situação oficial (opportunities.status), no singular, para a página de detalhes. */
const STATUS_LABELS: Record<OpportunityStatus, string> = {
  open: 'Aberta',
  upcoming: 'Em breve',
  closed: 'Encerrada',
  suspended: 'Suspensa',
  cancelled: 'Cancelada',
  unknown: 'Não informada',
}

export function getStatusLabel(status: OpportunityStatus): string {
  return STATUS_LABELS[status] ?? 'Não informada'
}
