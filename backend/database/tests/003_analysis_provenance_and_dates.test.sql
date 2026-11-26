-- =============================================================================
-- Testes SQL da migration 003 (executar DEPOIS de aplicar 001, 002 e 003).
--
-- Tudo roda dentro de uma transação que termina em ROLLBACK: nenhum dado
-- existente é alterado e nada do que o teste cria permanece no banco.
-- Cada caso usa SAVEPOINT para que uma falha esperada não aborte os demais.
--
-- Uso: psql -v ON_ERROR_STOP=1 -f database/tests/003_analysis_provenance_and_dates.test.sql
-- Saída esperada: uma linha "ok - ..." por caso e, no fim, "003: todos os testes passaram".
-- Qualquer falha interrompe com ERROR (código de saída diferente de zero).
-- =============================================================================

\pset tuples_only on

BEGIN;

-- Auxiliar temporária (some no ROLLBACK): executa o SQL e exige que falhe com a
-- constraint indicada.
CREATE FUNCTION pg_temp.expect_violation(sql text, constraint_name text, label text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  got text;
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION
    WHEN check_violation OR foreign_key_violation OR unique_violation OR not_null_violation THEN
      GET STACKED DIAGNOSTICS got = CONSTRAINT_NAME;
      IF got IS DISTINCT FROM constraint_name THEN
        RAISE EXCEPTION 'FALHOU - %: esperava %, recebeu %', label, constraint_name, got;
      END IF;
      RAISE NOTICE 'ok - %', label;
      RETURN;
  END;
  RAISE EXCEPTION 'FALHOU - %: o comando deveria ter sido rejeitado por %', label, constraint_name;
END;
$$;

CREATE FUNCTION pg_temp.expect_ok(sql text, label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE sql;
  RAISE NOTICE 'ok - %', label;
END;
$$;

-- Dados de teste (descartados no ROLLBACK).
INSERT INTO opportunities (id, title, category, source_name, external_id)
VALUES ('00000000-0000-4000-8000-000000000001', 'Teste 003', 'unclassified', 'sqltest-003', 'T-1'),
       ('00000000-0000-4000-8000-000000000002', 'Teste 003 B', 'unclassified', 'sqltest-003', 'T-2');

-- ---- Estrutura --------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM opportunity_categories WHERE code = 'unclassified') THEN
    RAISE EXCEPTION 'FALHOU - categoria unclassified ausente';
  END IF;
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'opportunity_analyses' AND column_name = 'closing_date') <> 'date' THEN
    RAISE EXCEPTION 'FALHOU - closing_date deveria ser date';
  END IF;
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'opportunities' AND column_name = 'deadline') <> 'timestamp with time zone' THEN
    RAISE EXCEPTION 'FALHOU - opportunities.deadline deveria continuar timestamptz';
  END IF;
  RAISE NOTICE 'ok - estrutura: unclassified, closing_date date, deadline timestamptz';
END $$;

-- ---- Categoria --------------------------------------------------------------
SELECT pg_temp.expect_violation(
  $q$INSERT INTO opportunity_analyses (opportunity_id, opportunity_category, analysis_status)
     VALUES ('00000000-0000-4000-8000-000000000001', 'unclassified', 'needs_review')$q$,
  'opportunity_analyses_category_not_operational',
  'IA não pode sugerir unclassified');

SELECT pg_temp.expect_violation(
  $q$INSERT INTO opportunity_analyses (opportunity_id, opportunity_category, analysis_status)
     VALUES ('00000000-0000-4000-8000-000000000001', 'inexistente', 'needs_review')$q$,
  'opportunity_analyses_opportunity_category_fkey',
  'categoria sugerida desconhecida é rejeitada pela FK');

SELECT pg_temp.expect_ok(
  $q$INSERT INTO opportunity_analyses (opportunity_id, opportunity_category, analysis_status)
     VALUES ('00000000-0000-4000-8000-000000000001', NULL, 'needs_review')$q$,
  'categoria sugerida NULL é aceita');

SELECT pg_temp.expect_violation(
  $q$UPDATE opportunities SET category_verified_at = now()
     WHERE id = '00000000-0000-4000-8000-000000000001'$q$,
  'opportunities_unclassified_not_verified',
  'unclassified não pode ser marcada como verificada');

SELECT pg_temp.expect_violation(
  $q$UPDATE opportunities SET institution_verified_at = now()
     WHERE id = '00000000-0000-4000-8000-000000000001'$q$,
  'opportunities_institution_verified_requires_value',
  'instituição NULL não pode ser verificada');

-- ---- Datas ------------------------------------------------------------------
SELECT pg_temp.expect_violation(
  $q$INSERT INTO opportunity_analyses (opportunity_id, opening_date, closing_date, analysis_status)
     VALUES ('00000000-0000-4000-8000-000000000001', '2026-05-01', '2026-04-30', 'needs_review')$q$,
  'opportunity_analyses_dates_order',
  'closing_date anterior a opening_date é rejeitada');

SELECT pg_temp.expect_ok(
  $q$INSERT INTO opportunity_analyses (opportunity_id, opening_date, closing_date, analysis_status)
     VALUES ('00000000-0000-4000-8000-000000000001', '2026-03-01', NULL, 'needs_review')$q$,
  'datas podem ser NULL independentemente');

-- ---- Textos -----------------------------------------------------------------
SELECT pg_temp.expect_violation(
  $q$INSERT INTO opportunity_analyses (opportunity_id, title, analysis_status)
     VALUES ('00000000-0000-4000-8000-000000000001', '   ', 'needs_review')$q$,
  'opportunity_analyses_title_not_blank',
  'título em branco é rejeitado');

-- ---- completed exige referência stated própria por campo ---------------------
SELECT pg_temp.expect_ok(
  $q$INSERT INTO opportunity_analyses
       (opportunity_id, title, closing_date, requirements, source_references, analysis_status, model_name, analyzed_at)
     VALUES ('00000000-0000-4000-8000-000000000001', 'Edital', '2026-04-30', '{"business_sizes":["micro"]}',
             '[{"field":"title","excerpt":"Edital","basis":"stated"},
               {"field":"closing_date","excerpt":"até 30/04/2026","basis":"stated"},
               {"field":"requirements.business_sizes","excerpt":"microempresas","basis":"stated"}]',
             'completed', 'gemini-test', now())$q$,
  'completed com referência stated para cada campo');

SELECT pg_temp.expect_violation(
  $q$INSERT INTO opportunity_analyses
       (opportunity_id, title, closing_date, source_references, analysis_status, model_name, analyzed_at)
     VALUES ('00000000-0000-4000-8000-000000000001', 'Edital', '2026-04-30',
             '[{"field":"title","excerpt":"Edital","basis":"stated"}]',
             'completed', 'gemini-test', now())$q$,
  'opportunity_analyses_completed_requires_stated_references',
  'completed com campo (closing_date) sem referência própria');

SELECT pg_temp.expect_violation(
  $q$INSERT INTO opportunity_analyses
       (opportunity_id, title, source_references, analysis_status, model_name, analyzed_at)
     VALUES ('00000000-0000-4000-8000-000000000001', 'Edital',
             '[{"field":"title","excerpt":"Edital","basis":"inferred"}]',
             'completed', 'gemini-test', now())$q$,
  'opportunity_analyses_completed_requires_stated_references',
  'completed com referência apenas inferred');

SELECT pg_temp.expect_violation(
  $q$INSERT INTO opportunity_analyses
       (opportunity_id, requirements, source_references, analysis_status, model_name, analyzed_at)
     VALUES ('00000000-0000-4000-8000-000000000001', '{"segments":["agro"]}',
             '[{"field":"requirements.business_sizes","excerpt":"x","basis":"stated"}]',
             'completed', 'gemini-test', now())$q$,
  'opportunity_analyses_completed_requires_stated_references',
  'referência de um campo não vale para outro (requirements.*)');

SELECT pg_temp.expect_violation(
  $q$INSERT INTO opportunity_analyses (opportunity_id, title, analysis_status, model_name, analyzed_at)
     VALUES ('00000000-0000-4000-8000-000000000001', 'Edital', 'completed', 'gemini-test', now())$q$,
  'opportunity_analyses_completed_requires_stated_references',
  'completed sem nenhuma referência');

SELECT pg_temp.expect_ok(
  $q$INSERT INTO opportunity_analyses
       (opportunity_id, title, source_references, analysis_status, model_name, analyzed_at)
     VALUES ('00000000-0000-4000-8000-000000000001', 'Edital',
             '[{"field":"title","excerpt":"Edital","basis":"inferred"}]',
             'needs_review', 'gemini-test', now())$q$,
  'needs_review aceita referência inferred');

SELECT pg_temp.expect_violation(
  $q$INSERT INTO opportunity_analyses (opportunity_id, analysis_status, analyzed_at)
     VALUES ('00000000-0000-4000-8000-000000000001', 'completed', now())$q$,
  'opportunity_analyses_completed_is_traceable',
  'completed continua exigindo model_name (001 preservada)');

SELECT pg_temp.expect_violation(
  $q$INSERT INTO opportunity_analyses (opportunity_id, analysis_status) VALUES ('00000000-0000-4000-8000-000000000001', 'done')$q$,
  'opportunity_analyses_status_valid',
  'analysis_status fora do conjunto continua rejeitado');

-- ---- Procedência da identificação -------------------------------------------
-- A análise de origem precisa pertencer à mesma oportunidade (FK composta, adiada
-- até o COMMIT; SET CONSTRAINTS IMMEDIATE força a checagem aqui).
INSERT INTO opportunity_analyses (id, opportunity_id, title, analysis_status)
VALUES ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000002', 'B', 'needs_review'),
       ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'A', 'needs_review');

SAVEPOINT fk_case;
SET CONSTRAINTS opportunities_identification_analysis_fk IMMEDIATE;
SELECT pg_temp.expect_violation(
  $q$UPDATE opportunities SET identification_analysis_id = '00000000-0000-4000-8000-0000000000a2'
     WHERE id = '00000000-0000-4000-8000-000000000001'$q$,
  'opportunities_identification_analysis_fk',
  'análise de origem de outra oportunidade é rejeitada');
SELECT pg_temp.expect_ok(
  $q$UPDATE opportunities SET identification_analysis_id = '00000000-0000-4000-8000-0000000000a1'
     WHERE id = '00000000-0000-4000-8000-000000000001'$q$,
  'análise de origem da mesma oportunidade é aceita');
SELECT pg_temp.expect_violation(
  $q$DELETE FROM opportunity_analyses WHERE id = '00000000-0000-4000-8000-0000000000a1'$q$,
  'opportunities_identification_analysis_fk',
  'análise de origem não pode ser apagada isoladamente');
SELECT pg_temp.expect_ok(
  $q$DELETE FROM opportunities WHERE id = '00000000-0000-4000-8000-000000000001'$q$,
  'apagar a oportunidade continua possível (cascata nas análises)');
ROLLBACK TO SAVEPOINT fk_case;

DO $$ BEGIN RAISE NOTICE '003: todos os testes passaram'; END $$;

ROLLBACK;
