BEGIN;
INSERT INTO opportunities (id, title, category, source_name)
  VALUES ('00000000-0000-0000-0000-000000000001', 'T', 'grant', 'base-002');

-- Teste da função: "esperado" é o resultado correto de check_source_reference_array.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
    ('URL https válida', true, '[{"field":"target_audience","document_url":"https://exemplo.gov.br/e.pdf","excerpt":"trecho","basis":"stated"}]'),
    ('URL http válida', true, '[{"field":"target_audience","document_url":"http://exemplo.gov.br/e.pdf","excerpt":"trecho","basis":"stated"}]'),
    ('document_url null explícito', true, '[{"field":"target_audience","document_url":null,"excerpt":"trecho","basis":"stated"}]'),
    ('document_url ausente', true, '[{"field":"target_audience","excerpt":"trecho","basis":"stated"}]'),
    ('URL sem esquema', false, '[{"field":"target_audience","document_url":"exemplo.gov.br/e.pdf","excerpt":"trecho","basis":"stated"}]'),
    ('URL com esquema ftp', false, '[{"field":"target_audience","document_url":"ftp://exemplo.gov.br/e.pdf","excerpt":"trecho","basis":"stated"}]'),
    ('URL string vazia', false, '[{"field":"target_audience","document_url":"","excerpt":"trecho","basis":"stated"}]'),
    ('URL número', false, '[{"field":"target_audience","document_url":123,"excerpt":"trecho","basis":"stated"}]'),
    ('URL booleano', false, '[{"field":"target_audience","document_url":true,"excerpt":"trecho","basis":"stated"}]'),
    ('regressão: excerpt vazio', false, '[{"field":"target_audience","document_url":null,"excerpt":"","basis":"stated"}]'),
    ('regressão: basis inválido', false, '[{"field":"target_audience","document_url":null,"excerpt":"trecho","basis":"guess"}]'),
    ('regressão: basis não string', false, '[{"field":"target_audience","document_url":null,"excerpt":"trecho","basis":1}]'),
    ('regressão: field ausente', false, '[{"document_url":null,"excerpt":"trecho","basis":"stated"}]'),
    ('regressão: array vazio', false, '[]'),
    ('regressão: item não é objeto', false, '["texto"]')
    ) AS v(label, expected, doc)
  LOOP
    IF check_source_reference_array(t.doc::jsonb) IS DISTINCT FROM t.expected THEN
      RAISE EXCEPTION 'FALHA NO TESTE: % (esperado %)', t.label, t.expected;
    END IF;
    RAISE NOTICE 'OK: %', t.label;
  END LOOP;
END $$;

-- Testes negativos pela constraint: URL com formato inválido deve ser rejeitada.
DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunity_analyses (opportunity_id, source_references)
    VALUES ('00000000-0000-0000-0000-000000000001', '[{"field":"target_audience","document_url":"exemplo.gov.br/e.pdf","excerpt":"trecho","basis":"stated"}]');
  RAISE EXCEPTION 'FALHA NO TESTE: URL sem esquema foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunity_analyses_source_references_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: URL sem esquema foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: URL sem esquema rejeitado por opportunity_analyses_source_references_valid';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunity_analyses (opportunity_id, source_references)
    VALUES ('00000000-0000-0000-0000-000000000001', '[{"field":"target_audience","document_url":"ftp://exemplo.gov.br/e.pdf","excerpt":"trecho","basis":"stated"}]');
  RAISE EXCEPTION 'FALHA NO TESTE: URL com esquema ftp foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunity_analyses_source_references_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: URL com esquema ftp foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: URL com esquema ftp rejeitado por opportunity_analyses_source_references_valid';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunity_analyses (opportunity_id, source_references)
    VALUES ('00000000-0000-0000-0000-000000000001', '[{"field":"target_audience","document_url":123,"excerpt":"trecho","basis":"stated"}]');
  RAISE EXCEPTION 'FALHA NO TESTE: URL numérica foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunity_analyses_source_references_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: URL numérica foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: URL numérica rejeitado por opportunity_analyses_source_references_valid';
END $$;

-- Testes positivos pela constraint: devem funcionar sem erro (URL válida, null e ausente).
INSERT INTO opportunity_analyses (opportunity_id, source_references)
  VALUES ('00000000-0000-0000-0000-000000000001', '[{"field":"target_audience","document_url":"https://exemplo.gov.br/e.pdf","excerpt":"trecho","basis":"stated"}]');
INSERT INTO opportunity_analyses (opportunity_id, source_references)
  VALUES ('00000000-0000-0000-0000-000000000001', '[{"field":"target_audience","document_url":null,"excerpt":"trecho","basis":"stated"}]');
INSERT INTO opportunity_analyses (opportunity_id, source_references)
  VALUES ('00000000-0000-0000-0000-000000000001', '[{"field":"target_audience","excerpt":"trecho","basis":"stated"}]');
ROLLBACK;