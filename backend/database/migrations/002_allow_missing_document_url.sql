-- =============================================================================
-- 002_allow_missing_document_url.sql
-- Edital Inteligente: permite referências de análise sem URL de documento.
--
-- Motivo: a IA pode analisar documentos enviados diretamente pelo usuário, que
-- não têm URL pública. Nesses casos, source_references[].document_url é null
-- ou está ausente.
--
-- Altera SOMENTE a função check_source_reference_array. Em source_references[]:
--   document_url  AGORA opcional: ausente, null ou URL http/https.
--                 Se informado e diferente de null, continua exigindo string
--                 que comece com http:// ou https://.
--   field         continua exigindo string não vazia.
--   excerpt       continua exigindo string não vazia.
--   basis         continua exigindo string JSON 'stated' ou 'inferred'.
--   array         continua não vazio, e cada item continua sendo um objeto.
--
-- Pré-requisito: 001_initial_schema.sql aplicada (na versão final, que contém a
-- função e a constraint opportunity_analyses_source_references_valid).
--
-- Segurança da alteração:
--  * A constraint existente usa a função pelo nome, então passa a usar a nova
--    definição automaticamente. Não é preciso recriar a constraint.
--  * A regra ficou mais permissiva: nenhuma linha existente se torna inválida.
--  * Reexecutar é inofensivo (CREATE OR REPLACE), mas aplique cada migration
--    uma única vez, em ordem.
-- =============================================================================

BEGIN;

-- Falha cedo se a 001 não estiver aplicada na versão esperada, para não criar a
-- função sem a constraint que a utiliza.
DO $$
BEGIN
  IF to_regprocedure('check_source_reference_array(jsonb)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'opportunity_analyses_source_references_valid'
     )
  THEN
    RAISE EXCEPTION '002 requer a 001 final aplicada (função check_source_reference_array e constraint opportunity_analyses_source_references_valid)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION check_source_reference_array(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN value IS NULL THEN false
    WHEN jsonb_typeof(value) <> 'array' THEN false
    WHEN jsonb_array_length(value) = 0 THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(value) AS item
      WHERE jsonb_typeof(item) <> 'object'
         OR jsonb_typeof(item -> 'field') IS DISTINCT FROM 'string'
         OR jsonb_typeof(item -> 'excerpt') IS DISTINCT FROM 'string'
         OR btrim(item ->> 'field') = ''
         OR btrim(item ->> 'excerpt') = ''
         -- document_url é opcional: ausente ou null são aceitos. Se informado, deve
         -- ser uma string JSON que comece com http:// ou https://.
         OR (
              (item -> 'document_url') IS NOT NULL
              AND jsonb_typeof(item -> 'document_url') <> 'null'
              AND (
                jsonb_typeof(item -> 'document_url') <> 'string'
                OR (item ->> 'document_url') !~* '^https?://'
              )
            )
         OR jsonb_typeof(item -> 'basis') IS DISTINCT FROM 'string'
         OR (item ->> 'basis') IS NULL
         OR (item ->> 'basis') NOT IN ('stated', 'inferred')
    )
  END
$$;

COMMENT ON COLUMN opportunity_analyses.source_references IS
  'Array de referências de origem dos dados extraídos. Cada item: {"field":"requirements.business_sizes","document_url":"https://...","page":4,"section":"3.2","excerpt":"trecho literal curto","basis":"stated"|"inferred"}. document_url é opcional: URL http/https, null ou ausente (documento enviado diretamente, sem URL pública). basis (string JSON) = stated quando o documento afirma expressamente; inferred quando é dedução, que não pode ser promovida nem apresentada como fato confirmado. O backend deve verificar que cada campo extraído tem sua própria referência. Documentado em database/README.md.';

COMMIT;
