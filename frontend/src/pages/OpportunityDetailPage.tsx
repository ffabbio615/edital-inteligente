import { useEffect, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Container from '../components/ui/Container'
import { UNCLASSIFIED_CATEGORY_CODE, getCategoryDisplayName } from '../features/opportunities/categories'
import OpportunityAnalysisSection from '../features/opportunities/components/OpportunityAnalysisSection'
import type { OpportunityLinkState } from '../features/opportunities/components/OpportunityCard'
import { formatCalendarDate, formatDateTime } from '../features/opportunities/format-date'
import { useOpportunityDetail } from '../features/opportunities/hooks/useOpportunityDetail'
import { getStatusLabel } from '../features/opportunities/opportunity-status'
import { ApiError } from '../services/api'
import type { Opportunity } from '../types/opportunity'
import styles from './OpportunityDetailPage.module.scss'

const SITE_TITLE = 'Edital Inteligente'

// Mesmo formato aceito pelo backend (z.string().uuid()): id inválido nem chega a ser consultado.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'opportunity_not_found' || error.code === 'validation_error')
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
  return 'Não foi possível carregar a oportunidade. Tente novamente.'
}

/**
 * Volta para a listagem. Vindo de um card, volta no histórico (filtros e página da URL são
 * restaurados). Acesso direto ao link: vai para a seção de oportunidades da Home.
 */
function BackToList() {
  const location = useLocation()
  const navigate = useNavigate()
  const cameFromList = (location.state as OpportunityLinkState | null)?.fromList === true

  if (cameFromList) {
    return (
      <button type="button" className={styles.back} onClick={() => navigate(-1)}>
        ← Voltar para as oportunidades
      </button>
    )
  }

  return (
    <Link to={{ pathname: '/', hash: 'oportunidades' }} className={styles.back}>
      ← Voltar para as oportunidades
    </Link>
  )
}

interface FieldProps {
  label: string
  children: ReactNode
  /** false: valor ainda não confirmado (selo "Em verificação"). */
  verified?: boolean
}

function Field({ label, children, verified = true }: FieldProps) {
  return (
    <div className={styles.field}>
      <dt>{label}</dt>
      <dd>
        {children}
        {!verified && (
          <>
            {' '}
            <Badge tone="neutral">Em verificação</Badge>
          </>
        )}
      </dd>
    </div>
  )
}

interface ExternalLinkProps {
  href: string
  children: ReactNode
}

function ExternalLink({ href, children }: ExternalLinkProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={styles.externalLink}>
      {children}
      <span aria-hidden="true"> ↗</span>
      <span className={styles.visuallyHidden}> (abre em nova aba)</span>
    </a>
  )
}

function DateValue({ iso, label }: { iso: string; label: string | null }) {
  return label ? <time dateTime={iso}>{label}</time> : null
}

/**
 * Dados oficiais (tabela opportunities). Nada desta seção vem de latest_analysis (IA).
 * Campos null não são exibidos.
 */
function OfficialData({ opportunity }: { opportunity: Opportunity }) {
  const isUnclassified = opportunity.category === UNCLASSIFIED_CATEGORY_CODE
  const publication = opportunity.publication_date ? formatCalendarDate(opportunity.publication_date) : null
  const opening = opportunity.opening_date ? formatDateTime(opportunity.opening_date) : null
  const deadline = opportunity.deadline ? formatDateTime(opportunity.deadline) : null
  const updated = formatDateTime(opportunity.updated_at)

  return (
    <section className={styles.panel} aria-labelledby="dados-oficiais-titulo">
      <div className={styles.panelHeading}>
        <h2 id="dados-oficiais-titulo" className={styles.panelTitle}>
          Dados oficiais
        </h2>
        <p className={styles.panelDescription}>
          Informações cadastradas na plataforma. Itens marcados como “Em verificação” ainda não foram
          confirmados.
        </p>
      </div>

      <dl className={styles.fields}>
        {opportunity.institution && (
          <Field label="Instituição" verified={opportunity.institution_verified_at !== null}>
            {opportunity.institution}
          </Field>
        )}
        {!isUnclassified && (
          <Field label="Categoria" verified={opportunity.category_verified_at !== null}>
            {opportunity.category_name}
          </Field>
        )}
        <Field label="Situação">{getStatusLabel(opportunity.status)}</Field>
        {opportunity.publication_date && publication && (
          <Field label="Publicação">
            <DateValue iso={opportunity.publication_date} label={publication} />
          </Field>
        )}
        {opportunity.opening_date && opening && (
          <Field label="Abertura das inscrições">
            <DateValue iso={opportunity.opening_date} label={opening} />
          </Field>
        )}
        {opportunity.deadline && deadline && (
          <Field label="Prazo">
            <DateValue iso={opportunity.deadline} label={deadline} />
          </Field>
        )}
        <Field label="Fonte">{opportunity.source_name}</Field>
        {updated && (
          <Field label="Atualizado em">
            <DateValue iso={opportunity.updated_at} label={updated} />
          </Field>
        )}
      </dl>

      {(opportunity.source_url || opportunity.document_url) && (
        <ul className={styles.links}>
          {opportunity.source_url && (
            <li>
              <ExternalLink href={opportunity.source_url}>Página do edital</ExternalLink>
            </li>
          )}
          {opportunity.document_url && (
            <li>
              <ExternalLink href={opportunity.document_url}>Documento do edital</ExternalLink>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function NotFound() {
  useEffect(() => {
    document.title = `Oportunidade não encontrada · ${SITE_TITLE}`
  }, [])

  return (
    <div className={styles.status} role="status">
      <h1 className={styles.statusTitle}>Oportunidade não encontrada</h1>
      <p className={styles.message}>A oportunidade procurada não existe ou não está mais disponível.</p>
    </div>
  )
}

function OpportunityDetail({ id }: { id: string }) {
  const { state, reload } = useOpportunityDetail(id)
  const title = state.status === 'success' ? state.data.opportunity.title : null

  useEffect(() => {
    if (title) {
      document.title = `${title} · ${SITE_TITLE}`
    }
  }, [title])

  if (state.status === 'loading') {
    return (
      <div className={styles.status} role="status" aria-busy="true">
        Carregando oportunidade…
      </div>
    )
  }

  if (state.status === 'error') {
    if (isNotFound(state.error)) {
      return <NotFound />
    }
    return (
      <div className={styles.status} role="alert">
        <p className={styles.message}>{errorMessage(state.error)}</p>
        <Button variant="secondary" onClick={reload}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  const { opportunity, latest_analysis } = state.data
  const isUnclassified = opportunity.category === UNCLASSIFIED_CATEGORY_CODE
  const isTitleVerified = opportunity.title_verified_at !== null

  // Cabeçalho e "Dados oficiais" usam só opportunity. latest_analysis (IA) vai apenas para a
  // seção própria, depois dos dados oficiais.
  return (
    <article className={styles.article}>
      <header className={styles.header}>
        {(!isUnclassified || !isTitleVerified) && (
          <div className={styles.tags}>
            {!isUnclassified && (
              <Badge tone="primary">{getCategoryDisplayName(opportunity.category, opportunity.category_name)}</Badge>
            )}
            {!isTitleVerified && <Badge tone="neutral">Em verificação</Badge>}
          </div>
        )}
        <h1 className={styles.title}>{opportunity.title}</h1>
        {opportunity.institution && <p className={styles.institution}>{opportunity.institution}</p>}
      </header>

      <OfficialData opportunity={opportunity} />

      <OpportunityAnalysisSection analysis={latest_analysis} />
    </article>
  )
}

/** Página pública de detalhes: /oportunidades/:id. */
function OpportunityDetailPage() {
  const { id = '' } = useParams()
  const isValidId = UUID_PATTERN.test(id)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  return (
    <section className={styles.page}>
      <Container className={styles.inner}>
        <BackToList />
        {isValidId ? <OpportunityDetail key={id} id={id} /> : <NotFound />}
      </Container>
    </section>
  )
}

export default OpportunityDetailPage
