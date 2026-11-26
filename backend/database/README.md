# Banco de dados — Edital Inteligente

Esquema SQL (PostgreSQL 14+, compatível com Supabase). Esta pasta fica fora de `src/` e não faz parte da compilação TypeScript.

> **Segurança obrigatória:** antes de inserir **qualquer dado real** em um projeto Supabase, é **obrigatório** configurar RLS e revisar os privilégios das tabelas, especialmente `users` e `password_hash`. Veja a seção [Segurança](#segurança-obrigatória-antes-de-dados-reais).

```text
database/
├── migrations/
│   ├── 001_initial_schema.sql                  # congelada
│   ├── 002_allow_missing_document_url.sql      # congelada
│   └── 003_analysis_provenance_and_dates.sql
├── tests/
│   └── 003_analysis_provenance_and_dates.test.sql  # testes SQL (terminam em ROLLBACK)
└── README.md
```

## Modelo de dados

```text
users 1───N user_profiles N───1 profile_types
opportunity_categories 1───N opportunities 1───N opportunity_analyses
opportunity_categories 1───N opportunity_analyses   (categoria sugerida, 003)
opportunities.identification_analysis_id ───> opportunity_analyses   (procedência da identificação, 003)
```

| Tabela | Função |
| --- | --- |
| `users` | Dados básicos e `password_hash` (somente o hash, nunca a senha). |
| `user_profiles` | Perfis do usuário. Um usuário pode ter vários. Só `profile_type` é obrigatório. |
| `profile_types` | Natureza ou atuação do perfil (10 tipos iniciais). Novos tipos entram com `INSERT`. |
| `opportunity_categories` | As 7 categorias iniciais e, desde a `003`, o marcador operacional `unclassified` ("sem categoria confirmada"). Licitações, se vierem, entram como categoria própria. |
| `opportunities` | Identificação da oportunidade e seus dados **confirmados** (critérios de elegibilidade, datas, valores). Título, instituição e categoria têm validação por campo (`*_verified_at`, `003`). Deduplicadas por `(source_name, external_id)` ou, sem id externo, por `(source_name, source_url)`. |
| `opportunity_analyses` | Histórico de análises de IA (extração **não confirmada**), inclusive título, instituição, categoria sugerida, objetivo, observações e datas (`003`). Cada análise é uma nova linha. |

Regras de exclusão: `users` → `user_profiles` e `opportunities` → `opportunity_analyses` usam `CASCADE`. `profile_types` e `opportunity_categories` usam `RESTRICT` (para desativar, use `is_active = false`).

**Senhas:** `password_hash` é `NOT NULL` e deve conter somente o hash, nunca senha em texto puro. O banco **não** valida o algoritmo nem o formato do hash: essa validação é feita exclusivamente pelo backend (hash com bcrypt ou argon2 e verificação do formato antes de qualquer gravação).

## Tipo de participante × porte

Os dois conceitos são independentes:

- `profile_types` (via `user_profiles.profile_type`) responde **"o que é"**: `startup`, `company`, `individual_entrepreneur`, `researcher`, `student`, `individual`, `university`, `research_institution`, `nonprofit`, `other_institution`.
- `user_profiles.business_size` responde **"qual o porte"**: `mei`, `micro`, `small`, `medium`, `large`.

| Situação | `profile_type` | `business_size` |
| --- | --- | --- |
| Startup microempresa | `startup` | `micro` |
| Startup de pequeno porte | `startup` | `small` |
| Empresa de médio porte | `company` | `medium` |
| MEI | `individual_entrepreneur` | `mei` |
| Pesquisador, estudante, pessoa física | `researcher`, `student`, `individual` | `NULL` |
| Universidade, ONG, instituição de pesquisa | `university`, `nonprofit`, `research_institution` | `NULL` |

**MEI sem duplicação:** MEI é um enquadramento de porte, então existe **apenas** em `business_size = 'mei'`. Não há tipo `mei` em `profile_types`. Como o MEI é, por definição, um empreendedor individual, o backend o cadastra com `profile_type = 'individual_entrepreneur'`. Uma oportunidade exclusiva para MEI usa `eligible_business_sizes = ["mei"]`, sem repetir a informação em `target_audience`.

Convenções para o backend:

- Cada critério é avaliado de forma independente e o resultado combina todos eles. Um edital para "MEI e microempresas" usa `target_audience = ["individual_entrepreneur","company"]` e `eligible_business_sizes = ["mei","micro"]`.
- O backend **rejeita `business_size` em perfis em que não se aplica** (pesquisador, estudante, pessoa física, instituições). O banco não impõe isso, para não prender o modelo a códigos específicos.
- Perfis `individual_entrepreneur` com `business_size` diferente de `mei` são válidos (empreendedor individual não enquadrado como MEI).

## Compatibilidade (estrutura de dados)

A compatibilidade será calculada pelo backend, com regras objetivas, comparando `user_profiles` com os critérios de `opportunities`:

| Critério | Perfil | Oportunidade |
| --- | --- | --- |
| Tipo de participante | `profile_type` | `target_audience` |
| Localização | `state`, `city` | `eligible_locations` |
| Segmento | `segment` | `eligible_segments` |
| Porte | `business_size` | `eligible_business_sizes` |
| Tempo de existência / estágio | `organization_founded_on`, `organization_stage` | `min_`/`max_organization_age_months`, `eligible_organization_stages` |

Convenções para "elegibilidade não confirmada":

- `NULL` em um critério de `opportunities` significa **não informado** (não "aberto a todos"). Arrays vazios são rejeitados pelo banco: use `NULL`.
- `opportunities.eligibility_verified_at` é `NULL` até os critérios serem validados (fonte oficial ou revisão humana). Enquanto for `NULL`, o resultado é "elegibilidade não confirmada".
- O mesmo vale para campos ausentes no perfil do usuário.
- A compatibilidade lê **somente** `opportunities`, nunca `opportunity_analyses`. Dados da IA só chegam a `opportunities` quando o backend os promove após validação.
- Percentuais de compatibilidade não são armazenados nem gerados por IA.

## Validação dos arrays JSONB

Princípio: o **banco garante a forma e os conjuntos fixos**; o **backend garante o conteúdo** que depende de dados de referência. Todo dado deve ser validado pelo backend (Zod) **antes** de ser gravado, venha de usuário, de coleta ou de IA. A saída de um LLM nunca é gravada sem validação; se for inválida, a análise é registrada com `analysis_status = 'failed'`.

| Coluna | O banco garante | O backend deve validar |
| --- | --- | --- |
| `target_audience` | Array não vazio de strings não vazias, ou `NULL` | Cada código existe e está ativo em `profile_types`. Sem duplicados. |
| `eligible_locations` | Array não vazio de objetos com `scope` em `national`, `state`, `city`, e propriedades compatíveis com o escopo (tabela abaixo). `state` e `city` devem ser strings. | Nome da cidade existe na UF (ex.: lista do IBGE). Sem duplicados. |
| `eligible_segments` | Array não vazio de strings não vazias, ou `NULL` | Valores do vocabulário de segmentos, quando definido. Normalização (minúsculas, espaços). |
| `eligible_business_sizes` | Array não vazio com valores apenas de `mei`, `micro`, `small`, `medium`, `large` | Sem duplicados. |
| `eligible_organization_stages` | Array não vazio de strings não vazias, ou `NULL` | Formato snake_case e valores do vocabulário de estágios, quando definido. |
| `user_profiles.areas_of_interest` | Array de strings não vazias (pode ser vazio) | Normalização e limite de tamanho. |

Propriedades aceitas em cada item de `eligible_locations` (rejeitadas pelo banco quando violadas):

| `scope` | `state` | `city` | Exemplo |
| --- | --- | --- | --- |
| `national` | Não aceita | Não aceita | `{"scope":"national"}` |
| `state` | Obrigatório (UF válida) | Não aceita | `{"scope":"state","state":"SP"}` |
| `city` | Obrigatório (UF válida) | Obrigatório (não vazio) | `{"scope":"city","state":"SP","city":"Campinas"}` |

Uma chave presente com valor `null` conta como presente: `{"scope":"national","state":null}` é rejeitado.

Por que o banco não valida tudo: códigos de `profile_types` e cidades dependem de dados que mudam, e uma CHECK não consulta outras tabelas. Validar isso por trigger adicionaria complexidade sem necessidade nesta etapa. As três funções auxiliares (`check_string_array`, `check_location_array`, `check_source_reference_array`) são puras e usadas apenas em CHECK.

O banco rejeita um valor inválido, mas a mensagem de erro não é amigável. O backend deve reutilizar as mesmas regras no schema Zod para responder com erros claros. Os valores fixos do banco (UF, portes, escopos) devem ser as mesmas constantes do schema Zod, para não divergir.

## Rastreabilidade das análises (`source_references`)

Cada linha de `opportunity_analyses` tem uma coluna JSONB `source_references`, um array de referências que ligam cada dado extraído ao trecho do documento. Ela permite ao chatbot responder com base em fonte e distinguir o que o documento afirma do que a IA deduziu.

```json
[
  {
    "field": "requirements.business_sizes",
    "document_url": "https://exemplo.gov.br/edital.pdf",
    "page": 4,
    "section": "3.2 Quem pode participar",
    "excerpt": "Podem participar microempresas e empresas de pequeno porte.",
    "basis": "stated"
  }
]
```

| Chave | Obrigatória | Regra |
| --- | --- | --- |
| `field` | Sim | Dado ao qual a referência se aplica: `title`, `institution`, `opportunity_category`, `objective`, `observations`, `opening_date`, `closing_date` (desde a `003`), `target_audience`, `eligible_locations`, `required_documents`, `funding_amount`, `funding_currency`, `counterpart_required` ou `requirements.<chave>` (`segments`, `business_sizes`, `organization_stages`, `min_organization_age_months`, `max_organization_age_months`). O banco exige apenas uma string não vazia; o backend aceita somente os valores desta lista. |
| `document_url` | Não | URL http/https do documento (edital ou anexo), `null` explícito ou chave ausente (documento enviado diretamente pelo usuário, sem URL pública). Se informado e diferente de `null`, deve ser uma string que comece com `http://` ou `https://`; qualquer outro valor (string sem esquema, `ftp://`, string vazia, número, booleano) é rejeitado pelo banco. A verificação é de prefixo: o backend valida a URL completa. Uma análise pode citar vários documentos. |
| `excerpt` | Sim | Trecho **literal e curto** do documento que sustenta o dado. |
| `basis` | Sim | Deve ser uma **string JSON** com exatamente `stated` (o documento afirma expressamente) ou `inferred` (dedução da IA). Outro tipo (número, booleano, objeto, `null`) ou outro valor é rejeitado pelo banco. |
| `page` | Não | Inteiro ≥ 1 (validado pelo backend). |
| `section` | Não | Texto livre com seção ou item do edital. |

O banco valida a presença e a forma das chaves obrigatórias, inclusive o tipo de `basis`.

**Desde a `003`**, o banco também impõe a regra de análise concluída (constraint `opportunity_analyses_completed_requires_stated_references`, que substitui `opportunity_analyses_completed_requires_references` da `001`): uma análise `completed` precisa ter, **para cada campo extraído e não nulo**, ao menos uma referência cujo `field` seja exatamente esse campo e cujo `basis` seja `stated`. Contam como campo extraído: `title`, `institution`, `opportunity_category`, `objective`, `observations`, `opening_date`, `closing_date`, `target_audience`, `eligible_locations`, `required_documents`, `funding_amount`, `funding_currency`, `counterpart_required` e cada chave não nula de `requirements` (como `requirements.<chave>`). Campo sem referência própria, ou só com `inferred`, obriga `needs_review`. Uma análise sem nenhum campo extraído pode ser `completed` sem referências. `analysis_summary` (legado) não conta. A verificação é feita pela função pura `check_analysis_stated_references(fields, requirements, refs)`.

Regras para o backend e o chatbot:

- O backend valida `page` e que `excerpt` é curto (sugestão: até ~500 caracteres).
- **Referência própria por campo:** o backend calcula o status antes de gravar: `completed` somente se **cada campo extraído pela IA** (cada coluna preenchida e cada chave de `requirements`) tiver referência própria `stated`; caso contrário, `needs_review`, com os campos listados na resposta. A referência de um campo não vale para outro: `funding_currency` exige referência própria mesmo quando `funding_amount` já tem a sua, e `closing_date` não é coberto por `opening_date`. O banco reforça a mesma regra (acima).
- **Documento sem URL:** quando `document_url` for `null` ou ausente, recomenda-se que o backend registre outra forma de identificar o documento (por exemplo, um identificador interno do arquivo em uma chave adicional como `document_id`). O banco não exige nem valida essa chave. Sem ela, o chatbot não consegue indicar de qual documento veio o trecho.
- **Identificação do modelo:** uma análise `completed` exige `analyzed_at` e `model_name` não nulo e não vazio (constraint `opportunity_analyses_completed_is_traceable`). O backend deve gravar o identificador real do modelo usado.
- Só dados com `basis = "stated"` podem ser apresentados como fato. Os `inferred` devem ser apresentados como "não confirmados".
- Sem referência, o chatbot não afirma o dado e informa que ele não foi confirmado. Campos listados em `missing_information` nunca são apresentados como conhecidos.
- Se o documento mudar, faz-se uma nova análise (nova linha). A análise anterior permanece como histórico.
- Ligar os critérios já promovidos em `opportunities` à análise de origem exigiria uma coluna adicional (`eligibility_analysis_id`). Ela não foi incluída para manter a estrutura simples e pode ser adicionada em uma migration futura, se necessário. A identificação provisória já tem essa ligação desde a `003` (`identification_analysis_id`).

### Promoção para `opportunities`

Dados de `opportunity_analyses` só chegam a `opportunities` por promoção feita pelo backend, seguindo estas regras:

- Um campo só pode ser promovido se tiver ao menos uma referência **própria** com `basis = "stated"`.
- Campos sustentados apenas por referências `inferred` **não podem ser promovidos como fatos confirmados**. Permanecem `NULL` em `opportunities` (e, portanto, como "não confirmados" na compatibilidade) ou seguem para revisão humana.
- Campos sem nenhuma referência própria não são promovidos.
- `funding_amount` e `funding_currency` são promovidos juntos: `opportunities` exige moeda quando há valor, e cada um precisa da sua referência própria `stated`.
- `eligibility_verified_at` só deve ser preenchido depois dessa verificação (ou de revisão humana).
- **Datas** (`003`): `opportunity_analyses.opening_date`/`closing_date` são `date`. Ao promover para `opportunities.opening_date`/`deadline` (`timestamptz`), o backend deve aplicar uma convenção explícita em `America/Sao_Paulo` (por exemplo, abertura às 00:00 e encerramento às 23:59:59 do dia, salvo horário informado e validado). Essa convenção ainda não está implementada.
- **Identificação** (`003`): título, instituição e categoria são confirmados preenchendo `title_verified_at`, `institution_verified_at` e `category_verified_at` (fonte oficial ou revisão humana). A categoria só pode ser confirmada depois de trocar `unclassified` por uma categoria real.

## Histórico de migrations

| Migration | Conteúdo |
| --- | --- |
| `001_initial_schema.sql` | Esquema inicial. **Congelada**: não deve mais ser editada. |
| `002_allow_missing_document_url.sql` | Atualiza `check_source_reference_array`: `document_url` passa a ser opcional (ausente, `null` ou URL http/https). Demais regras inalteradas. **Congelada.** |
| `003_analysis_provenance_and_dates.sql` | Histórico completo da análise (título, instituição, categoria sugerida, objetivo, observações, datas), procedência e validação por campo da identificação em `opportunities`, categoria operacional `unclassified` e regra de `completed` no banco. Detalhes na seção "Migration 003". |

A `002` pressupõe a `001` na versão final (com a função `check_source_reference_array` e a constraint `opportunity_analyses_source_references_valid`). Ela aborta com mensagem clara se esses objetos não existirem. Nesse caso, o banco local foi criado a partir de uma versão anterior da `001`: descarte-o e aplique a `001` atual e depois a `002`. A regra fica mais permissiva, então nenhuma linha existente se torna inválida.

## Alterações em relação à primeira versão da `001`

Estas alterações foram feitas na própria `001`, antes de ela ser considerada definitiva. As mudanças são **incompatíveis** com a versão anterior em um ponto: `profile_types` deixou de ter `mei`, `micro_enterprise`, `small_enterprise` e `medium_large_enterprise`, e passou a ter `company`. Se você já executou a versão anterior em um banco local de teste, descarte-o e execute de novo (`docker rm -f edital-pg`). A `001` agora está **congelada** (já foi executada): mudanças passam a ser feitas em novas migrations, como a `002`. As constraints de JSONB também foram renomeadas (`*_is_array` → `*_valid`) e ficaram mais rígidas.

Revisão posterior, também feita no lugar, pelo mesmo motivo:

- Removida a constraint `users_password_hash_format`. A validação do algoritmo e do formato do hash passou a ser exclusivamente do backend. `password_hash` continua `NOT NULL`.
- `check_source_reference_array` agora exige que `basis` seja uma string JSON, além de aceitar somente `stated` e `inferred`.
- `check_location_array` agora rejeita propriedades incompatíveis com o escopo (`national` sem `state`/`city`; `state` com `state` e sem `city`; `city` com `state` e `city`). Um `eligible_locations` que antes era aceito, como `{"scope":"national","state":"SP"}`, passa a ser rejeitado.

Nova revisão, também feita na própria `001`:

- `opportunity_analyses_completed_requires_references` agora também considera `funding_currency` como dado extraído. Uma análise `completed` só com `funding_currency` e sem `source_references`, antes aceita, passa a ser rejeitada.
- `opportunity_analyses_completed_is_traceable` agora exige `model_name` não vazio (`btrim(model_name) <> ''`), além de `analyzed_at` e `model_name` não nulos. Um `model_name` em branco, antes aceito, passa a ser rejeitado.
- Os testes negativos deste README passaram a usar blocos `DO`, que falham de forma explícita se o dado inválido for aceito.

## Executar a migration no Supabase (futuramente)

Quando o projeto Supabase existir, aplique as migrations em ordem numérica (`001`, `002` e `003`) usando uma das opções abaixo. Este repositório não executa migrations automaticamente.

**Opção A — SQL Editor (mais simples):** em *SQL Editor*, cole o conteúdo de `001_initial_schema.sql` e execute; depois repita com `002_allow_missing_document_url.sql` e `003_analysis_provenance_and_dates.sql`. Cada arquivo roda em uma única transação: se houver erro, nada daquele arquivo é aplicado.

**Opção B — `psql` com a string de conexão do Supabase:**

```powershell
cd edital-inteligente\backend
psql "SUA_DATABASE_URL" -v ON_ERROR_STOP=1 -f database\migrations\001_initial_schema.sql
psql "SUA_DATABASE_URL" -v ON_ERROR_STOP=1 -f database\migrations\002_allow_missing_document_url.sql
psql "SUA_DATABASE_URL" -v ON_ERROR_STOP=1 -f database\migrations\003_analysis_provenance_and_dates.sql
```

Use a string copiada do painel (Project Settings → Database), sem colá-la em arquivos versionados.

**Opção C — Supabase CLI:** o CLI espera migrations em `supabase/migrations/` com nome `<timestamp>_<nome>.sql`. Se adotar o CLI, copie o arquivo para lá com esse padrão.

Execute cada migration **uma única vez**, em ordem numérica. Ainda não há runner nem tabela de controle: registre manualmente quais foram aplicadas. **Configure a segurança (seção abaixo) antes de inserir dados reais.**

## Validar o SQL localmente (sem Supabase)

Requer Docker. Use uma senha descartável de sua escolha.

```powershell
docker run --name edital-pg -e POSTGRES_PASSWORD=SENHA_LOCAL_DESCARTAVEL -p 5433:5432 -d postgres:15
docker cp .\database\migrations\001_initial_schema.sql edital-pg:/tmp/001.sql
docker exec edital-pg psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/001.sql
docker exec edital-pg psql -U postgres -c "\dt"
docker exec edital-pg psql -U postgres -c "SELECT code FROM profile_types ORDER BY sort_order;"
```

O esperado é `COMMIT` sem erros, 6 tabelas e 10 tipos de perfil. Depois, teste as restrições em uma sessão interativa (`docker exec -it edital-pg psql -U postgres`), dentro de uma transação descartada. Se algum bloco terminar em `FALHA NO TESTE`, execute `ROLLBACK;`, corrija o SQL e repita:

```sql
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
```

Para descartar o ambiente: `docker rm -f edital-pg`.

## Migration 002 — executar e validar no PostgreSQL 15 local

Requer Docker. Use os mesmos comandos da seção anterior para criar o contêiner `edital-pg` e aplicar a `001`, se ainda não o fez. Todos os comandos são de PowerShell, a partir da pasta `backend`.

**1. Confirmar o pré-requisito** (a `001` final aplicada). Os dois resultados abaixo devem existir:

```powershell
docker exec edital-pg psql -U postgres -c "SELECT to_regprocedure('check_source_reference_array(jsonb)');"
docker exec edital-pg psql -U postgres -c "SELECT conname FROM pg_constraint WHERE conname = 'opportunity_analyses_source_references_valid';"
```

**2. (Opcional) Ver os testes falharem antes da `002`.** Execute o passo 4 antes de aplicar a migration: o caso `document_url null explícito` deve gerar `FALHA NO TESTE`. Isso confirma que os testes detectam a diferença.

**3. Aplicar a `002`:**

```powershell
docker cp .\database\migrations\002_allow_missing_document_url.sql edital-pg:/tmp/002.sql
docker exec edital-pg psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/002.sql
```

O esperado é `BEGIN`, `DO`, `CREATE FUNCTION`, `COMMENT` e `COMMIT`, sem erros.

**4. Validar.** Em uma sessão interativa (`docker exec -it edital-pg psql -U postgres`), dentro de uma transação descartada. O primeiro bloco testa a função diretamente (casos positivos, negativos de URL e regressões das demais regras). Os seguintes testam a constraint pela inserção real. Se algum bloco terminar em `FALHA NO TESTE`, execute `ROLLBACK;`, corrija e repita.

```sql
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
```

Observações:

- Dados existentes não são revalidados, e a regra ficou mais permissiva, então nada que já estava gravado se torna inválido.
- A `002` pode ser reexecutada sem efeito colateral, mas aplique cada migration uma única vez, em ordem.
- Para descartar o ambiente: `docker rm -f edital-pg`.

## Migration 003 — histórico completo, procedência e `unclassified`

`003_analysis_provenance_and_dates.sql` é incremental e roda em uma única transação. Não altera a `001` nem a `002` e **não modifica nenhuma linha existente** (as novas colunas entram `NULL`; a única linha inserida é a categoria `unclassified`). Usa apenas recursos do PostgreSQL 14+ (sem `SET NULL (coluna)`, `NULLS NOT DISTINCT` ou `MERGE`), compatível com Supabase.

### O que muda

**`opportunity_categories`**

- Nova linha `unclassified` ("Não classificada", `sort_order = 1000`): marcador operacional de "ainda sem categoria confirmada". Existe porque `opportunities.category` é `NOT NULL` com FK. Não é uma classificação, não deve ser exibida como tal e nunca é sugerida pela IA. Não se usa `institutional` como padrão para o desconhecido.

**`opportunity_analyses`** (dados extraídos, não confirmados)

| Coluna | Tipo | Regra |
| --- | --- | --- |
| `title` | `text` | Não vazio quando informado. |
| `institution` | `text` | Não vazio quando informado; `NULL` se a fonte não informa. |
| `opportunity_category` | `text` FK → `opportunity_categories` (`ON UPDATE CASCADE`, `ON DELETE RESTRICT`) | Categoria **sugerida**. `NULL` sem classificação segura. Nunca `unclassified` (`opportunity_analyses_category_not_operational`). |
| `objective`, `observations` | `text` | Não vazios quando informados. Substituem a concatenação em `analysis_summary` (que vira legado e fica `NULL` nas novas análises). |
| `opening_date`, `closing_date` | `date` | Sem horário inventado. `closing_date >= opening_date` quando ambos existem (`opportunity_analyses_dates_order`). **Não** são promovidas para `opportunities`. |

Também: `UNIQUE (id, opportunity_id)` (para a FK composta abaixo), índice em `opportunity_category`, a função `check_analysis_stated_references` e a constraint `opportunity_analyses_completed_requires_stated_references` (ver "Rastreabilidade"). `analysis_status` mantém os mesmos valores (`pending`, `completed`, `failed`, `needs_review`) e `opportunity_analyses_completed_is_traceable` continua valendo.

**`opportunities`** (identificação e dados confirmados)

| Coluna | Regra |
| --- | --- |
| `title_verified_at` | `NULL` = título provisório (extraído pela IA). Pode identificar e deduplicar, nunca ser apresentado como validado. |
| `institution_verified_at` | `NULL` = provisória ou ausente. Só pode ser preenchida com `institution` não nula (`opportunities_institution_verified_requires_value`). |
| `category_verified_at` | `NULL` = categoria não confirmada. Sempre `NULL` com `unclassified` (`opportunities_unclassified_not_verified`). |
| `identification_analysis_id` | Análise de origem do título/instituição provisórios. FK composta `(identification_analysis_id, id)` → `opportunity_analyses (id, opportunity_id)`: a análise precisa ser **da mesma oportunidade**. `DEFERRABLE INITIALLY DEFERRED` (o backend cria a oportunidade e depois a análise, na mesma transação). `ON DELETE NO ACTION`: a análise de origem não pode ser apagada sozinha; apagar a oportunidade continua possível (cascata). `NULL` em oportunidades anteriores à `003` ou cadastradas manualmente. |

`opportunities.deadline` continua `timestamptz`. Os campos de compatibilidade (`target_audience`, `eligible_*`, idades) e `eligibility_verified_at` não mudam e continuam sendo preenchidos somente por validação. Título, instituição e categoria provisórios não devem ser usados no cálculo de compatibilidade.

### Pré-condições e segurança da aplicação

A migration aborta (e nada é aplicado) se:

- a `003` já foi aplicada (`unclassified` existe);
- a `001` não está aplicada (tabelas ou a constraint `opportunity_analyses_completed_requires_references`);
- a `002` não está aplicada (uma referência sem `document_url` é rejeitada);
- existe alguma análise `completed` sem referência `stated` própria para cada campo extraído (só possível com dados gravados fora do backend). A mensagem informa quantas; revise-as (por exemplo, marque `needs_review`) e aplique de novo.

Dados da Etapa 3.1 continuam válidos: as oportunidades criadas antes ficam com `*_verified_at` `NULL` (não verificadas, que é o seu estado real) e mantêm a categoria gravada na época, que **não** passa a ser tratada como confirmada. As análises antigas mantêm `analysis_summary`.

### Executar e validar no PostgreSQL local (PowerShell)

A partir da pasta `backend`, com o contêiner `edital-pg` das seções anteriores (`001` e `002` já aplicadas):

```powershell
# 1. Aplicar a 003
docker cp .\database\migrations\003_analysis_provenance_and_dates.sql edital-pg:/tmp/003.sql
docker exec edital-pg psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/003.sql

# 2. Conferir a estrutura
docker exec edital-pg psql -U postgres -c "SELECT code, name FROM opportunity_categories WHERE code = 'unclassified';"
docker exec edital-pg psql -U postgres -c "\d opportunity_analyses"
docker exec edital-pg psql -U postgres -c "\d opportunities"

# 3. Testes SQL (tudo dentro de BEGIN ... ROLLBACK: nenhum dado existente é alterado)
docker cp .\database\tests\003_analysis_provenance_and_dates.test.sql edital-pg:/tmp/003_test.sql
docker exec edital-pg psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/003_test.sql
```

Esperado no passo 1: `BEGIN`, `DO`, `INSERT 0 1`, vários `ALTER TABLE`, `CREATE INDEX`, `CREATE FUNCTION` e `COMMENT`, e por fim `COMMIT`, sem erros. No passo 3: 21 linhas `NOTICE:  ok - ...` e, no fim, `NOTICE:  003: todos os testes passaram`. Qualquer falha aparece como `ERROR:  FALHOU - ...` e o comando sai com código diferente de zero.

Os testes SQL cobrem: categoria `unclassified` e estrutura; sugestão `unclassified` rejeitada; categoria sugerida desconhecida (FK) e `NULL`; `unclassified` não verificável; instituição `NULL` não verificável; ordem das datas e datas `NULL`; texto em branco; `completed` com referência `stated` por campo (aceito), sem referência própria, só `inferred`, referência de outro campo de `requirements` e sem nenhuma referência (rejeitados); `needs_review` com `inferred` (aceito); regras da `001` preservadas (`completed_is_traceable`, `status_valid`); FK de procedência (outra oportunidade rejeitada, mesma aceita, análise de origem não apagável, oportunidade apagável).

Para validar também o SQL do serviço contra o banco real, use a suíte de integração descrita em `backend/README.md` ("Testes com PostgreSQL real"), que exige um banco separado com nome terminado em `_test`.

## Segurança (obrigatória antes de dados reais)

O RLS **não** está habilitado na migration, de propósito: políticas incompletas poderiam bloquear o uso futuro. Mas isso não significa que a configuração seja opcional.

**Antes de inserir dados reais em um projeto Supabase, é obrigatório:**

1. **Habilitar RLS em todas as tabelas**, inclusive `profile_types` e `opportunity_categories`. Sem políticas, o RLS nega o acesso pela API pública:

   ```sql
   ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
   ALTER TABLE user_profiles          ENABLE ROW LEVEL SECURITY;
   ALTER TABLE profile_types          ENABLE ROW LEVEL SECURITY;
   ALTER TABLE opportunity_categories ENABLE ROW LEVEL SECURITY;
   ALTER TABLE opportunities          ENABLE ROW LEVEL SECURITY;
   ALTER TABLE opportunity_analyses   ENABLE ROW LEVEL SECURITY;
   ```

2. **Revisar os privilégios**, principalmente de `users` (contém `password_hash`). No Supabase, `anon` e `authenticated` recebem privilégios por padrão no schema `public`. Revogue o que não for necessário:

   ```sql
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
   ```

   Revise também os privilégios padrão de novas tabelas (`ALTER DEFAULT PRIVILEGES`) e a execução das funções do schema `public` por `anon` e `authenticated`.

3. **Verificar o resultado:** com a chave `anon` do projeto, uma consulta à API REST do Supabase em `users` deve ser negada ou retornar vazio. Confirme também que a conexão do backend continua funcionando. Os comandos acima devem ser executados como o usuário administrador do projeto.

**Acesso administrativo ao banco:**

- Todo acesso privilegiado ao banco ocorre **somente pelo backend**, usando `DATABASE_URL` (ou as variáveis `DB_*`) armazenada apenas no ambiente do servidor.
- **Nunca** exponha no frontend a string de conexão, a senha do banco ou a chave `service_role`. Variáveis com prefixo `VITE_` são incluídas no código enviado ao navegador, portanto nunca devem conter segredos.
- O frontend se comunica apenas com a API REST do backend. Se um dia usar o cliente do Supabase no navegador, será apenas com a chave `anon`, sob políticas RLS completas.
- Não versione `.env` nem cole credenciais em issues, logs ou mensagens de commit.

**Políticas RLS futuras (sugestões, não aplicadas):**

- `user_profiles`: o usuário lê e altera apenas as linhas em que `user_id` é o seu.
- `opportunities`, `opportunity_categories`, `profile_types`: leitura pública ou para autenticados; escrita só pelo backend.
- `users` e `opportunity_analyses`: sem acesso direto pela API pública.

Se adotar o Supabase Auth, avalie ligar `users.id` a `auth.users` e remover `password_hash`, já que o Supabase Auth guarda as senhas. Essa decisão pertence à etapa de autenticação.
