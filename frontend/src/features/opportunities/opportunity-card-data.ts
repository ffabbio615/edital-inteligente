import type { OpportunityListItem, OpportunityPreview } from '../../types/opportunity'
import { UNCLASSIFIED_CATEGORY_CODE, getCategoryDisplayName } from './categories'
import { formatCalendarDate, formatDateTime } from './format-date'

/**
 * O que o OpportunityCard exibe. Campos null não são exibidos.
 * Construído só a partir de dados oficiais: latest_analysis (IA) nunca entra aqui.
 */
export interface OpportunityCardData {
  id: string
  /** Caminho da página de detalhes. null: card sem link (dados de demonstração). */
  href: string | null
  title: string
  /** false: título ainda não confirmado (selo "Em verificação"). */
  isTitleVerified: boolean
  institution: string | null
  /** null: sem selo de categoria (ex.: 'unclassified'). */
  categoryLabel: string | null
  /** A API não fornece resumo nos dados oficiais: sempre null para dados reais. */
  summary: string | null
  /** null: sem prazo oficial; nada é exibido. */
  deadline: { dateTime: string; label: string } | null
}

/** Caminho da página de detalhes de uma oportunidade. */
export function opportunityPath(id: string): string {
  return `/oportunidades/${encodeURIComponent(id)}`
}

/** Item real de GET /api/opportunities. */
export function fromListItem(item: OpportunityListItem): OpportunityCardData {
  const deadlineLabel = item.deadline ? formatDateTime(item.deadline) : null

  return {
    id: item.id,
    href: opportunityPath(item.id),
    title: item.title,
    isTitleVerified: item.title_verified_at !== null,
    institution: item.institution,
    categoryLabel:
      item.category === UNCLASSIFIED_CATEGORY_CODE
        ? null
        : getCategoryDisplayName(item.category, item.category_name),
    summary: null,
    deadline: item.deadline && deadlineLabel ? { dateTime: item.deadline, label: deadlineLabel } : null,
  }
}

/**
 * Dado FICTÍCIO de demo-opportunities.ts. Não é usado na página pública; existe para que
 * os dados de demonstração continuem compatíveis com o card.
 */
export function fromPreview(preview: OpportunityPreview): OpportunityCardData {
  const deadlineLabel = preview.deadline ? formatCalendarDate(preview.deadline) : null

  return {
    id: preview.id,
    href: null,
    title: preview.title,
    isTitleVerified: true,
    institution: preview.institution,
    categoryLabel: getCategoryDisplayName(preview.category),
    summary: preview.summary,
    deadline: preview.deadline && deadlineLabel ? { dateTime: preview.deadline, label: deadlineLabel } : null,
  }
}
