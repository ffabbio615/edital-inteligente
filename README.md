# Edital Inteligente

Plataforma de identificação, organização, análise e recomendação de oportunidades públicas e privadas no Brasil, incluindo editais, chamadas públicas, bolsas, financiamentos, premiações e programas de aceleração.

Este documento apresenta os procedimentos para configurar e executar o projeto localmente, incluindo backend, frontend, PostgreSQL, Docker e n8n.

---

## 1. Visão geral da arquitetura

O projeto possui quatro componentes principais:

| Componente | Responsabilidade |
|---|---|
| Backend | API REST, regras de negócio, persistência e integração com o n8n |
| Frontend | Interface de consulta e visualização das oportunidades |
| PostgreSQL | Armazenamento das oportunidades e do histórico de análises |
| n8n | Automação da coleta, processamento e envio de oportunidades para a API |

O Gemini é utilizado no processo de análise dos documentos e das oportunidades.

### Tecnologias

- Node.js
- TypeScript
- Express
- React
- Vite
- Sass
- PostgreSQL 15
- Docker
- n8n
- Gemini

### Portas locais

| Serviço | Porta |
|---|---:|
| Backend | 3001 |
| Frontend | 5173 (padrão Vite; confirmar configuração local) |
| PostgreSQL | 5433 no computador / 5432 no container |
| n8n | 5678 |

---

## 2. Pré-requisitos

Instale os seguintes programas antes de iniciar:

### 2.1. Node.js e npm

Instale uma versão LTS do Node.js.

Download: https://nodejs.org/

O npm é instalado junto com o Node.js.

Verifique a instalação:

```bash
node -v
npm -v
```

### 2.2. Git

Download: https://git-scm.com/

Verifique:

```bash
git --version
```

### 2.3. Docker Desktop

O Docker será utilizado para executar o PostgreSQL e, quando necessário, o n8n.

Download: https://www.docker.com/products/docker-desktop/

Após instalar, abra o Docker Desktop e aguarde o serviço ficar disponível.

Verifique:

```bash
docker --version
docker compose version
```

### 2.4. PostgreSQL

Não é necessário instalar o PostgreSQL diretamente no Windows quando ele for executado pelo Docker.

O banco utilizado pelo projeto será PostgreSQL 15 dentro de um container.

Para consultas e administração, recomenda-se instalar também um cliente como:

- DBeaver: https://dbeaver.io/
- pgAdmin: https://www.pgadmin.org/

### 2.5. n8n

O n8n pode ser executado localmente pelo Docker.

A interface de administração estará disponível em:

http://localhost:5678

---

## 3. Obter o projeto

Clone o repositório:

```bash
git clone URL_DO_REPOSITORIO
```

Entre na pasta:

```bash
cd edital-inteligente
```

A estrutura principal esperada é:

```text
edital-inteligente/
├── backend/
├── frontend/
├── README.md
└── ...
```

A estrutura pode conter outros diretórios e arquivos de configuração.

Não versionar arquivos `.env`, credenciais, senhas ou chaves de integração.

---

## 4. Configuração do PostgreSQL com Docker

### 4.1. Criar o volume persistente

O volume garante que os dados do PostgreSQL não sejam perdidos quando o container for removido.

```bash
docker volume create edital-pg-data
```

### 4.2. Criar o container

Execute:

```bash
docker run -d \
  --name edital-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=SUA_SENHA \
  -e POSTGRES_DB=postgres \
  -p 5433:5432 \
  -v edital-pg-data:/var/lib/postgresql/data \
  postgres:15
```

Substitua `SUA_SENHA` por uma senha própria.

No Windows, o comando pode ser executado no Git Bash, PowerShell ou terminal compatível, ajustando a sintaxe de quebra de linha conforme o terminal.

**Importante:** se já existir um container chamado `edital-pg`, não execute novamente o comando de criação. Verifique primeiro o container existente.

### 4.3. Verificar o container

```bash
docker ps
```

O container `edital-pg` deve aparecer como ativo.

Para consultar os logs:

```bash
docker logs edital-pg
```

### 4.4. Verificar os bancos existentes

```bash
docker exec -it edital-pg psql -U postgres -l
```

O banco utilizado pela aplicação é:

```text
postgres
```

O banco `edital_test`, quando utilizado, deve permanecer separado e destinado exclusivamente a testes.

Não confundir o banco principal `postgres` com o banco de testes.

### 4.5. Acessar o PostgreSQL

Para abrir o terminal SQL:

```bash
docker exec -it edital-pg psql -U postgres -d postgres
```

Para sair:

```sql
\q
```

### 4.6. Parar e iniciar o PostgreSQL

Parar:

```bash
docker stop edital-pg
```

Iniciar novamente:

```bash
docker start edital-pg
```

Os dados permanecem armazenados no volume Docker.

**Atenção:** não remova o volume `edital-pg-data` durante a manutenção normal. A remoção do volume pode apagar permanentemente os dados armazenados.

---

## 5. Configuração do backend

O backend é responsável pela API REST, integração com o n8n, regras de negócio e acesso ao PostgreSQL.

### 5.1. Entrar na pasta

```bash
cd backend
```

### 5.2. Instalar dependências

```bash
npm install
```

### 5.3. Configurar variáveis de ambiente

Crie o arquivo:

```text
backend/.env
```

Utilize a estrutura abaixo como referência:

```env
NODE_ENV=development
PORT=3001

DATABASE_URL=postgresql://postgres:SUA_SENHA@localhost:5433/postgres

N8N_INTEGRATION_SECRET=COLOQUE_UMA_CHAVE_SEGURA_AQUI
```

Os nomes e valores devem ser compatíveis com o arquivo de configuração de ambiente e com o código atual do backend.

Não compartilhe esse arquivo e não o envie para o Git.

### 5.4. Gerar o N8N_INTEGRATION_SECRET

Essa variável representa o segredo compartilhado entre o n8n e o backend.

Ela é utilizada para proteger os endpoints de integração.

Gere uma chave aleatória forte.

Uma maneira de gerar pelo Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

O resultado será uma chave hexadecimal aleatória.

Copie o valor gerado para:

```env
N8N_INTEGRATION_SECRET=CHAVE_GERADA
```

O mesmo valor deverá ser configurado no n8n.

**Regras de segurança:**

- Não utilize uma chave simples ou previsível.
- Não publique o segredo no GitHub.
- Não coloque o segredo no frontend.
- Não utilize o mesmo segredo em ambientes de produção e desenvolvimento.
- Não compartilhe o segredo em capturas de tela ou documentos públicos.

### 5.5. Banco de dados e migrations

O projeto utiliza migrations SQL para estruturar o banco.

As migrations existentes devem ser executadas na ordem numérica, respeitando as dependências entre elas.

Antes de executar qualquer migration:

1. Confirme que o container PostgreSQL está ativo.
2. Confirme que a variável `DATABASE_URL` aponta para o banco correto.
3. Confirme se o banco já possui as migrations aplicadas.
4. Faça backup antes de alterar um banco com dados existentes.

Não execute migrations de inicialização sobre o banco principal sem verificar previamente o estado da estrutura.

Consulte os scripts disponíveis:

```bash
npm run
```

Execute o comando de migration somente se ele estiver definido no `package.json` do backend.

Se o projeto ainda não possuir um script de execução de migrations, a aplicação desse processo deverá seguir o procedimento SQL documentado no próprio projeto.

### 5.6. Iniciar o backend

Consulte os scripts disponíveis:

```bash
npm run
```

Execute o script de desenvolvimento definido no `package.json`, normalmente:

```bash
npm run dev
```

A API deverá ficar disponível em:

```text
http://localhost:3001
```

A rota de saúde, caso esteja implementada, pode ser utilizada para verificar se a aplicação está respondendo.

---

## 6. Configuração do frontend

O frontend utiliza React, TypeScript, Vite e Sass.

### 6.1. Entrar na pasta

Em outro terminal:

```bash
cd frontend
```

### 6.2. Instalar dependências

```bash
npm install
```

### 6.3. Configurar a URL da API

Verifique se o frontend possui arquivo `.env.example` ou documentação de variáveis de ambiente.

Se houver uma variável para endereço da API, configure-a no arquivo:

```text
frontend/.env
```

Exemplo ilustrativo:

```env
VITE_API_URL=http://localhost:3001/api
```

O nome da variável deve corresponder ao que o código realmente utiliza. Não crie variáveis diferentes das esperadas pela aplicação.

Variáveis com prefixo `VITE_` são incorporadas ao código disponibilizado no navegador. Portanto, nunca coloque senhas, tokens privados ou `N8N_INTEGRATION_SECRET` no frontend.

### 6.4. Iniciar o frontend

```bash
npm run dev
```

O Vite informará no terminal o endereço local da aplicação, normalmente:

```text
http://localhost:5173
```

Abra o endereço exibido no navegador.

### 6.5. Gerar build de produção

```bash
npm run build
```

Para verificar erros de TypeScript, utilize o script correspondente disponível no `package.json`.

---

## 7. Configuração do n8n local

O n8n executa os workflows responsáveis pela coleta e processamento das oportunidades.

### 7.1. Criar um volume persistente

```bash
docker volume create edital-n8n-data
```

### 7.2. Executar o n8n pelo Docker

```bash
docker run -d \
  --name edital-n8n \
  -p 5678:5678 \
  -v edital-n8n-data:/home/node/.n8n \
  n8nio/n8n
```

Se já existir um container `edital-n8n`, utilize-o em vez de criar outro.

Acesse:

```text
http://localhost:5678
```

Na primeira execução, siga as instruções do n8n para configurar o acesso local.

O volume persistente mantém os workflows e as configurações do n8n entre reinicializações.

### 7.3. Importar workflows exportados

Os workflows exportados do n8n normalmente são arquivos `.json`.

Para importar:

1. Abra o n8n em `http://localhost:5678`.
2. Entre na área de workflows.
3. Utilize a opção de importação, como **Import from File** ou a opção equivalente disponível na versão instalada.
4. Selecione o arquivo `.json` exportado.
5. Aguarde a abertura do workflow.
6. Confira os nodes, conexões e configurações.
7. Salve o workflow.

Se houver vários arquivos exportados, importe cada workflow separadamente.

**Importante:** importar o JSON não garante que todas as credenciais estejam configuradas.

### 7.4. Reconfigurar credenciais

Após importar:

1. Abra os nodes que utilizam credenciais.
2. Verifique quais credenciais estão ausentes.
3. Crie ou selecione as credenciais correspondentes no n8n.
4. Configure novamente as chaves de API necessárias, incluindo a chave do Gemini, se utilizada pelo workflow.
5. Salve as alterações.

Credenciais e segredos não devem ser considerados automaticamente disponíveis só porque o workflow foi exportado.

Não coloque senhas ou chaves privadas diretamente em campos de texto dos nodes quando houver suporte a credenciais próprias do n8n.

### 7.5. Configurar a integração com o backend

O workflow deverá enviar as requisições para o backend local.

A URL-base da API é:

```text
http://localhost:3001/api
```

O endpoint de integração utilizado atualmente é:

```text
POST /api/integrations/n8n/opportunities
```

Portanto, a URL completa é:

```text
http://localhost:3001/api/integrations/n8n/opportunities
```

O endpoint utiliza autenticação por segredo compartilhado.

Configure no node HTTP Request o mesmo valor definido no backend:

```env
N8N_INTEGRATION_SECRET=CHAVE_GERADA
```

O nome exato do header deve ser conferido no middleware de autenticação do backend. Não presuma que o nome do header é igual ao nome da variável de ambiente.

**Atenção à comunicação entre containers:**

- Se o n8n estiver sendo executado diretamente no computador, `localhost:3001` normalmente alcança o backend local.
- Se o n8n estiver dentro de um container Docker, `localhost` aponta para o próprio container, não para o computador host.
- Nesse segundo cenário, utilize o endereço de host apropriado para o sistema operacional, como `host.docker.internal:3001`, desde que a configuração de rede permita essa comunicação.

Não confunda a URL acessada pelo navegador com a URL que deve ser utilizada entre containers.

### 7.6. Conferir os workflows importados

Antes de executar qualquer workflow:

- Confirme a URL do backend.
- Confirme a autenticação da integração.
- Confirme as credenciais do Gemini.
- Confira os nodes HTTP Request.
- Confira os parâmetros de entrada e saída.
- Confira se os dados enviados seguem o contrato atual da API.
- Verifique se o workflow utiliza a fonte correta.
- Verifique se os nodes de coleta e processamento estão conectados corretamente.

Não ative agendamentos automáticos antes de validar a execução manual.

---

## 8. Executar o ambiente completo

Depois de concluir as configurações iniciais, a inicialização local pode seguir esta ordem:

### Terminal 1 — PostgreSQL

```bash
docker start edital-pg
```

Se o container ainda não existir, siga o procedimento de criação da seção 4.

### Terminal 2 — Backend

```bash
cd backend
npm run dev
```

### Terminal 3 — Frontend

```bash
cd frontend
npm run dev
```

### Terminal 4 — n8n

```bash
docker start edital-n8n
```

Se o container ainda não existir, siga o procedimento de criação da seção 7.

Acesse:

| Serviço | Endereço |
|---|---|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:3001 |
| n8n | http://localhost:5678 |
| PostgreSQL | localhost:5433 |

---

## 9. Fluxo de funcionamento da integração

O fluxo atual de integração funciona conceitualmente da seguinte maneira:

```text
Fonte institucional
        |
        v
Workflow de coleta no n8n
        |
        v
Extração dos dados do edital
        |
        v
Análise com Gemini
        |
        v
Envio dos dados para o backend
        |
        v
Validação do contrato da API
        |
        v
Persistência no PostgreSQL
        |
        v
Consulta pelo frontend
```

O backend mantém separadas as informações oficiais da oportunidade e as informações produzidas pela inteligência artificial.

As análises são armazenadas em histórico próprio, sem substituir automaticamente os dados oficiais.

O frontend consulta a API e apresenta as oportunidades e suas análises.

---

## 10. Estrutura de dados e preservação do histórico

O banco utiliza, entre outras, as seguintes tabelas:

| Tabela | Responsabilidade |
|---|---|
| `opportunities` | Cadastro das oportunidades e informações oficiais |
| `opportunity_analyses` | Histórico de análises produzidas pela IA |

As análises são preservadas separadamente dos dados oficiais.

A aplicação não deve apagar ou substituir análises antigas durante uma nova coleta.

Antes de realizar mudanças estruturais:

1. Faça backup do banco.
2. Verifique as migrations aplicadas.
3. Confirme o banco de destino.
4. Preserve os registros existentes.
5. Execute os testes em banco separado antes de aplicar mudanças ao banco principal.

---

## 11. Backup do PostgreSQL

Para gerar um backup:

```bash
docker exec edital-pg pg_dump -U postgres -d postgres -Fc -f /tmp/edital-backup.dump
```

Copie o arquivo para o computador:

```bash
docker cp edital-pg:/tmp/edital-backup.dump ./edital-backup.dump
```

Guarde o backup em local seguro e fora do controle de versão.

Para restaurar em um banco de homologação, crie primeiro um banco separado e utilize `pg_restore`, apontando explicitamente para esse banco.

Não restaure um backup sobre o banco principal sem um procedimento de recuperação planejado.

---

## 12. Problemas comuns

### PostgreSQL não conecta

Verifique:

```bash
docker ps
```

Confirme se o container está ativo e se a porta 5433 está disponível.

Confira também a variável `DATABASE_URL`.

### Backend não inicia

Verifique:

- Dependências instaladas.
- Arquivo `.env`.
- Conexão com PostgreSQL.
- Porta 3001.
- Scripts disponíveis no `package.json`.

### Frontend não consegue acessar a API

Verifique:

- Backend ativo.
- URL da API.
- Variável de ambiente esperada pelo frontend.
- Configuração de CORS do backend.

### n8n não consegue acessar o backend

Se o n8n estiver em Docker, confira se o endereço utilizado no node HTTP Request aponta para o host correto.

Confira também:

- Porta 3001.
- Autenticação.
- Header de integração.
- Valor de `N8N_INTEGRATION_SECRET`.

### Workflow importado apresenta erro

Verifique se:

- As credenciais foram reconfiguradas.
- Os nodes utilizados existem na versão instalada do n8n.
- As URLs estão corretas.
- As variáveis de ambiente necessárias estão configuradas.
- Os parâmetros enviados correspondem ao contrato atual do backend.

---

## 13. Segurança e boas práticas

- Nunca versionar arquivos `.env`.
- Nunca publicar chaves de API ou credenciais.
- Não compartilhar o `N8N_INTEGRATION_SECRET`.
- Não colocar segredos no frontend.
- Não utilizar o banco principal para testes destrutivos.
- Manter volumes persistentes para PostgreSQL e n8n.
- Fazer backup antes de migrations.
- Validar workflows manualmente antes de ativar agendamentos.
- Utilizar bancos separados para desenvolvimento, testes e homologação.
- Não apagar registros históricos para corrigir problemas de integração.

---

## 14. Checklist de instalação

### Ferramentas

- [ ] Node.js e npm instalados.
- [ ] Git instalado.
- [ ] Docker Desktop instalado e funcionando.
- [ ] Cliente PostgreSQL instalado, se necessário.

### Banco de dados

- [ ] Volume Docker criado.
- [ ] Container PostgreSQL iniciado.
- [ ] Banco `postgres` disponível.
- [ ] Porta 5433 acessível.
- [ ] Backup realizado quando aplicável.

### Backend

- [ ] Dependências instaladas.
- [ ] Arquivo `.env` configurado.
- [ ] `DATABASE_URL` validada.
- [ ] `N8N_INTEGRATION_SECRET` gerado.
- [ ] Migrations verificadas.
- [ ] API iniciada na porta 3001.

### Frontend

- [ ] Dependências instaladas.
- [ ] URL da API configurada.
- [ ] Aplicação iniciada pelo Vite.
- [ ] Comunicação com o backend validada.

### n8n

- [ ] Container iniciado.
- [ ] Workflows JSON importados.
- [ ] Credenciais reconfiguradas.
- [ ] URL do backend configurada.
- [ ] Header de integração configurado.
- [ ] Workflow testado manualmente.

---

## 15. Observação sobre a evolução da arquitetura

A arquitetura está em evolução para suportar múltiplas instituições e fontes de oportunidades.

As próximas etapas contemplam:

- Cadastro estruturado de fontes.
- Associação de oportunidades às respectivas fontes.
- Versionamento de documentos.
- Verificação de alterações nos editais.
- Cálculo de hash SHA-256 dos documentos.
- Pré-verificação antes de novas análises.
- Deduplicação de oportunidades.
- Histórico completo de análises.
- Revisão humana de informações oficiais.

As novas funcionalidades deverão preservar os dados existentes e manter a compatibilidade da integração atual durante a transição.

---

**Projeto:** Edital Inteligente  
**Objetivo:** centralizar oportunidades públicas e privadas, automatizar sua coleta e análise e facilitar sua consulta.
