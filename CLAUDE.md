# Assistente AI — contexto do projeto

Assistente pessoal do Felipe: organiza tarefas, gastos, notas, e-mails e notícias,
acessível pelo WhatsApp (Evolution API) e por um dashboard web próprio.
Escopo original: `requirements.txt.txt`.

## Decisões tomadas (30/10/2026)
- **Conta Google principal:** felipe@abcadvise.com.br (Google Workspace). Outras contas (tbfelipe, Unifal) ficam para depois.
- **Tarefas → Notion** (banco "Tarefas"). Avisos de horário → Google Calendar.
- **Gastos → Google Sheets** ("Controle de Gastos").
- **Notas → Google Keep.**
- **Supabase NÃO deve guardar informações pessoais.**
- **WhatsApp → Evolution API** da empresa (v2.3.7, https://evolution-api-production-8f8e.up.railway.app, instância `Felipe-Assistente`).
  Número conectado é o **pessoal** → o agente só responde no **grupo solo**, só a mensagens `fromMe`. Fase 1: conversar com o agente. Futuro: automatizar conversas.
- **Hospedagem do agente → Railway** (mesmo projeto da Evolution), deploy pelo GitHub **FelpTB/Assistente-AI** (privado).
  `Dockerfile` + `railway.json` na raiz constroem `agent/`; health check em `/health`. Dashboard em `/`.
- **Senhas → app próprio** (repositório será trazido para esta pasta). O dashboard só integra/visualiza.
- **Dashboard → web app próprio.**

## Recursos já criados
| Recurso | ID / link |
|---|---|
| Notion — página "Assistente AI" (privada) | https://app.notion.com/p/409dca3eb7d8816c8336d5bdd63954d6 |
| Notion — banco "Tarefas" | database `dde11622db594d3eb5802c6245570e5b` · data source `5072380e-9871-4bb0-8eed-695dca78ed8b` |
| Drive — pasta "Assistente AI" | `1SLvgcMiydqNIrmDb_n-ykbcc_zw3mOs7` |
| Sheets — "Controle de Gastos" | `1ATjK3sX3y8_IbgA38cqs1GU3seBus5VAI2441vuzTUI` |

### Banco "Tarefas" (Notion)
Tarefa (título) · Área (Trabalho/Academia/Faculdade/Projetos/Pessoal) · Status (A fazer/Em andamento/Concluída)
· Prazo (data+hora) · Prioridade (Alta/Média/Baixa) · Lembrete (checkbox → cria evento no Calendar)
· Origem (WhatsApp/E-mail/Dashboard/Manual) · Notas · ID Evento Calendar · ID (TAR-n) · Criada em.
Visões: tabela padrão, "Por área" (quadro), "Agenda" (calendário).

### Planilha "Controle de Gastos" (Sheets)
- **Lançamentos** (A:I): Data · Descrição · Tipo (Entrada/Saída) · Natureza (Fixa/Variável) · Categoria · Valor · Forma de pagamento · Origem · Mês (automático, ARRAYFORMULA em I1 — não escrever na coluna I).
- **Despesas Fixas**: Descrição · Categoria · Valor · Dia de vencimento · Forma de pagamento · Ativa (checkbox).
- **Resumo**: mês em B3 (padrão = mês atual), entradas, saídas, saldo, fixas pagas/previstas/pendentes, saídas por categoria.
- **Categorias**: lista editável (Categoria · Tipo).
- ⚠️ Planilha em locale **pt_BR**: fórmulas usam `;` como separador. Ao gravar via API, enviar datas e valores como números (não texto) e acrescentar linhas com append em `Lançamentos!A:H`.

## Arquitetura proposta
```
WhatsApp ──► Evolution API ──webhook──► Backend do agente (Node/TS + Claude API com tools)
                                              │
Dashboard web ◄──────── API própria ──────────┤
                                              ├─► Notion API (tarefas)
Agendador (cron) ─► relatório diário,         ├─► Google Sheets API (gastos)
   notificações via WhatsApp                  ├─► Google Calendar API (avisos)
                                              ├─► Google Keep API (notas)
                                              ├─► Gmail API (relatório de e-mails)
                                              └─► App de senhas (integração futura)
```
- Os conectores do Claude (Cowork) servem para montar/testar; o agente em produção precisa das **próprias credenciais**:
  Notion integration token, OAuth Google (ou service account) e chave da Claude API.
- **Google Keep API** só funciona em contas Workspace via **service account com delegação em todo o domínio** (precisa do admin do abcadvise.com.br).
- Segredos ficam em variáveis de ambiente/cofre do servidor, nunca no repositório.

## Estrutura de pastas sugerida
```
agent/      backend do agente (webhook Evolution, tools, cron)
web/        dashboard
docs/       documentação
senhas/     app de senhas (a importar)
```

## Roadmap
1. ✅ Base de dados: Notion (tarefas) + Sheets (gastos)
2. ✅ Código do agente em `agent/` (webhook Evolution + Claude + tools de tarefas, agenda, gastos, e-mails) — testado com mocks
   ⏳ Falta: credenciais, deploy no Railway, `/ativar` no grupo (passo a passo em `agent/README.md`)
3. Notas no Google Keep; áudios e fotos de comprovantes
4. Relatório diário (agenda + e-mails importantes + notícias) e notificações
5. 🟡 Dashboard web em `agent/public` (servido pelo agente, login Google): status, tarefas por esfera, agenda, gastos
   ⏳ Falta: URI de redirecionamento `/auth/callback` no Google Cloud; ligar esferas a contas de e-mail
6. Integração do app de senhas
7. Outras contas de e-mail; automação de conversas no WhatsApp
