-- =============================================================================
-- 001_initial_schema.sql
-- Edital Inteligente: esquema inicial (PostgreSQL 14+, compatível com Supabase)
--
-- Conteúdo: users, user_profiles, opportunities, opportunity_analyses e duas
-- tabelas de referência (profile_types, opportunity_categories).
--
-- Decisões gerais:
--  * Sem tipos ENUM: valores que evoluem ficam em tabelas de referência (FK) e
--    estados de ciclo de vida curtos ficam em CHECK. Ambos mudam com uma migration
--    simples, enquanto ALTER TYPE ... ADD VALUE é mais restritivo.
--  * Tipo de participante (profile_types) e porte (business_size) são
--    independentes: uma startup pode ser micro ou pequena; MEI é um porte.
--  * Em colunas JSONB de critérios, NULL significa "não informado". Arrays vazios
--    não são aceitos nesses critérios. Isso sustenta a situação "elegibilidade
--    não confirmada".
--  * O banco valida a FORMA dos arrays JSONB (tipos, valores fixos como UF e
--    portes). O CONTEÚDO que depende de dados de referência (códigos de
--    profile_types, cidades, segmentos) é validado pelo backend.
--  * Nenhuma política RLS é habilitada aqui. ATENÇÃO: antes de inserir dados
--    reais no Supabase, configurar RLS e revisar privilégios é OBRIGATÓRIO
--    (ver database/README.md, seção "Segurança").
--
-- Execução: tudo em uma única transação. Se algo falhar, nada é aplicado.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Função reutilizável para manter updated_at atualizado
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Funções de validação de forma para colunas JSONB (usadas em CHECK)
-- Retornam false para NULL: as restrições tratam NULL à parte ("col IS NULL OR ...").
-- -----------------------------------------------------------------------------

-- Array de strings não vazias. Arrays vazios só são aceitos com allow_empty = true.
CREATE FUNCTION check_string_array(value jsonb, allow_empty boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN value IS NULL THEN false
    WHEN jsonb_typeof(value) <> 'array' THEN false
    WHEN jsonb_array_length(value) = 0 THEN allow_empty
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(value) AS item
      WHERE jsonb_typeof(item) <> 'string' OR btrim(item #>> '{}') = ''
    )
  END
$$;

-- Array não vazio de localizações. Propriedades compatíveis com cada escopo:
--   {"scope":"national"}                                  não aceita state nem city
--   {"scope":"state","state":"SP"}                        exige state (UF válida); não aceita city
--   {"scope":"city","state":"SP","city":"Campinas"}       exige state (UF válida) e city (não vazia)
-- state e city devem ser strings JSON. Uma chave presente com valor null conta como presente.
-- Novos escopos (ex.: região) exigem uma migration que atualize esta função.
CREATE FUNCTION check_location_array(value jsonb)
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
         OR (item ->> 'scope') IS NULL
         OR (item ->> 'scope') NOT IN ('national', 'state', 'city')
         -- national: sem state e sem city
         OR (
              (item ->> 'scope') = 'national'
              AND ((item -> 'state') IS NOT NULL OR (item -> 'city') IS NOT NULL)
            )
         -- state: exige state; sem city
         OR (
              (item ->> 'scope') = 'state'
              AND (
                jsonb_typeof(item -> 'state') IS DISTINCT FROM 'string'
                OR (item ->> 'state') NOT IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
                OR (item -> 'city') IS NOT NULL
              )
            )
         -- city: exige state e city
         OR (
              (item ->> 'scope') = 'city'
              AND (
                jsonb_typeof(item -> 'state') IS DISTINCT FROM 'string'
                OR (item ->> 'state') NOT IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
                OR jsonb_typeof(item -> 'city') IS DISTINCT FROM 'string'
                OR btrim(item ->> 'city') = ''
              )
            )
    )
  END
$$;

-- Array não vazio de referências de origem (rastreabilidade das análises de IA).
-- Cada item exige: field, document_url (http/https), excerpt e basis (string JSON
-- com exatamente 'stated' ou 'inferred').
-- field: string não vazia. Os valores aceitos (target_audience, eligible_locations,
-- required_documents, funding_amount, funding_currency, counterpart_required e
-- requirements.<chave>) são validados pelo backend.
-- Campos opcionais (page, section) são validados pelo backend.
CREATE FUNCTION check_source_reference_array(value jsonb)
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
         OR jsonb_typeof(item -> 'document_url') IS DISTINCT FROM 'string'
         OR jsonb_typeof(item -> 'excerpt') IS DISTINCT FROM 'string'
         OR btrim(item ->> 'field') = ''
         OR btrim(item ->> 'excerpt') = ''
         OR (item ->> 'document_url') !~* '^https?://'
         OR jsonb_typeof(item -> 'basis') IS DISTINCT FROM 'string'
         OR (item ->> 'basis') IS NULL
         OR (item ->> 'basis') NOT IN ('stated', 'inferred')
    )
  END
$$;

-- -----------------------------------------------------------------------------
-- Tabelas de referência
-- Novos tipos de perfil ou categorias entram com um INSERT em migration futura,
-- sem alterar a estrutura das demais tabelas.
-- -----------------------------------------------------------------------------
CREATE TABLE profile_types (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_types_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT profile_types_name_not_blank CHECK (btrim(name) <> '')
);

COMMENT ON TABLE profile_types IS
  'Natureza ou atuação do perfil (startup, empresa, pesquisador, universidade etc.). NÃO representa porte: o porte fica em user_profiles.business_size. Dados de referência, estendidos por INSERT.';

CREATE TABLE opportunity_categories (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_categories_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT opportunity_categories_name_not_blank CHECK (btrim(name) <> '')
);

COMMENT ON TABLE opportunity_categories IS
  'Categorias de oportunidade. Licitações e contratações públicas NÃO fazem parte das categorias iniciais; se forem incorporadas, entram como categoria própria em uma migration futura.';

INSERT INTO profile_types (code, name, description, sort_order) VALUES
  ('startup',                'Startup',
   'Empresa de base inovadora. O porte é informado separadamente em user_profiles.business_size.', 10),
  ('company',                'Empresa',
   'Empresa que não se enquadra como startup. O porte é informado separadamente em user_profiles.business_size.', 20),
  ('individual_entrepreneur','Empreendedor individual',
   'Pessoa que empreende em nome próprio. O MEI é registrado com business_size = ''mei'' e não tem tipo próprio.', 30),
  ('researcher',             'Pesquisador',                       NULL, 40),
  ('student',                'Estudante',                         NULL, 50),
  ('individual',             'Pessoa física',                     NULL, 60),
  ('university',             'Universidade',                      NULL, 70),
  ('research_institution',   'Instituição de pesquisa',           NULL, 80),
  ('nonprofit',              'Organização sem fins lucrativos',   NULL, 90),
  ('other_institution',      'Outra instituição',                 NULL, 100);

INSERT INTO opportunity_categories (code, name, description, sort_order) VALUES
  ('grant',        'Fomento',                      'Editais de fomento e subvenção.', 10),
  ('financing',    'Financiamento',                'Linhas de crédito e financiamento.', 20),
  ('scholarship',  'Bolsas',                       'Bolsas de pesquisa e estudos.', 30),
  ('acceleration', 'Aceleração',                   'Programas de aceleração e incubação.', 40),
  ('award',        'Premiações',                   'Prêmios e concursos.', 50),
  ('public_call',  'Chamadas públicas',            'Chamadas públicas de seleção de projetos ou participantes. Não inclui licitações ou contratações.', 60),
  ('institutional','Oportunidades institucionais', 'Demais oportunidades divulgadas por instituições.', 70);

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'user',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT users_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+$'),
  CONSTRAINT users_role_valid CHECK (role IN ('user', 'admin'))
);

-- E-mail único sem diferenciar maiúsculas de minúsculas, sem exigir a extensão citext.
CREATE UNIQUE INDEX users_email_unique_idx ON users (lower(email));

COMMENT ON COLUMN users.password_hash IS
  'Somente hash de senha. Nunca armazenar senha em texto puro. O algoritmo e o formato do hash são validados exclusivamente pelo backend; o banco não os verifica.';

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- user_profiles
-- Um usuário pode ter vários perfis (ex.: pesquisador e sócio de uma startup).
-- Só profile_type é obrigatório: pesquisadores, estudantes e pessoas físicas não
-- têm porte, segmento ou data de fundação.
-- -----------------------------------------------------------------------------
CREATE TABLE user_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  profile_type            text NOT NULL REFERENCES profile_types (code) ON UPDATE CASCADE ON DELETE RESTRICT,
  state                   text,
  city                    text,
  organization_name       text,
  business_size           text,
  segment                 text,
  areas_of_interest       jsonb NOT NULL DEFAULT '[]'::jsonb,
  organization_founded_on date,
  organization_stage      text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_state_valid CHECK (
    state IS NULL OR state IN (
      'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
      'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
    )
  ),
  CONSTRAINT user_profiles_city_requires_state CHECK (city IS NULL OR state IS NOT NULL),
  CONSTRAINT user_profiles_city_not_blank CHECK (city IS NULL OR btrim(city) <> ''),
  CONSTRAINT user_profiles_organization_name_not_blank CHECK (organization_name IS NULL OR btrim(organization_name) <> ''),
  CONSTRAINT user_profiles_segment_not_blank CHECK (segment IS NULL OR btrim(segment) <> ''),
  CONSTRAINT user_profiles_business_size_valid CHECK (
    business_size IS NULL OR business_size IN ('mei', 'micro', 'small', 'medium', 'large')
  ),
  CONSTRAINT user_profiles_organization_stage_format CHECK (
    organization_stage IS NULL OR organization_stage ~ '^[a-z0-9_]+$'
  ),
  CONSTRAINT user_profiles_areas_of_interest_valid CHECK (check_string_array(areas_of_interest, true))
);

COMMENT ON COLUMN user_profiles.profile_type IS
  'Natureza do perfil (profile_types.code). Independente do porte. Usado para comparar com opportunities.target_audience.';
COMMENT ON COLUMN user_profiles.business_size IS
  'Porte formal (mei, micro, small, medium, large), independente de profile_type: uma startup pode ser micro ou pequena. MEI é registrado aqui (normalmente com profile_type individual_entrepreneur). NULL quando não se aplica (pessoa física, pesquisador, estudante). O backend rejeita porte em perfis em que não se aplica.';
COMMENT ON COLUMN user_profiles.organization_founded_on IS
  'Data de fundação. Armazenada no lugar da idade, que ficaria desatualizada; o tempo de existência é calculado a partir dela.';
COMMENT ON COLUMN user_profiles.organization_stage IS
  'Estágio da organização em snake_case. O vocabulário controlado será definido junto com a regra de compatibilidade.';
COMMENT ON COLUMN user_profiles.segment IS
  'Segmento de atuação. Texto livre por enquanto; um vocabulário controlado (ex.: CNAE) será avaliado junto com a regra de compatibilidade.';
COMMENT ON COLUMN user_profiles.areas_of_interest IS
  'Array de strings não vazias (pode ser vazio). Validação de conteúdo no backend.';

CREATE INDEX user_profiles_user_id_idx ON user_profiles (user_id);
CREATE INDEX user_profiles_profile_type_idx ON user_profiles (profile_type);
CREATE INDEX user_profiles_state_idx ON user_profiles (state);
CREATE INDEX user_profiles_areas_of_interest_idx ON user_profiles USING gin (areas_of_interest);

CREATE TRIGGER user_profiles_set_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- opportunities
-- Campos de critério (target_audience, eligible_*, idade mínima/máxima) são os
-- dados CONFIRMADOS usados na compatibilidade. NULL = não informado. Resultados
-- de IA ficam em opportunity_analyses até serem validados e promovidos.
-- -----------------------------------------------------------------------------
CREATE TABLE opportunities (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                        text NOT NULL,
  institution                  text,
  category                     text NOT NULL REFERENCES opportunity_categories (code) ON UPDATE CASCADE ON DELETE RESTRICT,
  description                  text,
  source_url                   text,
  document_url                 text,
  publication_date             date,
  opening_date                 timestamptz,
  deadline                     timestamptz,
  status                       text NOT NULL DEFAULT 'unknown',
  target_audience              jsonb,
  eligible_locations           jsonb,
  eligible_segments            jsonb,
  eligible_business_sizes      jsonb,
  eligible_organization_stages jsonb,
  min_organization_age_months  integer,
  max_organization_age_months  integer,
  eligibility_verified_at      timestamptz,
  funding_amount               numeric(18, 2),
  funding_currency             text,
  counterpart_required         boolean,
  source_name                  text NOT NULL,
  external_id                  text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunities_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT opportunities_source_name_not_blank CHECK (btrim(source_name) <> ''),
  CONSTRAINT opportunities_external_id_not_blank CHECK (external_id IS NULL OR btrim(external_id) <> ''),
  CONSTRAINT opportunities_source_url_format CHECK (source_url IS NULL OR source_url ~* '^https?://'),
  CONSTRAINT opportunities_document_url_format CHECK (document_url IS NULL OR document_url ~* '^https?://'),
  CONSTRAINT opportunities_status_valid CHECK (
    status IN ('unknown', 'upcoming', 'open', 'closed', 'suspended', 'cancelled')
  ),
  CONSTRAINT opportunities_dates_order CHECK (opening_date IS NULL OR deadline IS NULL OR deadline >= opening_date),
  CONSTRAINT opportunities_target_audience_valid CHECK (target_audience IS NULL OR check_string_array(target_audience)),
  CONSTRAINT opportunities_eligible_locations_valid CHECK (eligible_locations IS NULL OR check_location_array(eligible_locations)),
  CONSTRAINT opportunities_eligible_segments_valid CHECK (eligible_segments IS NULL OR check_string_array(eligible_segments)),
  -- Mesmo conjunto fechado de user_profiles.business_size.
  CONSTRAINT opportunities_eligible_business_sizes_valid CHECK (
    eligible_business_sizes IS NULL
    OR (
      check_string_array(eligible_business_sizes)
      AND eligible_business_sizes <@ '["mei","micro","small","medium","large"]'::jsonb
    )
  ),
  CONSTRAINT opportunities_eligible_organization_stages_valid CHECK (eligible_organization_stages IS NULL OR check_string_array(eligible_organization_stages)),
  CONSTRAINT opportunities_min_age_valid CHECK (min_organization_age_months IS NULL OR min_organization_age_months >= 0),
  CONSTRAINT opportunities_max_age_valid CHECK (max_organization_age_months IS NULL OR max_organization_age_months >= 0),
  CONSTRAINT opportunities_age_range_order CHECK (
    min_organization_age_months IS NULL
    OR max_organization_age_months IS NULL
    OR max_organization_age_months >= min_organization_age_months
  ),
  CONSTRAINT opportunities_funding_amount_valid CHECK (funding_amount IS NULL OR funding_amount >= 0),
  CONSTRAINT opportunities_funding_currency_format CHECK (funding_currency IS NULL OR funding_currency ~ '^[A-Z]{3}$'),
  -- Um valor sem moeda é ambíguo; a moeda nunca é assumida.
  CONSTRAINT opportunities_funding_amount_requires_currency CHECK (funding_amount IS NULL OR funding_currency IS NOT NULL)
);

COMMENT ON COLUMN opportunities.status IS
  'Situação conhecida da oportunidade. ''unknown'' quando a fonte não informa. Atualizada pelo backend; não é derivada automaticamente do prazo.';
COMMENT ON COLUMN opportunities.opening_date IS
  'Abertura das inscrições (timestamptz). Quando a fonte informa só a data, o backend define a convenção de horário (America/Sao_Paulo).';
COMMENT ON COLUMN opportunities.deadline IS
  'Prazo final (timestamptz). NULL para fluxo contínuo ou prazo não informado.';
COMMENT ON COLUMN opportunities.target_audience IS
  'Array não vazio de códigos de profile_types. NULL = não informado (diferente de público aberto). O banco valida a forma; o backend valida que cada código existe e está ativo em profile_types.';
COMMENT ON COLUMN opportunities.eligible_locations IS
  'Array não vazio de objetos: {"scope":"national"} (sem state/city), {"scope":"state","state":"SP"} (exige state; sem city) ou {"scope":"city","state":"SP","city":"Campinas"} (exige state e city). O banco valida escopo, propriedades compatíveis com o escopo e UF; o backend valida a cidade. NULL = não informado.';
COMMENT ON COLUMN opportunities.eligible_segments IS
  'Array não vazio de strings. NULL = não informado. Conteúdo validado pelo backend.';
COMMENT ON COLUMN opportunities.eligible_business_sizes IS
  'Array não vazio com valores de mei, micro, small, medium, large. Valores fora do conjunto são rejeitados pelo banco. NULL = não informado.';
COMMENT ON COLUMN opportunities.eligible_organization_stages IS
  'Array não vazio de strings no vocabulário de user_profiles.organization_stage (snake_case, validado pelo backend). NULL = não informado.';
COMMENT ON COLUMN opportunities.min_organization_age_months IS
  'Tempo mínimo de existência, em meses. NULL = sem informação ou sem exigência registrada.';
COMMENT ON COLUMN opportunities.max_organization_age_months IS
  'Tempo máximo de existência, em meses. NULL = sem informação ou sem exigência registrada.';
COMMENT ON COLUMN opportunities.eligibility_verified_at IS
  'Quando os critérios de elegibilidade foram validados (por fonte oficial ou revisão humana). NULL = não verificados: a compatibilidade deve tratar como "elegibilidade não confirmada".';
COMMENT ON COLUMN opportunities.funding_amount IS
  'Valor da oportunidade. NULL quando não informado ou inexistente.';
COMMENT ON COLUMN opportunities.counterpart_required IS
  'true = exige contrapartida; false = confirmado que não exige; NULL = não informado.';
COMMENT ON COLUMN opportunities.source_name IS
  'Identificador estável da fonte (ex.: nome do portal oficial). Faz parte da chave de deduplicação.';
COMMENT ON COLUMN opportunities.external_id IS
  'Identificador da oportunidade na fonte, quando existir.';

-- Deduplicação: (fonte + id externo) quando há id externo; senão (fonte + URL).
CREATE UNIQUE INDEX opportunities_source_external_id_unique_idx
  ON opportunities (source_name, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX opportunities_source_url_unique_idx
  ON opportunities (source_name, source_url)
  WHERE external_id IS NULL AND source_url IS NOT NULL;

CREATE INDEX opportunities_category_idx ON opportunities (category);
CREATE INDEX opportunities_status_idx ON opportunities (status);
CREATE INDEX opportunities_deadline_idx ON opportunities (deadline);
CREATE INDEX opportunities_publication_date_idx ON opportunities (publication_date);
CREATE INDEX opportunities_institution_idx ON opportunities (institution);
CREATE INDEX opportunities_target_audience_idx ON opportunities USING gin (target_audience);
CREATE INDEX opportunities_eligible_locations_idx ON opportunities USING gin (eligible_locations);
CREATE INDEX opportunities_eligible_segments_idx ON opportunities USING gin (eligible_segments);
CREATE INDEX opportunities_search_idx ON opportunities USING gin (
  to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(institution, '') || ' ' || coalesce(description, ''))
);

CREATE TRIGGER opportunities_set_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- opportunity_analyses
-- Histórico imutável de análises por IA: cada nova análise é uma nova linha.
-- O conteúdo aqui é extração automática, NÃO fato confirmado. A compatibilidade
-- só deve usar os campos de opportunities, nunca estes diretamente.
-- -----------------------------------------------------------------------------
CREATE TABLE opportunity_analyses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id       uuid NOT NULL REFERENCES opportunities (id) ON DELETE CASCADE,
  target_audience      jsonb,
  requirements         jsonb,
  eligible_locations   jsonb,
  required_documents   jsonb,
  funding_amount       numeric(18, 2),
  funding_currency     text,
  counterpart_required boolean,
  missing_information  jsonb,
  source_references    jsonb,
  analysis_summary     text,
  analysis_status      text NOT NULL DEFAULT 'pending',
  model_name           text,
  analyzed_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_analyses_status_valid CHECK (
    analysis_status IN ('pending', 'completed', 'failed', 'needs_review')
  ),
  CONSTRAINT opportunity_analyses_target_audience_valid CHECK (target_audience IS NULL OR check_string_array(target_audience)),
  CONSTRAINT opportunity_analyses_requirements_is_object CHECK (requirements IS NULL OR jsonb_typeof(requirements) = 'object'),
  CONSTRAINT opportunity_analyses_eligible_locations_valid CHECK (eligible_locations IS NULL OR check_location_array(eligible_locations)),
  CONSTRAINT opportunity_analyses_required_documents_is_array CHECK (required_documents IS NULL OR jsonb_typeof(required_documents) = 'array'),
  CONSTRAINT opportunity_analyses_missing_information_valid CHECK (missing_information IS NULL OR check_string_array(missing_information, true)),
  CONSTRAINT opportunity_analyses_source_references_valid CHECK (source_references IS NULL OR check_source_reference_array(source_references)),
  CONSTRAINT opportunity_analyses_funding_amount_valid CHECK (funding_amount IS NULL OR funding_amount >= 0),
  CONSTRAINT opportunity_analyses_funding_currency_format CHECK (funding_currency IS NULL OR funding_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT opportunity_analyses_funding_amount_requires_currency CHECK (funding_amount IS NULL OR funding_currency IS NOT NULL),
  -- Análise concluída precisa ser rastreável: quando foi feita e por qual modelo
  -- (model_name informado e não vazio).
  CONSTRAINT opportunity_analyses_completed_is_traceable CHECK (
    analysis_status <> 'completed'
    OR (analyzed_at IS NOT NULL AND model_name IS NOT NULL AND btrim(model_name) <> '')
  ),
  -- Fundamentação: análise concluída que extraiu algum dado precisa citar a origem.
  CONSTRAINT opportunity_analyses_completed_requires_references CHECK (
    analysis_status <> 'completed'
    OR source_references IS NOT NULL
    OR (
      requirements IS NULL AND target_audience IS NULL AND eligible_locations IS NULL
      AND required_documents IS NULL AND funding_amount IS NULL AND funding_currency IS NULL
      AND counterpart_required IS NULL
    )
  )
);

COMMENT ON TABLE opportunity_analyses IS
  'Histórico de análises de IA por oportunidade. Conteúdo extraído automaticamente, não confirmado.';
COMMENT ON COLUMN opportunity_analyses.requirements IS
  'Objeto com requisitos extraídos. Chaves recomendadas: segments, business_sizes, organization_stages, min_organization_age_months, max_organization_age_months (mesmos nomes das colunas de opportunities, para facilitar a promoção). Cada chave deve ter ao menos uma entrada em source_references. O que o documento não confirmar vai em missing_information, nunca preenchido por suposição.';
COMMENT ON COLUMN opportunity_analyses.missing_information IS
  'Array de strings com os campos que o documento não permitiu confirmar (ex.: ["deadline","funding_amount"]). [] = nada ausente; NULL = ainda não avaliado.';
COMMENT ON COLUMN opportunity_analyses.source_references IS
  'Array de referências de origem dos dados extraídos. Cada item: {"field":"requirements.business_sizes","document_url":"https://...","page":4,"section":"3.2","excerpt":"trecho literal curto","basis":"stated"|"inferred"}. basis (string JSON) = stated quando o documento afirma expressamente; inferred quando é dedução, que não pode ser promovida nem apresentada como fato confirmado. O backend deve verificar que cada campo extraído tem sua própria referência. Documentado em database/README.md.';
COMMENT ON COLUMN opportunity_analyses.analysis_status IS
  'pending, completed, failed ou needs_review (revisão humana necessária antes de promover dados para opportunities).';

CREATE INDEX opportunity_analyses_opportunity_created_idx
  ON opportunity_analyses (opportunity_id, created_at DESC);
CREATE INDEX opportunity_analyses_status_idx ON opportunity_analyses (analysis_status);

COMMIT;
