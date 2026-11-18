// Aba Trabalho → Capex Radar: monitoramento da carteira de projetos de investimento.
// Só leitura (pelo MCP do Capex Radar). Triagem e análise são feitas pelo Claude Code.
import { $, api, esc, fill, fmtData, fmtHora } from "./util.js";
import { hBars } from "./charts.js";

const num = (n) => (Number(n) || 0).toLocaleString("pt-BR");
const ESTAGIOS = { anuncio: "Anúncio", licenciamento: "Licenciamento", funding: "Funding", contratacao_epc: "Contratação EPC", mobilizacao: "Mobilização", operacao: "Operação", desaceleracao: "Desaceleração", cancelado: "Cancelado" };
const STATUS = { ativo: "Ativo", em_revisao: "Em revisão", descartado: "Descartado" };
const estagio = (e) => ESTAGIOS[e] ?? e ?? "—";
// Status com cor: ativo verde, em revisão laranja, descartado vermelho.
const statusTag = (s) => `<span class="tag st-${esc(s ?? "")}">${esc(STATUS[s] ?? s ?? "—")}</span>`;

/** R$ curto: 32 bi, 850 mi, 1,2 mil. */
function reais(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || !n) return "—";
  const f = (x, s) => `R$ ${x.toLocaleString("pt-BR", { maximumFractionDigits: x < 10 ? 1 : 0 })} ${s}`;
  if (n >= 1e9) return f(n / 1e9, "bi");
  if (n >= 1e6) return f(n / 1e6, "mi");
  if (n >= 1e3) return f(n / 1e3, "mil");
  return `R$ ${num(n)}`;
}

let base = "";
const link = (caminho, texto) => `<a href="${esc(base + caminho)}" target="_blank" rel="noopener">${texto}</a>`;
const DICA = `Triagem e análise pelo Claude Code, que tem o MCP do Capex Radar: peça, por exemplo, <i>"faça a triagem das notícias do Capex Radar"</i>.`;

export function renderCapex(el) {
  el.innerHTML = `
    <div class="page-head" style="margin-bottom:10px">
      <div class="muted small">Monitoramento da carteira de projetos de investimento. ${DICA}</div>
      <div class="periodo"><a class="btn sm" id="cx-abrir" target="_blank" rel="noopener">Abrir o Capex Radar</a><button class="btn sm" id="cx-atual">Atualizar</button></div>
    </div>
    <div id="cx-visao"></div>
    <section class="card" style="margin-top:16px">
      <div class="card-head"><h2>Carteira</h2>
        <form class="periodo" id="cx-filtro">
          <input name="texto" placeholder="Título, empresa ou município" style="min-width:200px">
          <select name="status"><option value="">Ativos e em revisão</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          <select name="estagio"><option value="">Todos os estágios</option>${Object.entries(ESTAGIOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          <input name="uf" placeholder="UF" maxlength="2" style="width:56px">
          <select name="ordem"><option value="valor">Maior valor</option><option value="recentes">Mais recentes</option></select>
          <button class="btn sm">Filtrar</button>
        </form></div>
      <div id="cx-carteira"></div>
    </section>`;
  const carregar = (forcar) => {
    fill($("#cx-visao"), () => api(`/capex/visao${forcar ? "?forcar=1" : ""}`), drawVisao);
    carregarCarteira(forcar);
  };
  $("#cx-atual").onclick = () => carregar(true);
  $("#cx-filtro").onsubmit = (e) => (e.preventDefault(), carregarCarteira(false));
  carregar(false);
}

function drawVisao(v) {
  base = v.url;
  $("#cx-abrir").href = `${base}/monitoramento`;
  const p = v.resumo.projetos;
  const st = p.por_status ?? {};
  const revisar = v.revisar?.noticias ?? [];
  const empresas = [...(v.resumo.empresas ?? [])].sort((a, b) => (b.noticias_a_revisar ?? 0) - (a.noticias_a_revisar ?? 0) || (b.projetos ?? 0) - (a.projetos ?? 0));
  const coletaAntiga = (d) => d && Date.now() - Date.parse(d) > 7 * 86400_000;
  const estagios = Object.keys(ESTAGIOS)
    .filter((k) => p.por_estagio?.[k])
    .map((k) => ({ label: ESTAGIOS[k], value: p.por_estagio[k] }));

  return `
    <div class="kpis kpis-4">
      <div class="kpi"><div class="label">Projetos ativos</div><div class="value">${num(st.ativo)}</div><div class="small muted">${num(st.em_revisao)} em revisão · ${num(st.descartado)} descartados</div></div>
      <div class="kpi"><div class="label">Valor da carteira</div><div class="value">${reais(p.valor_total_brl)}</div><div class="small muted">${num(v.resumo.empresas?.length)} empresas monitoradas</div></div>
      <div class="kpi"><div class="label">Notícias a revisar</div><div class="value ${v.revisar?.total ? "neg" : ""}">${num(v.revisar?.total)}</div><div class="small muted">${num(v.processandoTotal)} em processamento</div></div>
      <div class="kpi"><div class="label">Atualizado</div><div class="value small-value">${esc(fmtHora(v.atualizadoEm))}</div><div class="small muted">cache de 2 min</div></div>
    </div>
    <div class="grid" style="margin-top:16px">
      <section class="card span-4"><div class="card-head"><h2>Projetos por estágio</h2></div>${hBars(estagios, num)}</section>
      <section class="card span-8"><div class="card-head"><h2>Notícias a revisar</h2><span class="muted small">esperam decisão</span></div>
        ${
          revisar.length
            ? `<div class="list">${revisar
                .map(
                  (n) => `<div class="row"><span class="when">${esc(fmtData(n.data, { hora: false, semana: false }))}</span>
                  <div class="grow">${link(`/monitoramento/noticias/${n.id}`, `<b>${esc(n.titulo)}</b>`)}
                    <div class="meta small muted"><span>${esc(n.empresa ?? "")}</span><span>${esc(n.veiculo ?? "")}</span>
                      ${n.leitura?.valor_brl ? `<span>${reais(n.leitura.valor_brl)}</span>` : ""}${n.leitura?.estagio ? `<span>${esc(estagio(n.leitura.estagio))}</span>` : ""}
                      ${n.agente?.decisao ? `<span class="tag">IA: ${esc(n.agente.decisao.replace(/_/g, " "))}</span>` : ""}</div>
                    ${n.resumo ? `<div class="small">${esc(n.resumo)}</div>` : ""}</div></div>`,
                )
                .join("")}</div><p class="small muted" style="margin-top:8px">${DICA}</p>`
            : `<div class="empty">Nenhuma notícia esperando revisão.</div>`
        }
      </section>
      <section class="card span-6"><div class="card-head"><h2>Maiores projetos</h2></div>${listaProjetos(v.maiores?.projetos ?? [])}</section>
      <section class="card span-6"><div class="card-head"><h2>Movimentados recentemente</h2></div>${listaProjetos(v.recentes?.projetos ?? [], true)}</section>
      <section class="card span-12"><div class="card-head"><h2>Empresas monitoradas</h2><span class="muted small">coleta com mais de 7 dias em vermelho</span></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Empresa</th><th>Nicho</th><th class="num">Projetos</th><th class="num">A revisar</th><th class="num">Processando</th><th>Última coleta</th></tr></thead><tbody>
        ${empresas
          .map(
            (e) => `<tr><td>${esc(e.empresa)}</td><td class="muted small">${esc((e.nicho ?? "").replace(/_/g, " "))}</td><td class="num">${num(e.projetos)}</td>
            <td class="num">${e.noticias_a_revisar ? `<b class="neg">${num(e.noticias_a_revisar)}</b>` : "0"}</td><td class="num">${num(e.em_processamento)}</td>
            <td class="nowrap ${coletaAntiga(e.ultima_coleta) ? "neg" : ""}">${e.ultima_coleta ? esc(fmtData(e.ultima_coleta, { semana: false })) : "—"}</td></tr>`,
          )
          .join("")}</tbody></table></div>
      </section>
    </div>`;
}

function listaProjetos(ps, recente = false) {
  if (!ps.length) return `<div class="empty">Nenhum projeto.</div>`;
  return `<div class="list">${ps
    .map(
      (p) => `<div class="row"><div class="grow">${link(`/monitoramento/projetos/${p.id}`, `<b>${esc(p.titulo)}</b>`)}
        <div class="meta small muted">${statusTag(p.status)}<span>${esc(p.empresa ?? "")}</span><span>${esc([p.municipio, p.uf].filter(Boolean).join("/"))}</span><span>${esc(estagio(p.estagio))}</span>
        ${recente && p.ultima_evidencia_em ? `<span>evidência ${esc(fmtData(p.ultima_evidencia_em, { hora: false, semana: false }))}</span>` : ""}</div></div>
        <b class="nowrap">${reais(p.valor_estimado_brl)}</b></div>`,
    )
    .join("")}</div>`;
}

// ---- Carteira com filtros e ficha do projeto ------------------------------------

function carregarCarteira(forcar) {
  const f = $("#cx-filtro");
  const q = new URLSearchParams({ limite: "60", ordem: f.ordem.value });
  for (const k of ["texto", "status", "estagio", "uf"]) if (f[k].value.trim()) q.set(k, f[k].value.trim());
  if (forcar) q.set("forcar", "1");
  fill($("#cx-carteira"), () => api(`/capex/projetos?${q}`), drawCarteira);
}

function drawCarteira(r) {
  const ps = r.projetos ?? [];
  if (!ps.length) return `<div class="empty">Nenhum projeto com esses filtros.</div>`;
  setTimeout(ligarFichas);
  return `<p class="small muted">${num(ps.length)} de ${num(r.total)} projeto(s). Clique num projeto para ver a ficha.</p>
    <div class="buscas">${ps
      .map(
        (p) => `<details class="busca cx-st-${esc(p.status ?? "")}" data-projeto="${esc(p.id)}">
          <summary><span class="grow"><b>${esc(p.titulo)}</b>
            <span class="meta"><span>${esc(p.empresa ?? "")}</span><span>${esc([p.municipio, p.uf].filter(Boolean).join("/"))}</span><span>${esc((p.nicho ?? "").replace(/_/g, " "))}</span></span></span>
            <span class="busca-tags">${statusTag(p.status)}<span class="tag">${esc(estagio(p.estagio))}</span>
              <span class="tag">${num(p.evidencias)} evidência(s)</span><b class="nowrap">${reais(p.valor_estimado_brl)}</b></span></summary>
          <div class="busca-corpo cx-ficha"><div class="loading">Carregando a ficha…</div></div>
        </details>`,
      )
      .join("")}</div>`;
}

function ligarFichas() {
  document.querySelectorAll("#cx-carteira details[data-projeto]").forEach((d) => {
    d.addEventListener("toggle", () => {
      if (!d.open || d.dataset.carregado) return;
      d.dataset.carregado = "1";
      fill(d.querySelector(".cx-ficha"), () => api(`/capex/projetos/${d.dataset.projeto}`), drawFicha);
    });
  });
}

function drawFicha(f) {
  const p = f.projeto ?? {};
  const perfil = p.perfil ?? {};
  const marcos = p.linha_tempo?.marcos ?? [];
  const campo = (nome, valor) => (valor ? `<dt>${nome}</dt><dd>${valor}</dd>` : "");
  return `
    ${p.linha_tempo?.resumo || perfil.resumo ? `<p>${esc(p.linha_tempo?.resumo ?? perfil.resumo)}</p>` : ""}
    <dl class="params">
      ${campo("Objeto", esc(p.objeto ?? perfil.objeto))}
      ${campo("Empresa", esc([p.matriz_razao_social, p.matriz_cnpj].filter(Boolean).join(" · ")))}
      ${campo("Local", esc([perfil.local_detalhe, p.municipio, p.uf].filter(Boolean).join(" · ")))}
      ${campo("Valor", esc(perfil.valor_texto ?? reais(p.valor_estimado_brl)))}
      ${campo("Capacidade", esc(perfil.capacidade))}
      ${campo("Construtora", esc(perfil.construtora))}
      ${campo("Obra", esc([perfil.obra, perfil.inicio_obra && `início ${perfil.inicio_obra}`].filter(Boolean).join(" · ")))}
      ${campo("Validação", esc([p.flag_validacao, p.avaliacao?.decisao && `IA: ${p.avaliacao.decisao}`].filter(Boolean).join(" · ")))}
    </dl>
    ${
      marcos.length
        ? `<h3 class="small muted" style="margin:10px 0 6px">Linha do tempo</h3><div class="list">${marcos
            .map((m) => `<div class="row"><span class="when">${esc(m.data ?? "")}</span><div class="grow">${esc(m.marco ?? "")} <span class="muted small">${esc((m.tipo ?? "").replace(/_/g, " "))}</span></div></div>`)
            .join("")}</div>`
        : ""
    }
    ${
      (f.evidencias ?? []).length
        ? `<h3 class="small muted" style="margin:10px 0 6px">Evidências</h3><div class="list">${f.evidencias
            .map((e) => `<div class="row"><span class="when">${esc(fmtData(e.data, { hora: false, semana: false }))}</span><div class="grow"><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.titulo)}</a> <span class="muted small">${esc(e.veiculo ?? e.fonte ?? "")}</span></div></div>`)
            .join("")}</div>`
        : ""
    }
    ${drawObras(f.obras ?? [])}
    ${(f.registros ?? []).length ? `<p class="small muted" style="margin-top:8px">${num(f.registros.length)} registro(s) oficiais analisados</p>` : ""}
    <p style="margin-top:8px">${link(`/monitoramento/projetos/${p.id}`, "Abrir no Capex Radar")}</p>`;
}

// Obras do CNO ligadas ao projeto, num dropdown.
const CLASSES = { certeira: "st-ativo", provavel: "st-em_revisao", possivel: "", descartada: "st-descartado" };
function drawObras(obras) {
  if (!obras.length) return "";
  const area = (a) => (Number(a) ? `${Number(a).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²` : "—");
  return `<details class="cx-obras">
    <summary><b>${num(obras.length)} obra(s) no CNO</b> <span class="muted small">${esc([...new Set(obras.map((o) => o.status).filter(Boolean))].join(", "))}</span></summary>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>CNO</th><th>Obra</th><th>Município</th><th class="num">Área</th><th>Início</th><th>Situação</th><th>Vínculo</th></tr></thead><tbody>
    ${obras
      .map(
        (o) => `<tr><td class="nowrap small">${esc(o.cno ?? "")}</td><td>${esc(o.nome ?? "")}</td><td>${esc(o.municipio ?? "")}</td><td class="num nowrap">${area(o.area)}</td>
        <td class="nowrap">${esc(o.inicio ?? "—")}</td><td>${esc(o.status ?? "—")}${o.desde ? ` <span class="muted small">desde ${esc(o.desde)}</span>` : ""}</td>
        <td>${o.classe ? `<span class="tag ${CLASSES[o.classe] ?? ""}">${esc(o.classe)}</span>` : "—"}</td></tr>`,
      )
      .join("")}</tbody></table></div>
  </details>`;
}
