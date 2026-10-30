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

---

## Estrutura
```
src/index.ts        servidor e webhook (filtros de segurança)
src/agent.ts        conversa com o Claude + execução das ferramentas
src/evolution.ts    envio de mensagens
src/tools/          tarefas (Notion), agenda (Calendar), gastos (Sheets), emails (Gmail)
scripts/            google-auth, configurar-webhook
```
Memória da conversa: só em RAM (últimos 20 turnos), zera ao reiniciar. Nenhum dado pessoal é salvo em banco.

## Próximos passos
- Notas no Google Keep (requer conta de serviço autorizada pelo admin do Workspace)
- Áudios (transcrição) e fotos de comprovantes
- Relatório diário automático e notificações
