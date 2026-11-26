-- =============================================================================
-- 003_analysis_provenance_and_dates.sql
-- Edital Inteligente: histórico completo da análise de IA, procedência dos campos
-- de identificação e categoria operacional "unclassified".
--
-- Pré-requisito: 001_initial_schema.sql e 002_allow_missing_document_url.sql
-- aplicadas (ambas congeladas; esta migration não as altera).
--
-- O que muda:
--  1. opportunity_categories: nova categoria operacional 'unclassified'
--     ("ainda sem classificação confirmada"). Não é uma classificação.
--  2. opportunity_analyses: novas colunas com o que a IA extraiu e antes não era
--     preservado: title, institution, opportunity_category, objective,
--     observations, opening_date e closing_date (date, sem horário inventado).
--  3. opportunities: procedência e validação por campo de identificação
--     (title_verified_at, institution_verified_at, category_verified_at) e
--     identification_analysis_id (análise que originou título/instituição
--     provisórios na criação).
--  4. Regra de análise concluída no banco: 'completed' exige, para CADA campo
--     extraído e não nulo, uma referência própria com basis = 'stated'.
--
-- Dados existentes: nenhuma linha é alterada. As novas colunas entram NULL.
-- Oportunidades criadas antes desta migration ficam com *_verified_at NULL
-- (não verificadas), que é exatamente o seu estado real.
--
-- Execução: tudo em uma única transação. Se algo falhar, nada é aplicado.
-- Aplicar uma única vez, em ordem. Uma segunda execução falha (colunas e
-- constraints já existem) e é desfeita por inteiro.
-- Compatível com PostgreSQL 14+ e Supabase (sem recursos exclusivos do 15+).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Pré-condições
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.opportunity_categories') IS NOT NULL
     AND EXISTS (SELECT 1 FROM opportunity_categories WHERE code = 'unclassified') THEN
    RAISE EXCEPTION '003 já aplicada (categoria unclassified já existe)';
  END IF;

  IF to_regclass('public.opportunity_analyses') IS NULL
     OR to_regclass('public.opportunities') IS NULL
     OR to_regclass('public.opportunity_categories') IS NULL
     OR to_regprocedure('check_source_reference_array(jsonb)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'opportunity_analyses_completed_requires_references'
         AND conrelid = 'public.opportunity_analyses'::regclass
     )
  THEN
    RAISE EXCEPTION '003 requer a 001 aplicada (tabelas e constraint opportunity_analyses_completed_requires_references)';
  END IF;

  -- A 002 torna document_url opcional. Sem ela, esta referência seria rejeitada.
  IF NOT check_source_reference_array('[{"field":"title","excerpt":"x","basis":"stated"}]'::jsonb) THEN
    RAISE EXCEPTION '003 requer a 002 aplicada (document_url opcional em source_references)';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Categoria operacional
-- sort_order alto: fica no fim de listagens. O backend nunca aceita
-- 'unclassified' como sugestão da IA (constraint em opportunity_analyses abaixo).
-- -----------------------------------------------------------------------------
INSERT INTO opportunity_categories (code, name, description, sort_order) VALUES
  ('unclassified', 'Não classificada',
   'Marcador operacional: a oportunidade ainda não tem categoria confirmada. Não é uma classificação e não deve ser apresentada como tal.', 1000);

COMMENT ON TABLE opportunity_categories IS
  'Categorias de oportunidade. Licitações e contratações públicas NÃO fazem parte das categorias iniciais; se forem incorporadas, entram como categoria própria em uma migration futura. ''unclassified'' (migration 003) é um marcador operacional de "sem categoria confirmada", não uma classificação.';

-- -----------------------------------------------------------------------------
-- 2. opportunity_analyses: dados extraídos que passam a ser preservados
-- -----------------------------------------------------------------------------
ALTER TABLE opportunity_analyses
  ADD COLUMN title                text,
  ADD COLUMN institution          text,
  ADD COLUMN opportunity_category text REFERENCES opportunity_categories (code) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN objective            text,
  ADD COLUMN observations         text,
  ADD COLUMN opening_date         date,
  ADD COLUMN closing_date         date;

ALTER TABLE opportunity_analyses
  ADD CONSTRAINT opportunity_analyses_title_not_blank CHECK (title IS NULL OR btrim(title) <> ''),
  ADD CONSTRAINT opportunity_analyses_institution_not_blank CHECK (institution IS NULL OR btrim(institution) <> ''),
  ADD CONSTRAINT opportunity_analyses_objective_not_blank CHECK (objective IS NULL OR btrim(objective) <> ''),
  ADD CONSTRAINT opportunity_analyses_observations_not_blank CHECK (observations IS NULL OR btrim(observations) <> ''),
  -- 'unclassified' é marcador do banco, nunca sugestão da IA. Sem classificação segura: NULL.
  ADD CONSTRAINT opportunity_analyses_category_not_operational CHECK (
    opportunity_category IS NULL OR opportunity_category <> 'unclassified'
  ),
  ADD CONSTRAINT opportunity_analyses_dates_order CHECK (
    opening_date IS NULL OR closing_date IS NULL OR closing_date >= opening_date
  );

CREATE INDEX opportunity_analyses_opportunity_category_idx ON opportunity_analyses (opportunity_category);

-- Necessário para a FK composta de opportunities.identification_analysis_id, que
-- garante que a análise de origem pertence à mesma oportunidade.
ALTER TABLE opportunity_analyses
  ADD CONSTRAINT opportunity_analyses_id_opportunity_unique UNIQUE (id, opportunity_id);

-- -----------------------------------------------------------------------------
-- 3. Regra de análise concluída
-- Substitui opportunity_analyses_completed_requires_references (001), que só
-- exigia "alguma" referência e não cobria os novos campos.
-- -----------------------------------------------------------------------------

-- true quando cada campo informado tem ao menos uma referência própria com
-- basis = 'stated'. fields: nomes de campos extraídos (NULLs são ignorados).
-- requirements: cada chave com valor não nulo vira o campo 'requirements.<chave>'.
-- A referência de um campo nunca vale para outro (comparação exata de field).
CREATE FUNCTION check_analysis_stated_references(fields text[], requirements jsonb, refs jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM (
      SELECT field FROM unnest(fields) AS field
      UNION ALL
      SELECT 'requirements.' || entry.key
      FROM jsonb_each(
        CASE WHEN jsonb_typeof(requirements) = 'object' THEN requirements ELSE '{}'::jsonb END
      ) AS entry
      WHERE jsonb_typeof(entry.value) <> 'null'
    ) AS extracted
    WHERE extracted.field IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(refs) = 'array' THEN refs ELSE '[]'::jsonb END
        ) AS ref
        WHERE jsonb_typeof(ref) = 'object'
          AND ref ->> 'field' = extracted.field
          AND ref ->> 'basis' = 'stated'
      )
  )
$$;

-- Falha com mensagem clara se alguma análise existente já viola a nova regra
-- (só seria possível com dados gravados fora do backend).
DO $$
DECLARE
  violating integer;
BEGIN
  SELECT count(*) INTO violating
  FROM opportunity_analyses
  WHERE analysis_status = 'completed'
    AND NOT check_analysis_stated_references(
      ARRAY[
        CASE WHEN target_audience IS NOT NULL THEN 'target_audience' END,
        CASE WHEN eligible_locations IS NOT NULL THEN 'eligible_locations' END,
        CASE WHEN required_documents IS NOT NULL THEN 'required_documents' END,
        CASE WHEN funding_amount IS NOT NULL THEN 'funding_amount' END,
        CASE WHEN funding_currency IS NOT NULL THEN 'funding_currency' END,
        CASE WHEN counterpart_required IS NOT NULL THEN 'counterpart_required' END
      ],
      requirements,
      source_references
    );
  IF violating > 0 THEN
    RAISE EXCEPTION '003: % análise(s) completed sem referência stated própria para cada campo extraído. Revise-as (ex.: marque needs_review) antes de aplicar.', violating;
  END IF;
END $$;

ALTER TABLE opportunity_analyses
  DROP CONSTRAINT opportunity_analyses_completed_requires_references;

ALTER TABLE opportunity_analyses
  ADD CONSTRAINT opportunity_analyses_completed_requires_stated_references CHECK (
    analysis_status <> 'completed'
    OR check_analysis_stated_references(
      ARRAY[
        CASE WHEN title IS NOT NULL THEN 'title' END,
        CASE WHEN institution IS NOT NULL THEN 'institution' END,
        CASE WHEN opportunity_category IS NOT NULL THEN 'opportunity_category' END,
        CASE WHEN objective IS NOT NULL THEN 'objective' END,
        CASE WHEN observations IS NOT NULL THEN 'observations' END,
        CASE WHEN opening_date IS NOT NULL THEN 'opening_date' END,
        CASE WHEN closing_date IS NOT NULL THEN 'closing_date' END,
        CASE WHEN target_audience IS NOT NULL THEN 'target_audience' END,
        CASE WHEN eligible_locations IS NOT NULL THEN 'eligible_locations' END,
        CASE WHEN required_documents IS NOT NULL THEN 'required_documents' END,
        CASE WHEN funding_amount IS NOT NULL THEN 'funding_amount' END,
        CASE WHEN funding_currency IS NOT NULL THEN 'funding_currency' END,
        CASE WHEN counterpart_required IS NOT NULL THEN 'counterpart_required' END
      ],
      requirements,
      source_references
    )
  );

COMMENT ON TABLE opportunity_analyses IS
  'Histórico de análises de IA por oportunidade. Conteúdo extraído automaticamente, não confirmado. Desde a 003 preserva também título, instituição, categoria sugerida, objetivo, observações e datas extraídas.';
COMMENT ON COLUMN opportunity_analyses.title IS
  'Título extraído pela IA. Não confirmado.';
COMMENT ON COLUMN opportunity_analyses.institution IS
  'Instituição responsável extraída pela IA. NULL quando a fonte não informa. Não confirmada.';
COMMENT ON COLUMN opportunity_analyses.opportunity_category IS
  'Categoria SUGERIDA pela IA (código de opportunity_categories). NULL quando não há classificação segura. Nunca ''unclassified''. Não é promovida para opportunities.category.';
COMMENT ON COLUMN opportunity_analyses.objective IS
  'Objetivo extraído pela IA. Não confirmado.';
COMMENT ON COLUMN opportunity_analyses.observations IS
  'Observações extraídas pela IA (ex.: horário-limite, prorrogação). Não confirmadas.';
COMMENT ON COLUMN opportunity_analyses.opening_date IS
  'Data de abertura extraída (date, sem horário). NÃO é promovida para opportunities.opening_date. Uma futura validação humana define a conversão para timestamptz (America/Sao_Paulo).';
COMMENT ON COLUMN opportunity_analyses.closing_date IS
  'Data de encerramento extraída (date, sem horário). NÃO é promovida para opportunities.deadline. Uma futura validação humana define a conversão para timestamptz (America/Sao_Paulo).';
COMMENT ON COLUMN opportunity_analyses.analysis_summary IS
  'Legado (Etapa 3.1): objetivo e observações concatenados. Desde a 003 o backend grava objective e observations em colunas próprias e deixa este campo NULL.';
COMMENT ON COLUMN opportunity_analyses.source_references IS
  'Array de referências de origem dos dados extraídos. Cada item: {"field":"requirements.business_sizes","document_url":"https://...","page":4,"section":"3.2","excerpt":"trecho literal curto","basis":"stated"|"inferred"}. document_url é opcional: URL http/https, null ou ausente. field aceito (validado pelo backend): title, institution, opportunity_category, objective, observations, opening_date, closing_date, target_audience, eligible_locations, required_documents, funding_amount, funding_currency, counterpart_required e requirements.<chave>. basis = stated quando o documento afirma expressamente; inferred quando é dedução, que nunca é confirmada. Cada campo extraído precisa de referência própria. Documentado em database/README.md.';
COMMENT ON COLUMN opportunity_analyses.analysis_status IS
  'pending, completed, failed ou needs_review. completed exige, para cada campo extraído e não nulo, uma referência própria com basis = stated (constraint opportunity_analyses_completed_requires_stated_references). Campo sem referência ou só com inferred: needs_review (revisão humana antes de qualquer promoção).';

-- -----------------------------------------------------------------------------
-- 4. opportunities: procedência e validação dos campos de identificação
-- -----------------------------------------------------------------------------
ALTER TABLE opportunities
  ADD COLUMN title_verified_at          timestamptz,
  ADD COLUMN institution_verified_at    timestamptz,
  ADD COLUMN category_verified_at       timestamptz,
  ADD COLUMN identification_analysis_id uuid;

ALTER TABLE opportunities
  -- 'unclassified' significa "sem categoria confirmada": não pode estar verificada.
  ADD CONSTRAINT opportunities_unclassified_not_verified CHECK (
    category <> 'unclassified' OR category_verified_at IS NULL
  ),
  -- Só se confirma uma instituição que existe.
  ADD CONSTRAINT opportunities_institution_verified_requires_value CHECK (
    institution_verified_at IS NULL OR institution IS NOT NULL
  ),
  -- A análise de origem precisa ser desta mesma oportunidade. DEFERRABLE: o backend
  -- cria a oportunidade e a análise na mesma transação, nessa ordem.
  -- NO ACTION: a análise que originou a identificação não pode ser apagada isoladamente;
  -- apagar a oportunidade (cascata para as análises) continua possível.
  ADD CONSTRAINT opportunities_identification_analysis_fk
    FOREIGN KEY (identification_analysis_id, id)
    REFERENCES opportunity_analyses (id, opportunity_id)
    ON UPDATE NO ACTION ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX opportunities_identification_analysis_idx ON opportunities (identification_analysis_id);

COMMENT ON COLUMN opportunities.title IS
  'Título de identificação. Provisório (extraído pela IA) enquanto title_verified_at for NULL: pode ser exibido para identificar, nunca como dado validado.';
COMMENT ON COLUMN opportunities.institution IS
  'Instituição responsável. Provisória enquanto institution_verified_at for NULL. NULL quando não informada.';
COMMENT ON COLUMN opportunities.category IS
  'Categoria (opportunity_categories.code). ''unclassified'' = sem categoria confirmada (marcador operacional). Confirmada somente quando category_verified_at não é NULL.';
COMMENT ON COLUMN opportunities.title_verified_at IS
  'Quando o título foi confirmado (fonte oficial ou revisão humana). NULL = título provisório.';
COMMENT ON COLUMN opportunities.institution_verified_at IS
  'Quando a instituição foi confirmada. NULL = provisória ou ausente.';
COMMENT ON COLUMN opportunities.category_verified_at IS
  'Quando a categoria foi confirmada. NULL = não confirmada (sempre NULL para ''unclassified'').';
COMMENT ON COLUMN opportunities.identification_analysis_id IS
  'Análise (opportunity_analyses) da qual vieram o título e a instituição provisórios na criação. NULL em oportunidades criadas antes da 003 ou cadastradas manualmente.';
COMMENT ON COLUMN opportunities.opening_date IS
  'Abertura das inscrições CONFIRMADA (timestamptz). Nunca preenchida automaticamente a partir da IA (ver opportunity_analyses.opening_date). Na validação, uma data sem horário é convertida pelo backend com a convenção America/Sao_Paulo.';
COMMENT ON COLUMN opportunities.deadline IS
  'Prazo final CONFIRMADO (timestamptz). NULL para fluxo contínuo ou prazo não confirmado. Nunca preenchido automaticamente a partir da IA (ver opportunity_analyses.closing_date).';

COMMIT;
