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
- **Créditos da API do Claude (18/11/2026): só para processar mensagens do WhatsApp.** O dashboard não gera texto com a API (só a checagem de status `models.retrieve`, que não consome tokens). Resumos de e-mails e análises de chamados são feitos pelo **Claude Code** via MCP e gravados no servidor para o dashboard exibir.
- **Tudo o que o dashboard e o WhatsApp fazem também pode ser feito pelo Claude Code**, pelo servidor MCP do agente (ver "MCP para o Claude Code").

## Recursos já criados
| Recurso | ID / link |
|---|---|
| Notion — página "Assistente AI" (privada) | https://app.notion.com/p/409dca3eb7d8816c8336d5bdd63954d6 |
| Notion — banco "Tarefas" | database `dde11622db594d3eb5802c6245570e5b` · data source `5072380e-9871-4bb0-8eed-695dca78ed8b` |
| Drive — pasta "Assistente AI" | `1SLvgcMiydqNIrmDb_n-ykbcc_zw3mOs7` |
| Sheets — "Controle de Gastos" | `1ATjK3sX3y8_IbgA38cqs1GU3seBus5VAI2441vuzTUI` |
| Sheets — "Ficha de Treino" | `17f18p2Dke3M0wbIi1iTJ6-pii1J6_Sh2I8l6iYMTVTg` (`GOOGLE_TREINO_SHEET_ID`) |
| Supabase — projeto abcAdvise (Busca Fornecedor) | `hccolkrnyrxcbxuuajwq`, schema `busca_fornecedor` (company_profile, usuario_fornecedor, usuario_comprador, consultas) |

### Banco "Tarefas" (Notion)
Tarefa (título) · Área (Trabalho/Academia/Faculdade/Projetos/Pessoal) · Status (A fazer/Em andamento/Concluída)
· Prazo (data+hora) · Prioridade (Alta/Média/Baixa) · Lembrete (checkbox → cria evento no Calendar)
· Origem (WhatsApp/E-mail/Dashboard/Manual) · Notas · ID Evento Calendar · ID (TAR-n) · Criada em.
Visões: tabela padrão, "Por área" (quadro), "Agenda" (calendário).

### Planilha "Controle de Gastos" (Sheets)
- Registro **contínuo** (não separado por mês); relatórios filtram por data. Saldo em 3 meios:
  **Dinheiro** (conta/débito/Pix), **Cartão** (crédito: compras somam na fatura, o pagamento libera o limite) e **Vale** (benefício da empresa, separado do Dinheiro).
- **Lançamentos** (A:I): Data · Descrição · Tipo (Entrada/Saída/Pagamento de fatura/Ajuste) · Natureza (Fixa/Variável) · Categoria · Valor · Meio (Dinheiro/Cartão/Vale) · Origem · Mês (automático, ARRAYFORMULA em I1 — não escrever na coluna I).
  "Pagamento de fatura" sai do Dinheiro, zera parte da fatura do Cartão e não é despesa (as compras já contaram). Categoria escolhida pelo agente a partir da descrição.
  "Ajuste" (categoria "Ajuste de saldo", valor com sinal) corrige um saldo sem entrar nos relatórios; criado pelo formulário de correção ou pela tool `corrigir_saldo`.
- **Contas**: saldos atuais em B4:B8 (Dinheiro, Vale, fatura do Cartão, limite disponível, limite total) — o agente lê daqui.
  Limite total = limite disponível + fatura (B8 = B15 + B14); disponível atual = total − fatura atual.
  Valores iniciais (Dinheiro, Vale, fatura, **limite disponível**, data) em B12:B16, gravados pelo formulário "Inicializar" da aba Finanças. Movimento por meio em B19:E21 (entradas, saídas, faturas pagas, ajustes).
- **Despesas Fixas**: Descrição · Categoria · Valor · Dia de vencimento · Meio · Ativa (checkbox).
- **Resumo**: período em B3 (De) e B4 (Até), padrão = mês atual; entradas, saídas, por categoria, por meio, faturas pagas e saldos atuais.
- **Categorias**: lista editável (Categoria · Tipo).
- ⚠️ Planilha em locale **pt_BR**: fórmulas usam `;` como separador. Ao gravar via API, enviar datas e valores como números (não texto) e acrescentar linhas com append em `Lançamentos!A:H`.

### Ficha de treino (esfera Academia)
- Planilha "Ficha de Treino": **Exercícios** (treino, grupo, exercício, tipo Força/Cardio, descanso em s, séries base, **peso atual**, ordem, ativo; editável), **Sessões** (ID, início, fim, treino, status Em andamento/Concluída/Cancelada, pontos), **Séries**, **Evoluções**, **Cardio** e **Regras** (pontos e limites, lidos pelo sistema). Datas gravadas como número de data/hora (RAW).
- Regras padrão: 1 pt por série válida (≥ 8 repetições), 5 pts por subida de peso, 2 pts por hora de cardio (proporcional); 3 séries base; uma série com 12+ repetições no peso atual libera "Subir peso". A primeira série de um exercício sem peso define o peso atual.
- Dashboard: aba **Ficha de treino** (iniciar modalidade, registrar série a série, desfazer, subir peso, cardio em minutos, cronômetro de descanso com som/vibração que sobrevive a recarregar a página, finalizar) e **Relatório do mês** (pontos por tipo e por dia, treinos por modalidade, evoluções, maior peso por exercício). Código: `agent/src/treino.ts`, `agent/public/academia.js`. No WhatsApp: tool `relatorio_treino`.

### Painel Busca Fornecedor
- Lê o Supabase abcAdvise pela API REST com a chave service_role (`BF_SUPABASE_KEY`). Métricas agregadas (cache de 10 min) e listas das **últimas 40 buscas** (parâmetros, termos, resultados com nota/modelo/escopo/plano/site, qualidade, fallback) e dos **últimos 25 compradores e fornecedores** (cache de 2 min). Telefones mascarados; nunca senha, token nem contatos dos fornecedores encontrados.
- **Painel de admin** (`agent/src/bfTabelas.ts`): catálogo de ~32 tabelas de `busca_fornecedor` e `public` (feedbacks, contests de site, mensagens, avaliações, aparições, motor de busca, mensageria, engajamento, filas de cadastro, editor de perfil, configurações, chaves, OTP; `app_admins` fica de fora porque é trancada de propósito). Cada tabela declara só as colunas exibidas; hash de chave, código OTP, chave de API e URL completa do webhook nunca são lidos; telefones/e-mails mascarados; variáveis com nome de segredo aparecem como •••. Totais e pendências (feedback sem resposta, contest em aberto, fila com erro; mensagens não lidas sem alerta) em cache de 5 min; detalhe carregado ao abrir o painel.
- **Chamados** (`agent/src/bfAdmin.ts`, `agent/public/chamados.js`): feedbacks pendentes, contests de site (pendentes e rejeitados há até 14 dias), jobs de perfil com erro, fila de cadastro com erro reprocessável ou travada (> 2 h; erros `bloqueio_anti_bot` ficam fora da lista, só contados) e troca de CNPJ. A análise é feita pelo Claude Code (MCP `bf_contexto_chamado` → `bf_salvar_analise`: resumo, ação sugerida do catálogo, resposta sugerida) e aparece em cada item; nada roda sem clique. Ações: feedback respondido/pendente/excluir (RPCs), gerar perfil do novo site (Edge Function `fornecedor-perfil-novo-site`, só troca de site), resolver/rejeitar contest (UPDATE com a sessão do admin, política `admins_update_contests`), gerar perfil de novo ou arquivar (`status=arquivado`) job com erro, devolver item à fila (`status=pendente`, solta o lock; vale para erro, travado em processamento ou parado em `perfil_gravado` sem vetores), prévia e troca de CNPJ (RPCs; troca exige digitar o CNPJ novo duas vezes). "Verificar processamentos" chama `perfil-site-job-tick`, que nada agenda em produção.
  - O servidor age como o admin `BF_ADMIN_EMAIL` (precisa estar em `app_admins`): sessão obtida com `admin/generate_link` + `verify` usando a service_role, sem senha. Histórico de ações só em memória e no log do Railway.
  - Chave dos perfis: `company_profile.cnpj` guarda, na maioria, o **CNPJ básico (8 dígitos)**; `aparicoes.cnpj_basico` e `whatsapp_envios.cnpj_empresa` têm FK para ele com `ON DELETE CASCADE`. `admin_preview_troca_cnpj` foi refeita em 18/11/2026 (aceita 8 ou 14 dígitos e conta usuários, aparições, WhatsApp, engajamento, layouts, avaliações e mensagens).
  - `admin_trocar_cnpj_fornecedor` refeita em 18/11/2026 (testada com rollback): exige os dois CNPJs com 14 dígitos e o novo na `cnpj_db.estabelecimento`; para (sem alterar nada) se o destino já tiver dados em perfil, usuário, contador, engajamento, layouts, telefones ou avaliações. Move o perfil inteiro (mesmo id, todas as colunas; chave no mesmo formato, 8 ou 14), aparições, contador, WhatsApp, usuário, vendedores, jobs de perfil e, se o básico mudar, engajamento, avaliações, mensagens, layouts, mídia, e-mails, SMS, ligações, telefones e contests. Não move dados de cadastro/raspagem do CNPJ (cnpj_db, estabelecimentos_filtro, scrape_*, serper, website_discovery, filas, enr_*). Vetores no Qdrant não são tocados.
  - ⚠️ Conhecido no banco (18/11/2026): as Edge Functions de perfil/contest têm `verify_jwt=false` e não conferem quem chama; `fornecedor_marcar_dummy_e_registrar_contest` é executável por anon. `aplicar_perfil_novo_site` foi restrita à service_role em 18/11/2026.
- Na aba, todas as seções são recolhíveis (estado salvo no navegador, chave `bf-secoes`); alertas de pendências no topo abrem o painel correspondente.
- `company_profile` tem ~585 mil linhas e `created_at` **sem índice** (contar por data leva ~5 s; o limite da API é 8 s): o total vem da estimativa do Postgres e os novos são lidos pelas 10 mil linhas mais recentes por `id`.
- Site: verificação HTTP de `BF_SITE_URL`. n8n: API pública (`N8N_URL`, `N8N_API_KEY`), todas as execuções.

### Capex Radar (aba Trabalho → Capex Radar)
- Ferramenta da Busca Fornecedor em desenvolvimento: https://capex-radar-buscafornecedor.up.railway.app (dados no schema `capex_radar` do Supabase abcAdvise; `radar`/`radar2` são versões anteriores).
- **O dashboard só monitora**: `agent/src/capexRadar.ts` chama apenas as ferramentas de leitura do MCP do próprio Capex Radar (`resumo_radar`, `buscar_projetos`, `obter_projeto`, `buscar_noticias`, `obter_noticia`, `historico_alteracoes`), com cache de 2 min. Aba `agent/public/capex.js`: KPIs da carteira, projetos por estágio, notícias a revisar, maiores e mais recentes, empresas monitoradas (coleta > 7 dias em vermelho) e carteira filtrável com ficha do projeto.
- **Triagem e análise pelo Claude Code**, conectado direto ao MCP do Capex Radar (servidor `capex-radar` no `.mcp.json`): aprovar/vincular/descartar notícias, corrigir projetos, mudar status, classificar registros.
- ⚠️ 18/11/2026: o MCP (`/mcp`) e as páginas `/monitoramento` do Capex Radar respondem **sem autenticação**, inclusive ferramentas de escrita. Felipe decidiu seguir assim por estar em teste. Quando houver token, definir `CAPEX_RADAR_TOKEN` no Railway (o cliente já envia `Authorization: Bearer`).

### Ponto mensal (n8n → xlsx → e-mail)
- `agent/src/ponto.ts` lê a data table **"Ponto Felipe"** do n8n (API pública; tenta `/data-tables` e `/datatables`). Uma linha por batida: `Dia` (DD-MM, sem ano; o ano vem de `createdAt`) · `Hora` (local) · `Tipo_ponto` (Entrada, Almoco (Início), Almoco (Fim), Saída). Horas = saída − entrada − almoço; dias com batida faltando ou repetida ficam marcados.
- Dia 1, a partir das `PONTO_HORA_AVISO` h: o agente manda o resumo do mês anterior no grupo e pede aprovação; ao aprovar, a tool `enviar_ponto` envia o .xlsx para `PONTO_EMAIL` (waltagan@abcadvise.com.br) pelo Gmail. Não reenvia se já houver e-mail enviado com o mesmo assunto.
- Rodar a rotina manualmente: `/ponto` (ou `/ponto AAAA-MM`) no grupo → resumo + pedido de aprovação (avisa se já foi enviado); ou botão **Enviar por e-mail** na aba Ponto do dashboard (`POST /api/ponto/enviar`, com confirmação; `GET /api/ponto/enviado?mes=`).
- Envio exige o escopo `gmail.send` no refresh token. Conferência pelo dashboard: `/api/ponto/tabelas`, `/api/ponto?mes=AAAA-MM`, `/api/ponto/planilha?mes=AAAA-MM`.

### MCP para o Claude Code
- Endpoint `POST /mcp` do agente (`agent/src/mcp.ts`, Streamable HTTP sem sessão), protegido por `MCP_TOKEN` (Authorization: Bearer). Sem a variável, fica desligado (503).
- Ferramentas: as do agente do WhatsApp (tarefas, agenda, gastos, e-mails, ponto, relatório de treino) + e-mails com corpo e gravação de resumos (`emails_salvar_resumos`, `emails_salvar_resumo_do_dia`), finanças, Busca Fornecedor (pendências, contexto de chamado, `bf_salvar_analise`, `bf_executar_acao` com a mesma regra de confirmação, métricas, buscas, cadastros, tabelas, site, n8n), ponto e ficha de treino completa.
- `.mcp.json` na raiz conecta o Claude Code a este projeto; o token vem da variável de ambiente `ASSISTENTE_MCP_TOKEN` da máquina (nunca no repositório).
- Resumos e análises gravados pelo Claude Code ficam em memória no servidor (somem ao reiniciar).

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
2. ✅ Agente no ar no Railway (https://assistente-ai-claude-officetools.up.railway.app), conversando no grupo solo
3. Notas no Google Keep; áudios e fotos de comprovantes
4. Relatório diário (agenda + e-mails importantes + notícias) e notificações
5. ✅ Dashboard web em `agent/public` (servido pelo agente, login Google, tema claro/escuro): visão geral, **Finanças** (saldos, gráficos, lançamentos, inicializar/corrigir), esferas com abas (Trabalho: resumo de e-mails, tarefas, Busca Fornecedor com site/Supabase/n8n)
   ⏳ Falta: ligar esferas a contas de e-mail
6. Integração do app de senhas
7. Outras contas de e-mail; automação de conversas no WhatsApp
