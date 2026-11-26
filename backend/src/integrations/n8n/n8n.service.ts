import { randomUUID } from "node:crypto";
import type { Queryable, TransactionRunner } from "../../database/transaction";
import { AppError } from "../../errors/app-error";
import { REQUIREMENT_KEYS, UNCLASSIFIED_CATEGORY, type ReferenceableField } from "./n8n.constants";
import type { N8nIngestInput } from "./n8n.schemas";

type Analysis = N8nIngestInput["analysis"];
type Source = N8nIngestInput["source"];

export type AnalysisStatus = "completed" | "needs_review";

export interface N8nIngestResult {
  opportunity: { id: string; action: "created" | "unchanged" };
  analysis: { id: string; action: "created" | "already_registered"; status: string };
  review: {
    fields_without_reference: ReferenceableField[];
    fields_inferred_only: ReferenceableField[];
  };
}

export interface N8nService {
  ingestOpportunityAnalysis(input: N8nIngestInput): Promise<N8nIngestResult>;
}

/** Valores prontos para gravar em opportunity_analyses (NULL = não informado). */
export interface AnalysisRecord {
  title: string;
  analysisSummary: string | null;
  institution: string | null;
  /** Categoria SUGERIDA pela IA. NULL = sem classificação segura. */
  opportunityCategory: string | null;
  objective: string | null;
  observations: string | null;
  /** YYYY-MM-DD, gravado como date. */
  openingDate: string | null;
  closingDate: string | null;
  targetAudience: string[] | null;
  requirements: Record<string, unknown> | null;
  eligibleLocations: unknown[] | null;
  requiredDocuments: string[] | null;
  fundingAmount: number | null;
  fundingCurrency: string | null;
  counterpartRequired: boolean | null;
  missingInformation: string[] | null;
  sourceReferences: unknown[] | null;
  status: AnalysisStatus;
  fieldsWithoutReference: ReferenceableField[];
  fieldsInferredOnly: ReferenceableField[];
}

// ---- Regras puras (sem banco) ----------------------------------------------

function compactRequirements(criteria: Analysis["eligibility_criteria"]): Record<string, unknown> | null {
  if (!criteria) {
    return null;
  }
  const entries = Object.entries(criteria).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function listExtractedFields(
  analysis: Analysis,
  requirements: Record<string, unknown> | null,
): ReferenceableField[] {
  const fields: ReferenceableField[] = ["title"];
  if (analysis.institution !== undefined) fields.push("institution");
  if (analysis.opportunity_category !== undefined) fields.push("opportunity_category");
  if (analysis.objective !== undefined) fields.push("objective");
  if (analysis.observations !== undefined) fields.push("observations");
  if (analysis.opening_date !== undefined) fields.push("opening_date");
  if (analysis.closing_date !== undefined) fields.push("closing_date");
  if (analysis.target_audience) fields.push("target_audience");
  if (analysis.eligible_locations) fields.push("eligible_locations");
  if (analysis.required_documents) fields.push("required_documents");
  if (analysis.funding_amount !== undefined) fields.push("funding_amount");
  if (analysis.funding_currency !== undefined) fields.push("funding_currency");
  if (analysis.counterpart_required !== undefined) fields.push("counterpart_required");
  for (const key of REQUIREMENT_KEYS) {
    if (requirements && requirements[key] !== undefined) {
      fields.push(`requirements.${key}` as ReferenceableField);
    }
  }
  return fields;
}

/**
 * Converte a análise validada em valores de banco e decide o status.
 * Cada campo extraído e não nulo (inclusive title, institution, opportunity_category,
 * objective, observations e datas) precisa de referência própria (field idêntico) com
 * basis "stated". Sem referência, ou só com "inferred", o campo não é tratado como fato:
 * o status vira needs_review. A mesma regra é imposta pelo banco (migration 003).
 * Nenhum dado é promovido para opportunities.
 */
export function buildAnalysisRecord(input: N8nIngestInput): AnalysisRecord {
  const analysis = input.analysis;
  const requirements = compactRequirements(analysis.eligibility_criteria);
  const references = analysis.source_references ?? [];
  const extracted = listExtractedFields(analysis, requirements);

  const referencedFields = new Set<string>(references.map((reference) => reference.field));
  const statedFields = new Set<string>(
    references.filter((reference) => reference.basis === "stated").map((reference) => reference.field),
  );
  const fieldsWithoutReference = extracted.filter((field) => !referencedFields.has(field));
  const fieldsInferredOnly = extracted.filter(
    (field) => referencedFields.has(field) && !statedFields.has(field),
  );

  return {
    title: analysis.title,
    analysisSummary: analysis.analysis_summary ?? null,
    institution: analysis.institution ?? null,
    opportunityCategory: analysis.opportunity_category ?? null,
    objective: analysis.objective ?? null,
    observations: analysis.observations ?? null,
    openingDate: analysis.opening_date ?? null,
    closingDate: analysis.closing_date ?? null,
    targetAudience: analysis.target_audience ?? null,
    requirements,
    eligibleLocations: analysis.eligible_locations ?? null,
    requiredDocuments: analysis.required_documents ?? null,
    fundingAmount: analysis.funding_amount ?? null,
    fundingCurrency: analysis.funding_currency ?? null,
    counterpartRequired: analysis.counterpart_required ?? null,
    missingInformation: analysis.missing_information ?? null,
    sourceReferences: analysis.source_references ?? null,
    status: fieldsWithoutReference.length === 0 && fieldsInferredOnly.length === 0 ? "completed" : "needs_review",
    fieldsWithoutReference,
    fieldsInferredOnly,
  };
}

// ---- Acesso a dados ----------------------------------------------------------

interface IdRow {
  id: string;
}

const jsonParam = (value: unknown): string | null => (value === null ? null : JSON.stringify(value));

// Serializa requisições da mesma oportunidade, tornando localizar-e-inserir atômico
// mesmo com reenvios simultâneos. O lock é liberado no fim da transação.
function lockKey(source: Source): string {
  return source.external_id !== undefined
    ? `ext|${source.source_name}|${source.external_id}`
    : `url|${source.source_name}|${source.source_url ?? ""}`;
}

// Mesma identidade dos índices únicos parciais da migration 001.
async function findOpportunityId(tx: Queryable, source: Source): Promise<string | undefined> {
  const result =
    source.external_id !== undefined
      ? await tx.query<IdRow>(
          "SELECT id FROM opportunities WHERE source_name = $1 AND external_id = $2",
          [source.source_name, source.external_id],
        )
      : await tx.query<IdRow>(
          "SELECT id FROM opportunities WHERE source_name = $1 AND external_id IS NULL AND source_url = $2",
          [source.source_name, source.source_url ?? null],
        );
  return result.rows[0]?.id;
}

async function assertKnownProfileTypes(tx: Queryable, codes: string[] | undefined): Promise<void> {
  if (!codes) {
    return;
  }
  const result = await tx.query<{ code: string }>(
    "SELECT code FROM profile_types WHERE code = ANY($1::text[]) AND is_active",
    [codes],
  );
  const known = new Set(result.rows.map((row) => row.code));
  const unknown = codes.filter((code) => !known.has(code));
  if (unknown.length > 0) {
    throw new AppError(
      422,
      "unknown_target_audience",
      "target_audience contains unknown or inactive profile types.",
      unknown.map((code) => ({
        path: "analysis.target_audience",
        message: `Unknown or inactive profile type: ${code}`,
      })),
    );
  }
}

// Valida a categoria SUGERIDA (gravada em opportunity_analyses, com FK). Sem sugestão, nada
// a validar. 'unclassified' já foi rejeitada pelo schema.
async function assertActiveCategory(tx: Queryable, code: string | undefined): Promise<void> {
  if (code === undefined) {
    return;
  }
  const result = await tx.query(
    "SELECT 1 FROM opportunity_categories WHERE code = $1 AND is_active",
    [code],
  );
  if (result.rows.length === 0) {
    throw new AppError(422, "unknown_opportunity_category", "opportunity_category is unknown or inactive.", [
      { path: "analysis.opportunity_category", message: `Unknown or inactive category: ${code}` },
    ]);
  }
}

// Cria somente o registro de identificação, todo provisório:
//  * title e institution vêm da análise, com *_verified_at NULL (default) e a procedência em
//    identification_analysis_id (a análise inserida logo depois, na mesma transação; a FK é
//    DEFERRABLE e só é checada no COMMIT);
//  * category = 'unclassified': a sugestão da IA nunca é promovida, fica só na análise.
// Nenhum critério de elegibilidade, valor, data, status ou eligibility_verified_at é gravado.
async function insertOpportunity(
  tx: Queryable,
  input: N8nIngestInput,
  identificationAnalysisId: string,
): Promise<string | undefined> {
  const { source, analysis } = input;
  const result = await tx.query<IdRow>(
    `INSERT INTO opportunities
       (title, institution, category, source_url, source_name, external_id, identification_analysis_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      analysis.title,
      analysis.institution ?? null,
      UNCLASSIFIED_CATEGORY,
      source.source_url ?? null,
      source.source_name,
      source.external_id ?? null,
      identificationAnalysisId,
    ],
  );
  return result.rows[0]?.id;
}

// $1..$19 são usados tanto na busca de análise equivalente quanto na inserção. Cobrem
// TODAS as colunas de conteúdo da análise: mudar qualquer uma gera uma nova análise.
export const ANALYSIS_CONTENT_PARAM_COUNT = 19;

function analysisParams(opportunityId: string, modelName: string, record: AnalysisRecord): unknown[] {
  return [
    opportunityId,
    modelName,
    record.title,
    record.analysisSummary,
    record.institution,
    record.opportunityCategory,
    record.objective,
    record.observations,
    record.openingDate,
    record.closingDate,
    jsonParam(record.targetAudience),
    jsonParam(record.requirements),
    jsonParam(record.eligibleLocations),
    jsonParam(record.requiredDocuments),
    record.fundingAmount,
    record.fundingCurrency,
    record.counterpartRequired,
    jsonParam(record.missingInformation),
    jsonParam(record.sourceReferences),
  ];
}

// Reenvio idempotente: opportunity_analyses é um histórico sem chave natural, então uma
// análise com conteúdo e modelo idênticos é considerada a mesma e não é gravada de novo.
// Comparação com IS NOT DISTINCT FROM em cada coluna de conteúdo (NULL = NULL). Datas são
// comparadas como date e JSON como jsonb (ordem de chaves irrelevante; ordem de arrays,
// inclusive das referências, relevante). analysis_summary IS NULL exclui análises da
// Etapa 3.1, que concatenavam objetivo e observações: reenviá-las grava a versão completa.
// analyzed_at não entra: é metadado da execução, não conteúdo.
async function findEquivalentAnalysis(
  tx: Queryable,
  params: unknown[],
): Promise<{ id: string; analysis_status: string } | undefined> {
  const result = await tx.query<{ id: string; analysis_status: string }>(
    `SELECT id, analysis_status FROM opportunity_analyses
     WHERE opportunity_id = $1
       AND model_name IS NOT DISTINCT FROM $2::text
       AND title IS NOT DISTINCT FROM $3::text
       AND analysis_summary IS NOT DISTINCT FROM $4::text
       AND institution IS NOT DISTINCT FROM $5::text
       AND opportunity_category IS NOT DISTINCT FROM $6::text
       AND objective IS NOT DISTINCT FROM $7::text
       AND observations IS NOT DISTINCT FROM $8::text
       AND opening_date IS NOT DISTINCT FROM $9::date
       AND closing_date IS NOT DISTINCT FROM $10::date
       AND target_audience IS NOT DISTINCT FROM $11::jsonb
       AND requirements IS NOT DISTINCT FROM $12::jsonb
       AND eligible_locations IS NOT DISTINCT FROM $13::jsonb
       AND required_documents IS NOT DISTINCT FROM $14::jsonb
       AND funding_amount IS NOT DISTINCT FROM $15::numeric
       AND funding_currency IS NOT DISTINCT FROM $16::text
       AND counterpart_required IS NOT DISTINCT FROM $17::boolean
       AND missing_information IS NOT DISTINCT FROM $18::jsonb
       AND source_references IS NOT DISTINCT FROM $19::jsonb
     ORDER BY created_at DESC
     LIMIT 1`,
    params,
  );
  return result.rows[0];
}

async function insertAnalysis(
  tx: Queryable,
  params: unknown[],
  analysisId: string,
  status: AnalysisStatus,
  analyzedAt: string | undefined,
): Promise<string | undefined> {
  const result = await tx.query<IdRow>(
    `INSERT INTO opportunity_analyses
      (opportunity_id, model_name, title, analysis_summary, institution, opportunity_category, objective,
      observations, opening_date, closing_date, target_audience, requirements,
      eligible_locations, required_documents, funding_amount, funding_currency,
      counterpart_required, missing_information, source_references,
      id, analysis_status, analyzed_at)
      VALUES ($1, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text,
              $8::text, $9::date, $10::date, $11::jsonb, $12::jsonb,
              $13::jsonb, $14::jsonb, $15::numeric, $16::text,
              $17::boolean, $18::jsonb, $19::jsonb,
              $20::uuid, $21::text, COALESCE($22::timestamptz, now()))
     RETURNING id`,
    [...params, analysisId, status, analyzedAt ?? null],
  );
  return result.rows[0]?.id;
}

// ---- Caso de uso -------------------------------------------------------------

async function ingest(tx: Queryable, input: N8nIngestInput): Promise<N8nIngestResult> {
  const { source, analysis } = input;
  const record = buildAnalysisRecord(input);

  // Id gerado antes: na criação, a oportunidade já aponta para a análise que a originou.
  const newAnalysisId = randomUUID();

  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [lockKey(source)]);
  await assertKnownProfileTypes(tx, analysis.target_audience);
  await assertActiveCategory(tx, analysis.opportunity_category);

  let opportunityId = await findOpportunityId(tx, source);
  let opportunityCreated = false;
  if (opportunityId === undefined) {
    const insertedId = await insertOpportunity(tx, input, newAnalysisId);
    opportunityCreated = insertedId !== undefined;
    opportunityId = insertedId ?? (await findOpportunityId(tx, source));
  }
  if (opportunityId === undefined) {
    throw new AppError(409, "conflict", "The opportunity could not be created because of a conflict.");
  }

  const params = analysisParams(opportunityId, input.model_name, record);
  const existing = await findEquivalentAnalysis(tx, params);

  let analysisId: string;
  let analysisAction: "created" | "already_registered";
  let analysisStatus: string;
  if (existing) {
    analysisId = existing.id;
    analysisAction = "already_registered";
    analysisStatus = existing.analysis_status;
  } else {
    const insertedId = await insertAnalysis(tx, params, newAnalysisId, record.status, input.analyzed_at);
    if (insertedId === undefined) {
      throw new Error("Analysis insert returned no row.");
    }
    analysisId = insertedId;
    analysisAction = "created";
    analysisStatus = record.status;
  }

  return {
    opportunity: { id: opportunityId, action: opportunityCreated ? "created" : "unchanged" },
    analysis: { id: analysisId, action: analysisAction, status: analysisStatus },
    review: {
      fields_without_reference: record.fieldsWithoutReference,
      fields_inferred_only: record.fieldsInferredOnly,
    },
  };
}

export function createN8nService(runInTransaction: TransactionRunner): N8nService {
  return {
    ingestOpportunityAnalysis: (input) => runInTransaction((tx) => ingest(tx, input)),
  };
}
