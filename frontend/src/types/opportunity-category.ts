/**
 * Códigos de opportunity_categories (migration 001 e, para 'unclassified', migration 003).
 * A tabela pode ganhar categorias por migration: dados vindos da API usam `string`
 * (Opportunity.category) e esta união descreve as categorias conhecidas pelo frontend.
 */
export type OpportunityCategoryCode =
  | 'grant'
  | 'financing'
  | 'scholarship'
  | 'acceleration'
  | 'award'
  | 'public_call'
  | 'institutional'
  | 'unclassified'

/** Categoria oficial: code, name e description exatamente como no banco/API. */
export interface OpportunityCategory {
  code: OpportunityCategoryCode
  name: string
  description: string | null
}

/**
 * Categoria oficial acrescida dos textos de vitrine da interface pública.
 * displayName e displayDescription nunca substituem name e description.
 */
export interface OpportunityCategoryPresentation extends OpportunityCategory {
  displayName: string
  displayDescription: string
}
