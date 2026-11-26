import type { Queryable, TransactionRunner } from "../database/transaction";
import { AppError } from "../errors/app-error";
import type { OpportunitySortField } from "./opportunities.constants";
import type { ListOpportunitiesQuery } from "./opportunities.schemas";

/** Dados oficiais da oportunidade: somente colunas de opportunities (e o nome da categoria). */
export interface Opportunity {
  id: string;
  title: string;
  title_verified_at: Date | null;
  institution: string | null;
  institution_verified_at: Date | null;
  category: string;
  category_name: string;
  category_verified_at: Date | null;
  status: string;
  /** YYYY-MM-DD. */
  publication_date: string | null;
  opening_date: Date | null;
  deadline: Date | null;
  eligibility_verified_at: Date | null;
  source_name: string;
  source_url: string | null;
  document_url: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Resumo da última análise de IA (opportunity_analyses). Conteúdo extraído automaticamente,
 * NÃO confirmado: confirmed é sempre false. Serve só para complementar a apresentação.
 */
export interface LatestAnalysisSummary {
  confirmed: false;
  id: string;
  analysis_status: string;
  suggested_category: string | null;
  /** YYYY-MM-DD extraído pela IA. */
  opening_date: string | null;
  closing_date: string | null;
  model_name: string | null;
  analyzed_at: Date | null;
}

/**
 * Última análise de IA completa, com as evidências (source_references). NÃO confirmada:
 * confirmed é sempre false. Os campos repetem os nomes das colunas de opportunity_analyses,
 * exceto opportunity_category, exposto como suggested_category.
 */
export interface LatestAnalysisDetail extends LatestAnalysisSummary {
  analysis_summary: string | null;
  title: string | null;
  institution: string | null;
  objective: string | null;
  observations: string | null;
  target_audience: unknown[] | null;
  requirements: Record<string, unknown> | null;
  eligible_locations: unknown[] | null;
  required_documents: unknown[] | null;
  funding_amount: number | null;
  funding_currency: string | null;
  counterpart_required: boolean | null;
  missing_information: string[] | null;
  /** Evidências: trecho, documento, página/seção e basis (stated | inferred) de cada campo. */
  source_references: unknown[] | null;
  created_at: Date;
}

/** Item da listagem: colunas oficiais de opportunities + resumo da última análise. */
export interface OpportunityListItem extends Opportunity {
  latest_analysis: LatestAnalysisSummary | null;
}

export interface Pagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface OpportunityListResult {
  items: OpportunityListItem[];
  pagination: Pagination;
}

/** Consulta individual: dados oficiais e última análise separados. */
export interface OpportunityDetailResult {
  opportunity: Opportunity;
  latest_analysis: LatestAnalysisDetail | null;
}

export interface OpportunitiesService {
  listOpportunities(query: ListOpportunitiesQuery): Promise<OpportunityListResult>;
  /** Lança AppError 404 (opportunity_not_found) quando o id não existe. */
  getOpportunity(id: string): Promise<OpportunityDetailResult>;
}

// ---- Regras puras (sem banco) ----------------------------------------------

// Coluna SQL de cada campo de ordenação. O texto recebido nunca entra no SQL: só estas chaves.
export const SORT_COLUMNS: Record<OpportunitySortField, string> = {
  created_at: "o.created_at",
  updated_at: "o.updated_at",
  title: "o.title",
  deadline: "o.deadline",
  publication_date: "o.publication_date",
};

/** Escapa \, % e _ para uso em ILIKE ... ESCAPE '\'. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface WhereClause {
  sql: string;
  params: unknown[];
}

// Monta o WHERE só com os filtros enviados. Todos os valores vão como parâmetros $n.
// Filtros usam exclusivamente colunas oficiais de opportunities.
export function buildWhere(query: ListOpportunitiesQuery): WhereClause {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.category !== undefined) {
    params.push(query.category);
    conditions.push(`o.category = $${params.length}`);
  }
  if (query.status !== undefined) {
    params.push(query.status);
    conditions.push(`o.status = $${params.length}`);
  }
  if (query.institution !== undefined) {
    params.push(`%${escapeLikePattern(query.institution)}%`);
    conditions.push(`o.institution ILIKE $${params.length} ESCAPE '\\'`);
  }
  return { sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

export function buildOrderBy(query: ListOpportunitiesQuery): string {
  const direction = query.order === "asc" ? "ASC" : "DESC";
  // NULL sempre por último; id desempata para a paginação ser estável.
  return `ORDER BY ${SORT_COLUMNS[query.sort]} ${direction} NULLS LAST, o.id ${direction}`;
}

export function totalPages(total: number, pageSize: number): number {
  return total === 0 ? 0 : Math.ceil(total / pageSize);
}

// numeric(18,2) chega do driver pg como texto. O schema do n8n limita o valor a 1 trilhão
// com 2 casas, que cabe em number sem perda.
export function numericToNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

// ---- Acesso a dados ----------------------------------------------------------

interface OpportunityRow {
  id: string;
  title: string;
  title_verified_at: Date | null;
  institution: string | null;
  institution_verified_at: Date | null;
  category: string;
  category_name: string;
  category_verified_at: Date | null;
  status: string;
  publication_date: string | null;
  opening_date: Date | null;
  deadline: Date | null;
  eligibility_verified_at: Date | null;
  source_name: string;
  source_url: string | null;
  document_url: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ListRow extends OpportunityRow {
  analysis_id: string | null;
  analysis_status: string | null;
  analysis_opportunity_category: string | null;
  analysis_opening_date: string | null;
  analysis_closing_date: string | null;
  analysis_model_name: string | null;
  analysis_analyzed_at: Date | null;
}

interface AnalysisRow {
  id: string;
  analysis_status: string;
  analysis_summary: string | null;
  opportunity_category: string | null;
  title: string | null;
  institution: string | null;
  objective: string | null;
  observations: string | null;
  opening_date: string | null;
  closing_date: string | null;
  target_audience: unknown[] | null;
  requirements: Record<string, unknown> | null;
  eligible_locations: unknown[] | null;
  required_documents: unknown[] | null;
  funding_amount: string | null;
  funding_currency: string | null;
  counterpart_required: boolean | null;
  missing_information: string[] | null;
  source_references: unknown[] | null;
  model_name: string | null;
  analyzed_at: Date | null;
  created_at: Date;
}

// Colunas oficiais, iguais na listagem e na consulta individual.
// Colunas date saem como texto (::text) para não sofrer deslocamento de fuso no driver pg.
const OPPORTUNITY_COLUMNS = `o.id, o.title, o.title_verified_at, o.institution, o.institution_verified_at,
         o.category, c.name AS category_name, o.category_verified_at, o.status,
         o.publication_date::text AS publication_date, o.opening_date, o.deadline,
         o.eligibility_verified_at, o.source_name, o.source_url, o.document_url,
         o.created_at, o.updated_at`;

// A última análise é a mais recente por created_at (índice opportunity_analyses_opportunity_created_idx).
const LIST_SELECT = `
  SELECT ${OPPORTUNITY_COLUMNS},
         la.id AS analysis_id, la.analysis_status,
         la.opportunity_category AS analysis_opportunity_category,
         la.opening_date::text AS analysis_opening_date,
         la.closing_date::text AS analysis_closing_date,
         la.model_name AS analysis_model_name, la.analyzed_at AS analysis_analyzed_at
  FROM opportunities o
  JOIN opportunity_categories c ON c.code = o.category
  LEFT JOIN LATERAL (
    SELECT a.id, a.analysis_status, a.opportunity_category, a.opening_date, a.closing_date,
           a.model_name, a.analyzed_at
    FROM opportunity_analyses a
    WHERE a.opportunity_id = o.id
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 1
  ) la ON true`;

const DETAIL_OPPORTUNITY_SELECT = `
  SELECT ${OPPORTUNITY_COLUMNS}
  FROM opportunities o
  JOIN opportunity_categories c ON c.code = o.category
  WHERE o.id = $1`;

// Mesmo critério de "última análise" da listagem. funding_amount como texto evita
// arredondamento antes da conversão controlada (numericToNumber).
const DETAIL_ANALYSIS_SELECT = `
  SELECT a.id, a.analysis_status, a.analysis_summary, a.opportunity_category,
         a.title, a.institution, a.objective, a.observations,
         a.opening_date::text AS opening_date, a.closing_date::text AS closing_date,
         a.target_audience, a.requirements, a.eligible_locations, a.required_documents,
         a.funding_amount::text AS funding_amount, a.funding_currency, a.counterpart_required,
         a.missing_information, a.source_references, a.model_name, a.analyzed_at, a.created_at
  FROM opportunity_analyses a
  WHERE a.opportunity_id = $1
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT 1`;

function toOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    title: row.title,
    title_verified_at: row.title_verified_at,
    institution: row.institution,
    institution_verified_at: row.institution_verified_at,
    category: row.category,
    category_name: row.category_name,
    category_verified_at: row.category_verified_at,
    status: row.status,
    publication_date: row.publication_date,
    opening_date: row.opening_date,
    deadline: row.deadline,
    eligibility_verified_at: row.eligibility_verified_at,
    source_name: row.source_name,
    source_url: row.source_url,
    document_url: row.document_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toListItem(row: ListRow): OpportunityListItem {
  return {
    ...toOpportunity(row),
    latest_analysis:
      row.analysis_id === null
        ? null
        : {
            confirmed: false,
            id: row.analysis_id,
            analysis_status: row.analysis_status as string,
            suggested_category: row.analysis_opportunity_category,
            opening_date: row.analysis_opening_date,
            closing_date: row.analysis_closing_date,
            model_name: row.analysis_model_name,
            analyzed_at: row.analysis_analyzed_at,
          },
  };
}

function toAnalysisDetail(row: AnalysisRow): LatestAnalysisDetail {
  return {
    confirmed: false,
    id: row.id,
    analysis_status: row.analysis_status,
    analysis_summary: row.analysis_summary,
    suggested_category: row.opportunity_category,
    title: row.title,
    institution: row.institution,
    objective: row.objective,
    observations: row.observations,
    opening_date: row.opening_date,
    closing_date: row.closing_date,
    target_audience: row.target_audience,
    requirements: row.requirements,
    eligible_locations: row.eligible_locations,
    required_documents: row.required_documents,
    funding_amount: numericToNumber(row.funding_amount),
    funding_currency: row.funding_currency,
    counterpart_required: row.counterpart_required,
    missing_information: row.missing_information,
    source_references: row.source_references,
    model_name: row.model_name,
    analyzed_at: row.analyzed_at,
    created_at: row.created_at,
  };
}

async function list(tx: Queryable, query: ListOpportunitiesQuery): Promise<OpportunityListResult> {
  // Somente leitura: o banco rejeita qualquer escrita nesta transação.
  await tx.query("SET TRANSACTION READ ONLY");

  const where = buildWhere(query);
  // count(*) e itens na mesma transação: total e página vêm do mesmo estado do banco.
  const countResult = await tx.query<{ total: string }>(
    `SELECT count(*) AS total FROM opportunities o ${where.sql}`,
    where.params,
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  const limitIndex = where.params.length + 1;
  const offsetIndex = where.params.length + 2;
  const itemsResult = await tx.query<ListRow>(
    `${LIST_SELECT}
  ${where.sql}
  ${buildOrderBy(query)}
  LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    [...where.params, query.page_size, (query.page - 1) * query.page_size],
  );

  return {
    items: itemsResult.rows.map(toListItem),
    pagination: {
      page: query.page,
      page_size: query.page_size,
      total,
      total_pages: totalPages(total, query.page_size),
    },
  };
}

// id já validado como UUID pelo controller (um texto inválido geraria erro 22P02 no banco).
async function getById(tx: Queryable, id: string): Promise<OpportunityDetailResult> {
  await tx.query("SET TRANSACTION READ ONLY");

  const opportunityResult = await tx.query<OpportunityRow>(DETAIL_OPPORTUNITY_SELECT, [id]);
  const row = opportunityResult.rows[0];
  if (!row) {
    throw new AppError(404, "opportunity_not_found", "Opportunity not found.");
  }

  const analysisResult = await tx.query<AnalysisRow>(DETAIL_ANALYSIS_SELECT, [id]);
  const analysis = analysisResult.rows[0];

  return {
    opportunity: toOpportunity(row),
    latest_analysis: analysis ? toAnalysisDetail(analysis) : null,
  };
}

export function createOpportunitiesService(runInTransaction: TransactionRunner): OpportunitiesService {
  return {
    listOpportunities: (query) => runInTransaction((tx) => list(tx, query)),
    getOpportunity: (id) => runInTransaction((tx) => getById(tx, id)),
  };
}
