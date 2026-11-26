import { Link } from 'react-router-dom'
import Badge from '../../../components/ui/Badge'
import type { OpportunityCardData } from '../opportunity-card-data'
import styles from './OpportunityCard.module.scss'

interface OpportunityCardProps {
  opportunity: OpportunityCardData
  /** Marca o cartão como conteúdo fictício de demonstração. */
  isDemo?: boolean
  /** Chamado ao abrir a página de detalhes pelo link do título. */
  onOpen?: () => void
}

/** Estado enviado à página de detalhes: indica que a pessoa veio da listagem. */
export interface OpportunityLinkState {
  fromList: true
}

function OpportunityCard({ opportunity, isDemo = false, onOpen }: OpportunityCardProps) {
  const linkState: OpportunityLinkState = { fromList: true }

  const hasTags = opportunity.categoryLabel !== null || !opportunity.isTitleVerified || isDemo

  return (
    <article className={styles.card}>
      {hasTags && (
        <div className={styles.tags}>
          {opportunity.categoryLabel && <Badge tone="primary">{opportunity.categoryLabel}</Badge>}
          {!opportunity.isTitleVerified && <Badge tone="neutral">Em verificação</Badge>}
          {isDemo && <Badge tone="warning">Demonstração</Badge>}
        </div>
      )}

      <h3 className={styles.title}>
        {opportunity.href ? (
          <Link to={opportunity.href} state={linkState} className={styles.titleLink} onClick={onOpen}>
            {opportunity.title}
          </Link>
        ) : (
          opportunity.title
        )}
      </h3>
      <p className={styles.institution}>{opportunity.institution ?? 'Instituição não informada'}</p>
      {opportunity.summary && <p className={styles.summary}>{opportunity.summary}</p>}

      {opportunity.deadline && (
        <dl className={styles.meta}>
          <dt>Prazo</dt>
          <dd>
            <time dateTime={opportunity.deadline.dateTime}>{opportunity.deadline.label}</time>
          </dd>
        </dl>
      )}
    </article>
  )
}

export default OpportunityCard
