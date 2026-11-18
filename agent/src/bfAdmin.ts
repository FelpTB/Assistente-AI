import { config } from "./config.js";

// Resolução de chamados do Busca Fornecedor pelo dashboard e pelo Claude Code (MCP).
// O dashboard não chama a API do Claude: a análise é feita pelo Claude Code, que lê o contexto
// (bf_contexto_chamado), grava a análise (salvarAnalise) e executa ações deste catálogo.
// As RPCs administrativas conferem public.is_admin(auth.uid()), então o servidor age como um
// usuário admin (BF_ADMIN_EMAIL): a sessão vem de um link de login gerado com a service_role,
// sem senha guardada. Ações irreversíveis ou que decidem disputas exigem confirmação explícita.

const bf = config.buscaFornecedor;

export class Proibido extends Error {
  status = 400;
}
const erro = (msg: string) => new Proibido(msg);

// ---- Sessão do admin ------------------------------------------------------------

let sessao: { token: string; userId: string; email: string; expira: number } | null = null;

async function auth(caminho: string, corpo: unknown) {
  if (!bf.supabaseKey) throw erro("Configure BF_SUPABASE_KEY no Railway.");
  const res = await fetch(`${bf.supabaseUrl}/auth/v1/${caminho}`, {
    method: "POST",
    headers: { apikey: bf.supabaseKey, Authorization: `Bearer ${bf.supabaseKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Supabase Auth ${caminho}: ${res.status} ${json.msg ?? json.error_description ?? json.message ?? ""}`);
  return json;
}

async function sessaoAdmin() {
  if (sessao && sessao.expira - Date.now() > 120_000) return sessao;
  if (!bf.adminEmail) throw erro("Configure BF_ADMIN_EMAIL no Railway (e-mail de um usuário que está em app_admins).");
  // generate_link não envia e-mail: só devolve o token, que é trocado por uma sessão logo em seguida.
  const link = await auth("admin/generate_link", { type: "magiclink", email: bf.adminEmail });
  const tokenHash = link.hashed_token ?? link.properties?.hashed_token;
  if (!tokenHash) throw new Error("Supabase Auth não devolveu o token do link de login.");
  const s = await auth("verify", { type: "magiclink", token_hash: tokenHash });
  if (!s.access_token) throw new Error("Não foi possível abrir a sessão do admin.");
  sessao = { token: s.access_token, userId: s.user?.id, email: bf.adminEmail, expira: Date.now() + (Number(s.expires_in) || 3600) * 1000 };
  return sessao;
}

/** Chama uma RPC como o admin autenticado (a própria RPC confere is_admin). */
async function rpcAdmin(nome: string, args: Record<string, unknown> = {}) {
  const s = await sessaoAdmin();
  const res = await fetch(`${bf.supabaseUrl}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: bf.supabaseKey, Authorization: `Bearer ${s.token}`, "Content-Type": "application/json", "Content-Profile": "public" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30_000),
  });
  const txt = await res.text();
  if (!res.ok) {
    let msg = txt;
    try {
      const j = JSON.parse(txt);
      msg = [j.message, j.details, j.hint].filter(Boolean).join(" · ");
    } catch {}
    throw new Error(`${nome}: ${msg.slice(0, 300)}`);
  }
  return txt ? JSON.parse(txt) : null;
}

/** Leitura/escrita direta com a service_role (só onde não existe RPC administrativa). */
async function rest(schema: string, tabela: string, query: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const res = await fetch(`${bf.supabaseUrl}/rest/v1/${tabela}?${query}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: bf.supabaseKey,
      Authorization: `Bearer ${bf.supabaseKey}`,
      "Accept-Profile": schema,
      "Content-Profile": schema,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${tabela}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// ---- Histórico de ações ------------------------------------------------------------
// Mantido em memória (últimas 200) e no log do Railway. Ver CLAUDE.md sobre gravar no banco.

type Registro = { em: string; acao: string; alvo: string; dados: unknown; resultado: "ok" | "erro"; detalhe: string; por: string };
const historico: Registro[] = [];

function registrar(r: Omit<Registro, "em" | "por">) {
  const reg = { ...r, em: new Date().toISOString(), por: sessao?.email ?? bf.adminEmail ?? "?" };
  historico.unshift(reg);
  historico.length = Math.min(historico.length, 200);
  console.log(`[bf-admin] ${reg.acao} ${reg.alvo} → ${reg.resultado} ${reg.detalhe}`);
}

export const historicoAcoes = () => historico;

// ---- Catálogo de ações -------------------------------------------------------------
// risco: "livre" executa direto; "confirmar" exige que o pedido traga confirmar=true
// (o dashboard pergunta antes); "digitar" exige que o pedido repita o valor crítico.

type Acao = {
  id: string;
  tipo: "feedback" | "contest" | "falha" | "cnpj";
  nome: string;
  risco: "livre" | "confirmar" | "digitar";
  descricao: string;
  executar: (alvo: string, params: Record<string, any>) => Promise<unknown>;
};

const ACOES: Acao[] = [];
const acao = (a: Acao) => ACOES.push(a);

// Feedbacks (RPCs: atualizar_status_feedback, excluir_feedback)
acao({
  id: "feedback_respondido", tipo: "feedback", nome: "Marcar como respondido", risco: "livre",
  descricao: "Status do feedback passa a Respondido.",
  executar: (alvo) => rpcAdmin("atualizar_status_feedback", { _id: Number(alvo), _status: "Respondido" }),
});
acao({
  id: "feedback_pendente", tipo: "feedback", nome: "Voltar para pendente", risco: "livre",
  descricao: "Status do feedback volta a Pendente.",
  executar: (alvo) => rpcAdmin("atualizar_status_feedback", { _id: Number(alvo), _status: "Pendente" }),
});
acao({
  id: "feedback_excluir", tipo: "feedback", nome: "Excluir feedback", risco: "confirmar",
  descricao: "Apaga o feedback de vez.",
  executar: (alvo) => rpcAdmin("excluir_feedback", { _id: Number(alvo) }),
});

// Troca de CNPJ (RPCs: admin_preview_troca_cnpj, admin_trocar_cnpj_fornecedor)
acao({
  id: "cnpj_previa", tipo: "cnpj", nome: "Prévia da troca de CNPJ", risco: "livre",
  descricao: "Mostra o que existe no CNPJ (8 ou 14 dígitos): perfil, aparições, usuários, WhatsApp, engajamento, layouts, avaliações e mensagens. Não altera nada.",
  executar: (alvo) => rpcAdmin("admin_preview_troca_cnpj", { p_cnpj: alvo }),
});
acao({
  id: "cnpj_trocar", tipo: "cnpj", nome: "Trocar CNPJ do fornecedor", risco: "digitar",
  descricao: "Move para o CNPJ novo tudo o que é da conta e do perfil (perfil, aparições, usuário, vendedores, engajamento, avaliações, mensagens, layouts, histórico de envios, contests). Irreversível; para se o destino já tiver dados.",
  executar: async (alvo, p) => {
    const novo = String(p.cnpjNovo ?? "").replace(/\D/g, "");
    if (novo.length !== 14) throw erro("Informe o CNPJ novo com 14 dígitos.");
    if (String(p.confirmacao ?? "").replace(/\D/g, "") !== novo) throw erro("Digite o CNPJ novo de novo para confirmar.");
    try {
      return await rpcAdmin("admin_trocar_cnpj_fornecedor", { p_cnpj_antigo: alvo, p_cnpj_novo: novo });
    } catch (e: any) {
      const m = String(e?.message ?? e);
      const amigavel: [RegExp, string][] = [
        [/destino_ja_tem_dados: ([\w, ]+)/, "O CNPJ novo já tem dados em: $1. Nada foi alterado."],
        [/cnpj_novo_nao_existe_na_receita/, "O CNPJ novo não existe na base da Receita. Nada foi alterado."],
        [/cnpj_antigo_nao_encontrado/, "Não há perfil para o CNPJ antigo. Nada foi alterado."],
      ];
      for (const [re, txt] of amigavel) if (re.test(m)) throw erro(m.replace(new RegExp(`.*${re.source}.*`, "s"), txt));
      throw e;
    }
  },
});

// ---- Contests de site e processamentos ----------------------------------------------

/** REST com a sessão do admin: passa pelas políticas RLS de admin (ex.: admins_update_contests). */
async function restAdmin(tabela: string, query: string, init: { method?: string; body?: unknown } = {}) {
  const s = await sessaoAdmin();
  const res = await fetch(`${bf.supabaseUrl}/rest/v1/${tabela}?${query}`, {
    method: init.method ?? "GET",
    headers: { apikey: bf.supabaseKey, Authorization: `Bearer ${s.token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${tabela}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const linhas = await res.json();
  if (init.method === "PATCH" && Array.isArray(linhas) && !linhas.length) throw new Error(`${tabela}: nenhuma linha alterada (sem permissão ou item inexistente).`);
  return linhas;
}

/** Edge Functions do Busca Fornecedor (deploy com verify_jwt=false; respondem 200 com {success, error}). */
async function edge(slug: string, corpo: unknown = {}) {
  const res = await fetch(`${bf.supabaseUrl}/functions/v1/${slug}`, {
    method: "POST",
    headers: { apikey: bf.supabaseKey, Authorization: `Bearer ${bf.supabaseKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(60_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`${slug}: ${json.error ?? res.status}`);
  return json;
}

async function contest(id: string) {
  const [c] = await rest("public", "site_contests", `select=*&id=eq.${encodeURIComponent(id)}`);
  if (!c) throw erro("Contest não encontrado.");
  return c;
}

const notaAdmin = (c: any, texto: string) => `${c.notas ? `${c.notas} | ` : ""}[admin ${new Date().toISOString().slice(0, 10)}] ${texto}`;

acao({
  id: "contest_gerar_perfil", tipo: "contest", nome: "Gerar perfil a partir do novo site", risco: "livre",
  descricao: "Só para troca de site: inicia a geração do perfil; quando o job termina, o perfil é aplicado e o contest resolvido automaticamente. Se o contest estava rejeitado, ele volta a pendente.",
  executar: async (alvo) => {
    const c = await contest(alvo);
    if (c.tipo !== "troca_de_site") throw erro("Só contests de troca de site geram perfil automaticamente. Disputa de site em uso é decidida por você.");
    if (c.status === "resolvido") throw erro("Este contest já está resolvido.");
    if (c.status !== "pendente") await restAdmin("site_contests", `id=eq.${c.id}`, { method: "PATCH", body: { status: "pendente", resolvido_em: null, notas: notaAdmin(c, "reaberto para gerar o perfil") } });
    return edge("fornecedor-perfil-novo-site", { user_id: c.usuario_id, cnpj: c.cnpj_usuario, site: c.site_informado });
  },
});
acao({
  id: "contest_resolver", tipo: "contest", nome: "Marcar contest como resolvido", risco: "confirmar",
  descricao: "Fecha o contest como resolvido, sem alterar perfis. Use quando o caso foi tratado por fora.",
  executar: async (alvo, p) => {
    const c = await contest(alvo);
    const s = await sessaoAdmin();
    return restAdmin("site_contests", `id=eq.${c.id}`, {
      method: "PATCH",
      body: { status: "resolvido", resolvido_em: new Date().toISOString(), resolvido_por: s.userId, notas: notaAdmin(c, String(p.motivo || "resolvido pelo admin")) },
    });
  },
});
acao({
  id: "contest_rejeitar", tipo: "contest", nome: "Rejeitar contest", risco: "confirmar",
  descricao: "Fecha o contest como rejeitado (o site informado não será usado).",
  executar: async (alvo, p) => {
    const c = await contest(alvo);
    const s = await sessaoAdmin();
    return restAdmin("site_contests", `id=eq.${c.id}`, {
      method: "PATCH",
      body: { status: "rejeitado", resolvido_em: new Date().toISOString(), resolvido_por: s.userId, notas: notaAdmin(c, String(p.motivo || "rejeitado pelo admin")) },
    });
  },
});

acao({
  id: "job_tentar_novamente", tipo: "falha", nome: "Gerar o perfil de novo", risco: "livre",
  descricao: "Para um job de perfil com erro: inicia uma nova geração para o mesmo CNPJ e site (cria outro job).",
  executar: async (alvo) => {
    const [j] = await rest("public", "perfil_site_jobs", `select=user_id,cnpj,cnpj_gravacao,site,status&id=eq.${encodeURIComponent(alvo)}`);
    if (!j) throw erro("Job não encontrado.");
    if (j.status !== "erro") throw erro("Só jobs com erro podem ser reenviados.");
    return edge("fornecedor-perfil-novo-site", { user_id: j.user_id, cnpj: j.cnpj_gravacao || j.cnpj, site: j.site });
  },
});
acao({
  id: "fila_reenfileirar", tipo: "falha", nome: "Devolver à fila de cadastro", risco: "livre",
  descricao: "Para um item da fila de cadastro com erro ou travado: volta para pendente e solta o bloqueio do worker.",
  executar: (alvo) =>
    rest("busca_fornecedor", "fila_cadastro_perfil", `cnpj_basico=eq.${encodeURIComponent(alvo)}&status=in.(erro,processando)`, {
      method: "PATCH",
      body: { status: "pendente", locked_at: null, locked_by: null, last_error: null },
      prefer: "return=representation",
    }).then((l) => {
      if (!l?.length) throw erro("Item não está com erro nem travado.");
      return { reenfileirados: l.length };
    }),
});

/** Consulta os jobs aguardando no serviço de geração de perfil e aplica os que terminaram. */
export async function verificarProcessamentos() {
  const r = await edge("perfil-site-job-tick");
  registrar({ acao: "verificar_processamentos", alvo: "-", dados: {}, resultado: "ok", detalhe: `${r.verificados ?? 0} job(s)` });
  return r;
}

// ---- Pendências e contexto ----------------------------------------------------------

const TRAVADO_MS = 2 * 3600_000; // item "processando" há mais de 2 h está travado

export async function pendencias() {
  const [feedbacks, contests, jobs, filaErro, filaTravada, aguardando] = await Promise.all([
    rpcAdmin("listar_feedbacks").catch((e) => ({ erro: String(e.message) })),
    rest("public", "site_contests", "select=id,created_at,tipo,status,site_informado,cnpj_usuario,cnpj_conflito,notas&or=(status.eq.pendente,and(status.eq.rejeitado,updated_at.gte." + new Date(Date.now() - 14 * 86400_000).toISOString() + "))&order=created_at.desc&limit=50"),
    rest("public", "perfil_site_jobs", "select=id,created_at,updated_at,cnpj,site,status,tentativas,erro&status=eq.erro&order=updated_at.desc&limit=30"),
    rest("busca_fornecedor", "fila_cadastro_perfil", "select=cnpj_basico,razao_social,municipio,uf,url_site,status,attempts,last_error,worker,updated_at&status=eq.erro&order=updated_at.desc&limit=50"),
    rest("busca_fornecedor", "fila_cadastro_perfil", `select=cnpj_basico,razao_social,municipio,uf,url_site,status,attempts,locked_by,locked_at,updated_at&status=eq.processando&locked_at=lt.${new Date(Date.now() - TRAVADO_MS).toISOString()}&order=locked_at.asc&limit=50`),
    rest("public", "perfil_site_jobs", "select=id&status=eq.aguardando"),
  ]);
  const fb = Array.isArray(feedbacks)
    ? feedbacks
        .filter((f: any) => f.status !== "Respondido")
        .map((f: any) => ({ id: f.id, em: f.created_at, motivo: f.motivo, texto: f.texto, status: f.status, temContato: !!(f.email || f.email_contato || f.telefone_contato) }))
    : [];
  return {
    feedbacks: fb,
    feedbacksErro: Array.isArray(feedbacks) ? null : (feedbacks as any).erro,
    contests,
    jobsErro: jobs,
    jobsAguardando: aguardando.length,
    filaErro,
    filaTravada,
    acoes: catalogo(),
    analises: analisesSalvas(),
    admin: bf.adminEmail || null,
  };
}

/** Contexto de um chamado para análise (sem e-mails/telefones). */
export async function contextoChamado(tipo: Acao["tipo"], alvo: string) {
  if (tipo === "feedback") {
    const [f] = await rest("busca_fornecedor", "feedback_usuario", `select=id,created_at,motivo,text,status&id=eq.${Number(alvo)}`);
    if (!f) throw erro("Feedback não encontrado.");
    return f;
  }
  if (tipo === "contest") {
    const c = await contest(alvo);
    const basico = String(c.cnpj_usuario ?? "").replace(/\D/g, "").slice(0, 8);
    const [perfis, jobs, outros] = await Promise.all([
      basico ? rest("busca_fornecedor", "company_profile", `select=cnpj,nome_empresa,is_dummy,url_atual:full_profile->contato->>url_site&cnpj=gte.${basico}000000&cnpj=lte.${basico}999999&limit=3`) : [],
      basico ? rest("public", "perfil_site_jobs", `select=created_at,site,status,tentativas,erro&cnpj=like.${basico}*&order=created_at.desc&limit=5`) : [],
      rest("public", "site_contests", `select=created_at,tipo,status,cnpj_usuario&site_informado=eq.${encodeURIComponent(c.site_informado)}&id=neq.${c.id}&limit=5`),
    ]);
    const { usuario_id, resolvido_por, ...resto } = c;
    return { contest: resto, perfilAtual: perfis, jobsDoCnpj: jobs, outrosContestsMesmoSite: outros };
  }
  if (tipo === "falha") {
    if (/^\d{8}$/.test(alvo)) return (await rest("busca_fornecedor", "fila_cadastro_perfil", `select=razao_social,municipio,uf,url_site,status,discovery_status,attempts,last_error,worker,locked_at,updated_at&cnpj_basico=eq.${alvo}`))[0];
    return (await rest("public", "perfil_site_jobs", `select=created_at,updated_at,cnpj,site,status,tentativas,erro&id=eq.${encodeURIComponent(alvo)}`))[0];
  }
  return { cnpj: alvo, previa: await rpcAdmin("admin_preview_troca_cnpj", { p_cnpj: alvo }).catch((e) => ({ erro: String(e.message) })) };
}

export function registrarAcao(a: Acao) {
  acao(a);
}

export const catalogo = () => ACOES.map(({ executar, ...a }) => a);

/** Executa uma ação do catálogo, aplicando a regra de confirmação e registrando no histórico. */
export async function executarAcao(id: string, alvo: string, params: Record<string, any> = {}) {
  const a = ACOES.find((x) => x.id === id);
  if (!a) throw erro("Ação desconhecida.");
  if (!alvo) throw erro("Informe o item.");
  if (a.risco !== "livre" && params.confirmar !== true) throw erro(`"${a.nome}" precisa de confirmação.`);
  try {
    const resultado = await a.executar(String(alvo), params);
    registrar({ acao: a.id, alvo: String(alvo), dados: params, resultado: "ok", detalhe: "" });
    return { ok: true, acao: a.id, resultado };
  } catch (e: any) {
    registrar({ acao: a.id, alvo: String(alvo), dados: params, resultado: "erro", detalhe: String(e?.message ?? e) });
    throw e;
  }
}

// ---- Análises gravadas pelo Claude Code -------------------------------------------------
// Ficam em memória e aparecem no dashboard junto do chamado (somem quando o servidor reinicia).

export type Analise = {
  resumo: string;
  categoria?: string;
  acao?: string | null;
  params?: Record<string, unknown>;
  justificativa?: string;
  resposta_sugerida?: string | null;
  confianca?: string;
  em?: string;
};
const analises = new Map<string, Analise>();

export function salvarAnalise(tipo: Acao["tipo"], alvo: string, a: Analise) {
  if (!["feedback", "contest", "falha", "cnpj"].includes(tipo)) throw erro("Tipo inválido.");
  if (a.acao && !ACOES.some((x) => x.id === a.acao && x.tipo === tipo)) throw erro(`Ação ${a.acao} não existe para ${tipo}.`);
  analises.set(`${tipo}:${alvo}`, { ...a, em: new Date().toISOString() });
  while (analises.size > 300) analises.delete(analises.keys().next().value!);
  return { ok: true };
}

export const analisesSalvas = () => Object.fromEntries(analises);

export { rpcAdmin, rest as restBf, sessaoAdmin, erro as erroAdmin };
