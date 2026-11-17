// Esfera Academia: ficha de treino (com treino em andamento e cronômetro de descanso) e relatório mensal.
import { $, api, esc, fill, fmtData, fmtMes, hojeISO } from "./util.js";
import { barChart } from "./charts.js";

const num = (n, casas = 0) => (Number(n) || 0).toLocaleString("pt-BR", { maximumFractionDigits: casas });
const kg = (n) => (n == null ? "—" : `${num(n, 2)} kg`);
const pts = (n) => `${num(n, 2)} pt${Math.abs(n) === 1 ? "" : "s"}`;

let estado = null; // resposta de /treino
let el = null;

// ---- Ficha de treino ----------------------------------------------------------

export function renderTreino(container) {
  el = container;
  el.innerHTML = `<div class="loading">Carregando a ficha…</div>`;
  carregar();
}

async function carregar() {
  try {
    estado = await api("/treino");
    desenhar();
  } catch (err) {
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

function desenhar() {
  const { ativa, treinos, regras } = estado;
  el.innerHTML = `
    ${ativa ? `<div id="tr-ativa"></div>` : drawIniciar(treinos)}
    <section class="card" style="margin-top:16px">
      <div class="card-head"><h2>Ficha da semana</h2>
        <span class="muted small">${regras.seriesBase} séries por exercício · mínimo de ${regras.minRepeticoes} repetições · com ${regras.repsParaSubir} já pode subir o peso</span></div>
      ${drawFicha(treinos)}
    </section>`;
  if (ativa) desenharAtiva();
  el.querySelectorAll("[data-iniciar]").forEach((b) => (b.onclick = () => iniciar(b.dataset.iniciar, b)));
}

function drawIniciar(treinos) {
  return `<section class="card">
    <div class="card-head"><h2>Iniciar treino</h2><span class="muted small">Escolha a modalidade de hoje</span></div>
    <div class="tr-modalidades">${treinos
      .map(
        (t) => `<button class="tr-modalidade" data-iniciar="${esc(t.nome)}">
          <b>${esc(t.nome)}</b>
          <span class="small muted">${t.cardio ? "cardio" : `${t.exercicios.length} exercícios${t.descanso ? ` · descanso ${relogio(t.descanso)}` : ""}`}</span>
          <span class="small muted">${t.ultimaVez ? `último: ${esc(fmtData(t.ultimaVez, { hora: false }))}` : "ainda não feito"}</span>
        </button>`,
      )
      .join("")}</div>
  </section>`;
}

function drawFicha(treinos) {
  return `<div class="tr-ficha">${treinos
    .map(
      (t) => `<details class="tr-ficha-treino">
        <summary><b>${esc(t.nome)}</b> <span class="muted small">${t.ultimaVez ? `último: ${esc(fmtData(t.ultimaVez, { hora: false }))}` : "ainda não feito"}</span></summary>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Exercício</th><th>Grupo</th>${t.cardio ? "" : `<th class="num">Peso atual</th><th>Última série</th>`}</tr></thead><tbody>
        ${t.exercicios
          .map(
            (e) => `<tr><td>${esc(e.nome)}</td><td class="muted">${esc(e.grupo)}</td>${
              t.cardio ? "" : `<td class="num"><b>${kg(e.peso)}</b></td><td class="small muted">${e.ultima ? `${kg(e.ultima.peso)} × ${e.ultima.reps} · ${esc(fmtData(e.ultima.quando, { hora: false }))}` : "—"}</td>`
            }</tr>`,
          )
          .join("")}</tbody></table></div>
      </details>`,
    )
    .join("")}</div>`;
}

async function iniciar(treino, botao) {
  botao.disabled = true;
  try {
    await api("/treino/iniciar", { method: "POST", body: { treino } });
    await carregar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    alert(err.message);
    botao.disabled = false;
  }
}

// ---- Treino em andamento --------------------------------------------------------

function desenharAtiva() {
  const s = estado.ativa;
  const box = $("#tr-ativa");
  box.innerHTML = `
    <div class="tr-barra">
      <div><div class="small muted">Treino em andamento · desde ${esc(fmtData(s.inicio, { semana: false }))}</div><h2>${esc(s.treino)}</h2></div>
      <div class="tr-pontos"><span class="small muted">pontos</span><b id="tr-pontos">${num(s.pontos, 2)}</b></div>
      <div class="tr-timer" id="tr-timer">
        <span class="small muted">Descanso</span>
        <b id="tr-relogio">--:--</b>
        <div class="tr-timer-btns">
          ${(s.exercicios.find((e) => e.descanso)?.descanso ?? 0) ? `<button class="btn sm" data-timer="${s.exercicios.find((e) => e.descanso).descanso}">${relogio(s.exercicios.find((e) => e.descanso).descanso)}</button>` : ""}
          <button class="btn sm" data-timer="+15">+15 s</button>
          <button class="btn sm" data-timer="0">Parar</button>
        </div>
      </div>
    </div>
    <div class="tr-exercicios">${s.exercicios.map(drawExercicio).join("")}</div>
    <div class="tr-fim">
      <button class="btn" id="tr-cancelar">Cancelar treino</button>
      <button class="btn primary" id="tr-finalizar">Finalizar treino</button>
    </div>`;

  box.querySelectorAll("[data-timer]").forEach((b) => (b.onclick = () => (b.dataset.timer === "+15" ? somarTimer(15) : iniciarTimer(Number(b.dataset.timer)))));
  box.querySelectorAll("form[data-serie]").forEach((f) => (f.onsubmit = (e) => (e.preventDefault(), enviarSerie(f))));
  box.querySelectorAll("form[data-cardio]").forEach((f) => (f.onsubmit = (e) => (e.preventDefault(), enviarCardio(f))));
  box.querySelectorAll("form[data-subir]").forEach((f) => (f.onsubmit = (e) => (e.preventDefault(), enviarSubida(f))));
  box.querySelectorAll("[data-desfazer]").forEach((b) => (b.onclick = () => acao("/treino/serie/desfazer", { exercicio: b.dataset.desfazer }, b)));
  $("#tr-finalizar").onclick = finalizar;
  $("#tr-cancelar").onclick = cancelar;
  atualizarTimer();
}

function drawExercicio(e) {
  const id = slug(e.nome);
  if (e.cardio)
    return `<section class="card tr-ex">
      <div class="tr-ex-head"><div><b>${esc(e.nome)}</b> <span class="muted small">cardio</span></div>
        <span class="small ${e.cardioMin ? "ok-text" : "muted"}">${e.cardioMin ? `${num(e.cardioMin)} min feitos` : "não feito"}</span></div>
      <form class="tr-form" data-cardio="${esc(e.nome)}">
        <label><span class="small muted">Minutos</span><input name="minutos" type="number" inputmode="numeric" min="1" max="600" required placeholder="30"></label>
        <button class="btn primary">Registrar</button>
      </form>
    </section>`;

  const validas = e.feitas.filter((x) => x.valida).length;
  const completo = validas >= e.series;
  const ultimo = e.feitas.at(-1);
  const pesoPadrao = e.peso ?? ultimo?.peso ?? "";
  return `<section class="card tr-ex ${completo ? "tr-ex-ok" : ""}" id="ex-${id}">
    <div class="tr-ex-head">
      <div><b>${esc(e.nome)}</b> <span class="muted small">${esc(e.grupo)}</span></div>
      <span class="small"><b class="${completo ? "ok-text" : ""}">${validas}/${e.series}</b> séries · ${kg(e.peso)}</span>
    </div>
    ${
      e.feitas.length
        ? `<div class="tr-series">${e.feitas
            .map(
              (x) => `<span class="tr-serie ${x.valida ? "ok" : "ruim"}" title="${x.valida ? "Série válida" : "Abaixo do mínimo: não conta"}">${x.serie}ª · ${kg(x.peso)} × ${x.reps}${x.valida ? ` <b>+${num(x.pontos)}</b>` : ""}</span>`,
            )
            .join("")}<button class="btn sm link" data-desfazer="${esc(e.nome)}" title="Apaga a última série deste exercício">Desfazer</button></div>`
        : ""
    }
    ${e.evoluiu.map((v) => `<div class="tr-evolucao">Peso subiu: ${kg(v.de)} → ${kg(v.para)} <b>+${num(estado.regras.pontosEvolucao)}</b></div>`).join("")}
    <form class="tr-form" data-serie="${esc(e.nome)}">
      <label><span class="small muted">Peso (kg)</span><input name="peso" type="number" inputmode="decimal" step="0.5" min="0" max="1000" value="${esc(pesoPadrao)}" required></label>
      <label><span class="small muted">Repetições</span><input name="reps" type="number" inputmode="numeric" min="1" max="100" required placeholder="${estado.regras.minRepeticoes}–${estado.regras.repsParaSubir}"></label>
      <button class="btn primary">${completo ? "Série extra" : `Registrar ${e.feitas.length + 1}ª série`}</button>
    </form>
    ${
      e.podeSubir
        ? `<form class="tr-form tr-subir" data-subir="${esc(e.nome)}">
            <span class="small">Fez ${estado.regras.repsParaSubir}+ repetições: pode subir o peso.</span>
            <label><span class="small muted">Novo peso (kg)</span><input name="peso" type="number" inputmode="decimal" step="0.5" min="0" value="${esc((e.peso ?? 0) + 2)}" required></label>
            <button class="btn primary">Subir peso (+${estado.regras.pontosEvolucao} pts)</button>
          </form>`
        : ""
    }
  </section>`;
}

async function acao(caminho, corpo, botao) {
  if (botao) botao.disabled = true;
  try {
    estado.ativa = await api(caminho, { method: "POST", body: { sessao: estado.ativa.id, ...corpo } });
    const y = window.scrollY;
    desenharAtiva();
    window.scrollTo(0, y);
    return true;
  } catch (err) {
    alert(err.message);
    if (botao) botao.disabled = false;
    return false;
  }
}

async function enviarSerie(f) {
  const nome = f.dataset.serie;
  const reps = Number(f.reps.value);
  const ok = await acao("/treino/serie", { exercicio: nome, peso: Number(f.peso.value), reps }, f.querySelector("button"));
  if (!ok) return;
  const ex = estado.ativa.exercicios.find((e) => e.nome === nome);
  if (ex?.descanso) iniciarTimer(ex.descanso);
  if (reps < estado.regras.minRepeticoes) avisar(`Série com ${reps} repetições não conta (mínimo ${estado.regras.minRepeticoes}).`);
}

const enviarCardio = (f) => acao("/treino/cardio", { exercicio: f.dataset.cardio, minutos: Number(f.minutos.value) }, f.querySelector("button"));
const enviarSubida = (f) => acao("/treino/subir-peso", { exercicio: f.dataset.subir, pesoNovo: Number(f.peso.value) }, f.querySelector("button"));

async function finalizar() {
  const s = estado.ativa;
  if (!confirm(`Finalizar ${s.treino} com ${num(s.pontos, 2)} pontos?`)) return;
  try {
    await api("/treino/finalizar", { method: "POST", body: { sessao: s.id } });
    pararTimer();
    await carregar();
    avisar(`Treino finalizado: ${pts(s.pontos)}.`);
  } catch (err) {
    alert(err.message);
  }
}

async function cancelar() {
  if (!confirm("Cancelar este treino? Só é possível se nada foi registrado.")) return;
  try {
    await api("/treino/cancelar", { method: "POST", body: { sessao: estado.ativa.id } });
    pararTimer();
    await carregar();
  } catch (err) {
    alert(err.message);
  }
}

// ---- Cronômetro de descanso ------------------------------------------------------
// O fim do descanso fica salvo no navegador: recarregar a página não zera o cronômetro.

const CHAVE_TIMER = "treino-descanso-fim";
let tick = null;
let audio = null;

const relogio = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;

function lerFim() {
  try {
    return Number(localStorage.getItem(CHAVE_TIMER)) || 0;
  } catch {
    return 0;
  }
}

function salvarFim(ms) {
  try {
    ms ? localStorage.setItem(CHAVE_TIMER, String(ms)) : localStorage.removeItem(CHAVE_TIMER);
  } catch {}
}

function iniciarTimer(segundos) {
  if (!segundos) return pararTimer();
  // O som precisa ser liberado por um toque do usuário (regras dos navegadores no celular).
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume?.();
  } catch {}
  salvarFim(Date.now() + segundos * 1000);
  atualizarTimer();
}

function somarTimer(s) {
  const fim = lerFim();
  salvarFim(Math.max(fim, Date.now()) + s * 1000);
  atualizarTimer();
}

function pararTimer() {
  salvarFim(0);
  atualizarTimer();
}

function atualizarTimer() {
  clearInterval(tick);
  const passo = () => {
    const box = $("#tr-timer");
    const rel = $("#tr-relogio");
    if (!box || !rel) return clearInterval(tick);
    const fim = lerFim();
    const resta = Math.ceil((fim - Date.now()) / 1000);
    if (!fim) {
      rel.textContent = "--:--";
      box.classList.remove("rodando", "acabou");
      return clearInterval(tick);
    }
    if (resta <= 0) {
      rel.textContent = "0:00";
      box.classList.remove("rodando");
      box.classList.add("acabou");
      salvarFim(0);
      alertaFim();
      return clearInterval(tick);
    }
    rel.textContent = relogio(resta);
    box.classList.add("rodando");
    box.classList.remove("acabou");
  };
  passo();
  tick = setInterval(passo, 250);
}

function alertaFim() {
  try {
    navigator.vibrate?.([300, 150, 300]);
  } catch {}
  try {
    if (!audio) return;
    [0, 0.35, 0.7].forEach((t) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.25);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + t);
      o.stop(audio.currentTime + t + 0.3);
    });
  } catch {}
  avisar("Descanso terminado: próxima série!");
}

function avisar(texto) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = texto;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

const slug = (s) => s.normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase();

// ---- Relatório mensal -------------------------------------------------------------

let relatorioCache = null;

export function renderRelatorioTreino(container) {
  container.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Relatório do mês</h2><input type="month" id="tr-mes" value="${hojeISO().slice(0, 7)}"></div>
      <div id="tr-rel"></div>
    </section>`;
  const carregarMes = () => fill($("#tr-rel"), () => api(`/treino/relatorio?mes=${$("#tr-mes").value}`), drawRelatorio);
  $("#tr-mes").onchange = carregarMes;
  carregarMes();
}

function drawRelatorio(r) {
  relatorioCache = r;
  setTimeout(desenharGraficoTreino);
  return `
    <div class="kpis kpis-4">
      <div class="kpi"><div class="label">Pontos em ${esc(fmtMes(r.mes, true))}</div><div class="value">${num(r.pontos, 2)}</div>
        <div class="small muted">${num(r.pontosSeries, 2)} de séries · ${num(r.pontosEvolucao, 2)} de evolução · ${num(r.pontosCardio, 2)} de cardio</div></div>
      <div class="kpi"><div class="label">Treinos</div><div class="value">${num(r.treinos)}</div><div class="small muted">${num(r.diasTreinados)} dia(s) treinados</div></div>
      <div class="kpi"><div class="label">Séries válidas</div><div class="value">${num(r.seriesValidas)}</div><div class="small muted">${num(r.seriesInvalidas)} abaixo do mínimo</div></div>
      <div class="kpi"><div class="label">Evoluções de peso</div><div class="value">${num(r.evolucoes.length)}</div><div class="small muted">cardio: ${num(r.cardioMinutos / 60, 1)} h</div></div>
    </div>
    <h3 class="small muted" style="margin:16px 0 8px">Pontos por dia</h3>
    <div id="tr-graf"></div>
    <div class="grid" style="margin-top:12px">
      <div class="span-6">
        <h3 class="small muted" style="margin-bottom:8px">Treinos por modalidade</h3>
        ${r.porTreino.length ? `<div class="list">${r.porTreino.map((t) => `<div class="row"><span class="grow">${esc(t.treino)}</span><b>${num(t.sessoes)}</b></div>`).join("")}</div>` : `<div class="empty">Nenhum treino finalizado no mês.</div>`}
        <h3 class="small muted" style="margin:14px 0 8px">Evoluções</h3>
        ${r.evolucoes.length ? `<div class="list">${r.evolucoes.map((v) => `<div class="row"><span class="when">${esc(fmtData(v.quando, { hora: false, semana: false }))}</span><span class="grow">${esc(v.exercicio)}</span><span>${kg(v.de)} → <b>${kg(v.para)}</b></span></div>`).join("")}</div>` : `<div class="empty">Nenhuma subida de peso no mês.</div>`}
      </div>
      <div class="span-6">
        <h3 class="small muted" style="margin-bottom:8px">Maior peso por exercício</h3>
        ${r.recordes.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Exercício</th><th>Treino</th><th class="num">Maior peso</th><th class="num">Séries</th></tr></thead><tbody>${r.recordes.map((x) => `<tr><td>${esc(x.exercicio)}</td><td class="muted small">${esc(x.treino)}</td><td class="num"><b>${kg(x.maiorPeso)}</b></td><td class="num">${num(x.series)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Sem séries no mês.</div>`}
      </div>
    </div>`;
}

function desenharGraficoTreino() {
  const g = $("#tr-graf");
  if (!g || !relatorioCache) return;
  const d = relatorioCache.porDia;
  barChart(
    g,
    {
      labels: d.map((x) => fmtData(x.data, { semana: false })),
      series: [
        { name: "Séries", color: "--series-1", values: d.map((x) => x.series) },
        { name: "Evolução", color: "--series-2", values: d.map((x) => x.evolucao) },
        { name: "Cardio", color: "--series-3", values: d.map((x) => x.cardio) },
      ],
    },
    { height: 200, fmt: (v) => num(v, 2), title: "Pontos por dia" },
  );
}

export function redesenharAcademia() {
  desenharGraficoTreino();
}
