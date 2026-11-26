import type { ReactNode } from 'react'
import Badge from '../../../components/ui/Badge'
import type {
  EligibleLocation,
  OpportunityAnalysis,
  ReferenceBasis,
  SourceReference,
} from '../../../types/opportunity-analysis'
import {
  analysisStatusLabels,
  getAnalysisFieldLabel,
  getBusinessSizeLabel,
  getProfileTypeName,
  isKnownAnalysisField,
  referenceBasisLabels,
} from '../analysis-labels'
import { findCategory } from '../categories'
import { formatCalendarDate, formatDateTime } from '../format-date'
import { formatMoney } from '../format-money'
import styles from './OpportunityAnalysisSection.module.scss'

/**
 * Seção "Análise automática (IA)" do detalhe. Recebe somente latest_analysis: nada aqui vem
 * dos dados oficiais (opportunities), e nada daqui é exibido nas seções oficiais.
 *
 * Exibe apenas campos previstos no contrato da API, como vieram. Campo null, lista vazia ou
 * valor fora do formato do contrato não é exibido. Nenhum texto é criado a partir dos dados.
 */

// ---------------------------------------------------------------------------
// Leitura defensiva: o banco garante a forma de alguns campos; o restante é conferido aqui.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Itens de texto não vazios de uma lista. Itens de outro tipo ficam de fora. */
function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

/** Meses de existência: inteiro >= 0 (n8n.schemas.ts). */
function readMonths(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function readText(value: string | null): string | null {
  return value !== null && value.trim() !== '' ? value : null
}

function isLocation(value: unknown): value is EligibleLocation {
  if (!isRecord(value)) {
    return false
  }
  switch (value.scope) {
    case 'national':
      return true
    case 'state':
      return typeof value.state === 'string'
    case 'city':
      return typeof value.state === 'string' && typeof value.city === 'string'
    default:
      return false
  }
}

const REFERENCE_BASES: readonly string[] = ['stated', 'inferred']

function isSourceReference(value: unknown): value is SourceReference {
  return (
    isRecord(value) &&
    typeof value.field === 'string' &&
    isKnownAnalysisField(value.field) &&
    typeof value.excerpt === 'string' &&
    typeof value.basis === 'string' &&
    REFERENCE_BASES.includes(value.basis)
  )
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function locationLabel(location: EligibleLocation): string {
  switch (location.scope) {
    case 'national':
      return 'Nacional'
    case 'state':
      return location.state
    case 'city':
      return `${location.city} (${location.state})`
  }
}

function monthsLabel(months: number): string {
  return `${months} ${months === 1 ? 'mês' : 'meses'}`
}

// ---------------------------------------------------------------------------
// Componentes de apresentação
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string
  children: ReactNode
  wide?: boolean
}

function Field({ label, children, wide = false }: FieldProps) {
  return (
    <div className={wide ? `${styles.field} ${styles.fieldWide}` : styles.field}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function ValueList({ items }: { items: string[] }) {
  return (
    <ul className={styles.valueList}>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  )
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={styles.externalLink}>
      {children}
      <span aria-hidden="true"> ↗</span>
      <span className={styles.visuallyHidden}> (abre em nova aba)</span>
    </a>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.block}>
      <h3 className={styles.blockTitle}>{title}</h3>
      {children}
    </div>
  )
}

function basisTone(basis: ReferenceBasis): 'neutral' | 'warning' {
  return basis === 'inferred' ? 'warning' : 'neutral'
}

function Evidence({ references }: { references: SourceReference[] }) {
  return (
    <details className={styles.evidence}>
      <summary className={styles.evidenceSummary}>
        Trechos do documento usados pela análise automática ({references.length})
      </summary>
      <p className={styles.evidenceNote}>
        Evidências registradas pela análise automática. Elas mostram de onde a IA extraiu cada
        informação e não são uma confirmação oficial.
      </p>
      <ol className={styles.evidenceList}>
        {references.map((reference, index) => {
          const page = typeof reference.page === 'number' && Number.isInteger(reference.page) ? reference.page : null
          const section = typeof reference.section === 'string' && reference.section.trim() !== '' ? reference.section : null
          const documentUrl = isHttpUrl(reference.document_url) ? reference.document_url : null
          return (
            <li key={`${index}-${reference.field}`} className={styles.evidenceItem}>
              <div className={styles.evidenceHeader}>
                <span className={styles.evidenceField}>{getAnalysisFieldLabel(reference.field)}</span>
                <Badge tone={basisTone(reference.basis)}>{referenceBasisLabels[reference.basis]}</Badge>
              </div>
              <blockquote className={styles.excerpt}>{reference.excerpt}</blockquote>
              {(page !== null || section || documentUrl) && (
                <p className={styles.evidenceMeta}>
                  {page !== null && <span>Página {page}</span>}
                  {section && <span>Seção: {section}</span>}
                  {documentUrl && <ExternalLink href={documentUrl}>Documento citado</ExternalLink>}
                </p>
              )}
            </li>
          )
        })}
      </ol>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Conteúdo da análise (completed e needs_review)
// ---------------------------------------------------------------------------

function AnalysisContent({ analysis }: { analysis: OpportunityAnalysis }) {
  const summary = readText(analysis.analysis_summary)
  const title = readText(analysis.title)
  const institution = readText(analysis.institution)
  const objective = readText(analysis.objective)
  const observations = readText(analysis.observations)
  const category = analysis.suggested_category
    ? (findCategory(analysis.suggested_category)?.name ?? analysis.suggested_category)
    : null
  const opening = analysis.opening_date ? formatCalendarDate(analysis.opening_date) : null
  const closing = analysis.closing_date ? formatCalendarDate(analysis.closing_date) : null
  const currency = readText(analysis.funding_currency)
  const amount =
    analysis.funding_amount !== null && currency ? formatMoney(analysis.funding_amount, currency) : null
  const counterpart = analysis.counterpart_required

  const requirements = isRecord(analysis.requirements) ? analysis.requirements : {}
  const audience = readStrings(analysis.target_audience).map(getProfileTypeName)
  const businessSizes = readStrings(requirements.business_sizes).map(getBusinessSizeLabel)
  const stages = readStrings(requirements.organization_stages)
  const segments = readStrings(requirements.segments)
  const minAge = readMonths(requirements.min_organization_age_months)
  const maxAge = readMonths(requirements.max_organization_age_months)
  const locations = Array.isArray(analysis.eligible_locations)
    ? analysis.eligible_locations.filter(isLocation).map(locationLabel)
    : []
  const documents = readStrings(analysis.required_documents)
  // Campos fora do contrato ficam de fora, aqui e nas evidências.
  const missing = readStrings(analysis.missing_information).filter(isKnownAnalysisField).map(getAnalysisFieldLabel)
  const references = Array.isArray(analysis.source_references)
    ? analysis.source_references.filter(isSourceReference)
    : []

  const hasIdentified = Boolean(
    title || institution || category || opening || closing || amount || (currency && !amount) || counterpart !== null || objective || observations,
  )
  const hasEligibility =
    audience.length > 0 ||
    businessSizes.length > 0 ||
    stages.length > 0 ||
    segments.length > 0 ||
    minAge !== null ||
    maxAge !== null ||
    locations.length > 0

  if (!summary && !hasIdentified && !hasEligibility && documents.length === 0 && missing.length === 0 && references.length === 0) {
    return <p className={styles.message}>A análise não extraiu informações deste edital.</p>
  }

  return (
    <div className={styles.content}>
      {summary && (
        <Block title="Resumo da análise">
          <p className={styles.text}>{summary}</p>
        </Block>
      )}

      {hasIdentified && (
        <Block title="Informações identificadas">
          <dl className={styles.fields}>
            {title && <Field label="Título">{title}</Field>}
            {institution && <Field label="Instituição">{institution}</Field>}
            {category && <Field label="Categoria sugerida">{category}</Field>}
            {analysis.opening_date && opening && (
              <Field label="Abertura das inscrições">
                <time dateTime={analysis.opening_date}>{opening}</time>
              </Field>
            )}
            {analysis.closing_date && closing && (
              <Field label="Encerramento das inscrições">
                <time dateTime={analysis.closing_date}>{closing}</time>
              </Field>
            )}
            {amount && <Field label="Valor">{amount}</Field>}
            {currency && !amount && <Field label="Moeda">{currency}</Field>}
            {counterpart !== null && <Field label="Exige contrapartida">{counterpart ? 'Sim' : 'Não'}</Field>}
            {objective && (
              <Field label="Objetivo" wide>
                <span className={styles.text}>{objective}</span>
              </Field>
            )}
            {observations && (
              <Field label="Observações" wide>
                <span className={styles.text}>{observations}</span>
              </Field>
            )}
          </dl>
        </Block>
      )}

      {hasEligibility && (
        <Block title="Elegibilidade">
          <dl className={styles.fields}>
            {audience.length > 0 && (
              <Field label="Público-alvo">
                <ValueList items={audience} />
              </Field>
            )}
            {businessSizes.length > 0 && (
              <Field label="Porte">
                <ValueList items={businessSizes} />
              </Field>
            )}
            {stages.length > 0 && (
              <Field label="Estágio da organização">
                <ValueList items={stages} />
              </Field>
            )}
            {segments.length > 0 && (
              <Field label="Segmentos">
                <ValueList items={segments} />
              </Field>
            )}
            {minAge !== null && <Field label="Tempo mínimo de existência">{monthsLabel(minAge)}</Field>}
            {maxAge !== null && <Field label="Tempo máximo de existência">{monthsLabel(maxAge)}</Field>}
            {locations.length > 0 && (
              <Field label="Locais elegíveis">
                <ValueList items={locations} />
              </Field>
            )}
          </dl>
        </Block>
      )}

      {documents.length > 0 && (
        <Block title="Documentos exigidos">
          <ValueList items={documents} />
        </Block>
      )}

      {missing.length > 0 && (
        <Block title="Não identificado no documento">
          <p className={styles.blockNote}>A análise automática não encontrou estas informações no documento:</p>
          <ValueList items={missing} />
        </Block>
      )}

      {references.length > 0 && <Evidence references={references} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Seção
// ---------------------------------------------------------------------------

function AnalysisFooter({ analysis }: { analysis: OpportunityAnalysis }) {
  const model = readText(analysis.model_name)
  const analyzedAt = analysis.analyzed_at ? formatDateTime(analysis.analyzed_at) : null
  return (
    <p className={styles.footer}>
      <span>Situação da análise: {analysisStatusLabels[analysis.analysis_status] ?? analysis.analysis_status}</span>
      {model && <span>Modelo: {model}</span>}
      {analysis.analyzed_at && analyzedAt && (
        <span>
          Analisada em <time dateTime={analysis.analyzed_at}>{analyzedAt}</time>
        </span>
      )}
    </p>
  )
}

function AnalysisBody({ analysis }: { analysis: OpportunityAnalysis | null }) {
  if (analysis === null) {
    return <p className={styles.message}>Nenhuma análise automática disponível para este edital.</p>
  }

  switch (analysis.analysis_status) {
    case 'pending':
      return <p className={styles.message}>A análise automática deste edital ainda está em andamento.</p>
    case 'failed':
      return <p className={styles.message}>Não foi possível concluir a análise automática deste edital.</p>
    case 'needs_review':
    case 'completed':
      return (
        <>
          <p className={styles.notice}>
            Informações extraídas automaticamente do documento do edital por inteligência artificial. Elas não
            foram confirmadas pela instituição responsável e podem conter erros. Confira sempre o edital
            oficial.
          </p>
          {analysis.analysis_status === 'needs_review' && (
            <p className={styles.reviewNote}>Esta análise aguarda revisão humana.</p>
          )}
          <AnalysisContent analysis={analysis} />
          <AnalysisFooter analysis={analysis} />
        </>
      )
    default:
      // Status fora do contrato: nada é exibido além da identificação da seção.
      return <p className={styles.message}>Nenhuma análise automática disponível para este edital.</p>
  }
}

function OpportunityAnalysisSection({ analysis }: { analysis: OpportunityAnalysis | null }) {
  return (
    <section className={styles.section} aria-labelledby="analise-ia-titulo">
      <div className={styles.heading}>
        <h2 id="analise-ia-titulo" className={styles.title}>
          Análise automática (IA)
        </h2>
        <Badge tone="warning">Não confirmada</Badge>
      </div>
      <AnalysisBody analysis={analysis} />
    </section>
  )
}

export default OpportunityAnalysisSection
