// Dashboard do Assistente AI — sem build: HTML + JS puro, dados via /api.
const TZ = "America/Sao_Paulo";
const $ = (sel, el = document) => el.querySelector(sel);
const main = $("#main");
let me = null;
let tarefasCache = null; // todas as tarefas abertas, para contagens por esfera

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const brl = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error("Sessão expirada. Entre novamente.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro ?? `Erro ${res.status}`);
  return data;
}

// ---- Datas -----------------------------------------------------------------
const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
const hojeISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
function fmtData(s, { hora = true } = {}) {
  if (!s) return "";
  if (isDateOnly(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "short", weekday: "short" });
  }
  const d = new Date(s);
  const dia = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short", weekday: "short" });
  return hora ? `${dia} ${d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}` : dia;
}
const diaDe = (s) => (isDateOnly(s) ? s : new Date(s).toLocaleDateString("sv-SE", { timeZone: TZ }));
const atrasada = (t) => t.prazo && t.status !== "Concluída" && diaDe(t.prazo) < hojeISO();

// ---- Navegação -------------------------------------------------------------
function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  return h.startsWith("esfera/") ? { page: "esfera", area: h.slice(7) } : { page: "geral" };
}

function renderNav() {
  const r = route();
  const cont = (a) => (tarefasCache ? tarefasCache.filter((t) => t.area === a).length : "");
  $("#nav").innerHTML =
    `<a href="#/" class="${r.page === "geral" ? "active" : ""}">Visão geral</a>` +
    `<div class="sep">Esferas</div>` +
    me.areas
      .map(
        (a) =>
          `<a href="#/esfera/${encodeURIComponent(a)}" class="${r.area === a ? "active" : ""}">${esc(a)}<span class="count">${cont(a)}</span></a>`,
      )
      .join("");
}

window.addEventListener("hashchange", render);

function render() {
  renderNav();
  const r = route();
  if (r.page === "esfera" && me.areas.includes(r.area)) renderEsfera(r.area);
  else renderGeral();
}

/** Carrega um card de forma independente: se uma integração falhar, as outras continuam. */
async function fill(el, loader, draw) {
  el.innerHTML = `<div class="loading">Carregando…</div>`;
  try {
    el.innerHTML = draw(await loader());
  } catch (err) {
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

async function carregarTarefas(force = false) {
  if (!tarefasCache || force) tarefasCache = await api("/tarefas");
  renderNav();
  return tarefasCache;
}

// ---- Visão geral -----------------------------------------------------------
function renderGeral() {
  const hoje = hojeISO();
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Visão geral</h1><div class="muted">${esc(fmtData(hojeISO()))}</div></div>
      <button class="btn" id="refresh">Atualizar</button>
    </div>
    <div class="grid">
      <section class="card span-12"><div class="card-head"><h2>Status do agente</h2></div><div id="c-status"></div></section>
      <section class="card span-12"><div class="card-head"><h2>Esferas</h2><span class="muted small">tarefas abertas</span></div><div id="c-areas"></div></section>
      <section class="card span-6"><div class="card-head"><h2>Próximas tarefas</h2></div><div id="c-tarefas"></div></section>
      <section class="card span-6"><div class="card-head"><h2>Agenda · 7 dias</h2></div><div id="c-agenda"></div></section>
      <section class="card span-12">
        <div class="card-head"><h2>Gastos</h2>
          <div class="periodo"><input type="date" id="de" value="${inicioMes}" /><span class="muted">até</span><input type="date" id="ate" value="${hoje}" /></div>
        </div>
        <div id="c-gastos"></div>
      </section>
    </div>`;
  $("#refresh").onclick = () => {
    tarefasCache = null;
    renderGeral();
  };
  const carregarGastos = () => fill($("#c-gastos"), () => api(`/gastos?de=${$("#de").value}&ate=${$("#ate").value}`), drawGastos);
  $("#de").onchange = carregarGastos;
  $("#ate").onchange = carregarGastos;

  fill($("#c-status"), () => api("/status"), drawStatus);
  fill($("#c-agenda"), () => api("/agenda?dias=7"), drawAgenda);
  carregarGastos();
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
      (i) => `<div class="status-item"><span class="dot ${i.ok ? "ok" : "bad"}"></span>
        <div><div>${esc(i.nome)}</div><div class="detail">${esc(i.detalhe)}</div></div></div>`,
    )
    .join("")}</div>`;
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
      (e) => `<div class="row"><span class="when">${esc(fmtData(e.inicio, { hora: !isDateOnly(e.inicio) }))}</span>
        <div class="grow"><div class="title">${esc(e.titulo ?? "(sem título)")}</div>
        ${e.local ? `<div class="meta">${esc(e.local)}</div>` : ""}</div></div>`,
    )
    .join("")}</div>`;
}

function drawGastos(g) {
  const cats = Object.entries(g.porCategoria ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...cats.map((c) => c[1]), 1);
  const s = g.saldosAtuais;
  const sinal = (n) => (n < 0 ? "neg" : "");
  return `
    <h3 class="small muted" style="margin-bottom:8px">Saldos atuais</h3>
    <div class="kpis saldos">
      <div class="kpi"><div class="label">Dinheiro em conta</div><div class="value ${sinal(s.dinheiro)}">${brl(s.dinheiro)}</div></div>
      <div class="kpi"><div class="label">Vale</div><div class="value ${sinal(s.vale)}">${brl(s.vale)}</div></div>
      <div class="kpi"><div class="label">Cartão · fatura em aberto</div><div class="value">${brl(s.cartaoFatura)}</div>
        <div class="small muted">Limite disponível <span class="${sinal(s.cartaoLimiteDisponivel)}">${brl(s.cartaoLimiteDisponivel)}</span></div></div>
    </div>
    <h3 class="small muted" style="margin-bottom:8px">No período</h3>
    <div class="kpis">
      <div class="kpi"><div class="label">Entradas</div><div class="value pos">${brl(g.entradas)}</div></div>
      <div class="kpi"><div class="label">Saídas</div><div class="value neg">${brl(g.saidas)}</div>
        <div class="small muted">${Object.entries(g.saidasPorMeio ?? {}).map(([m, v]) => `${esc(m)} ${brl(v)}`).join(" · ")}</div></div>
      <div class="kpi"><div class="label">Saldo do período</div><div class="value ${g.saldoDoPeriodo >= 0 ? "pos" : "neg"}">${brl(g.saldoDoPeriodo)}</div>
        <div class="small muted">Faturas pagas ${brl(g.faturasPagas)}</div></div>
    </div>
    <div class="grid">
      <div class="span-6">
        <h3 class="small muted" style="margin-bottom:8px">Saídas por categoria</h3>
        ${
          cats.length
            ? `<div class="bars">${cats
                .map(
                  ([c, v]) => `<div class="bar-row"><span class="name" title="${esc(c)}">${esc(c)}</span>
                  <div class="bar"><span style="width:${(v / max) * 100}%"></span></div><span class="val">${brl(v)}</span></div>`,
                )
                .join("")}</div>`
            : `<div class="empty">Sem saídas neste mês.</div>`
        }
        <div class="small muted" style="margin-top:12px">Fixas pagas ${brl(g.fixasPagas)} · Variáveis ${brl(g.variaveis)}</div>
      </div>
      <div class="span-6">
        <h3 class="small muted" style="margin-bottom:8px">Últimos lançamentos</h3>
        ${
          g.ultimosLancamentos?.length
            ? `<div class="list">${[...g.ultimosLancamentos]
                .reverse()
                .map(
                  (l) => `<div class="row"><span class="when">${esc(fmtData(l.data))}</span>
                  <div class="grow"><div class="title">${esc(l.descricao)}</div><div class="meta"><span>${esc(l.categoria)}</span><span class="tag">${esc(l.meio)}</span></div></div>
                  <span class="${l.tipo === "Entrada" ? "pos" : l.tipo === "Saída" ? "neg" : "muted"}">${l.tipo === "Entrada" ? "+" : l.tipo === "Saída" ? "−" : "↔"}${brl(l.valor)}</span></div>`,
                )
                .join("")}</div>`
            : `<div class="empty">Nenhum lançamento.</div>`
        }
      </div>
    </div>`;
}

// ---- Esfera ----------------------------------------------------------------
let mostrarConcluidas = false;

function renderEsfera(area) {
  main.innerHTML = `
    <div class="page-head">
      <div><div class="muted small">Esfera</div><h1>${esc(area)}</h1></div>
      <label class="check"><input type="checkbox" id="concl" ${mostrarConcluidas ? "checked" : ""}/> Mostrar concluídas</label>
    </div>
    <section class="card" style="margin-bottom:16px">
      <form class="add" id="add">
        <input name="tarefa" placeholder="Nova tarefa em ${esc(area)}" required maxlength="200" />
        <input name="prazo" type="datetime-local" title="Prazo" />
        <select name="prioridade"><option value="">Prioridade</option>${me.prioridades.map((p) => `<option>${esc(p)}</option>`).join("")}</select>
        <label class="check" title="Cria um aviso no Google Calendar"><input type="checkbox" name="lembrete" /> Lembrete</label>
        <button class="btn primary">Adicionar</button>
      </form>
      <div id="add-msg" class="small" style="margin-top:8px"></div>
    </section>
    <div id="board"></div>`;

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

async function loadBoard(area) {
  const board = $("#board");
  board.innerHTML = `<div class="loading">Carregando…</div>`;
  try {
    const ts = await api(`/tarefas?area=${encodeURIComponent(area)}${mostrarConcluidas ? "&concluidas=1" : ""}`);
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

// ---- Início ----------------------------------------------------------------
function showLogin() {
  $("#app").hidden = true;
  $("#login").hidden = false;
}

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
