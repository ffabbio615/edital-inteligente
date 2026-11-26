# Edital Inteligente — Backend

API REST da plataforma **Edital Inteligente**.

**Objetivo do produto:** identificar, organizar, analisar e recomendar oportunidades públicas e privadas no Brasil (editais, financiamentos, bolsas, aceleração, premiações e chamadas públicas).

**Implementado até agora:** recebimento e armazenamento das análises produzidas pelo n8n e pelo Gemini, com histórico por análise e separação entre dados oficiais e dados extraídos pela IA, e consulta das oportunidades pela API (listagem e detalhe). Recomendação, cálculo de compatibilidade e revisão humana fazem parte do objetivo, mas **ainda não foram implementados**.

**Estado atual (Etapa 4.2 concluída; migrations 001, 002 e 003):** o backend expõe `GET /api/health`, a listagem pública `GET /api/opportunities` (Etapa 4.1), a consulta individual `GET /api/opportunities/:id` (Etapa 4.2) e o endpoint de integração `POST /api/integrations/n8n/opportunities`, que recebe do n8n a análise estruturada do Gemini, valida, deduplica e grava no PostgreSQL. As consultas devolvem os dados oficiais de `opportunities` separados da análise mais recente de `opportunity_analyses`, sempre marcada com `confirmed: false`. O esquema do banco está em `database/migrations/` (`001`, `002` e `003`).

A **coleta e a orquestração** dos editais são feitas pelos workflows do n8n, que chamam o endpoint de integração. O backend não implementa coleta: ele só recebe, valida e persiste o que o n8n envia.

Ainda **não** há autenticação de usuários finais, cadastros, cálculo de compatibilidade, recomendação, revisão humana/promoção de dados nem frontend.

## Arquitetura

```text
Fontes oficiais → n8n → Gemini → n8n (transformação) → Backend Node.js/TypeScript → PostgreSQL
```

| Parte | Responsabilidade |
| --- | --- |
| **n8n** | Coleta, extração do texto dos documentos, orquestração, chamada ao Gemini e transformação da saída do Gemini no contrato da API. Envia o resultado por HTTP. **Não acessa o PostgreSQL.** |
| **Gemini** | Extrai informações e produz uma análise estruturada, com evidência (trecho) para cada campo. |
| **Backend** | Único componente com acesso ao banco. Autentica o n8n, valida o contrato (Zod estrito), valida códigos contra as tabelas de referência, aplica as regras de negócio (procedência, status, deduplicação, idempotência) e persiste em transação. |
| **PostgreSQL** | Guarda os dados e reforça as regras críticas por constraints (inclusive a regra de análise `completed`). |
| **Frontend** (futuro) | Fala somente com a API do backend. Nunca recebe a chave de integração nem credenciais do banco. |

### Dados extraídos × dados confirmados

O sistema distingue três situações e preserva essa distinção em todas as camadas:

1. **Extraído pela IA** (não confirmado): fica em `opportunity_analyses`, uma linha por análise, com referências por campo.
2. **Confirmado** (fonte oficial ou revisão humana): fica em `opportunities`. São os únicos dados que a compatibilidade poderá usar.
3. **Desconhecido / precisa de revisão**: `NULL` (nunca um valor inventado), listado em `missing_information` quando aplicável, e análises com status `needs_review`.

A API **nunca promove** dados da IA para os campos confirmados de `opportunities`. Na criação de uma oportunidade só é gravada a **identificação provisória** (título, instituição, origem), com `title_verified_at`, `institution_verified_at`, `category_verified_at` e `eligibility_verified_at` em `NULL`, e categoria operacional `unclassified`.

## Tecnologias

- Node.js e TypeScript estrito (`tsx` em desenvolvimento)
- Express 5
- PostgreSQL via `pg` (sem ORM)
- Zod (validação) e dotenv (variáveis de ambiente)
- CORS
- npm

## Estrutura de pastas

```text
backend/
├── src/
│   ├── config/
│   │   └── env.ts                  # Carrega e valida variáveis de ambiente
│   ├── database/
│   │   ├── connection.ts           # Pool pg, query(), withTransaction(), checkDatabaseStatus()
│   │   └── transaction.ts          # runInTransaction() e tipos Queryable/TransactionRunner
│   ├── errors/
│   │   └── app-error.ts            # AppError: erro esperado com status e código
│   ├── integrations/
│   │   └── n8n/                    # Integração n8n
│   │       ├── n8n.constants.ts    # Valores fixos (portes, UFs, campos referenciáveis, unclassified)
│   │       ├── n8n.schemas.ts      # Schema Zod estrito da requisição (contrato da API)
│   │       ├── n8n.service.ts      # Regras de negócio e SQL (transação, deduplicação, idempotência)
│   │       ├── n8n.controller.ts   # Valida o corpo e monta a resposta
│   │       └── n8n.routes.ts       # POST /opportunities
│   ├── opportunities/              # Consulta de oportunidades (Etapas 4.1 e 4.2)
│   │   ├── opportunities.constants.ts  # Status, campos de ordenação e limites de paginação
│   │   ├── opportunities.schemas.ts    # Schemas Zod estritos (query da listagem, :id)
│   │   ├── opportunities.service.ts    # Listagem, consulta individual e SQL (somente leitura)
│   │   ├── opportunities.controller.ts # Valida query/parâmetros e monta a resposta
│   │   └── opportunities.routes.ts     # GET / e GET /:id
│   ├── middlewares/
│   │   ├── error.middleware.ts     # 404 e tratamento centralizado de erros
│   │   └── integration-auth.middleware.ts  # Valida o header x-integration-key
│   ├── routes/
│   │   ├── index.ts                # Agrega as rotas
│   │   ├── health.routes.ts        # GET /health
│   │   ├── integrations.routes.ts  # Monta /integrations/n8n com o serviço real
│   │   └── opportunities.routes.ts # Monta /opportunities com o serviço real
│   ├── app.ts                      # Cria o app Express
│   └── server.ts                   # Inicia o servidor e o encerramento seguro
├── database/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql                  # Esquema inicial (congelada)
│   │   ├── 002_allow_missing_document_url.sql      # document_url opcional (congelada)
│   │   └── 003_analysis_provenance_and_dates.sql   # Histórico completo, procedência, unclassified
│   ├── tests/
│   │   └── 003_analysis_provenance_and_dates.test.sql  # Testes SQL da 003 (terminam em ROLLBACK)
│   └── README.md                   # Modelo, execução e segurança do banco
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── tsconfig.build.json             # Build sem os arquivos *.test.ts
└── README.md
```

Os testes TypeScript ficam ao lado do código (`*.test.ts`).

## Requisitos

- Windows com PowerShell
- Node.js 20 ou superior (`node -v`)
- npm (`npm -v`)
- Visual Studio Code (recomendado)

## Instalação

```powershell
cd edital-inteligente\backend
npm install
```

## Configuração do `.env`

```powershell
Copy-Item .env.example .env
```

O servidor inicia com o `.env` copiado, mesmo com as variáveis de banco vazias (`/api/health` responde `database: not_configured`). Para usar a integração, preencha `DATABASE_URL` (ou `DB_*`) e `N8N_INTEGRATION_SECRET`. As variáveis `N8N_WEBHOOK_URL`, `GEMINI_API_KEY` e `GEMINI_MODEL` são apenas reservadas: o backend não chama o Gemini (quem chama é o n8n).

Nunca versione o `.env`. Ele já está no `.gitignore`.

## Iniciar o servidor

Desenvolvimento (reinicia ao salvar arquivos):

```powershell
npm run dev
```

Produção (após o build):

```powershell
npm run start
```

## Build e verificação de tipos

```powershell
npm run type-check   # verifica tipos sem gerar arquivos
npm run build        # compila para dist/ (sem os *.test.ts)
```

## Testes

```powershell
npm run test                 # todos os testes; a suíte com PostgreSQL só roda se TEST_DATABASE_URL existir
npm run test:integration     # somente a suíte com PostgreSQL real
```

Usa o executor de testes do Node (`node:test`) via `tsx`, sem dependências novas.

| Arquivo | Tipo | O que cobre |
| --- | --- | --- |
| `database/transaction.test.ts` | Unitário | BEGIN/COMMIT, ROLLBACK em erro, descarte da conexão, falha de conexão |
| `middlewares/integration-auth.middleware.test.ts` | Unitário | Sem chave, chave inválida, segredo não configurado |
| `middlewares/error.middleware.test.ts` | Unitário | Formato dos erros, 503, mapeamento de erros do PostgreSQL, sem vazamento |
| `integrations/n8n/n8n.schemas.test.ts` | Unitário | Contrato estrito: datas `YYYY-MM-DD`, categoria `null`/`unclassified`, campos de referência, `document_url`, `basis`, localizações, valores |
| `integrations/n8n/n8n.service.test.ts` | Unitário (banco falso) | Identificação provisória, `unclassified`, histórico completo, referências por campo, `completed`/`needs_review`, idempotência por todas as colunas, códigos, rollback |
| `integrations/n8n/n8n.controller.test.ts` | Unitário | Status 201/200, payload inválido, referências sem URL |
| `integrations/n8n/n8n.routes.test.ts` | HTTP (Express real, serviço falso) | 401, 400 (inclusive `unclassified` e data com horário), 201, 200, 503, 500 |
| `integrations/n8n/n8n.service.integration.test.ts` | **Integração (PostgreSQL real)** | SQL real do serviço: criação provisória, nada promovido, datas como `date`, reenvio idempotente, nova análise a cada mudança de conteúdo/procedência, `needs_review`, 422, rollback real, 6 requisições simultâneas, deduplicação por URL |
| `opportunities/opportunities.schemas.test.ts` | Unitário | Padrões, filtros aceitos, vazios, limites de paginação, ordenação só por colunas oficiais, parâmetros desconhecidos ou repetidos; UUID do `:id` e query vazia do detalhe |
| `opportunities/opportunities.service.test.ts` | Unitário (banco falso) | WHERE parametrizado só com colunas de `opportunities`, escape de `%`/`_`, ORDER BY por mapa fixo, LIMIT/OFFSET, última análise com `confirmed: false`; detalhe: consultas separadas e parametrizadas, mesmo contrato da listagem, análise completa, `null` sem análise, 404 |
| `opportunities/opportunities.routes.test.ts` | HTTP (Express real, serviço falso) | Listagem e detalhe: 200, 400 (UUID inválido, query extra), 404 (inexistente e métodos não permitidos), 503, 500 sem vazamento |
| `opportunities/opportunities.service.integration.test.ts` | **Integração (PostgreSQL real)** | Filtros por categoria/status oficiais (sugestão da IA ignorada), instituição por trecho, combinação, paginação, ordenação com NULL por último, última análise correta; detalhe com análise completa e evidências, sem análise e UUID inexistente |

### Testes com PostgreSQL real

A suíte de integração exige um banco **dedicado a testes**, cujo nome termine em `_test`, com as migrations `001`, `002` e `003` aplicadas. Ela grava somente linhas com um `source_name` exclusivo da execução (`integration-test-<uuid>`) e as apaga ao final; nada mais é alterado. Sem `TEST_DATABASE_URL`, a suíte aparece como `SKIP`.

Com Docker (PowerShell, na pasta `backend`; use uma senha descartável):

```powershell
docker run --name edital-pg-test -e POSTGRES_PASSWORD=SENHA_LOCAL_DESCARTAVEL -p 5434:5432 -d postgres:15
Start-Sleep -Seconds 5
docker exec edital-pg-test createdb -U postgres edital_test
foreach ($f in "001_initial_schema", "002_allow_missing_document_url", "003_analysis_provenance_and_dates") {
  docker cp ".\database\migrations\$f.sql" "edital-pg-test:/tmp/$f.sql"
  docker exec edital-pg-test psql -U postgres -d edital_test -v ON_ERROR_STOP=1 -f "/tmp/$f.sql"
}

# Testes SQL da 003 (terminam em ROLLBACK)
docker cp .\database\tests\003_analysis_provenance_and_dates.test.sql edital-pg-test:/tmp/003_test.sql
docker exec edital-pg-test psql -U postgres -d edital_test -v ON_ERROR_STOP=1 -f /tmp/003_test.sql

# Todos os testes TypeScript, inclusive a integração
$env:TEST_DATABASE_URL = "postgresql://postgres:SENHA_LOCAL_DESCARTAVEL@localhost:5434/edital_test"
npm run test
Remove-Item Env:TEST_DATABASE_URL
```

Esperado: o teste SQL termina com `003: todos os testes passaram` e `npm run test` com `# fail 0`. Para descartar: `docker rm -f edital-pg-test`.

## Testar a rota de saúde

Com o servidor em execução, em outro terminal:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
```

Ou, para ver o JSON bruto:

```powershell
curl.exe http://localhost:3001/api/health
```

Resposta com o banco ainda não configurado:

```json
{
  "status": "ok",
  "application": "Edital Inteligente",
  "api": "online",
  "database": "not_configured"
}
```

O campo `database` pode ser:

| Valor | Significado |
| --- | --- |
| `not_configured` | Nenhuma credencial de banco foi informada |
| `connected` | Banco configurado e respondendo |
| `disconnected` | Banco configurado, mas indisponível |

`status` e `api` indicam que o servidor está no ar, independentemente do banco. A resposta nunca inclui credenciais ou detalhes internos.

Rotas inexistentes retornam 404 e erros seguem o formato padrão:

```json
{ "status": "error", "error": { "code": "not_found", "message": "Route not found." } }
```

## Consulta de oportunidades

`GET /api/opportunities` lista as oportunidades com filtros, paginação e ordenação. Não exige autenticação nesta etapa (ver "Limitações conhecidas").

**Regra:** os dados oficiais vêm somente de `opportunities`. Filtros e ordenação usam apenas colunas dessa tabela. A última análise de `opportunity_analyses` aparece em `latest_analysis`, com `confirmed: false`, só para complementar a apresentação.

| Parâmetro | Coluna | Regra |
| --- | --- | --- |
| `category` | `opportunities.category` | Código exato (ex.: `grant`, `unclassified`) |
| `status` | `opportunities.status` | `unknown`, `upcoming`, `open`, `closed`, `suspended` ou `cancelled` |
| `institution` | `opportunities.institution` | Trecho, sem diferenciar maiúsculas (até 200 caracteres) |
| `page` | | Inteiro de 1 a 10000; padrão 1 |
| `page_size` | | 1 a 100; padrão 20 |
| `sort` | | `created_at` (padrão), `updated_at`, `title`, `deadline` ou `publication_date` |
| `order` | | `asc` ou `desc` (padrão); `NULL` sempre por último, desempate por `id` |

Parâmetro vazio equivale a ausente. Parâmetro desconhecido, repetido ou inválido retorna 400 `validation_error`.

Situação atual dos dados: o n8n grava toda oportunidade com `category = 'unclassified'` e `status = 'unknown'`, e as datas oficiais ficam `NULL` até haver revisão humana. Por isso `?category=grant` retorna 0 itens mesmo que a IA tenha sugerido `grant`. A instituição é a cópia provisória da análise enquanto `institution_verified_at` for `NULL`.

```powershell
Invoke-RestMethod "http://localhost:3001/api/opportunities?page_size=5"
Invoke-RestMethod "http://localhost:3001/api/opportunities?institution=finep&sort=title&order=asc"
curl.exe "http://localhost:3001/api/opportunities?status=unknown&page=2&page_size=10"
```

Resposta 200 (um item):

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "ced3c182-5b52-4b5a-8566-5c3d03c64f84",
        "title": "Edital Smoke",
        "title_verified_at": null,
        "institution": "FINEP",
        "institution_verified_at": null,
        "category": "unclassified",
        "category_name": "Não classificada",
        "category_verified_at": null,
        "status": "unknown",
        "publication_date": null,
        "opening_date": null,
        "deadline": null,
        "eligibility_verified_at": null,
        "source_name": "smoke",
        "source_url": null,
        "document_url": null,
        "created_at": "2026-11-25T23:48:18.991Z",
        "updated_at": "2026-11-25T23:48:18.991Z",
        "latest_analysis": {
          "confirmed": false,
          "id": "9c324512-e983-46f7-9bf3-b30ee19467c5",
          "analysis_status": "completed",
          "suggested_category": "grant",
          "opening_date": null,
          "closing_date": "2026-12-31",
          "model_name": "gemini-smoke",
          "analyzed_at": "2026-11-25T23:48:18.991Z"
        }
      }
    ],
    "pagination": { "page": 1, "page_size": 5, "total": 1, "total_pages": 1 }
  }
}
```

- `latest_analysis` é a análise mais recente (`created_at`), ou `null` se não houver. `suggested_category` e as datas dela são extração da IA, **não confirmadas**.
- Colunas `date` (`publication_date`, datas da análise) saem como `YYYY-MM-DD`; `timestamptz` saem em ISO 8601 (UTC).
- A consulta roda numa transação `READ ONLY`, com total e página lidos do mesmo estado do banco.
- Erros: 400 `validation_error`, 503 `database_not_configured`/`database_unavailable`, 500 `internal_error` (sem detalhes).

### Consulta individual: `GET /api/opportunities/:id`

Devolve uma oportunidade e, quando existir, a sua análise de IA mais recente. A resposta separa os dois blocos:

- `opportunity`: dados oficiais, somente de `opportunities`, com exatamente os mesmos campos de um item da listagem (sem `latest_analysis`).
- `latest_analysis`: a análise mais recente de `opportunity_analyses` (maior `created_at`, desempate por `id`), ou `null` se não houver. Sempre traz `"confirmed": false`. O histórico completo não é retornado.

| Campo de `latest_analysis` | Coluna | Tipo na resposta |
| --- | --- | --- |
| `confirmed` | (fixo) | `false` |
| `id`, `analysis_status`, `analysis_summary` | mesmas | texto |
| `suggested_category` | `opportunity_category` | código ou `null` |
| `title`, `institution`, `objective`, `observations` | mesmas | texto ou `null` |
| `opening_date`, `closing_date` | mesmas (`date`) | `YYYY-MM-DD` ou `null` |
| `target_audience`, `eligible_locations`, `required_documents`, `missing_information` | mesmas (`jsonb`) | array ou `null` |
| `requirements` | mesma (`jsonb`) | objeto (critérios de elegibilidade) ou `null` |
| `funding_amount` | mesma (`numeric(18,2)`) | número ou `null` |
| `funding_currency`, `counterpart_required` | mesmas | texto / booleano ou `null` |
| `source_references` | mesma (`jsonb`) | evidências por campo (`field`, `excerpt`, `basis`, `document_url`, `page`, `section`) ou `null` |
| `model_name`, `analyzed_at`, `created_at` | mesmas | texto / ISO 8601 |

`opportunities.description` não é exposta porque também não faz parte do contrato da listagem (o n8n não a preenche).

| Situação | HTTP | `error.code` |
| --- | --- | --- |
| Encontrada | 200 | |
| `id` não é UUID, ou query string enviada | 400 | `validation_error` |
| UUID válido inexistente | 404 | `opportunity_not_found` |
| Outro método (POST, PUT, PATCH, DELETE) | 404 | `not_found` |
| Banco não configurado / indisponível | 503 | `database_not_configured` / `database_unavailable` |
| Erro inesperado | 500 | `internal_error` |

```powershell
Invoke-RestMethod "http://localhost:3001/api/opportunities/1ebaeb92-c083-4907-a5c7-af63eb6c9be8" | ConvertTo-Json -Depth 8
```

As duas tabelas são consultadas separadamente, por `id` parametrizado, na mesma transação `READ ONLY`.

## Preparação para o Supabase

O módulo `src/database/connection.ts` concentra toda a conexão com o PostgreSQL:

- **Conexão preguiçosa:** o pool é criado na primeira necessidade e o servidor nunca depende do banco para iniciar.
- **`DATABASE_URL` tem prioridade.** Se estiver vazia, são usados `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` e `DB_PASSWORD`. O banco é considerado configurado com `DATABASE_URL` ou com host, nome e usuário.
- **SSL:** `DB_SSL=true` ativa SSL, necessário no Supabase.
- **Uso por outros módulos:** importe `query` de `database/connection`, sem conhecer os detalhes da conexão.
- **Logs seguros:** erros de banco registram apenas o tipo e o código, nunca a mensagem original.

Quando for conectar ao Supabase, copie a string de conexão do painel (Project Settings → Database), preencha `DATABASE_URL` e defina `DB_SSL=true`. Nenhuma alteração de código é necessária. Antes, aplique as migrations `001`, `002` e `003` (ver `database/README.md`).

## Integração com o n8n

O n8n envia à API o resultado estruturado da análise do Gemini. **O n8n não acessa o PostgreSQL**: toda leitura e escrita passa por este backend.

### Configuração

Defina `N8N_INTEGRATION_SECRET` no `.env` (mínimo de 32 caracteres, **obrigatória em produção**: o servidor não inicia sem ela). Sem a variável, o endpoint nega todas as requisições (503). Para gerar uma chave aleatória no PowerShell:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

Configure o mesmo valor no n8n como **credencial** do nó HTTP Request (nunca no fluxo versionado). O banco precisa estar configurado (`DATABASE_URL` ou `DB_*`) e com as migrations `001`, `002` **e `003`** aplicadas.

### Endpoint e autenticação

`POST /api/integrations/n8n/opportunities`

Headers: `Content-Type: application/json` e `x-integration-key: <N8N_INTEGRATION_SECRET>`.

A chave é comparada pelos hashes SHA-256 com `crypto.timingSafeEqual`. Sem chave ou com chave errada: `401`. Sem segredo configurado: `503` (fail closed).

### Dois contratos

| Contrato | Quem produz | Quem consome | Formato |
| --- | --- | --- | --- |
| **Saída do Gemini** | Gemini (resposta JSON com schema) | n8n | Cada campo é `{ "value": ..., "evidence": [...] }`, com evidências sem `field` nem URL |
| **Entrada da API** | n8n (nó Code) | Backend | Campos planos em `analysis` + `source_references[]` com `field` e `document_url` |

O backend **só** conhece o contrato de entrada e o valida de forma estrita (Zod, chaves desconhecidas rejeitadas). A saída do Gemini nunca é enviada diretamente à API.

### Contrato de saída do Gemini

Configure o nó do Gemini para responder **somente JSON** (`responseMimeType: application/json`, com `responseSchema` equivalente ao exemplo). Todo campo tem a mesma forma:

- `value`: o valor **já normalizado** para os códigos do contrato, ou `null` quando o documento não informa ou não permite classificar com segurança.
- `evidence`: lista de `{ "excerpt", "basis", "page"?, "section"? }`. `excerpt` é um trecho literal curto; `basis` é `stated` (o documento afirma expressamente) ou `inferred` (dedução).
- `source_text` (opcional): o texto em linguagem natural como aparece no edital, só para auditoria no n8n. **Não** é enviado à API.

```json
{
  "title": { "value": "Programa de Apoio a Startups 2026", "evidence": [{ "excerpt": "PROGRAMA DE APOIO A STARTUPS 2026", "basis": "stated", "page": 1 }] },
  "institution": { "value": "Fundação de Amparo à Pesquisa", "evidence": [{ "excerpt": "A Fundação de Amparo à Pesquisa torna público...", "basis": "stated", "page": 1 }] },
  "opportunity_category": { "value": "grant", "evidence": [{ "excerpt": "concessão de recursos de subvenção econômica", "basis": "stated", "page": 1 }] },
  "objective": { "value": "Apoiar startups em fase inicial.", "evidence": [{ "excerpt": "tem por objetivo apoiar startups em fase inicial", "basis": "stated", "page": 2 }] },
  "observations": { "value": "Submissões até 18h (horário de Brasília) do último dia.", "evidence": [{ "excerpt": "até as 18h (horário de Brasília)", "basis": "stated", "page": 5 }] },
  "opening_date": { "value": "2026-03-01", "evidence": [{ "excerpt": "Inscrições: 01/03/2026 a 30/04/2026", "basis": "stated", "page": 5 }] },
  "closing_date": { "value": "2026-04-30", "evidence": [{ "excerpt": "Inscrições: 01/03/2026 a 30/04/2026", "basis": "stated", "page": 5 }] },
  "target_audience": { "source_text": "Startups sediadas no Brasil", "value": ["startup"], "evidence": [{ "excerpt": "Poderão participar startups sediadas no Brasil", "basis": "stated", "page": 3 }] },
  "eligible_locations": { "source_text": "Sede no estado do Rio de Janeiro", "value": [{ "scope": "state", "state": "RJ" }], "evidence": [{ "excerpt": "com sede no estado do Rio de Janeiro", "basis": "stated", "page": 3 }] },
  "eligibility_criteria": {
    "segments": { "value": null, "evidence": [] },
    "business_sizes": { "value": ["micro", "small"], "evidence": [{ "excerpt": "microempresas e empresas de pequeno porte", "basis": "stated", "page": 3 }] },
    "organization_stages": { "value": null, "evidence": [] },
    "min_organization_age_months": { "value": null, "evidence": [] },
    "max_organization_age_months": { "value": 60, "evidence": [{ "excerpt": "constituídas há no máximo 5 anos", "basis": "stated", "page": 3 }] }
  },
  "required_documents": { "value": ["Plano de negócios", "Contrato social"], "evidence": [{ "excerpt": "plano de negócios e contrato social", "basis": "stated", "page": 4 }] },
  "funding_amount": { "value": 100000, "evidence": [{ "excerpt": "até R$ 100.000,00 por proposta", "basis": "stated", "page": 2 }] },
  "funding_currency": { "value": "BRL", "evidence": [{ "excerpt": "R$ 100.000,00", "basis": "inferred", "page": 2 }] },
  "counterpart_required": { "value": null, "evidence": [] },
  "missing_information": ["counterpart_required"]
}
```

Regras de normalização que o **prompt do Gemini** deve impor (o backend rejeita o que não as seguir):

| Campo | Regra |
| --- | --- |
| `opportunity_category` | Somente um código de `opportunity_categories`: `grant`, `financing`, `scholarship`, `acceleration`, `award`, `public_call`, `institutional`. Sem classificação segura: `null`. **Nunca** `unclassified` (marcador do banco) e nunca `institutional` como "padrão" para o desconhecido. |
| `target_audience` | Somente códigos de `profile_types` (`startup`, `company`, `individual_entrepreneur`, `researcher`, `student`, `individual`, `university`, `research_institution`, `nonprofit`, `other_institution`). "Startups sediadas no Brasil" → `["startup"]` só quando o documento permite identificar o código. Uma menção genérica a "empresas" **não** vira `company` automaticamente. |
| `eligibility_criteria.business_sizes` | Somente `mei`, `micro`, `small`, `medium`, `large`. |
| `eligibility_criteria.organization_stages` | snake_case. |
| `eligibility_criteria.*_age_months` | Inteiros em meses ("até 5 anos" → `max_organization_age_months: 60`). |
| `eligible_locations` | `{"scope":"national"}`, `{"scope":"state","state":"RJ"}` ou `{"scope":"city","state":"RJ","city":"Petrópolis"}`. |
| `opening_date`, `closing_date` | `YYYY-MM-DD`, sem horário. Horário-limite informado pelo edital vai em `observations`, com evidência. Data não informada: `null`. |
| `funding_amount` / `funding_currency` | Número (máx. 2 casas) e código ISO de 3 letras. Moeda nunca é presumida: se for deduzida de "R$", use `basis: "inferred"`. |
| Ausência | Informação ausente é `null`, **nunca** `[]`. Um edital que não cita restrições **não** é "aberto a todos": o critério fica `null` e, se relevante, entra em `missing_information`. |

### Transformação no n8n

Um nó **Code** entre o Gemini e o HTTP Request converte a saída do Gemini no contrato da API. A transformação é **mecânica**: não reclassifica, não completa valores e não altera `basis`.

1. Para cada campo com `value` diferente de `null`: copia o valor para `analysis.<campo>` e converte cada evidência em uma referência com `field` = nome do campo (`eligibility_criteria.<chave>` → `requirements.<chave>`) e `document_url` = URL do documento analisado (conhecida pelo n8n; `null` para documento sem URL pública).
2. Campo com `value: null`: envia `null` e descarta as evidências (campo ausente não tem referência).
3. Campo com valor e **sem** evidência: envia o valor sem referência. O backend registra a análise como `needs_review` (nunca se fabrica uma referência).
4. Descarta `source_text`.
5. Acrescenta `source` (identificação na fonte), `model_name` (identificador real do modelo) e `analyzed_at`.

Exemplo do nó Code (verificado em Node.js contra o schema da API com o JSON acima; o resultado é aceito e fica `needs_review` porque `funding_currency` só tem evidência `inferred`):

```js
function toApiPayload(gemini, ctx) {
  const SIMPLE = [
    "title", "institution", "opportunity_category", "objective", "observations",
    "opening_date", "closing_date", "target_audience", "eligible_locations",
    "required_documents", "funding_amount", "funding_currency", "counterpart_required",
  ];
  const analysis = {};
  const source_references = [];

  const take = (entry, field) => {
    if (!entry || entry.value === null || entry.value === undefined) return null; // ausente: sem referência
    for (const ev of entry.evidence ?? []) {
      source_references.push({
        field,
        document_url: ctx.document_url ?? null,
        excerpt: ev.excerpt,
        basis: ev.basis,
        ...(ev.page != null ? { page: ev.page } : {}),
        ...(ev.section != null ? { section: ev.section } : {}),
      });
    }
    return entry.value;
  };

  for (const key of SIMPLE) {
    analysis[key] = take(gemini[key], key);
  }
  const criteria = {};
  for (const [key, entry] of Object.entries(gemini.eligibility_criteria ?? {})) {
    criteria[key] = take(entry, `requirements.${key}`);
  }
  analysis.eligibility_criteria = Object.values(criteria).some((v) => v !== null) ? criteria : null;
  analysis.source_references = source_references.length > 0 ? source_references : null;
  analysis.missing_information = gemini.missing_information ?? null;

  return {
    source: { source_name: ctx.source_name, external_id: ctx.external_id ?? null, source_url: ctx.source_url ?? null },
    model_name: ctx.model_name,
    analyzed_at: ctx.analyzed_at,
    analysis,
  };
}
module.exports = { toApiPayload };

// No n8n: ajuste os nomes dos nós e campos conforme o seu fluxo.
return [{ json: toApiPayload($json.gemini, {
  source_name: "nome-estavel-da-fonte",
  external_id: $json.edital_id ?? null,
  source_url: $json.page_url ?? null,
  document_url: $json.pdf_url ?? null,
  model_name: "gemini-2.5-flash-lite",
  analyzed_at: new Date().toISOString(),
}) }];
```

### Contrato de entrada da API

```json
{
  "source": {
    "source_name": "finep",
    "external_id": "EDITAL-2026-01",
    "source_url": "https://www.finep.gov.br/edital/1"
  },
  "model_name": "gemini-2.5-flash-lite",
  "analyzed_at": "2026-11-24T12:00:00Z",
  "analysis": {
    "title": "Edital de Inovação",
    "institution": "Finep",
    "opportunity_category": "grant",
    "objective": "Apoiar projetos de inovação.",
    "observations": "Prazo sujeito a prorrogação.",
    "opening_date": "2026-03-01",
    "closing_date": "2026-04-30",
    "target_audience": ["startup", "company"],
    "eligibility_criteria": { "business_sizes": ["micro", "small"], "min_organization_age_months": 6 },
    "eligible_locations": null,
    "funding_amount": 500000,
    "funding_currency": "BRL",
    "required_documents": ["Plano de negócios"],
    "counterpart_required": false,
    "source_references": [
      { "field": "title", "document_url": "https://www.finep.gov.br/edital/1.pdf", "excerpt": "EDITAL DE INOVAÇÃO", "basis": "stated", "page": 1 },
      { "field": "closing_date", "document_url": "https://www.finep.gov.br/edital/1.pdf", "excerpt": "até 30/04/2026", "basis": "stated", "page": 5, "section": "6" },
      { "field": "target_audience", "document_url": null, "excerpt": "Podem participar startups e empresas.", "basis": "stated", "page": 3, "section": "2.1" }
    ],
    "missing_information": ["eligible_locations"]
  }
}
```

Neste exemplo resumido só `title`, `closing_date` e `target_audience` têm referência, então a análise seria gravada como `needs_review` (os demais campos extraídos ficariam em `review.fields_without_reference`). Para `completed`, cada campo não nulo precisa da sua referência `stated`.

O formato é **estrito**: chaves desconhecidas são rejeitadas (400). `null` equivale a campo ausente.

| Campo | Regra |
| --- | --- |
| `source.source_name` | Obrigatório. Identificador estável da fonte. |
| `source.external_id` / `source.source_url` | Pelo menos um é obrigatório (identificam a oportunidade). `source_url` deve ser http/https. |
| `model_name` | Obrigatório. Gravado na análise. |
| `analyzed_at` | Opcional (ISO 8601 com fuso). Padrão: momento do recebimento. |
| `analysis.title` | **Obrigatório.** Usado como identificação provisória quando a oportunidade é criada. |
| `analysis.institution`, `objective`, `observations` | Opcionais (texto). Vazios viram `null`. |
| `analysis.opportunity_category` | Opcional. Código **sugerido** de `opportunity_categories`, existente e ativo. `null` = sem classificação segura. `unclassified` é rejeitado (400). |
| `analysis.opening_date`, `closing_date` | Opcionais. Somente `YYYY-MM-DD` (data de calendário válida, sem horário). `closing_date` não pode ser anterior a `opening_date`. |
| `analysis.target_audience` | Códigos de `profile_types`, todos existentes e ativos. |
| `analysis.eligibility_criteria` | Chaves opcionais `segments`, `business_sizes` (`mei`, `micro`, `small`, `medium`, `large`), `organization_stages` (snake_case), `min_organization_age_months`, `max_organization_age_months`. Gravado como `requirements`. |
| `analysis.eligible_locations` | Itens `national`, `state` ou `city`, com propriedades compatíveis com o escopo. |
| `analysis.funding_amount` / `funding_currency` | Número ≥ 0 com no máximo 2 casas. Moeda (3 letras) obrigatória quando há valor. |
| `analysis.required_documents`, `missing_information` | Listas de textos. `missing_information: []` ("nada ausente") é preservado. |
| `analysis.source_references[]` | Ver "Referências e rastreabilidade". |

Listas vazias em critérios (`[]`) são tratadas como **não informado** e gravadas como `NULL`, nunca como "sem restrição".

### Referências e rastreabilidade

Cada referência tem exatamente: `field`, `excerpt` (até 500 caracteres), `basis` (`stated` ou `inferred`), `document_url` (URL http/https, `null` ou ausente) e, opcionalmente, `page` (inteiro ≥ 1) e `section`.

Valores aceitos em `field`:

- Identificação e conteúdo (migration `003`): `title`, `institution`, `opportunity_category`, `objective`, `observations`, `opening_date`, `closing_date`.
- Critérios e valores: `target_audience`, `eligible_locations`, `required_documents`, `funding_amount`, `funding_currency`, `counterpart_required`, `requirements.segments`, `requirements.business_sizes`, `requirements.organization_stages`, `requirements.min_organization_age_months`, `requirements.max_organization_age_months`.

**Cada campo extraído e não nulo precisa da sua própria referência.** A referência de um campo nunca vale para outro (`funding_currency` precisa da sua, mesmo que `funding_amount` tenha a dele; `closing_date` não é coberto por `opening_date`). Uma referência a um campo ausente é aceita e gravada, mas não altera o status.

### Status `completed` e `needs_review`

| Status | Quando |
| --- | --- |
| `completed` | **Todos** os campos extraídos e não nulos (inclusive `title`, que é sempre extraído) têm ao menos uma referência própria com `basis = "stated"`. |
| `needs_review` | Algum campo extraído não tem referência própria (`review.fields_without_reference`) ou só tem referências `inferred` (`review.fields_inferred_only`). |

Dados `inferred` nunca são tratados como confirmados. A regra é aplicada no serviço **e** no banco (constraint `opportunity_analyses_completed_requires_stated_references`, migration `003`): uma análise `completed` que a viole é recusada pelo PostgreSQL.

### O que a API grava

| Origem | Destino |
| --- | --- |
| `source_name`, `external_id`, `source_url` | `opportunities` (identidade e deduplicação) |
| `title`, `institution` | `opportunities` **somente ao criar**, como identificação **provisória** (`title_verified_at` e `institution_verified_at` `NULL`, `identification_analysis_id` = análise de origem). Sempre também em `opportunity_analyses` |
| `opportunity_category` | **Somente** `opportunity_analyses` (sugestão). A oportunidade criada recebe `category = 'unclassified'` e `category_verified_at = NULL` |
| `objective`, `observations`, `opening_date`, `closing_date` | `opportunity_analyses` (colunas próprias; datas como `date`) |
| `target_audience`, `eligibility_criteria` (→ `requirements`), `eligible_locations`, `required_documents`, `funding_amount`, `funding_currency`, `counterpart_required`, `missing_information`, `source_references` | `opportunity_analyses` |
| status calculado, `model_name`, `analyzed_at` | `opportunity_analyses` |

Regras:

- **Nada é promovido.** Nenhum critério de elegibilidade, valor, data (`opening_date`, `deadline`), status, categoria ou `eligibility_verified_at` é gravado em `opportunities`. A compatibilidade, quando existir, não deve usar título, instituição ou categoria enquanto os respectivos `*_verified_at` forem `NULL`.
- **Oportunidade existente nunca é alterada.** A API não faz `UPDATE` em `opportunities`. Uma nova análise da mesma oportunidade entra no histórico, com o título, a instituição e a categoria que a IA extraiu dessa vez.
- **Datas.** `opening_date` → `opportunity_analyses.opening_date`; `closing_date` → `opportunity_analyses.closing_date`. Nenhum horário é inventado. A conversão para `timestamptz` (`opportunities.opening_date`/`deadline`) fica para a futura validação humana, com convenção explícita do backend em `America/Sao_Paulo`.
- **Transação.** Todas as operações de uma requisição ocorrem em uma única transação: qualquer falha desfaz tudo, inclusive a oportunidade recém-criada.

### Categoria `unclassified`

`unclassified` é uma linha de `opportunity_categories` criada pela migration `003` apenas porque `opportunities.category` é obrigatória (`NOT NULL` + FK). Significa "ainda sem categoria confirmada", **não** é uma classificação:

- é usada pelo backend em toda oportunidade criada pela integração;
- nunca é aceita como sugestão da IA (rejeitada pelo Zod e por constraint);
- não pode ter `category_verified_at` preenchido (constraint);
- não deve ser exibida como categoria confirmada (o frontend deve mostrá-la como "não classificada").

### Deduplicação

A oportunidade é identificada por `(source_name, external_id)` ou, sem `external_id`, por `(source_name, source_url)`, os mesmos índices únicos parciais da migration `001`. A busca e a criação ocorrem sob `pg_advisory_xact_lock` com uma chave derivada da identidade, e o `INSERT` usa `ON CONFLICT DO NOTHING`; requisições simultâneas para a mesma oportunidade não geram duplicidade (verificado com 6 requisições paralelas no teste de integração).

### Idempotência

`opportunity_analyses` é um histórico sem chave natural. Uma análise só é considerada **a mesma** quando, para a mesma oportunidade, **todas** as colunas de conteúdo são iguais (`IS NOT DISTINCT FROM`): `model_name`, `title`, `institution`, `opportunity_category`, `objective`, `observations`, `opening_date`, `closing_date`, `target_audience`, `requirements`, `eligible_locations`, `required_documents`, `funding_amount`, `funding_currency`, `counterpart_required`, `missing_information` e `source_references`. Nesse caso a resposta traz `already_registered` e nada é gravado.

- Qualquer mudança, inclusive só de procedência (`basis`, trecho, página, URL) ou de uma data, gera uma **nova** análise.
- `analyzed_at` não faz parte da comparação: é metadado da execução. Reprocessar o mesmo edital com resultado idêntico não cria linhas repetidas.
- Análises gravadas pela Etapa 3.1 (com `analysis_summary` preenchido e sem as colunas da `003`) nunca são consideradas equivalentes: reenviar o mesmo edital depois da `003` grava a versão completa.
- A ordem das referências conta (arrays JSON são comparados em ordem). Mantenha a ordem estável no n8n.

### Respostas

Sucesso (`201` se algo foi criado, `200` se tudo já estava registrado):

```json
{
  "success": true,
  "data": {
    "opportunity": { "id": "…", "action": "created" },
    "analysis": { "id": "…", "action": "created", "status": "needs_review" },
    "review": { "fields_without_reference": ["institution"], "fields_inferred_only": [] }
  }
}
```

`opportunity.action`: `created` ou `unchanged`. `analysis.action`: `created` ou `already_registered`. O campo `not_persisted` da Etapa 3.1 foi removido: desde a `003` tudo o que é recebido fica no histórico da análise.

Erros (`success: false`, sem stack trace, credenciais ou detalhes do banco):

| Status | `error.code` | Quando |
| --- | --- | --- |
| 400 | `validation_error`, `invalid_json` | Payload fora do formato (com `details` por campo) |
| 401 | `unauthorized` | Chave ausente ou inválida |
| 409 | `conflict` | Conflito que não pôde ser resolvido |
| 422 | `unknown_opportunity_category`, `unknown_target_audience`, `data_rejected` | Código inexistente ou inativo; dado recusado pelo banco |
| 503 | `integration_not_configured`, `database_not_configured`, `database_unavailable` | Segredo ou banco não configurado ou indisponível |
| 500 | `internal_error` | Erro inesperado |

### Testar a integração por PowerShell

Com o banco configurado (migrations `001` a `003`) e o servidor em execução (`npm run dev`):

```powershell
$secret = "COLE_AQUI_O_VALOR_DE_N8N_INTEGRATION_SECRET"
$uri = "http://localhost:3001/api/integrations/n8n/opportunities"

function Send-Analysis([string]$json, [hashtable]$headers = @{ "x-integration-key" = $secret }) {
  try {
    Invoke-RestMethod -Method Post -Uri $uri -Headers $headers `
      -ContentType "application/json; charset=utf-8" `
      -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) | ConvertTo-Json -Depth 10
  } catch {
    "$($_.Exception.Response.StatusCode.value__) $($_.ErrorDetails.Message)"
  }
}

$body = @'
{
  "source": { "source_name": "teste-manual", "external_id": "EDITAL-001" },
  "model_name": "gemini-teste",
  "analysis": {
    "title": "Edital de Teste",
    "opportunity_category": "grant",
    "closing_date": "2026-04-30",
    "target_audience": ["startup"],
    "source_references": [
      { "field": "title", "excerpt": "EDITAL DE TESTE", "basis": "stated" },
      { "field": "opportunity_category", "excerpt": "subvenção econômica", "basis": "stated" },
      { "field": "closing_date", "excerpt": "até 30/04/2026", "basis": "stated" },
      { "field": "target_audience", "document_url": null, "excerpt": "Podem participar startups.", "basis": "stated" }
    ]
  }
}
'@

Send-Analysis $body                                   # 1
Send-Analysis $body                                   # 2
Send-Analysis $body @{}                               # 3
Send-Analysis ($body -replace '"2026-04-30"', '"2026-05-15"' -replace 'até 30/04/2026', 'até 15/05/2026')   # 4
Send-Analysis ($body -replace 'startups\.", "basis": "stated"', 'startups.", "basis": "inferred"')   # 5
Send-Analysis ($body -replace '"grant"', '"unclassified"')   # 6
```

Esperado:

1. `opportunity.action = created`, `analysis.status = completed`.
2. Mesmos ids, `opportunity.action = unchanged`, `analysis.action = already_registered` (status `200`).
3. `401 unauthorized`.
4. Nova análise (`analysis.action = created`); a oportunidade continua `unchanged`.
5. Nova análise com `status = needs_review` e `fields_inferred_only = ["target_audience"]`.
6. `400 validation_error` em `analysis.opportunity_category`.

Conferir no banco (Docker do `database/README.md`):

```powershell
docker exec edital-pg psql -U postgres -c "SELECT title, category, status, title_verified_at, category_verified_at, eligibility_verified_at, deadline, identification_analysis_id FROM opportunities WHERE source_name = 'teste-manual';"
docker exec edital-pg psql -U postgres -c "SELECT title, opportunity_category, closing_date, analysis_status FROM opportunity_analyses a JOIN opportunities o ON o.id = a.opportunity_id WHERE o.source_name = 'teste-manual' ORDER BY a.created_at;"
```

Esperado: em `opportunities`, `category = unclassified`, `status = unknown` e todos os `*_verified_at` e `deadline` vazios; em `opportunity_analyses`, uma linha por análise, com a categoria sugerida (`grant`) e `closing_date` como data.

No n8n, configure o nó **HTTP Request** com método `POST`, a URL acima, o header `x-integration-key` (a partir de uma credencial) e o corpo gerado pelo nó Code.

### Segurança da integração

- A chave é comparada pelos hashes SHA-256 com `crypto.timingSafeEqual` (tempo constante, sem vazar o tamanho). Ela não é registrada em logs nem retornada, e não existe valor padrão no código.
- Sem segredo configurado, a rota nega tudo; em produção o servidor não inicia sem ele.
- O texto integral do edital **não faz parte do contrato** e não é gravado nem registrado. Os logs não incluem o corpo das requisições.
- A API não expõe mensagens do PostgreSQL, nomes de constraints, tabelas ou valores nas respostas de erro.
- O frontend não deve conhecer a chave. Ela fica apenas no n8n (credencial) e no servidor.

## Banco de dados

O esquema SQL está em `database/migrations/`. Consulte [`database/README.md`](database/README.md) para o modelo de dados, a migration `003`, os testes SQL, a execução no Supabase e a configuração de segurança (RLS e privilégios), **obrigatória antes de inserir dados reais**. Nenhuma migration é executada automaticamente.

### Migration 003 (resumo)

`003_analysis_provenance_and_dates.sql` é incremental e transacional, não altera a `001` nem a `002` e não modifica linhas existentes:

- `opportunity_analyses`: novas colunas `title`, `institution`, `opportunity_category` (FK), `objective`, `observations`, `opening_date` e `closing_date` (`date`); constraint de análise `completed` com referência `stated` própria por campo.
- `opportunities`: `title_verified_at`, `institution_verified_at`, `category_verified_at` e `identification_analysis_id` (FK composta para a análise de origem, da mesma oportunidade).
- `opportunity_categories`: categoria operacional `unclassified`.

## Limitações conhecidas

- **Promoção e revisão humana** ainda não existem: nada sai de `opportunity_analyses` para os campos confirmados de `opportunities`, e nenhum `*_verified_at` é preenchido pela aplicação.
- **Horário-limite** do edital não tem coluna estruturada: fica em `observations` (com referência). As datas são somente `date`.
- **Título obrigatório:** uma análise sem título é rejeitada (400), pois a criação exige identificação provisória.
- **Idempotência** é garantida pelo advisory lock + comparação de colunas, não por índice único no banco. Comparação de `source_references` é sensível à ordem.
- **Cidades** em `eligible_locations` não são validadas contra a lista do IBGE (só UF e texto não vazio).
- O fluxo do n8n e o prompt do Gemini não estão versionados neste repositório; o contrato acima é a referência para montá-los.
- **Consulta sem autenticação:** `GET /api/opportunities` e `GET /api/opportunities/:id` são públicos e o CORS está aberto. Antes de publicar fora do ambiente local, definir autenticação/CORS e, no Supabase, RLS.
- **Histórico de análises** não é exposto pela API: a consulta individual traz só a mais recente.
