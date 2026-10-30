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

export function renderBuscaFornecedor(el) {
  el.innerHTML = `
    <div class="page-head" style="margin-bottom:12px">
      <div class="muted small">Site no Lovable, banco no Supabase e automações no n8n. Só números agregados: nenhum dado pessoal aparece aqui.</div>
      <button class="btn sm" id="bf-atual">Atualizar tudo</button>
    </div>
    <div class="grid">
      <section class="card span-4"><div class="card-head"><h2>Site</h2><span class="muted small">Lovable</span></div><div id="bf-site"></div></section>
      <section class="card span-8"><div class="card-head"><h2>Automações</h2><span class="muted small">n8n</span></div><div id="bf-n8n-kpis"></div></section>
      <section class="card span-12"><div class="card-head"><h2>Consultas</h2><span class="muted small" id="bf-banco-at">Supabase</span></div><div id="bf-consultas"></div></section>
      <section class="card span-12"><div class="card-head"><h2>Cadastros</h2><span class="muted small">compradores e fornecedores</span></div><div id="bf-cadastros"></div></section>
      <section class="card span-6"><div class="card-head"><h2>Compradores</h2></div><div id="bf-compradores"></div></section>
      <section class="card span-6"><div class="card-head"><h2>Fornecedores</h2></div><div id="bf-fornecedores"></div></section>
      <section class="card span-12"><div class="card-head"><h2>Perfis de empresa</h2><span class="muted small">company_profile</span></div><div id="bf-perfis"></div></section>
      <section class="card span-12"><div class="card-head"><h2>Últimas execuções do n8n</h2></div><div id="bf-n8n-lista"></div></section>
    </div>`;
  const carregar = (forcar) => {
    const q = forcar ? "?forcar=1" : "";
    fill($("#bf-site"), () => api(`/projetos/busca-fornecedor/site${q}`), drawSite);
    carregarN8n(q);
    carregarBanco(q);
  };
  $("#bf-atual").onclick = () => carregar(true);
  carregar(false);
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
