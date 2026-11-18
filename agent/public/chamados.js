// Chamados do Busca Fornecedor: feedbacks, contests de site, processamentos com erro e troca de CNPJ.
// "Analisar com IA" pede ao Claude um resumo e uma ação sugerida; nada é executado sem um clique seu,
// e ações arriscadas pedem confirmação (a troca de CNPJ pede o CNPJ digitado de novo).
import { $, api, esc, fmtData } from "./util.js";

let dados = null;
let aba = "feedbacks";
const analises = new Map(); // "tipo:alvo" → resultado da IA

export async function carregarChamados(forcar = false) {
  const el = $("#bf-chamados");
  if (!el) return;
  if (!dados || forcar) el.innerHTML = `<div class="loading">Carregando chamados…</div>`;
  try {
    dados = await api("/projetos/busca-fornecedor/chamados");
    desenhar();
  } catch (err) {
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

const ABAS = [
  { id: "feedbacks", nome: "Feedbacks", n: (d) => d.feedbacks.length },
  { id: "contests", nome: "Contests", n: (d) => d.contests.filter((c) => c.status === "pendente").length },
  { id: "falhas", nome: "Falhas", n: (d) => d.jobsErro.length + d.filaErro.length + d.filaTravada.length },
  { id: "cnpj", nome: "Troca de CNPJ", n: () => 0 },
  { id: "historico", nome: "Histórico", n: () => 0 },
];

function desenhar() {
  const d = dados;
  const el = $("#bf-chamados");
  const sub = $("#chamados-sub");
  const total = ABAS.slice(0, 3).reduce((s, a) => s + a.n(d), 0);
  if (sub) sub.innerHTML = total ? `<span class="tag alta">${total} em aberto</span>` : "nada em aberto";
  el.innerHTML = `
    ${d.admin ? "" : `<div class="notice">Para executar ações, defina <code>BF_ADMIN_EMAIL</code> no Railway com o e-mail de um usuário que está em <code>app_admins</code>. A análise e a lista funcionam sem isso, exceto feedbacks.</div>`}
    <div class="ch-topo">
      <div class="theme-switch" role="tablist">${ABAS.map((a) => `<button data-aba="${a.id}" aria-pressed="${a.id === aba}">${a.nome}${a.n(d) ? ` <b>${a.n(d)}</b>` : ""}</button>`).join("")}</div>
      <div class="periodo">
        <button class="btn sm" id="ch-verificar" title="Consulta os jobs de geração de perfil e aplica os que terminaram">Verificar processamentos${d.jobsAguardando ? ` (${d.jobsAguardando} aguardando)` : ""}</button>
        <button class="btn sm" id="ch-atualizar">Atualizar</button>
      </div>
    </div>
    <div id="ch-corpo"></div>`;
  el.querySelectorAll("[data-aba]").forEach((b) => (b.onclick = () => ((aba = b.dataset.aba), desenhar())));
  $("#ch-atualizar").onclick = () => carregarChamados(true);
  $("#ch-verificar").onclick = verificar;
  const corpo = $("#ch-corpo");
  if (aba === "feedbacks") corpo.innerHTML = drawFeedbacks(d);
  if (aba === "contests") corpo.innerHTML = drawContests(d);
  if (aba === "falhas") corpo.innerHTML = drawFalhas(d);
  if (aba === "cnpj") corpo.innerHTML = drawCnpj();
  if (aba === "historico") return carregarHistorico(corpo);
  ligar(corpo);
}

// ---- Itens ---------------------------------------------------------------------

const acoesDe = (tipo, filtro = () => true) => dados.acoes.filter((a) => a.tipo === tipo && filtro(a));
const botoes = (tipo, alvo, acoes) =>
  acoes.map((a) => `<button class="btn sm ${a.risco === "livre" ? "" : "perigo"}" data-acao="${a.id}" data-tipo="${tipo}" data-alvo="${esc(alvo)}" title="${esc(a.descricao)}">${esc(a.nome)}</button>`).join("");

function item({ tipo, alvo, titulo, meta, texto = "", acoes }) {
  const chave = `${tipo}:${alvo}`;
  return `<div class="ch-item" data-chave="${esc(chave)}">
    <div class="ch-item-head"><div class="grow"><b>${titulo}</b><div class="meta small muted">${meta}</div></div></div>
    ${texto ? `<div class="ch-texto">${texto}</div>` : ""}
    <div class="ch-acoes">
      <button class="btn sm primary" data-analisar="${tipo}" data-alvo="${esc(alvo)}">Analisar com IA</button>
      ${botoes(tipo, alvo, acoes)}
    </div>
    <div class="ch-ia">${analises.has(chave) ? drawAnalise(tipo, alvo, analises.get(chave)) : ""}</div>
  </div>`;
}

function drawFeedbacks(d) {
  if (d.feedbacksErro) return `<div class="error">${esc(d.feedbacksErro)}</div>`;
  if (!d.feedbacks.length) return `<div class="empty">Nenhum feedback pendente.</div>`;
  return d.feedbacks
    .map((f) =>
      item({
        tipo: "feedback",
        alvo: String(f.id),
        titulo: esc(f.motivo ?? "Feedback"),
        meta: `${esc(fmtData(f.em, { semana: false }))} · ${esc(f.status ?? "")}${f.temContato ? " · deixou contato" : ""}`,
        texto: esc(f.texto ?? ""),
        acoes: acoesDe("feedback", (a) => a.id !== "feedback_pendente" || f.status === "Respondido"),
      }),
    )
    .join("");
}

function drawContests(d) {
  if (!d.contests.length) return `<div class="empty">Nenhum contest pendente nem rejeitado nos últimos 14 dias.</div>`;
  return d.contests
    .map((c) =>
      item({
        tipo: "contest",
        alvo: c.id,
        titulo: `${c.tipo === "troca_de_site" ? "Troca de site" : "Site em uso por outro fornecedor"} · <span class="tag ${c.status === "pendente" ? "alta" : ""}">${esc(c.status)}</span>`,
        meta: `${esc(fmtData(c.created_at, { semana: false }))} · CNPJ ${esc(c.cnpj_usuario ?? "—")}${c.cnpj_conflito ? ` · conflito com ${esc(c.cnpj_conflito)}` : ""}`,
        texto: `Site informado: <b>${esc(c.site_informado ?? "—")}</b>${c.notas ? `<div class="small muted">${esc(c.notas)}</div>` : ""}`,
        acoes: acoesDe("contest", (a) => a.id !== "contest_gerar_perfil" || c.tipo === "troca_de_site"),
      }),
    )
    .join("");
}

function drawFalhas(d) {
  const partes = [];
  if (d.jobsErro.length)
    partes.push(`<h3 class="grupo-sub">Geração de perfil pelo site</h3>` + d.jobsErro
      .map((j) => item({ tipo: "falha", alvo: j.id, titulo: esc(j.site ?? "—"), meta: `${esc(fmtData(j.updated_at ?? j.created_at, { semana: false }))} · CNPJ ${esc(j.cnpj ?? "—")}`, texto: esc(j.erro ?? ""), acoes: acoesDe("falha", (a) => a.id === "job_tentar_novamente") }))
      .join(""));
  const fila = (l, travado) =>
    l.map((f) =>
      item({
        tipo: "falha",
        alvo: f.cnpj_basico,
        titulo: `${esc(f.razao_social ?? f.cnpj_basico)} ${travado ? `<span class="tag alta">travado</span>` : ""}`,
        meta: `${esc(f.municipio ?? "")}${f.uf ? `/${esc(f.uf)}` : ""} · ${esc(f.url_site ?? "sem site")} · ${f.attempts ?? 0} tentativa(s)${travado ? ` · bloqueado por ${esc(f.locked_by ?? "?")} desde ${esc(fmtData(f.locked_at, { semana: false }))}` : ""}`,
        texto: esc(f.last_error ?? ""),
        acoes: acoesDe("falha", (a) => a.id === "fila_reenfileirar"),
      }),
    ).join("");
  if (d.filaTravada.length) partes.push(`<h3 class="grupo-sub">Fila de cadastro: travados há mais de 2 h</h3>${fila(d.filaTravada, true)}`);
  if (d.filaErro.length) partes.push(`<h3 class="grupo-sub">Fila de cadastro: com erro</h3>${fila(d.filaErro, false)}`);
  return partes.join("") || `<div class="empty">Nenhuma falha em aberto.</div>`;
}

function drawCnpj() {
  return `<form class="ch-cnpj" id="ch-cnpj-previa">
      <label><span class="small muted">CNPJ (8 ou 14 dígitos)</span><input name="cnpj" inputmode="numeric" required placeholder="00.000.000/0000-00"></label>
      <button class="btn">Ver prévia</button>
      <button class="btn primary" type="button" id="ch-cnpj-ia">Analisar com IA</button>
    </form>
    <div id="ch-cnpj-res"></div>`;
}

// ---- Análise e ações ------------------------------------------------------------------

function drawAnalise(tipo, alvo, r) {
  if (r.carregando) return `<div class="ia-box loading">Analisando…</div>`;
  if (r.erro) return `<div class="error">${esc(r.erro)}</div>`;
  const a = r.acao ? dados.acoes.find((x) => x.id === r.acao) : null;
  return `<div class="ia-box">
    <div><b>${esc(r.resumo ?? "")}</b></div>
    <div class="small muted">${[r.categoria, r.confianca && `confiança ${r.confianca}`].filter(Boolean).map(esc).join(" · ")}</div>
    ${r.justificativa ? `<div class="small" style="margin-top:6px">${esc(r.justificativa)}</div>` : ""}
    ${r.resposta_sugerida ? `<div class="ch-resposta"><span class="small muted">Resposta sugerida</span><div>${esc(r.resposta_sugerida)}</div><button class="btn sm" data-copiar="${esc(r.resposta_sugerida)}">Copiar</button></div>` : ""}
    ${
      a
        ? `<div class="ch-acoes" style="margin-top:8px"><span class="small">Sugestão:</span> <button class="btn sm ${a.risco === "livre" ? "primary" : "perigo"}" data-acao="${a.id}" data-tipo="${tipo}" data-alvo="${esc(alvo)}" data-params="${esc(JSON.stringify(r.params ?? {}))}">${esc(a.nome)}</button></div>`
        : `<div class="small muted" style="margin-top:6px">Sem ação automática sugerida: decida manualmente.</div>`
    }
  </div>`;
}

function ligar(raiz) {
  raiz.querySelectorAll("[data-analisar]").forEach((b) => (b.onclick = () => analisar(b.dataset.analisar, b.dataset.alvo, b)));
  raiz.querySelectorAll("[data-acao]").forEach((b) => (b.onclick = () => executar(b.dataset.acao, b.dataset.alvo, JSON.parse(b.dataset.params || "{}"), b)));
  raiz.querySelectorAll("[data-copiar]").forEach((b) => (b.onclick = () => navigator.clipboard?.writeText(b.dataset.copiar).then(() => (b.textContent = "Copiado"))));
  const previa = $("#ch-cnpj-previa");
  if (previa) {
    previa.onsubmit = (e) => (e.preventDefault(), previaCnpj(previa.cnpj.value));
    $("#ch-cnpj-ia").onclick = () => {
      const cnpj = previa.cnpj.value.replace(/\D/g, "");
      if (![8, 14].includes(cnpj.length)) return alert("Informe o CNPJ com 8 ou 14 dígitos.");
      analisar("cnpj", cnpj, $("#ch-cnpj-ia"), $("#ch-cnpj-res"));
    };
  }
}

async function analisar(tipo, alvo, botao, destino) {
  const chave = `${tipo}:${alvo}`;
  const box = destino ?? botao.closest(".ch-item").querySelector(".ch-ia");
  botao.disabled = true;
  analises.set(chave, { carregando: true });
  box.innerHTML = drawAnalise(tipo, alvo, analises.get(chave));
  try {
    analises.set(chave, await api("/projetos/busca-fornecedor/chamados/analisar", { method: "POST", body: { tipo, alvo } }));
  } catch (err) {
    analises.set(chave, { erro: err.message });
  }
  box.innerHTML = drawAnalise(tipo, alvo, analises.get(chave));
  ligar(box);
  botao.disabled = false;
}

async function executar(id, alvo, params, botao) {
  const a = dados.acoes.find((x) => x.id === id);
  if (!a) return;
  if (a.risco === "digitar") return alert("Use a aba Troca de CNPJ para esta ação.");
  if (a.risco === "confirmar") {
    if (!confirm(`${a.nome}?\n\n${a.descricao}`)) return;
    params = { ...params, confirmar: true };
    if (id === "contest_resolver" || id === "contest_rejeitar") {
      const motivo = prompt("Motivo (fica nas notas do contest):", params.motivo ?? "");
      if (motivo === null) return;
      params.motivo = motivo;
    }
  }
  botao.disabled = true;
  try {
    const r = await api("/projetos/busca-fornecedor/chamados/acao", { method: "POST", body: { acao: id, alvo, params } });
    aviso(`${a.nome}: feito.${r.resultado?.job_id ? " Geração iniciada; use Verificar processamentos em alguns minutos." : ""}`);
    analises.delete(`${a.tipo}:${alvo}`);
    await carregarChamados();
  } catch (err) {
    alert(err.message);
    botao.disabled = false;
  }
}

async function verificar(e) {
  const b = e.target;
  b.disabled = true;
  try {
    const r = await api("/projetos/busca-fornecedor/chamados/verificar", { method: "POST" });
    aviso(`${r.verificados ?? 0} job(s) verificado(s)${r.resumo?.length ? `: ${r.resumo.map((x) => `${x.site} → ${x.status}`).join(", ")}` : ""}.`);
    await carregarChamados();
  } catch (err) {
    alert(err.message);
    b.disabled = false;
  }
}

async function previaCnpj(valor) {
  const cnpj = valor.replace(/\D/g, "");
  const box = $("#ch-cnpj-res");
  if (![8, 14].includes(cnpj.length)) return (box.innerHTML = `<div class="error">Informe o CNPJ com 8 (básico) ou 14 dígitos.</div>`);
  box.innerHTML = `<div class="loading">Consultando…</div>`;
  try {
    const { resultado: p } = await api("/projetos/busca-fornecedor/chamados/acao", { method: "POST", body: { acao: "cnpj_previa", alvo: cnpj } });
    const linha = (nome, n) => `<div class="row"><span class="grow">${nome}</span><b>${n ?? 0}</b></div>`;
    box.innerHTML = `<div class="ia-box">
        <div><b>${p.existe ? esc(p.razao_social ?? "Perfil encontrado") : "Nenhum perfil com este CNPJ"}</b>${p.is_dummy ? ` <span class="tag">dummy</span>` : ""}</div>
        ${p.chave_perfil ? `<div class="small muted">Perfil guardado com a chave ${esc(p.chave_perfil)}</div>` : ""}
        <div class="list" style="margin-top:8px">
          ${linha("Usuários fornecedores vinculados", p.usuarios_vinculados)}
          ${linha("Aparições em buscas", p.aparicoes)}
          ${linha("Envios de WhatsApp", p.whatsapp_envios)}
          ${linha("Engajamento", p.engajamento)}
          ${linha("Layouts de perfil", p.layouts_perfil)}
          ${linha("Avaliações", p.avaliacoes)}
          ${linha("Mensagens de compradores", p.mensagens)}
        </div>
      </div>
      ${p.existe && cnpj.length === 14 ? `<form class="ch-cnpj" id="ch-cnpj-trocar" style="margin-top:10px">
        <label><span class="small muted">CNPJ novo (14 dígitos)</span><input name="novo" inputmode="numeric" required></label>
        <label><span class="small muted">Digite o CNPJ novo de novo</span><input name="conf" inputmode="numeric" required></label>
        <button class="btn perigo">Trocar CNPJ (irreversível)</button>
      </form>` : p.existe ? `<div class="small muted" style="margin-top:8px">Para trocar, informe o CNPJ atual completo (14 dígitos).</div>` : ""}`;
    const f = $("#ch-cnpj-trocar");
    if (f)
      f.onsubmit = async (e) => {
        e.preventDefault();
        if (!confirm(`Trocar o CNPJ ${cnpj} por ${f.novo.value}?

Tudo o que é da conta e do perfil passa para o CNPJ novo. Não pode ser desfeito.`)) return;
        f.querySelector("button").disabled = true;
        try {
          const r = await api("/projetos/busca-fornecedor/chamados/acao", { method: "POST", body: { acao: "cnpj_trocar", alvo: cnpj, params: { cnpjNovo: f.novo.value, confirmacao: f.conf.value, confirmar: true } } });
          const m = r.resultado?.movidos ?? {};
          const itens = Object.entries(m).filter(([k, v]) => k !== "perfil" && v).map(([k, v]) => `${esc(k)}: ${v}`);
          box.innerHTML = `<div class="notice">CNPJ trocado para ${esc(r.resultado?.para ?? "")}. Perfil ${esc(m.perfil?.de ?? "")} → ${esc(m.perfil?.para ?? "")}.${itens.length ? `<br>Movidos: ${itens.join(" · ")}` : ""}</div>`;
        } catch (err) {
          alert(err.message);
          f.querySelector("button").disabled = false;
        }
      };
  } catch (err) {
    box.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

async function carregarHistorico(el) {
  el.innerHTML = `<div class="loading">Carregando…</div>`;
  try {
    const h = await api("/projetos/busca-fornecedor/chamados/historico");
    el.innerHTML = h.length
      ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quando</th><th>Ação</th><th>Item</th><th>Resultado</th><th>Por</th></tr></thead><tbody>${h
          .map((r) => `<tr><td class="nowrap">${esc(fmtData(r.em, { semana: false }))}</td><td>${esc(r.acao)}</td><td class="small">${esc(r.alvo)}</td><td>${r.resultado === "ok" ? `<span class="tag ok">ok</span>` : `<span class="tag alta" title="${esc(r.detalhe)}">erro</span>`} <span class="small muted">${esc(r.detalhe)}</span></td><td class="small muted">${esc(r.por)}</td></tr>`)
          .join("")}</tbody></table></div><p class="small muted">Histórico desde o último reinício do servidor.</p>`
      : `<div class="empty">Nenhuma ação desde o último reinício do servidor.</div>`;
  } catch (err) {
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

function aviso(texto) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = texto;
  document.body.append(t);
  setTimeout(() => t.remove(), 5000);
}
