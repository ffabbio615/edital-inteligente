BEGIN;
INSERT INTO opportunities (id, title, category, source_name)
  VALUES ('00000000-0000-0000-0000-000000000001', 'T', 'grant', 'base');

-- Testes negativos: cada bloco DO tenta inserir um dado inválido.
--  * Se o dado for aceito, o bloco gera "FALHA NO TESTE" e a transação é abortada.
--  * Se for rejeitado pela constraint esperada, mostra "OK" (NOTICE).
--  * Se for rejeitado por outra constraint, gera "FALHA NO TESTE".
--  * Qualquer outro tipo de erro também interrompe o teste.
DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunities (title, category, source_name, eligible_locations)
    VALUES ('T','grant','a','[{"scope":"national","state":"SP"}]');
  RAISE EXCEPTION 'FALHA NO TESTE: national com state foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunities_eligible_locations_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: national com state foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: national com state rejeitado por opportunities_eligible_locations_valid';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunities (title, category, source_name, eligible_locations)
    VALUES ('T','grant','b','[{"scope":"state","state":"SP","city":"Campinas"}]');
  RAISE EXCEPTION 'FALHA NO TESTE: state com city foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunities_eligible_locations_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: state com city foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: state com city rejeitado por opportunities_eligible_locations_valid';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunities (title, category, source_name, eligible_locations)
    VALUES ('T','grant','c','[{"scope":"state"}]');
  RAISE EXCEPTION 'FALHA NO TESTE: state sem state foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunities_eligible_locations_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: state sem state foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: state sem state rejeitado por opportunities_eligible_locations_valid';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunities (title, category, source_name, eligible_locations)
    VALUES ('T','grant','d','[{"scope":"city","state":"SP"}]');
  RAISE EXCEPTION 'FALHA NO TESTE: city sem city foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunities_eligible_locations_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: city sem city foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: city sem city rejeitado por opportunities_eligible_locations_valid';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunities (title, category, source_name, eligible_locations)
    VALUES ('T','grant','e','[{"scope":"state","state":"XX"}]');
  RAISE EXCEPTION 'FALHA NO TESTE: UF inválida foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunities_eligible_locations_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: UF inválida foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: UF inválida rejeitado por opportunities_eligible_locations_valid';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunities (title, category, source_name, eligible_business_sizes)
    VALUES ('T','grant','f','["xl"]');
  RAISE EXCEPTION 'FALHA NO TESTE: porte inválido foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunities_eligible_business_sizes_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: porte inválido foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: porte inválido rejeitado por opportunities_eligible_business_sizes_valid';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunities (title, category, source_name, target_audience)
    VALUES ('T','grant','g','[]');
  RAISE EXCEPTION 'FALHA NO TESTE: array vazio em target_audience foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunities_target_audience_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: array vazio em target_audience foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: array vazio em target_audience rejeitado por opportunities_target_audience_valid';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunity_analyses (opportunity_id, source_references)
    VALUES ('00000000-0000-0000-0000-000000000001', '[{"field":"target_audience","document_url":"https://exemplo.gov.br/e.pdf","excerpt":"trecho","basis":1}]');
  RAISE EXCEPTION 'FALHA NO TESTE: basis que não é string foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunity_analyses_source_references_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: basis que não é string foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: basis que não é string rejeitado por opportunity_analyses_source_references_valid';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunity_analyses (opportunity_id, source_references)
    VALUES ('00000000-0000-0000-0000-000000000001', '[{"field":"target_audience","document_url":"https://exemplo.gov.br/e.pdf","excerpt":"trecho","basis":"guess"}]');
  RAISE EXCEPTION 'FALHA NO TESTE: basis com valor inválido foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunity_analyses_source_references_valid' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: basis com valor inválido foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: basis com valor inválido rejeitado por opportunity_analyses_source_references_valid';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunity_analyses (opportunity_id, analysis_status, analyzed_at, model_name, funding_currency)
    VALUES ('00000000-0000-0000-0000-000000000001', 'completed', now(), 'modelo-teste', 'BRL');
  RAISE EXCEPTION 'FALHA NO TESTE: análise concluída só com funding_currency e sem referências foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunity_analyses_completed_requires_references' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: análise concluída só com funding_currency e sem referências foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: análise concluída só com funding_currency e sem referências rejeitado por opportunity_analyses_completed_requires_references';
END $$;

DO $$
DECLARE violated text;
BEGIN
  INSERT INTO opportunity_analyses (opportunity_id, analysis_status, analyzed_at, model_name)
    VALUES ('00000000-0000-0000-0000-000000000001', 'completed', now(), '   ');
  RAISE EXCEPTION 'FALHA NO TESTE: análise concluída com model_name em branco foi aceito';
EXCEPTION
  WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated IS DISTINCT FROM 'opportunity_analyses_completed_is_traceable' THEN
      RAISE EXCEPTION 'FALHA NO TESTE: análise concluída com model_name em branco foi rejeitado pela constraint inesperada %', violated;
    END IF;
    RAISE NOTICE 'OK: análise concluída com model_name em branco rejeitado por opportunity_analyses_completed_is_traceable';
END $$;

-- Testes positivos: devem funcionar sem erro.
INSERT INTO opportunities (title, category, source_name, eligible_locations)
  VALUES ('T','grant','h','[{"scope":"national"},{"scope":"state","state":"RJ"},{"scope":"city","state":"SP","city":"Campinas"}]');
INSERT INTO opportunities (title, category, source_name, eligible_business_sizes)
  VALUES ('T','grant','i','["mei","micro"]');
INSERT INTO opportunity_analyses (opportunity_id, source_references)
  VALUES ('00000000-0000-0000-0000-000000000001', '[{"field":"target_audience","document_url":"https://exemplo.gov.br/e.pdf","excerpt":"trecho","basis":"stated"}]');
INSERT INTO opportunity_analyses (opportunity_id, analysis_status, analyzed_at, model_name, funding_amount, funding_currency, source_references)
  VALUES ('00000000-0000-0000-0000-000000000001', 'completed', now(), 'modelo-teste', 1000, 'BRL',
          '[{"field":"funding_amount","document_url":"https://exemplo.gov.br/e.pdf","excerpt":"trecho","basis":"stated"},{"field":"funding_currency","document_url":"https://exemplo.gov.br/e.pdf","excerpt":"trecho","basis":"stated"}]');
ROLLBACK;