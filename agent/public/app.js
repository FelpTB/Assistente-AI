// Dashboard do Assistente AI — sem build: HTML + JS puro (módulos ES), dados via /api.
import { $, api, addDias, brl, diaDe, esc, fill, fmtData, fmtHora, hojeISO, setOnUnauthorized } from "./util.js";
import { renderFinancas, redesenharFinancas } from "./financas.js";
import { redesenharTrabalho, renderBuscaFornecedor, renderEmails } from "./trabalho.js";

/** Redesenha os gráficos visíveis (troca de tema ou de largura). */
const redesenhar = () => {
  redesenharFinancas();
  redesenharTrabalho();
};

const main = $("#main");
let me = null;
let tarefasCache = null; // todas as tarefas abertas, para contagens por esfera

const atrasada = (t) => t.prazo && t.status !== "Concluída" && diaDe(t.prazo) < hojeISO();

// ---- Tema ------------------------------------------------------------------
function aplicarTema(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try {
    t === "auto" ? localStorage.removeItem("tema") : localStorage.setItem("tema", t);
  } catch {}
  document.querySelectorAll(".theme-switch button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tema === t));
  redesenhar();
}
document.querySelectorAll(".theme-switch button").forEach((b) => (b.onclick = () => aplicarTema(b.dataset.tema)));
aplicarTema(document.documentElement.dataset.theme ?? "auto");

// ---- Navegação -------------------------------------------------------------
function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  if (h.startsWith("esfera/")) {
    const [area, aba] = h.slice(7).split("/");
    return { page: "esfera", area, aba };
  }
  if (h === "financas") return { page: "financas" };
  return { page: "geral" };
}

function renderNav() {
  const r = route();
  const cont = (a) => (tarefasCache ? tarefasCache.filter((t) => t.area === a).length : "");
  $("#nav").innerHTML =
    `<a href="#/" class="${r.page === "geral" ? "active" : ""}">Visão geral</a>` +
    `<a href="#/financas" class="${r.page === "financas" ? "active" : ""}">Finanças</a>` +
    `<div class="sep">Esferas</div>` +
    me.areas
      .map(
        (a) =>
          `<a href="#/esfera/${encodeURIComponent(a)}" class="${r.area === a ? "active" : ""}">${esc(a)}<span class="count">${cont(a)}</span></a>`,
      )
      .join("");
}

window.addEventListener("hashchange", render);

// Links "#secao" rolam até a seção sem trocar a página.
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]:not([href^="#/"])');
  if (!a) return;
  e.preventDefault();
  document.getElementById(a.getAttribute("href").slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(redesenhar, 150);
});

function render() {
  renderNav();
  const r = route();
  window.scrollTo(0, 0);
  if (r.page === "esfera" && me.areas.includes(r.area)) renderEsfera(r.area, r.aba);
  else if (r.page === "financas") renderFinancas(main);
  else renderGeral();
}

async function carregarTarefas(force = false) {
  if (!tarefasCache || force) tarefasCache = await api("/tarefas");
  renderNav();
  return tarefasCache;
}

// ---- Visão geral -----------------------------------------------------------
function renderGeral() {
  const hoje = hojeISO();
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Visão geral</h1><div class="muted">${esc(fmtData(hoje))}</div></div>
      <button class="btn" id="refresh">Atualizar</button>
    </div>
    <div class="grid">
      <section class="card span-12"><div class="card-head"><h2>Status do agente</h2></div><div id="c-status"></div></section>
      <section class="card span-8"><div class="card-head"><h2>Finanças</h2><a href="#/financas" class="small">Abrir finanças</a></div><div id="c-fin"></div></section>
      <section class="card span-4"><div class="card-head"><h2>E-mails de hoje</h2><a href="#/esfera/Trabalho/emails" class="small">Ver resumo</a></div><div id="c-emails"></div></section>
      <section class="card span-12"><div class="card-head"><h2>Esferas</h2><span class="muted small">tarefas abertas</span></div><div id="c-areas"></div></section>
      <section class="card span-6"><div class="card-head"><h2>Próximas tarefas</h2></div><div id="c-tarefas"></div></section>
      <section class="card span-6"><div class="card-head"><h2>Agenda · 7 dias</h2></div><div id="c-agenda"></div></section>
    </div>`;
  $("#refresh").onclick = () => {
    tarefasCache = null;
    renderGeral();
  };

  fill($("#c-status"), () => api("/status"), drawStatus);
  fill($("#c-agenda"), () => api("/agenda?dias=7"), drawAgenda);
  fill($("#c-fin"), () => api(`/gastos?de=${hoje.slice(0, 7)}-01&ate=${hoje}`), drawFinResumo);
  fill($("#c-emails"), () => api("/emails/hoje"), drawEmailsResumo);
  const tarefas = carregarTarefas();
  fill($("#c-areas"), () => tarefas, drawAreas);
  fill($("#c-tarefas"), () => tarefas, (ts) => drawListaTarefas(ts.filter((t) => t.prazo).slice(0, 8)));
}

function drawStatus(s) {
  const a = s.agente;
  const itens = [
    { nome: "Agente", ok: a.chatsPermitidos > 0, detalhe: `${a.modo} · ${a.chatsPermitidos} chat(s) · no ar desde ${fmtData(a.noArDesde)}` },
    ...s.integracoes,
  ];
  return `<div class="status-list">${itens
    .map(
      (i) => `<div class="status-item"><span class="dot ${i.ok ? "ok" : "bad"}" aria-label="${i.ok ? "ok" : "com erro"}"></span>
        <div><div>${esc(i.nome)}</div><div class="detail">${esc(i.detalhe)}</div></div></div>`,
    )
    .join("")}</div>`;
}

function drawFinResumo(g) {
  const s = g.saldosAtuais;
  const sinal = (n) => (n < 0 ? "neg" : "");
  return `
    <div class="kpis kpis-4 saldos">
      <div class="kpi"><div class="label">Dinheiro</div><div class="value ${sinal(s.dinheiro)}">${brl(s.dinheiro)}</div></div>
      <div class="kpi"><div class="label">Vale</div><div class="value ${sinal(s.vale)}">${brl(s.vale)}</div></div>
      <div class="kpi"><div class="label">Fatura do cartão</div><div class="value">${brl(s.cartaoFatura)}</div></div>
      <div class="kpi"><div class="label">Limite disponível</div><div class="value ${sinal(s.cartaoLimiteDisponivel)}">${brl(s.cartaoLimiteDisponivel)}</div></div>
    </div>
    <div class="small muted" style="margin-top:10px">Este mês: entradas <b class="pos">${brl(g.entradas)}</b> · saídas <b class="neg">${brl(g.saidas)}</b> · resultado <b>${brl(g.saldoDoPeriodo)}</b></div>`;
}

function drawEmailsResumo(es) {
  const relevantes = es.filter((e) => e.categoria !== "Promoções" && e.categoria !== "Social");
  const naoLidos = relevantes.filter((e) => e.naoLido).length;
  const importantes = relevantes.filter((e) => e.importante).length;
  return `
    <div class="kpis kpis-2">
      <div class="kpi"><div class="label">Recebidos</div><div class="value">${es.length}</div><div class="small muted">${relevantes.length} relevantes</div></div>
      <div class="kpi"><div class="label">Não lidos</div><div class="value">${naoLidos}</div><div class="small muted">${importantes} importantes</div></div>
    </div>
    ${relevantes.slice(0, 3).map((e) => `<div class="mini-mail ${e.naoLido ? "unread" : ""}"><span class="title">${esc(e.assunto)}</span><span class="muted small">${esc(remetente(e.de))}</span></div>`).join("")}`;
}

function drawAreas(ts) {
  return `<div class="areas">${me.areas
    .map((a) => {
      const doArea = ts.filter((t) => t.area === a);
      const late = doArea.filter(atrasada).length;
      return `<a class="area-tile" href="#/esfera/${encodeURIComponent(a)}">
        <div class="muted small">${esc(a)}</div><div class="n">${doArea.length}</div>
        <div class="small ${late ? "late" : "muted"}">${late ? `${late} atrasada(s)` : "em dia"}</div></a>`;
    })
    .join("")}</div>`;
}

function drawListaTarefas(ts) {
  if (!ts.length) return `<div class="empty">Nenhuma tarefa com prazo.</div>`;
  return `<div class="list">${ts
    .map(
      (t) => `<div class="row">
        <span class="when ${atrasada(t) ? "late" : ""}">${esc(fmtData(t.prazo))}</span>
        <div class="grow"><div class="title">${esc(t.tarefa)}</div>
          <div class="meta"><span>${esc(t.codigo)}</span><span>${esc(t.area ?? "")}</span><span>${esc(t.status ?? "")}</span></div></div>
        ${t.prioridade ? `<span class="tag ${t.prioridade === "Alta" ? "alta" : ""}">${esc(t.prioridade)}</span>` : ""}
      </div>`,
    )
    .join("")}</div>`;
}

function drawAgenda(evs) {
  if (!evs.length) return `<div class="empty">Nada na agenda nos próximos 7 dias.</div>`;
  return `<div class="list">${evs
    .map(
      (e) => `<div class="row"><span class="when">${esc(fmtData(e.inicio, { hora: !e.inicio?.match(/^\d{4}-\d{2}-\d{2}$/) }))}</span>
        <div class="grow"><div class="title">${esc(e.titulo ?? "(sem título)")}</div>
        ${e.local ? `<div class="meta">${esc(e.local)}</div>` : ""}</div></div>`,
    )
    .join("")}</div>`;
}

// ---- Esferas ---------------------------------------------------------------
// Cada esfera pode ter abas próprias; "tarefas" é o quadro do Notion. Novas abas entram aqui.
const ABAS = {
  Trabalho: [
    { id: "emails", nome: "Resumo de e-mails", render: renderEmails },
    { id: "tarefas", nome: "Tarefas" },
    { id: "busca-fornecedor", nome: "Busca Fornecedor", render: renderBuscaFornecedor },
  ],
};

let mostrarConcluidas = false;

function renderEsfera(area, abaId) {
  const abas = ABAS[area] ?? [{ id: "tarefas", nome: "Tarefas" }];
  const aba = abas.find((a) => a.id === abaId) ?? abas[0];
  main.innerHTML = `
    <div class="page-head">
      <div><div class="muted small">Esfera</div><h1>${esc(area)}</h1></div>
    </div>
    ${abas.length > 1 ? `<nav class="tabs" aria-label="Abas de ${esc(area)}">${abas
      .map((a) => `<a href="#/esfera/${encodeURIComponent(area)}/${a.id}" ${a === aba ? 'aria-current="page"' : ""}>${esc(a.nome)}</a>`)
      .join("")}</nav>` : ""}
    <div id="aba"></div>`;
  if (aba.render) aba.render($("#aba"), area);
  else renderTarefas($("#aba"), area);
}

function renderTarefas(el, area) {
  el.innerHTML = `
    <section class="card" style="margin-bottom:16px"><div id="e-kpis"></div></section>
    <section class="card">
      <div class="card-head"><h2>Tarefas</h2>
        <label class="check"><input type="checkbox" id="concl" ${mostrarConcluidas ? "checked" : ""}/> Mostrar concluídas</label></div>
      <form class="add" id="add">
        <input name="tarefa" placeholder="Nova tarefa em ${esc(area)}" required maxlength="200" />
        <input name="prazo" type="datetime-local" title="Prazo" />
        <select name="prioridade"><option value="">Prioridade</option>${me.prioridades.map((p) => `<option>${esc(p)}</option>`).join("")}</select>
        <label class="check" title="Cria um aviso no Google Calendar"><input type="checkbox" name="lembrete" /> Lembrete</label>
        <button class="btn primary">Adicionar</button>
      </form>
      <div id="add-msg" class="small" style="margin:8px 0"></div>
      <div id="board"></div>
    </section>`;

  $("#concl").onchange = (e) => {
    mostrarConcluidas = e.target.checked;
    loadBoard(area);
  };
  $("#add").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector("button");
    const msg = $("#add-msg");
    const local = f.get("prazo");
    btn.disabled = true;
    try {
      const t = await api("/tarefas", {
        method: "POST",
        body: {
          tarefa: f.get("tarefa"),
          area,
          prazo: local ? `${local}:00-03:00` : undefined,
          prioridade: f.get("prioridade") || undefined,
          lembrete: f.get("lembrete") === "on",
        },
      });
      e.target.reset();
      msg.className = "small muted";
      msg.textContent = `${t.codigo} criada${t.lembreteCriado ? " com lembrete no Calendar" : ""}.`;
      await carregarTarefas(true);
      loadBoard(area);
    } catch (err) {
      msg.className = "small error";
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
  loadBoard(area);
}

function drawKpisEsfera(ts) {
  const hoje = hojeISO();
  const abertas = ts.filter((t) => t.status !== "Concluída");
  const semana = abertas.filter((t) => t.prazo && diaDe(t.prazo) >= hoje && diaDe(t.prazo) <= addDias(hoje, 7)).length;
  return `<div class="kpis kpis-4">
    <div class="kpi"><div class="label">Abertas</div><div class="value">${abertas.length}</div></div>
    <div class="kpi"><div class="label">Em andamento</div><div class="value">${abertas.filter((t) => t.status === "Em andamento").length}</div></div>
    <div class="kpi"><div class="label">Atrasadas</div><div class="value ${abertas.some(atrasada) ? "late" : ""}">${abertas.filter(atrasada).length}</div></div>
    <div class="kpi"><div class="label">Prazo nos próximos 7 dias</div><div class="value">${semana}</div></div>
  </div>`;
}

async function loadBoard(area) {
  const board = $("#board");
  board.innerHTML = `<div class="loading">Carregando…</div>`;
  try {
    const ts = await api(`/tarefas?area=${encodeURIComponent(area)}${mostrarConcluidas ? "&concluidas=1" : ""}`);
    $("#e-kpis").innerHTML = drawKpisEsfera(ts);
    const cols = mostrarConcluidas ? me.status : me.status.filter((s) => s !== "Concluída");
    board.innerHTML = `<div class="columns" style="--cols:${cols.length}">${cols
      .map((s) => {
        const doStatus = ts.filter((t) => t.status === s);
        return `<div class="col"><h3><span>${esc(s)}</span><span>${doStatus.length}</span></h3>
          ${doStatus.map(drawTask).join("") || `<div class="empty">Vazio.</div>`}</div>`;
      })
      .join("")}</div>`;
    board.querySelectorAll("[data-status]").forEach((b) => (b.onclick = () => mudarStatus(b, area)));
  } catch (err) {
    board.innerHTML = `<div class="error">${esc(err.message)}</div>`;
    $("#e-kpis").innerHTML = "";
  }
}

function drawTask(t) {
  const proximos = { "A fazer": ["Em andamento", "Concluída"], "Em andamento": ["A fazer", "Concluída"], "Concluída": ["A fazer"] }[t.status] ?? [];
  const rotulo = { "Em andamento": "Iniciar", "Concluída": "Concluir", "A fazer": t.status === "Concluída" ? "Reabrir" : "Voltar" };
  return `<div class="task">
    <div class="title">${esc(t.tarefa)}</div>
    <div class="meta small muted" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">
      <span>${esc(t.codigo)}</span>
      ${t.prazo ? `<span class="${atrasada(t) ? "late" : ""}">${esc(fmtData(t.prazo))}</span>` : ""}
      ${t.prioridade ? `<span class="tag ${t.prioridade === "Alta" ? "alta" : ""}">${esc(t.prioridade)}</span>` : ""}
    </div>
    ${t.notas ? `<div class="small muted" style="margin-top:4px">${esc(t.notas)}</div>` : ""}
    <div class="actions">
      ${proximos.map((s) => `<button class="btn sm" data-id="${esc(t.id)}" data-status="${esc(s)}">${esc(rotulo[s])}</button>`).join("")}
      <a class="btn sm" href="${esc(t.url)}" target="_blank" rel="noopener">Notion</a>
    </div></div>`;
}

async function mudarStatus(btn, area) {
  btn.disabled = true;
  try {
    await api(`/tarefas/${btn.dataset.id}`, { method: "PATCH", body: { status: btn.dataset.status } });
    await carregarTarefas(true);
    loadBoard(area);
  } catch (err) {
    btn.disabled = false;
    alert(err.message);
  }
}

const remetente = (de) => (de.match(/^"?([^"<]+?)"?\s*</)?.[1] ?? de).trim();

// ---- Início ----------------------------------------------------------------
function showLogin() {
  $("#app").hidden = true;
  $("#login").hidden = false;
}
setOnUnauthorized(showLogin);

$("#logout").onclick = async () => {
  await fetch("/auth/logout", { method: "POST" });
  showLogin();
};

try {
  me = await api("/me");
  $("#user-email").textContent = me.email;
  $("#login").hidden = true;
  $("#app").hidden = false;
  render();
} catch {
  showLogin();
}
