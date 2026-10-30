# Agente do WhatsApp — Assistente AI

Recebe as suas mensagens do **grupo solo** no WhatsApp (via Evolution API), entende o pedido com o Claude
e age no Notion (tarefas), Google Sheets (gastos), Google Calendar (agenda/lembretes) e Gmail (leitura).

## Segurança (número pessoal)
O agente **só responde** quando as duas condições valem:
1. a mensagem foi enviada **por você** (`fromMe`);
2. o chat está em `ALLOWED_CHAT_JIDS` (o seu grupo solo).

Conversas com outras pessoas são ignoradas. O webhook exige `?token=WEBHOOK_TOKEN`.
As respostas começam com 🤖, e o agente ignora as próprias mensagens.

## O que você pode mandar no grupo
- `academia amanhã 7h` → tarefa em *Academia* + aviso no Calendar
- `gastei 45 no almoço no pix` → lançamento na planilha
- `recebi 1200 do freela` → entrada
- `o que tenho pra hoje?` / `minhas tarefas da faculdade`
- `conclui TAR-3`
- `resumo dos gastos de outubro`
- `e-mails importantes de hoje`
- `/reset` → limpa a memória da conversa

---

## Configuração (uma vez)

### 1. Credenciais
| Variável | Onde conseguir |
|---|---|
| `CLAUDE_API_KEY` | console.anthropic.com → API Keys |
| `CLAUDE_WORKSPACE_ID` | Opcional. Só se a chave não for de um workspace: console.anthropic.com → Settings → Workspaces → ID (`wrkspc_...`) |
| `TOKEN_NOTION` | notion.so/profile/integrations → *Nova integração* (interna) → copie o token. Depois, na página **Assistente AI** do Notion: `⋯` → *Conexões* → adicione a integração. |
| `EVOLUTION_AUTH_KEY` | No Railway, serviço da Evolution → Variables → `AUTHENTICATION_API_KEY` |
| `WEBHOOK_TOKEN` | Qualquer texto aleatório longo (ex.: gerador de senhas, 40 caracteres) |
| `GOOGLE_ID_CLIENT` / `GOOGLE_SECRET_KEY` | Passo 2 |
| `GOOGLE_REFRESH_TOKEN` | Passo 3 |

### 2. Google Cloud (OAuth)
1. console.cloud.google.com → crie um projeto "Assistente AI" (logado como felipe@abcadvise.com.br).
2. *APIs e serviços → Biblioteca*: ative **Google Sheets API**, **Google Calendar API** e **Gmail API**.
3. *Tela de consentimento OAuth*: tipo **Interno** (assim o token não expira em 7 dias).
4. *Credenciais → Criar → ID do cliente OAuth → App para computador*. Copie o ID e a chave secreta.

### 3. Gerar o refresh token (no seu PC)
```bash
cd agent
npm install
cp .env.example .env      # preencha GOOGLE_ID_CLIENT e GOOGLE_SECRET_KEY
npm run google-auth       # abra o link, autorize, copie o GOOGLE_REFRESH_TOKEN
```

### 4. Grupo solo no WhatsApp
Crie um grupo (ex.: "🤖 Assistente"). O WhatsApp pede pelo menos um participante: adicione alguém e remova logo depois.

### 5. Deploy no Railway
Pelo GitHub (recomendado): veja o passo a passo no [README da raiz](../README.md#deploy-no-railway).
O `Dockerfile` e o `railway.json` da raiz do repositório já cuidam do build.

### 6. Ligar a Evolution ao agente
```bash
npm run webhook -- https://SEU-AGENTE.up.railway.app
```
(Também dá para configurar no Manager da Evolution: Webhook → URL `https://SEU-AGENTE.up.railway.app/webhook/evolution?token=SEU_TOKEN`, evento `MESSAGES_UPSERT`.)

### 7. Ativar o grupo
Mande `/ativar` no grupo solo. O agente responde com o ID do chat (ex.: `1203630...@g.us`).
Cole em `ALLOWED_CHAT_JIDS` no Railway e aguarde o redeploy. Pronto: mande `oi`.

### 8. Dashboard
O dashboard fica no mesmo endereço do agente (`https://SEU-AGENTE.up.railway.app/`), com login pelo Google.
1. No Google Cloud, no mesmo OAuth client, adicione em *URIs de redirecionamento autorizados*:
   `https://SEU-AGENTE.up.railway.app/auth/callback`
2. Pronto. Só os e-mails de `DASHBOARD_EMAILS` entram (padrão: felipe@abcadvise.com.br).

| Variável (opcional) | Para quê |
|---|---|
| `DASHBOARD_EMAILS` | E-mails com acesso, separados por vírgula |
| `PUBLIC_URL` | Endereço público, se usar domínio próprio (o Railway já informa o padrão) |
| `BF_SUPABASE_KEY` | Chave **service_role** do projeto Supabase abcAdvise (Settings → API). Só o servidor usa, para leituras agregadas do schema `busca_fornecedor` |
| `BF_SITE_URL` | Endereço publicado do site do Busca Fornecedor (Lovable) |
| `N8N_URL` / `N8N_API_KEY` | Endereço do n8n e uma chave da API (n8n → Settings → n8n API) |
| `DASHBOARD_SESSION_SECRET` | Assina o cookie de login; sem ela, deriva do `WEBHOOK_TOKEN` |

- **Visão geral:** status das integrações, saldos, e-mails de hoje, tarefas por esfera e agenda.
- **Finanças:** saldos de Dinheiro, Cartão e Vale; relatório por período; gráficos de entradas e saídas por mês e da evolução dos saldos; lista de lançamentos; formulários para inicializar e corrigir saldos.
- **Esferas:** indicadores e quadro de tarefas de cada área. **Trabalho** tem abas: resumo dos 5 e-mails mais recentes (resumo e ação sugerida pela IA) e dos e-mails do dia, tarefas e o projeto **Busca Fornecedor**.
- Tema claro, escuro ou automático. Os dados são lidos na hora; nada fica guardado no servidor.

---

## Estrutura
```
src/index.ts        servidor e webhook (filtros de segurança)
src/agent.ts        conversa com o Claude + execução das ferramentas
src/evolution.ts    envio de mensagens
src/auth.ts         login do dashboard (Google)
src/dashboard.ts    API do dashboard (/api/*)
src/buscaFornecedor.ts  painel do projeto: site, métricas do Supabase e execuções do n8n
public/             interface do dashboard (HTML/JS em módulos, sem build): app, financas, trabalho, charts, util
src/tools/          tarefas (Notion), agenda (Calendar), gastos (Sheets), emails (Gmail)
scripts/            google-auth, configurar-webhook
```
Memória da conversa: só em RAM (últimos 20 turnos), zera ao reiniciar. Nenhum dado pessoal é salvo em banco.

## Próximos passos
- Notas no Google Keep (requer conta de serviço autorizada pelo admin do Workspace)
- Áudios (transcrição) e fotos de comprovantes
- Relatório diário automático e notificações
