import type {
  OpportunityCategoryCode,
  OpportunityCategoryPresentation,
} from '../../types/opportunity-category'

/**
 * As oito categorias oficiais, na ordem de sort_order do backend.
 * - code, name e description: cópia exata de opportunity_categories (migrations 001 e 003).
 *   A API não tem endpoint de categorias; se o banco mudar, esta lista deve ser atualizada.
 * - displayName e displayDescription: textos de vitrine da interface pública.
 *   Nunca substituem os valores oficiais.
 */
export const opportunityCategories: OpportunityCategoryPresentation[] = [
  {
    code: 'grant',
    name: 'Fomento',
    description: 'Editais de fomento e subvenção.',
    displayName: 'Editais de fomento',
    displayDescription: 'Recursos não reembolsáveis para projetos de pesquisa, inovação e cultura.',
  },
  {
    code: 'financing',
    name: 'Financiamento',
    description: 'Linhas de crédito e financiamento.',
    displayName: 'Financiamentos',
    displayDescription: 'Linhas de crédito com condições especiais para empresas e empreendedores.',
  },
  {
    code: 'scholarship',
    name: 'Bolsas',
    description: 'Bolsas de pesquisa e estudos.',
    displayName: 'Bolsas',
    displayDescription: 'Bolsas de pesquisa, estudo e formação para estudantes e pesquisadores.',
  },
  {
    code: 'acceleration',
    name: 'Aceleração',
    description: 'Programas de aceleração e incubação.',
    displayName: 'Aceleração',
    displayDescription: 'Programas de aceleração e incubação para startups em crescimento.',
  },
  {
    code: 'award',
    name: 'Premiações',
    description: 'Prêmios e concursos.',
    displayName: 'Premiações',
    displayDescription: 'Prêmios e concursos que reconhecem projetos e iniciativas.',
  },
  {
    code: 'public_call',
    name: 'Chamadas públicas',
    description:
      'Chamadas públicas de seleção de projetos ou participantes. Não inclui licitações ou contratações.',
    displayName: 'Chamadas públicas',
    displayDescription:
      'Chamadas públicas de seleção de projetos ou participantes. Não inclui licitações ou contratações.',
  },
  {
    code: 'institutional',
    name: 'Oportunidades institucionais',
    description: 'Demais oportunidades divulgadas por instituições.',
    displayName: 'Oportunidades institucionais',
    displayDescription: 'Demais oportunidades divulgadas por instituições.',
  },
  {
    // Marcador operacional (migration 003): "ainda sem categoria confirmada".
    // Não é uma classificação: não aparece como card nem como filtro da vitrine.
    code: 'unclassified',
    name: 'Não classificada',
    description:
      'Marcador operacional: a oportunidade ainda não tem categoria confirmada. Não é uma classificação e não deve ser apresentada como tal.',
    displayName: 'Não classificada',
    displayDescription: 'Oportunidade ainda sem categoria confirmada.',
  },
]

/** Código da categoria operacional "sem categoria confirmada". */
export const UNCLASSIFIED_CATEGORY_CODE: OpportunityCategoryCode = 'unclassified'

/** Categorias exibidas como cards na página pública (as mesmas cinco da Etapa 7). */
const PUBLIC_CATEGORY_CODES: readonly OpportunityCategoryCode[] = [
  'grant',
  'financing',
  'scholarship',
  'acceleration',
  'award',
]

export const publicCategories: OpportunityCategoryPresentation[] = opportunityCategories.filter(
  (category) => PUBLIC_CATEGORY_CODES.includes(category.code),
)

/** Texto usado quando nem o frontend nem a API informam um nome. */
const UNKNOWN_CATEGORY_NAME = 'Categoria não informada'

export function findCategory(code: string): OpportunityCategoryPresentation | undefined {
  return opportunityCategories.find((category) => category.code === code)
}

export function isOpportunityCategoryCode(code: string): code is OpportunityCategoryCode {
  return findCategory(code) !== undefined
}

/**
 * Texto de vitrine para cards e elementos visuais.
 * Código desconhecido: usa o nome oficial enviado pela API (category_name), nunca o código.
 */
export function getCategoryDisplayName(code: string, apiName?: string): string {
  return findCategory(code)?.displayName ?? apiName ?? UNKNOWN_CATEGORY_NAME
}

/**
 * Nome oficial. O valor enviado pela API (category_name) tem prioridade sobre a cópia local.
 */
export function getCategoryOfficialName(code: string, apiName?: string): string {
  return apiName ?? findCategory(code)?.name ?? UNKNOWN_CATEGORY_NAME
}
