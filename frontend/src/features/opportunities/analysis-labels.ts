import type { AnalysisStatus, ReferenceBasis } from '../../types/opportunity-analysis'

/**
 * Rótulos da análise automática (IA). Só conjuntos fechados do contrato: nenhum texto aqui
 * descreve o conteúdo de um edital. Código sem rótulo conhecido é exibido como veio.
 */

export const analysisStatusLabels: Record<AnalysisStatus, string> = {
  pending: 'Em andamento',
  completed: 'Concluída',
  failed: 'Não concluída',
  needs_review: 'Aguardando revisão',
}

export const referenceBasisLabels: Record<ReferenceBasis, string> = {
  stated: 'Declarado no documento',
  inferred: 'Inferido pela IA',
}

/** Nomes oficiais da tabela profile_types (migration 001). Códigos de target_audience. */
const profileTypeNames: Record<string, string> = {
  startup: 'Startup',
  company: 'Empresa',
  individual_entrepreneur: 'Empreendedor individual',
  researcher: 'Pesquisador',
  student: 'Estudante',
  individual: 'Pessoa física',
  university: 'Universidade',
  research_institution: 'Instituição de pesquisa',
  nonprofit: 'Organização sem fins lucrativos',
  other_institution: 'Outra instituição',
}

/** Portes aceitos em requirements.business_sizes (mesmos valores de user_profiles.business_size). */
const businessSizeLabels: Record<string, string> = {
  mei: 'MEI',
  micro: 'Microempresa',
  small: 'Pequena empresa',
  medium: 'Média empresa',
  large: 'Grande empresa',
}

/** Campos que a análise pode citar em source_references e missing_information. */
const analysisFieldLabels: Record<string, string> = {
  title: 'Título',
  institution: 'Instituição',
  opportunity_category: 'Categoria',
  objective: 'Objetivo',
  observations: 'Observações',
  opening_date: 'Abertura das inscrições',
  closing_date: 'Encerramento das inscrições',
  target_audience: 'Público-alvo',
  eligible_locations: 'Locais elegíveis',
  required_documents: 'Documentos exigidos',
  funding_amount: 'Valor',
  funding_currency: 'Moeda',
  counterpart_required: 'Contrapartida',
  'requirements.segments': 'Segmentos',
  'requirements.business_sizes': 'Porte',
  'requirements.organization_stages': 'Estágio da organização',
  'requirements.min_organization_age_months': 'Tempo mínimo de existência',
  'requirements.max_organization_age_months': 'Tempo máximo de existência',
}

const lookup = (labels: Record<string, string>, code: string): string =>
  Object.hasOwn(labels, code) ? labels[code] : code

export const getProfileTypeName = (code: string): string => lookup(profileTypeNames, code)
export const getBusinessSizeLabel = (code: string): string => lookup(businessSizeLabels, code)
export const getAnalysisFieldLabel = (field: string): string => lookup(analysisFieldLabels, field)

/** true para campos previstos no contrato (REFERENCEABLE_FIELDS do n8n). */
export const isKnownAnalysisField = (field: string): boolean => Object.hasOwn(analysisFieldLabels, field)
