# Assistente AI

Assistente pessoal que organiza tarefas, agenda, gastos, notas e e-mails, acessível pelo WhatsApp e, em breve, por um dashboard web.

| Pasta | O que é | Status |
|---|---|---|
| `agent/` | Agente do WhatsApp (Evolution API + Claude + Notion/Google) | ✅ pronto para deploy |
| `web/` | Dashboard | 🔜 |
| `senhas/` | App de senhas (integração) | 🔜 |

Contexto completo, decisões e IDs dos recursos: [`CLAUDE.md`](CLAUDE.md). Escopo original: `requirements.txt.txt`.

## Deploy no Railway

O repositório já vem configurado: `Dockerfile` e `railway.json` na raiz constroem o agente da pasta `agent/`,
com health check em `/` e reinício automático em caso de falha.

1. No projeto do Railway onde está a Evolution: **+ New → GitHub Repo → FelpTB/Assistente-AI**.
   (Na primeira vez, autorize o Railway a acessar o repositório.)
2. No serviço criado → **Variables → Raw Editor**: cole as variáveis de [`agent/.env.example`](agent/.env.example)
   com os seus valores. Deixe `ALLOWED_CHAT_JIDS` vazio por enquanto.
3. **Settings → Networking → Generate Domain**. Abra a URL: deve mostrar `{"ok":true,...}`.
4. Aponte o webhook da Evolution para o agente (no seu PC, dentro de `agent/`):
   ```bash
   npm install
   npm run webhook -- https://SEU-DOMINIO.up.railway.app
   ```
5. Mande `/ativar` no seu grupo solo do WhatsApp, copie o ID que o agente responder para
   `ALLOWED_CHAT_JIDS` no Railway e aguarde o redeploy.

A cada `git push` na branch principal, o Railway faz o deploy de novo automaticamente.

## Segurança
- **Nunca** faça commit de `.env` (já está no `.gitignore`). Segredos ficam só nas Variables do Railway.
- O agente só responde a mensagens enviadas por você, no grupo liberado em `ALLOWED_CHAT_JIDS`.
- Mantenha o repositório **privado**.
