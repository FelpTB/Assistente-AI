// Painéis da esfera Trabalho: resumo de e-mails e projeto Busca Fornecedor.
import { $, api, esc, fill, fmtData, fmtHora } from "./util.js";
import { barChart, hBars } from "./charts.js";

const remetente = (de) => (de.match(/^"?([^"<]+?)"?\s*</)?.[1] ?? de).trim();
const num = (n) => (Number(n) || 0).toLocaleString("pt-BR");

// ---- Resumo de e-mails ------------------------------------------------------

export function renderEmails(el) {
  el.innerHTML = `
    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>E-mails mais recentes</h2><button class="btn sm" id="r-atual">Atualizar</button></div>
      <div id="r-lista"></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Todos os e-mails de hoje</h2>
        <div class="periodo"><button class="btn sm" id="m-atual">Atualizar</button><button class="btn sm primary" id="m-resumo">Resumir o dia com IA</button></div></div>
      <div id="m-ia"></div>
      <div id="m-lista"></div>
    </section>`;
  const recentes = () => {
    $("#r-lista").innerHTML = `<div class="loading">Lendo e resumindo os e-mails…</div>`;
    fill($("#r-lista"), () => api("/emails/recentes"), drawRecentes);
  };
  const hoje = () => fill($("#m-lista"), () => api("/emails/hoje"), drawEmailsHoje);
  $("#r-atual").onclick = recentes;
  $("#m-atual").onclick = hoje;
  $("#m-resumo").onclick = async (e) => {
    const btn = e.target;
    btn.disabled = true;
    $("#m-ia").innerHTML = `<div class="ia-box loading">Lendo os e-mails de hoje…</div>`;
    try {
      const r = await api("/emails/resumo", { method: "POST" });
      $("#m-ia").innerHTML = `<div class="ia-box">${formatarResumo(r.texto)}
        <div class="small muted">Resumo de ${r.emails} e-mail(s), gerado às ${fmtHora(r.geradoEm)}${r.cache ? " (sem e-mails novos desde então)" : ""}.</div></div>`;
    } catch (err) {
      $("#m-ia").innerHTML = `<div class="error">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  };
  recentes();
  hoje();
}

function drawRecentes(es) {
  if (!es.length) return `<div class="empty">Caixa de entrada vazia.</div>`;
  return `<div class="list">${es
    .map(
      (e) => `<div class="row mail-resumo ${e.naoLido ? "unread" : ""}">
        <span class="when">${esc(fmtData(e.recebidoEm, { semana: false }))}</span>
        <div class="grow">
          <a class="title" href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.assunto)}</a>
          <div class="meta"><span>${esc(remetente(e.de))}</span>${e.naoLido ? `<span class="tag">Não lido</span>` : ""}${e.importante ? `<span class="tag alta">Importante</span>` : ""}</div>
          <div class="resumo">${esc(e.resumo ?? e.trecho)}</div>
          ${e.acao ? `<div class="acao"><b>Ação:</b> ${esc(e.acao)}</div>` : ""}
        </div></div>`,
    )
    .join("")}</div>`;
}

/** Texto do resumo → HTML seguro: linhas "- " viram itens; as demais, títulos. */
function formatarResumo(texto) {
  let html = "";
  let aberto = false;
  for (const linha of texto.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const item = linha.match(/^[-•*]\s+(.*)$/);
    if (item) {
      if (!aberto) (html += "<ul>"), (aberto = true);
      html += `<li>${esc(item[1].replace(/\*\*/g, ""))}</li>`;
    } else {
      if (aberto) (html += "</ul>"), (aberto = false);
      html += `<h4>${esc(linha.replace(/[#*:]/g, "").trim())}</h4>`;
    }
  }
  return html + (aberto ? "</ul>" : "");
}

function drawEmailsHoje(es) {
  if (!es.length) return `<div class="empty">Nenhum e-mail recebido hoje.</div>`;
  const grupos = [
    ["Principal", es.filter((e) => e.categoria === "Principal" || e.categoria === "Fóruns")],
    ["Atualizações", es.filter((e) => e.categoria === "Atualizações")],
    ["Promoções e social", es.filter((e) => e.categoria === "Promoções" || e.categoria === "Social")],
  ].filter(([, l]) => l.length);
  return grupos
    .map(
      ([nome, l]) => `<details class="mail-group" ${nome === "Promoções e social" ? "" : "open"}>
      <summary><b>${esc(nome)}</b> <span class="muted small">${l.length} · ${l.filter((e) => e.naoLido).length} não lido(s)</span></summary>
      <div class="list">${l
        .map(
          (e) => `<a class="row mail ${e.naoLido ? "unread" : ""}" href="${esc(e.link)}" target="_blank" rel="noopener">
            <span class="when">${esc(fmtHora(e.recebidoEm))}</span>
            <div class="grow"><div class="title">${esc(e.assunto)}</div>
              <div class="meta"><span>${esc(remetente(e.de))}</span>${e.importante ? `<span class="tag alta">Importante</span>` : ""}</div>
              <div class="small muted snippet">${esc(e.trecho)}</div></div></a>`,
        )
        .join("")}</div></details>`,
    )
    .join("");
}

// ---- Projeto Busca Fornecedor -----------------------------------------------

let bancoCache = null; // para redesenhar os gráficos no resize

// ---- Seções recolhíveis ------------------------------------------------------
// O estado (aberta/fechada) de cada seção fica salvo no navegador.

const CHAVE_SECOES = "bf-secoes";
let estadoSecoes = {};
try {
  estadoSecoes = JSON.parse(localStorage.getItem(CHAVE_SECOES) ?? "{}");
} catch {}
const aoAbrir = {}; // id da seção → carregamento sob demanda

function secao({ id, titulo, sub = "", extra = "", span = 12, spanFechada = span, aberto = true, corpo }) {
  const open = estadoSecoes[id] ?? aberto;
  return `<section class="card recolhivel span-${open ? span : spanFechada} ${open ? "" : "fechada"}" data-secao="${id}" data-span="${span}" data-span-fechada="${spanFechada}">
    <div class="card-head"><button class="secao-toggle" type="button" aria-expanded="${open}"><span class="chev" aria-hidden="true"></span><h2>${titulo}</h2></button>
      <span class="muted small secao-sub" id="${id}-sub">${sub}</span><div class="secao-extra">${extra}</div></div>
    <div class="secao-corpo" id="${corpo}"></div></section>`;
}

function alternarSecao(sec, abrir = sec.classList.contains("fechada")) {
  sec.classList.toggle("fechada", !abrir);
  sec.classList.remove(`span-${sec.dataset.span}`, `span-${sec.dataset.spanFechada}`);
  sec.classList.add(`span-${abrir ? sec.dataset.span : sec.dataset.spanFechada}`);
  sec.querySelector(".secao-toggle").setAttribute("aria-expanded", String(abrir));
  estadoSecoes[sec.dataset.secao] = abrir;
  try {
    localStorage.setItem(CHAVE_SECOES, JSON.stringify(estadoSecoes));
  } catch {}
  if (abrir) {
    aoAbrir[sec.dataset.secao]?.();
    redesenharTrabalho();
  }
}

export function renderBuscaFornecedor(el) {
  const grupos = [...new Set(ADMIN_GRUPOS)];
  el.innerHTML = `
    <div class="page-head" style="margin-bottom:10px">
      <div class="muted small">Site no Lovable, banco no Supabase e automações no n8n. Telefones e e-mails mascarados; chaves e códigos nunca são lidos.</div>
      <div class="periodo"><button class="btn sm" id="bf-recolher">Recolher tudo</button><button class="btn sm" id="bf-atual">Atualizar tudo</button></div>
    </div>
    <div id="bf-alertas" class="alertas"></div>
    <div class="grid">
      ${secao({ id: "site", titulo: "Site", sub: "Lovable", span: 4, corpo: "bf-site" })}
      ${secao({ id: "automacoes", titulo: "Automações", sub: "n8n", span: 8, corpo: "bf-n8n-kpis" })}
      ${secao({ id: "consultas", titulo: "Consultas", sub: "Supabase", corpo: "bf-consultas" })}
      ${secao({ id: "cadastros", titulo: "Cadastros", sub: "compradores e fornecedores", corpo: "bf-cadastros" })}
      ${secao({
        id: "ultimas-buscas", titulo: "Últimas buscas", aberto: false, corpo: "bf-buscas",
        extra: `<div class="periodo"><select id="bf-buscas-origem"></select><select id="bf-buscas-qual"></select></div>`,
      })}
      ${secao({
        id: "ultimos-cadastros", titulo: "Últimos cadastros", aberto: false, corpo: "bf-cad-lista",
        extra: `<div class="theme-switch" id="bf-cad-tipo" role="group"><button data-t="compradores" aria-pressed="true">Compradores</button><button data-t="fornecedores" aria-pressed="false">Fornecedores</button></div>`,
      })}
      ${secao({ id: "compradores", titulo: "Compradores", span: 6, aberto: false, corpo: "bf-compradores" })}
      ${secao({ id: "fornecedores", titulo: "Fornecedores", span: 6, aberto: false, corpo: "bf-fornecedores" })}
      ${secao({ id: "perfis", titulo: "Perfis de empresa", sub: "company_profile", aberto: false, corpo: "bf-perfis" })}
      ${secao({ id: "execucoes", titulo: "Últimas execuções do n8n", aberto: false, corpo: "bf-n8n-lista" })}
    </div>
    <h2 class="grupo-titulo">Painel de admin</h2>
    <div id="bf-admin">${grupos
      .map(
        (g) => `<h3 class="grupo-sub">${esc(g)}</h3><div class="grid" data-grupo="${esc(g)}"><div class="loading span-12">Carregando…</div></div>`,
      )
      .join("")}</div>`;

  el.onclick = (e) => {
    const t = e.target.closest(".secao-toggle");
    if (t) return alternarSecao(t.closest(".recolhivel"));
    const a = e.target.closest("[data-abrir]");
    if (a) {
      const sec = el.querySelector(`[data-secao="${a.dataset.abrir}"]`);
      if (sec) {
        alternarSecao(sec, true);
        sec.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  };
  $("#bf-recolher").onclick = () => el.querySelectorAll(".recolhivel:not(.fechada)").forEach((s) => alternarSecao(s, false));

  const carregar = (forcar) => {
    const q = forcar ? "?forcar=1" : "";
    alertas.n8n = null;
    fill($("#bf-site"), () => api(`/projetos/busca-fornecedor/site${q}`), drawSite);
    carregarN8n(q);
    carregarBanco(q);
    carregarBuscas(q);
    carregarCadastros(q);
    carregarAdmin(q);
  };
  $("#bf-atual").onclick = () => carregar(true);
  carregar(false);
}

// ---- Alertas no topo ----------------------------------------------------------

const alertas = { n8n: null, tabelas: [] };

function drawAlertas() {
  const el = $("#bf-alertas");
  if (!el) return;
  const itens = [];
  if (alertas.n8n) itens.push(`<button class="alerta" data-abrir="execucoes"><b>${num(alertas.n8n)}</b> erro(s) no n8n em 24 h</button>`);
  for (const t of alertas.tabelas) itens.push(`<button class="alerta" data-abrir="t-${t.id}"><b>${num(t.pendentes)}</b> ${esc(t.nome.toLowerCase())} ${esc(t.pendenteNome)}</button>`);
  el.innerHTML = itens.length ? itens.join("") : `<span class="alerta ok">Nada pendente no painel de admin.</span>`;
}

// ---- Painel de admin (tabelas do Supabase) ------------------------------------

// Ordem dos grupos na página (os nomes vêm da API).
const ADMIN_GRUPOS = ["Atendimento", "Busca", "Mensageria", "Engajamento", "Cadastro de perfis", "Sistema e acesso"];
const detalhes = new Map(); // id → dados já carregados

async function carregarAdmin(q) {
  detalhes.clear();
  try {
    const r = await api(`/projetos/busca-fornecedor/tabelas${q}`);
    for (const g of ADMIN_GRUPOS) {
      const box = document.querySelector(`#bf-admin [data-grupo="${g}"]`);
      if (!box) continue;
      const ts = r.tabelas.filter((t) => t.grupo === g);
      box.innerHTML = ts
        .map((t) => secao({ id: `t-${t.id}`, titulo: esc(t.nome), sub: subTabela(t), span: 12, spanFechada: 6, aberto: false, corpo: `bf-t-${t.id}` }))
        .join("");
      for (const t of ts) {
        aoAbrir[`t-${t.id}`] = () => carregarTabela(t, q);
        if (estadoSecoes[`t-${t.id}`]) carregarTabela(t, q);
      }
    }
    alertas.tabelas = r.tabelas.filter((t) => t.pendentes);
    drawAlertas();
  } catch (err) {
    $("#bf-admin").innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

function subTabela(t) {
  if (t.erro) return `<span class="tag alta" title="${esc(t.erro)}">erro ao ler</span>`;
  const partes = [`${t.estimado ? "≈ " : ""}${num(t.total)}`];
  if (t.ult24h) partes.push(`+${num(t.ult24h)} em 24 h`);
  let s = partes.join(" · ");
  if (t.pendentes) s += ` <span class="tag alta">${num(t.pendentes)} ${esc(t.pendenteNome)}</span>`;
  return s;
}

async function carregarTabela(t, q) {
  const el = $(`#bf-t-${t.id}`);
  if (!el || detalhes.has(t.id)) return;
  detalhes.set(t.id, null);
  el.innerHTML = `<div class="loading">Carregando…</div>`;
  try {
    const d = await api(`/projetos/busca-fornecedor/tabelas/${t.id}${q}`);
    detalhes.set(t.id, d);
    el.innerHTML = drawTabelaAdmin(t, d);
  } catch (err) {
    detalhes.delete(t.id);
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

function celula(v, tipo) {
  if (v == null) return `<span class="muted">—</span>`;
  switch (tipo) {
    case "data":
      return `<span class="nowrap">${esc(fmtData(v, { semana: false }))}</span>`;
    case "bool":
      return v ? `<span class="tag ok">sim</span>` : `<span class="muted">não</span>`;
    case "link":
      return linkSite(String(v));
    case "tel":
    case "email":
      return `<span class="nowrap">${esc(v)}</span>`;
    case "num":
      return num(v);
    case "texto":
      return `<span class="cel-texto" title="${esc(v)}">${esc(v)}</span>`;
    case "json":
      return `<code class="small">${esc(v)}</code>`;
    default:
      return esc(v);
  }
}

function drawTabelaAdmin(t, d) {
  const kpis = [
    kpi("Total", `${t.estimado ? "≈ " : ""}${num(t.total)}`),
    t.ult24h != null ? kpi("Últimas 24 h", num(t.ult24h)) : "",
    d.ult7d != null ? kpi("Últimos 7 dias", num(d.ult7d)) : "",
    t.pendentes != null ? kpi(t.pendenteNome[0].toUpperCase() + t.pendenteNome.slice(1), num(t.pendentes), "", t.pendentes ? "neg" : "") : "",
  ].filter(Boolean);
  const dist = d.distribuicoes
    .filter((x) => x.itens.length)
    .map(
      (x) => `<div class="dist"><span class="muted small">${esc(x.coluna)}</span>${x.itens
        .map((i) => `<span class="pill">${esc(i.nome)} <b>${num(i.n)}</b></span>`)
        .join("")}</div>`,
    )
    .join("");
  const funil = d.funil
    ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Variante</th><th class="num">Sessões</th>${d.funil.etapas.map((e) => `<th class="num">${esc(e)}</th>`).join("")}</tr></thead>
        <tbody>${d.funil.grupos
          .map(
            (g) => `<tr><td><b>${esc(g.nome)}</b></td><td class="num">${num(g.total)}</td>${g.etapas
              .map((n) => `<td class="num">${num(n)} <span class="muted small">${g.total ? Math.round((n / g.total) * 100) : 0}%</span></td>`)
              .join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`
    : "";
  const linhas = d.linhas.length
    ? `<div class="tbl-wrap"><table class="tbl tbl-admin"><thead><tr>${d.colunas.map((c) => `<th>${esc(c.nome)}</th>`).join("")}</tr></thead>
        <tbody>${d.linhas.map((l) => `<tr>${d.colunas.map((c) => `<td>${celula(l[c.c], c.tipo)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : `<div class="empty">Tabela vazia.</div>`;
  return `
    ${t.descricao ? `<p class="small muted" style="margin:0 0 8px">${esc(t.descricao)}</p>` : ""}
    ${kpis.length > 1 ? `<div class="kpis kpis-${Math.min(kpis.length, 4)}">${kpis.join("")}</div>` : ""}
    ${dist ? `<div class="dists">${dist}${d.amostra ? `<div class="small muted">nas ${num(d.amostra)} linhas mais recentes</div>` : ""}</div>` : ""}
    ${funil}
    <h3 class="small muted" style="margin:12px 0 6px">Mais recentes (${d.linhas.length})</h3>
    ${linhas}`;
}

function drawSite(s) {
  const ok = s.noAr && !s.lento;
  return `
    <div class="status-item" style="margin-bottom:10px"><span class="dot ${s.noAr ? (ok ? "ok" : "warn") : "bad"}"></span>
      <div><div><b>${s.noAr ? (s.lento ? "No ar, lento" : "No ar") : "Fora do ar"}</b></div>
      <div class="detail">${s.erro ? esc(s.erro) : `HTTP ${s.httpStatus} · ${num(s.tempoMs)} ms`}</div></div></div>
    <div class="small">${s.titulo ? `<div><span class="muted">Título:</span> ${esc(s.titulo)}</div>` : ""}
      <div><a href="${esc(s.urlFinal ?? s.url)}" target="_blank" rel="noopener">${esc(s.urlFinal ?? s.url)}</a></div>
      ${s.ultimaAlteracao ? `<div class="muted">Última alteração: ${esc(fmtData(new Date(s.ultimaAlteracao).toISOString()))}</div>` : ""}
      <div class="muted">Verificado às ${esc(fmtHora(s.atualizadoEm))}</div></div>`;
}

async function carregarN8n(q) {
  const kpis = $("#bf-n8n-kpis");
  const lista = $("#bf-n8n-lista");
  kpis.innerHTML = lista.innerHTML = `<div class="loading">Carregando…</div>`;
  try {
    const n = await api(`/projetos/busca-fornecedor/n8n${q}`);
    kpis.innerHTML = `
      <div class="kpis kpis-4">
        <div class="kpi"><div class="label">Workflows ativos</div><div class="value">${num(n.workflowsAtivos)}</div><div class="small muted">de ${num(n.workflowsTotal)}</div></div>
        <div class="kpi"><div class="label">Erros em 24 h</div><div class="value ${n.erros24h ? "neg" : ""}">${num(n.erros24h)}</div></div>
        <div class="kpi"><div class="label">Erros em 7 dias</div><div class="value ${n.erros7d ? "neg" : ""}">${num(n.erros7d)}</div></div>
        <div class="kpi"><div class="label">Última execução</div><div class="value small-value">${n.ultimas[0] ? esc(fmtData(n.ultimas[0].inicio)) : "—"}</div></div>
      </div>
      ${n.errosPorWorkflow.length ? `<h3 class="small muted" style="margin:12px 0 8px">Erros por workflow · 7 dias</h3>${hBars(n.errosPorWorkflow.slice(0, 6).map((e) => ({ label: e.nome, value: e.n })), num)}` : ""}`;
    lista.innerHTML = drawExecucoes(n.ultimas, n.ultimosErros);
    alertas.n8n = n.erros24h;
    drawAlertas();
  } catch (err) {
    kpis.innerHTML = `<div class="error">${esc(err.message)}</div>`;
    lista.innerHTML = "";
  }
}

function drawExecucoes(ultimas, erros) {
  const statusTag = (s) => {
    const cls = s === "error" || s === "crashed" ? "alta" : s === "success" ? "ok" : "";
    const nome = { success: "Sucesso", error: "Erro", crashed: "Falhou", running: "Rodando", waiting: "Aguardando", canceled: "Cancelada" }[s] ?? s;
    return `<span class="tag ${cls}">${esc(nome)}</span>`;
  };
  const dur = (ms) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`);
  const tabela = (l) =>
    l.length
      ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Workflow</th><th>Status</th><th>Início</th><th class="num">Duração</th><th></th></tr></thead><tbody>${l
          .map(
            (e) => `<tr><td>${esc(e.workflow)}</td><td>${statusTag(e.status)}</td><td class="nowrap">${esc(fmtData(e.inicio))}</td>
              <td class="num">${dur(e.duracaoMs)}</td><td><a href="${esc(e.link)}" target="_blank" rel="noopener" class="small">Abrir</a></td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : `<div class="empty">Nenhuma execução.</div>`;
  return `${erros.length ? `<details class="mail-group" open><summary><b>Últimos erros</b> <span class="muted small">${erros.length}</span></summary>${tabela(erros)}</details>` : ""}
    <details class="mail-group" ${erros.length ? "" : "open"}><summary><b>Todas as execuções recentes</b> <span class="muted small">${ultimas.length}</span></summary>${tabela(ultimas)}</details>`;
}

async function carregarBanco(q) {
  const ids = ["#bf-consultas", "#bf-cadastros", "#bf-compradores", "#bf-fornecedores", "#bf-perfis"];
  ids.forEach((id) => ($(id).innerHTML = `<div class="loading">Consultando o banco…</div>`));
  try {
    const b = await api(`/projetos/busca-fornecedor/banco${q}`);
    bancoCache = b;
    $("#bf-banco-at").textContent = `Supabase · atualizado às ${fmtHora(b.atualizadoEm)}`;
    drawBanco(b);
  } catch (err) {
    ids.forEach((id) => ($(id).innerHTML = `<div class="error">${esc(err.message)}</div>`));
  }
}

const kpi = (label, valor, extra = "", cls = "") =>
  `<div class="kpi"><div class="label">${esc(label)}</div><div class="value ${cls}">${valor}</div>${extra ? `<div class="small muted">${extra}</div>` : ""}</div>`;

function drawBanco(b) {
  const c = b.consultas;
  $("#bf-consultas").innerHTML = `
    <div class="kpis kpis-4">
      ${kpi("Últimas 24 h", num(c.ultimas24h))}
      ${kpi("Últimos 7 dias", num(c.ultimos7d))}
      ${kpi("Últimos 30 dias", num(c.ultimos30d))}
      ${kpi("Total", num(c.total), `${num(c.pendentes)} pendente(s) · fallback em ${c.fallbackPct}%`)}
    </div>
    <div class="grid" style="margin-top:16px">
      <div class="span-8"><h3 class="small muted" style="margin-bottom:8px">Consultas por dia · 30 dias</h3><div id="bf-graf-consultas"></div></div>
      <div class="span-4">
        <h3 class="small muted" style="margin-bottom:8px">Por origem</h3>${hBars(c.porOrigem.map((x) => ({ label: x.nome, value: x.n })), num)}
        <h3 class="small muted" style="margin:14px 0 8px">Qualidade avaliada <span class="muted">(${num(c.avaliadas)})</span></h3>
        ${hBars(c.qualidade.map((x) => ({ label: x.nome, value: x.n })), num)}
      </div>
    </div>`;
  desenharGraficoConsultas();

  const u = b.compradores;
  const f = b.fornecedores;
  $("#bf-cadastros").innerHTML = `
    <div class="kpis kpis-2">
      ${kpi("Compradores novos", `${num(u.novos24h)} <span class="muted small-value">em 24 h</span>`, `${num(u.novos7d)} em 7 dias · ${num(u.novos30d)} em 30 dias`)}
      ${kpi("Fornecedores novos", `${num(f.novos24h)} <span class="muted small-value">em 24 h</span>`, `${num(f.novos7d)} em 7 dias · ${num(f.novos30d)} em 30 dias`)}
    </div>
    <h3 class="small muted" style="margin:16px 0 8px">Cadastros por dia · 30 dias</h3>
    <div id="bf-graf-cadastros"></div>`;
  desenharGraficoCadastros();

  $("#bf-compradores").innerHTML = `
    <div class="kpis kpis-2">
      ${kpi("Compradores", num(u.total), `${num(u.novos30d)} novos em 30 dias`)}
      ${kpi("Buscas realizadas", num(u.buscasRealizadas), `${u.telefoneVerificadoPct}% com telefone verificado · ${num(u.comAgente)} com agente`)}
    </div>
    <h3 class="small muted" style="margin:14px 0 8px">Por tier</h3>${hBars(u.porTier.map((x) => ({ label: x.nome, value: x.n })), num)}`;

  $("#bf-fornecedores").innerHTML = `
    <div class="kpis kpis-2">
      ${kpi("Fornecedores", num(f.total), `${num(f.novos30d)} novos em 30 dias · ${num(f.cadastroIncompleto)} com cadastro incompleto`)}
      ${kpi("Assinatura ativa", num(f.assinaturaAtiva), f.completudeMedia != null ? `perfil ${f.completudeMedia}% completo em média` : "")}
      ${kpi("Créditos pagos", num(f.creditosPagos))}
      ${kpi("Créditos gastos", num(f.creditosGastos))}
    </div>
    <h3 class="small muted" style="margin:14px 0 8px">Por plano</h3>${hBars(f.porPlano.map((x) => ({ label: x.nome, value: x.n })), num)}`;

  const p = b.perfisEmpresa;
  $("#bf-perfis").innerHTML = `
    <div class="kpis kpis-4">
      ${kpi("Total", `≈ ${num(p.totalAproximado)}`, "estimativa do Postgres")}
      ${kpi("Novos em 7 dias", num(p.novos7d))}
      ${kpi("Novos em 30 dias", `${num(p.novos30d)}${p.novos30dNoLimite ? "+" : ""}`, `${num(p.cadastradosPeloSite30d)} cadastrados pelo site`)}
      ${kpi("Com erro (30 dias)", num(p.comErro30d), `${num(p.whatsappValido30d)} com WhatsApp válido`, p.comErro30d ? "neg" : "")}
    </div>`;
}

function desenharGraficoConsultas() {
  const el = $("#bf-graf-consultas");
  if (!bancoCache || !el) return;
  const s = bancoCache.consultas.porDia;
  barChart(
    el,
    { labels: s.map((d) => fmtData(d.data, { semana: false })), series: [{ name: "Consultas", color: "--series-1", values: s.map((d) => d.n) }] },
    { height: 200, fmt: (v) => num(v), title: "Consultas por dia" },
  );
}

function desenharGraficoCadastros() {
  const el = $("#bf-graf-cadastros");
  if (!bancoCache || !el) return;
  const c = bancoCache.compradores.porDia;
  const f = bancoCache.fornecedores.porDia;
  barChart(
    el,
    {
      labels: c.map((d) => fmtData(d.data, { semana: false })),
      series: [
        { name: "Compradores", color: "--series-1", values: c.map((d) => d.n) },
        { name: "Fornecedores", color: "--series-2", values: f.map((d) => d.n) },
      ],
    },
    { height: 200, fmt: (v) => num(v), title: "Cadastros por dia" },
  );
}

export function redesenharTrabalho() {
  desenharGraficoConsultas();
  desenharGraficoCadastros();
}

// ---- Ponto (data table do n8n) ----------------------------------------------

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function mesAnteriorISO() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function renderPonto(el) {
  el.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Ponto do mês</h2>
        <div class="periodo">
          <input type="month" id="p-mes" value="${mesAnteriorISO()}">
          <a class="btn sm" id="p-baixar" href="#">Baixar planilha (.xlsx)</a>
          <button class="btn sm primary" id="p-enviar">Enviar por e-mail</button>
        </div></div>
      <p class="small muted">Lido da tabela de ponto do n8n. No dia 1, o agente prepara o mês anterior e pede aprovação no WhatsApp antes de enviar por e-mail.
        Para rodar a rotina agora, use <b>Enviar por e-mail</b> ou mande <b>/ponto</b> no grupo do WhatsApp.</p>
      <div id="p-status"></div>
      <div id="p-dados"></div>
    </section>
    <section class="card" style="margin-top:16px">
      <div class="card-head"><h2>Tabelas no n8n</h2><button class="btn sm" id="p-tabelas">Mostrar</button></div>
      <div id="p-lista"></div>
    </section>`;
  let atual = null; // último resumo carregado (mês, destinatário)
  const carregar = async () => {
    const mes = $("#p-mes").value;
    $("#p-baixar").href = `/api/ponto/planilha?mes=${mes}`;
    $("#p-status").innerHTML = "";
    atual = await fill($("#p-dados"), () => api(`/ponto?mes=${mes}`), drawPonto);
    if (atual?.dias?.length)
      api(`/ponto/enviado?mes=${mes}`)
        .then((r) => {
          if (r.enviado && $("#p-mes").value === mes)
            $("#p-status").innerHTML = `<div class="notice">A planilha de ${esc(atual.nomeMes)} já foi enviada para ${esc(atual.enviarPara)}. Enviar de novo manda outra cópia.</div>`;
        })
        .catch(() => {});
  };
  $("#p-mes").onchange = carregar;
  $("#p-enviar").onclick = async () => {
    const mes = $("#p-mes").value;
    const btn = $("#p-enviar");
    if (atual && atual.mes === mes && !atual.dias.length) {
      $("#p-status").innerHTML = `<div class="error">Não há registros em ${esc(atual.nomeMes)} para enviar.</div>`;
      return;
    }
    const para = atual?.enviarPara ?? "o e-mail configurado";
    if (!confirm(`Enviar a planilha de ponto de ${atual?.nomeMes ?? mes} para ${para}?`)) return;
    btn.disabled = true;
    btn.textContent = "Enviando…";
    try {
      const r = await api("/ponto/enviar", { method: "POST", body: { mes } });
      $("#p-status").innerHTML = `<div class="notice">Enviado para <b>${esc(r.enviadoPara)}</b>: ${esc(r.mes)}, ${r.diasTrabalhados} dias, total ${esc(r.total)}${r.incompletos.length ? ` · ${r.incompletos.length} dia(s) com registro incompleto` : ""}.</div>`;
    } catch (err) {
      $("#p-status").innerHTML = `<div class="error">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Enviar por e-mail";
    }
  };
  $("#p-tabelas").onclick = () => fill($("#p-lista"), () => api("/ponto/tabelas"), drawTabelas);
  carregar();
}

function drawPonto(r) {
  const fonte = `<p class="small muted">Tabela <b>${esc(r.tabela)}</b> no n8n</p>`;
  if (!r.dias.length) {
    const g = r.diagnostico;
    const fmt = (d) => (d ? d.split("-").reverse().join("/") : "—");
    return `${fonte}<div class="empty">Nenhum registro em ${esc(r.nomeMes)}.</div>
      <div class="notice">A tabela tem <b>${g.linhas}</b> batida(s)${g.linhas ? `, de ${fmt(g.primeiroDia)} a ${fmt(g.ultimoDia)}` : ""}.</div>
      ${g.exemplo ? `<p class="small muted">Última linha, como veio do n8n:</p><pre class="small" style="white-space:pre-wrap;overflow-x:auto">${esc(JSON.stringify(g.exemplo, null, 2))}</pre>` : ""}`;
  }
  const h = (m) => (m == null ? `<span class="muted">—</span>` : hhmm(m));
  return `
    <div class="kpis">
      <div class="kpi"><div class="label">Total de horas</div><div class="value">${r.total}</div></div>
      <div class="kpi"><div class="label">Dias trabalhados</div><div class="value">${r.diasTrabalhados}</div></div>
      <div class="kpi"><div class="label">Registro incompleto</div><div class="value">${r.incompletos.length}</div><div class="small muted">dias para conferir</div></div>
    </div>
    ${fonte}
    <div style="overflow-x:auto"><table class="tbl">
      <thead><tr><th>Data</th><th>Dia</th><th>Entrada</th><th>Saída almoço</th><th>Volta almoço</th><th>Saída</th><th>Almoço</th><th>Horas</th><th>Obs.</th></tr></thead>
      <tbody>${r.dias
        .map(
          (d) => `<tr>
          <td>${d.dia.split("-").reverse().join("/")}</td><td>${esc(d.semana)}</td>
          <td>${h(d.entrada)}</td><td>${h(d.almocoInicio)}</td><td>${h(d.almocoFim)}</td><td>${h(d.saida)}</td>
          <td>${hhmm(d.almoco)}</td><td><b>${hhmm(d.minutos)}</b></td>
          <td>${d.pendencias.map((x) => `<span class="tag alta">${esc(x)}</span>`).join(" ")}</td></tr>`,
        )
        .join("")}</tbody>
    </table></div>`;
}

function drawTabelas(ts) {
  if (!ts.length) return `<div class="empty">Nenhuma data table no n8n.</div>`;
  return `<div class="list">${ts
    .map((t) => `<div class="row"><div class="grow"><b>${esc(t.nome)}</b> <span class="muted small">${esc(t.id)}</span>
      <div class="small muted">${t.colunas.length ? t.colunas.map((c) => `${esc(c.nome)} (${esc(c.tipo)})`).join(" · ") : "colunas não informadas pela API"}</div></div></div>`)
    .join("")}</div>`;
}

// ---- Últimas buscas ---------------------------------------------------------

let buscasCache = [];

async function carregarBuscas(q) {
  const el = $("#bf-buscas");
  el.innerHTML = `<div class="loading">Carregando…</div>`;
  try {
    buscasCache = (await api(`/projetos/busca-fornecedor/buscas${q}`)).buscas;
    const opcoes = (l) => [...new Set(l.filter(Boolean))].map((o) => `<option>${esc(o)}</option>`).join("");
    $("#bf-buscas-origem").innerHTML = `<option value="">Todas as origens</option>${opcoes(buscasCache.map((b) => b.origem))}`;
    $("#bf-buscas-qual").innerHTML = `<option value="">Qualquer qualidade</option><option value="sem">Sem avaliação</option>${opcoes(buscasCache.map((b) => b.qualidade))}`;
    $("#bf-buscas-origem").onchange = $("#bf-buscas-qual").onchange = drawBuscas;
    drawBuscas();
  } catch (err) {
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

const TOM_QUALIDADE = { Ótimo: "ok", Bom: "ok", Ruim: "alta", Péssimo: "alta" };
const tagQualidade = (q) => (q ? `<span class="tag ${TOM_QUALIDADE[q] ?? ""}">${esc(q)}</span>` : `<span class="tag">sem avaliação</span>`);
const quando = (iso) => fmtData(iso, { semana: false });
const linkSite = (s) =>
  `<a href="${esc(/^https?:\/\//.test(s) ? s : `https://${s}`)}" target="_blank" rel="noopener">${esc(s.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`;

function drawBuscas() {
  const origem = $("#bf-buscas-origem").value;
  const qual = $("#bf-buscas-qual").value;
  const bs = buscasCache.filter((b) => (!origem || b.origem === origem) && (!qual || (qual === "sem" ? !b.qualidade : b.qualidade === qual)));
  $("#bf-buscas").innerHTML = bs.length
    ? `<p class="small muted">${bs.length} de ${buscasCache.length} buscas mais recentes. Clique numa busca para ver os parâmetros e os resultados.</p>
       <div class="buscas">${bs.map(drawBusca).join("")}</div>`
    : `<div class="empty">Nenhuma busca com esses filtros.</div>`;
}

function drawBusca(b) {
  const quem = b.comprador ? [b.comprador.nome, b.comprador.empresa].filter(Boolean).join(" · ") : "sem comprador";
  const poucos = b.status !== "pending" && b.nResultados < 5;
  return `<details class="busca">
    <summary>
      <span class="when">${esc(quando(b.em))}</span>
      <span class="grow"><b>${esc(b.descricao ?? "(sem descrição)")}</b>
        <span class="meta"><span>${esc(b.local)}</span><span>${esc(quem)}</span><span>${esc(b.origem ?? "?")}</span></span></span>
      <span class="busca-tags">
        ${b.status === "pending" ? `<span class="tag alta">pendente</span>` : `<span class="tag ${poucos ? "alta" : ""}">${b.nResultados} resultado(s)</span>`}
        ${b.fallback ? `<span class="tag alta">fallback</span>` : ""}
        ${tagQualidade(b.qualidade)}
      </span>
    </summary>
    <div class="busca-corpo">
      <dl class="params">
        <dt>Tipo</dt><dd>${esc(b.tipoBusca ?? "—")}</dd>
        <dt>Local</dt><dd>${esc(b.local)}${b.municipios ? ` <span class="muted">(${b.municipios} municípios)</span>` : ""}</dd>
        ${b.modeloNegocio ? `<dt>Modelo</dt><dd>${esc(b.modeloNegocio)}</dd>` : ""}
        <dt>Termos</dt><dd>${esc(b.termos ?? "—")}</dd>
        <dt>Notas</dt><dd>${b.notaMedia != null ? `média ${b.notaMedia} · mínima ${b.notaMin}` : "—"}</dd>
      </dl>
      ${
        b.resultados.length
          ? `<div style="overflow-x:auto"><table class="tbl">
          <thead><tr><th>#</th><th>Empresa</th><th>Nota</th><th>Modelo</th><th>Escopo</th><th>Plano</th><th>Site</th></tr></thead>
          <tbody>${b.resultados
            .map(
              (r, i) => `<tr><td>${r.posicao ?? i + 1}</td><td>${esc(r.empresa ?? "—")}</td><td>${r.nota ?? "—"}</td>
              <td>${esc(r.modelo ?? "—")}</td><td>${esc(r.escopo ?? "—")}</td>
              <td>${r.plano ? `<span class="tag ok">${esc(r.plano)}</span>` : ""}</td><td>${r.site ? linkSite(r.site) : ""}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
          : `<div class="empty">Sem resultados.</div>`
      }
    </div>
  </details>`;
}

// ---- Últimos cadastros ------------------------------------------------------

let cadastrosCache = null;
let cadastroTipo = "compradores";

function carregarCadastros(q) {
  $("#bf-cad-tipo").onclick = (e) => {
    const t = e.target.closest("button")?.dataset.t;
    if (!t) return;
    cadastroTipo = t;
    $("#bf-cad-tipo").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === t)));
    if (cadastrosCache) $("#bf-cad-lista").innerHTML = drawCadastros(cadastrosCache);
  };
  fill($("#bf-cad-lista"), () => api(`/projetos/busca-fornecedor/cadastros${q}`), (c) => {
    cadastrosCache = c;
    return drawCadastros(c);
  });
}

const selo = (v, texto, tom = "ok") => (v ? `<span class="tag ${tom}">${texto}</span>` : "");

function drawCadastros(c) {
  if (cadastroTipo === "compradores") {
    if (!c.compradores.length) return `<div class="empty">Nenhum comprador.</div>`;
    return `<div style="overflow-x:auto"><table class="tbl">
      <thead><tr><th>Cadastro</th><th>Nome</th><th>Empresa</th><th>Telefone</th><th>Fonte</th><th>Tier</th><th>Buscas</th><th>Acessos</th><th></th></tr></thead>
      <tbody>${c.compradores
        .map(
          (u) => `<tr><td class="nw">${esc(quando(u.em))}</td><td>${esc(u.nome ?? "—")}</td><td>${esc(u.empresa ?? "—")}</td>
          <td class="nw">${esc(u.telefone ?? "—")} ${selo(u.telefoneVerificado, "verificado")}</td>
          <td>${esc(u.fonte ?? "—")}</td><td>${esc(u.tier ?? "—")}</td>
          <td>${u.buscas}${u.limiteBuscas != null ? ` / ${u.limiteBuscas}` : ""}</td><td>${u.acessos}</td>
          <td>${selo(u.agente, "agente")} ${selo(u.indicado, "indicado", "")}</td></tr>`,
        )
        .join("")}</tbody></table></div>`;
  }
  if (!c.fornecedores.length) return `<div class="empty">Nenhum fornecedor.</div>`;
  return `<div style="overflow-x:auto"><table class="tbl">
    <thead><tr><th>Cadastro</th><th>Nome</th><th>CNPJ</th><th>Telefone</th><th>Plano</th><th>Perfil</th><th>Créditos</th><th>Acessos</th><th></th></tr></thead>
    <tbody>${c.fornecedores
      .map(
        (f) => `<tr><td class="nw">${esc(quando(f.em))}</td><td>${esc(f.nome ?? "—")}</td><td class="nw">${esc(f.cnpj ?? "—")}</td><td class="nw">${esc(f.telefone ?? "—")}</td>
        <td>${esc(f.plano ?? "—")} ${selo(f.assinaturaAtiva, "assinante")}</td>
        <td>${f.completude != null ? `${f.completude}%` : "—"} ${selo(f.cadastroIncompleto, "incompleto", "alta")}</td>
        <td>${f.creditos} <span class="muted small">(${f.creditosGastos} gastos)</span></td><td>${f.acessos}</td>
        <td>${f.upgrade ? `<span class="tag">${esc(f.upgrade)}</span>` : ""}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
}
