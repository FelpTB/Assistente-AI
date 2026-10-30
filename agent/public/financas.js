// Aba Finanças: saldos atuais, relatório do período, histórico e formulários de inicialização/correção.
import { $, api, brl, brlCurto, esc, fmtData, fmtMes, hojeISO } from "./util.js";
import { barChart, hBars, lineChart } from "./charts.js";

const MEIOS = [
  { key: "Dinheiro", campo: "dinheiro", color: "--series-1" },
  { key: "Cartão", campo: "cartaoFatura", color: "--series-2" },
  { key: "Vale", campo: "vale", color: "--series-3" },
];

let periodo = null; // { de, ate } — mantido ao trocar de aba
let filtroMeio = "";
let ultimo = null; // última resposta de /financas, para redesenhar os gráficos no resize

export function renderFinancas(main) {
  const hoje = hojeISO();
  periodo ??= { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Finanças</h1><div class="muted">Registro contínuo · saldos em Dinheiro, Cartão e Vale</div></div>
      <div class="periodo">
        <select id="atalho" aria-label="Período">
          <option value="">Período…</option><option value="mes">Este mês</option><option value="ant">Mês passado</option>
          <option value="90">Últimos 90 dias</option><option value="ano">Este ano</option>
        </select>
        <input type="date" id="de" value="${periodo.de}" /><span class="muted">até</span><input type="date" id="ate" value="${periodo.ate}" />
      </div>
    </div>
    <div class="grid">
      <section class="card span-12"><div class="card-head"><h2>Saldos atuais</h2><a href="#ajustar" class="small">Inicializar ou corrigir</a></div><div id="f-saldos"></div></section>
      <section class="card span-12"><div class="card-head"><h2>No período</h2><span class="muted small" id="f-per"></span></div><div id="f-periodo"></div></section>
      <section class="card span-6"><div class="card-head"><h2>Entradas e saídas por mês</h2><span class="muted small">últimos 12 meses</span></div><div id="f-mensal"></div></section>
      <section class="card span-6"><div class="card-head"><h2>Evolução dos saldos</h2><span class="muted small">desde a data inicial</span></div><div id="f-evolucao"></div></section>
      <section class="card span-6"><div class="card-head"><h2>Saídas por categoria</h2><span class="muted small">no período</span></div><div id="f-cat"></div></section>
      <section class="card span-6"><div class="card-head"><h2>Saídas por meio</h2><span class="muted small">no período</span></div><div id="f-meio"></div></section>
      <section class="card span-12">
        <div class="card-head"><h2>Lançamentos</h2>
          <div class="chips" id="f-filtro">${["", ...MEIOS.map((m) => m.key)]
            .map((m) => `<button class="chip" data-meio="${esc(m)}" aria-pressed="${filtroMeio === m}">${m || "Todos"}</button>`)
            .join("")}</div>
        </div>
        <div id="f-lanc"></div>
      </section>
      <section class="card span-12" id="ajustar">
        <div class="card-head"><h2>Inicializar ou corrigir saldos</h2></div>
        <div class="forms">
          <form id="f-correcao" class="form">
            <h3>Corrigir</h3>
            <p class="muted small">Informe o valor real de hoje só no que estiver diferente. A diferença entra como ajuste, que muda o saldo mas não aparece como entrada ou saída.</p>
            <label>Dinheiro em conta<input name="dinheiro" type="number" step="0.01" inputmode="decimal" /></label>
            <label>Vale<input name="vale" type="number" step="0.01" inputmode="decimal" /></label>
            <label>Fatura do cartão em aberto<input name="cartaoFatura" type="number" step="0.01" inputmode="decimal" /></label>
            <label>Limite do cartão<input name="cartaoLimite" type="number" step="0.01" min="0" inputmode="decimal" /></label>
            <label>Motivo (opcional)<input name="motivo" maxlength="120" placeholder="Ex.: tarifa bancária não lançada" /></label>
            <button class="btn primary">Aplicar correção</button>
            <div class="form-msg small"></div>
          </form>
          <form id="f-iniciais" class="form">
            <h3>Inicializar</h3>
            <p class="muted small">Define o ponto de partida do monitoramento. Os saldos passam a ser estes valores mais os lançamentos a partir da data.</p>
            <label>Dinheiro em conta<input name="dinheiro" type="number" step="0.01" required inputmode="decimal" /></label>
            <label>Vale<input name="vale" type="number" step="0.01" required inputmode="decimal" /></label>
            <label>Fatura do cartão em aberto<input name="cartaoFatura" type="number" step="0.01" required inputmode="decimal" /></label>
            <label>Limite do cartão<input name="cartaoLimite" type="number" step="0.01" min="0" required inputmode="decimal" /></label>
            <label>Data destes valores<input name="data" type="date" required /></label>
            <button class="btn">Salvar valores iniciais</button>
            <div class="form-msg small"></div>
          </form>
        </div>
      </section>
    </div>`;

  const setPeriodo = (de, ate) => {
    periodo = { de, ate };
    $("#de").value = de;
    $("#ate").value = ate;
    carregar();
  };
  $("#de").onchange = () => setPeriodo($("#de").value, $("#ate").value);
  $("#ate").onchange = () => setPeriodo($("#de").value, $("#ate").value);
  $("#atalho").onchange = (e) => {
    const h = hojeISO();
    const [y, m] = h.split("-").map(Number);
    const v = e.target.value;
    e.target.value = "";
    if (v === "mes") setPeriodo(`${h.slice(0, 7)}-01`, h);
    if (v === "ant") {
      const ini = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      const fim = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
      setPeriodo(ini, fim);
    }
    if (v === "90") setPeriodo(new Date(Date.parse(`${h}T12:00:00Z`) - 89 * 86400000).toISOString().slice(0, 10), h);
    if (v === "ano") setPeriodo(`${y}-01-01`, h);
  };
  $("#f-filtro").onclick = (e) => {
    const b = e.target.closest("[data-meio]");
    if (!b) return;
    filtroMeio = b.dataset.meio;
    $("#f-filtro").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === b));
    if (ultimo) $("#f-lanc").innerHTML = drawLancamentos(ultimo.lancamentos);
  };
  $("#f-correcao").onsubmit = (e) => enviar(e, "/financas/correcao", (r) => `Correção aplicada (${r.feitos.length} item(ns)).`);
  $("#f-iniciais").onsubmit = (e) => {
    if (!confirm("Isso redefine o ponto de partida de todos os saldos. Continuar?")) {
      e.preventDefault();
      return;
    }
    enviar(e, "/financas/iniciais", () => "Valores iniciais salvos.");
  };
  carregar();
}

async function enviar(e, path, sucesso) {
  e.preventDefault();
  const form = e.target;
  const msg = form.querySelector(".form-msg");
  const btn = form.querySelector("button");
  const body = Object.fromEntries([...new FormData(form)].filter(([, v]) => v !== ""));
  btn.disabled = true;
  msg.className = "form-msg small muted";
  msg.textContent = "Salvando…";
  try {
    const r = await api(path, { method: "POST", body });
    msg.className = "form-msg small ok-text";
    msg.textContent = sucesso(r);
    if (form.id === "f-correcao") form.reset();
    carregar();
  } catch (err) {
    msg.className = "form-msg small error";
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function carregar() {
  const ids = ["#f-saldos", "#f-periodo", "#f-mensal", "#f-evolucao", "#f-cat", "#f-meio", "#f-lanc"];
  ids.forEach((id) => ($(id).innerHTML = `<div class="loading">Carregando…</div>`));
  $("#f-per").textContent = `${fmtData(periodo.de, { semana: false })} a ${fmtData(periodo.ate, { semana: false })}`;
  try {
    const d = await api(`/financas?de=${periodo.de}&ate=${periodo.ate}`);
    ultimo = d;
    desenhar(d);
  } catch (err) {
    ids.forEach((id) => ($(id).innerHTML = `<div class="error">${esc(err.message)}</div>`));
  }
}

function desenhar(d) {
  const r = d.resumo;
  const s = r.saldosAtuais;
  const ini = d.historico.iniciais;
  const sinal = (n) => (n < 0 ? "neg" : "");
  const semInicio = !ini.dinheiro && !ini.vale && !ini.cartaoFatura && !ini.cartaoLimite;

  $("#f-saldos").innerHTML = `
    ${semInicio ? `<div class="notice">Os valores iniciais ainda estão zerados. Preencha <a href="#ajustar">Inicializar</a> com os saldos de hoje para o monitoramento começar certo.</div>` : ""}
    <div class="kpis kpis-4 saldos">
      <div class="kpi"><div class="label"><i class="sw" style="background:var(--series-1)"></i>Dinheiro em conta</div><div class="value ${sinal(s.dinheiro)}">${brl(s.dinheiro)}</div></div>
      <div class="kpi"><div class="label"><i class="sw" style="background:var(--series-3)"></i>Vale</div><div class="value ${sinal(s.vale)}">${brl(s.vale)}</div></div>
      <div class="kpi"><div class="label"><i class="sw" style="background:var(--series-2)"></i>Cartão · fatura em aberto</div><div class="value">${brl(s.cartaoFatura)}</div></div>
      <div class="kpi"><div class="label">Cartão · limite disponível</div><div class="value ${sinal(s.cartaoLimiteDisponivel)}">${brl(s.cartaoLimiteDisponivel)}</div>
        <div class="small muted">de ${brl(ini.cartaoLimite)}</div></div>
    </div>
    <div class="small muted" style="margin-top:8px">Base: valores de ${fmtData(ini.data, { semana: false })}. Dinheiro disponível descontando a fatura: <b>${brl(s.dinheiro - s.cartaoFatura)}</b></div>`;

  $("#f-periodo").innerHTML = `
    <div class="kpis kpis-4">
      <div class="kpi"><div class="label">Entradas</div><div class="value pos">${brl(r.entradas)}</div></div>
      <div class="kpi"><div class="label">Saídas</div><div class="value neg">${brl(r.saidas)}</div></div>
      <div class="kpi"><div class="label">Resultado</div><div class="value ${r.saldoDoPeriodo >= 0 ? "pos" : "neg"}">${brl(r.saldoDoPeriodo)}</div></div>
      <div class="kpi"><div class="label">Faturas pagas</div><div class="value">${brl(r.faturasPagas)}</div></div>
    </div>
    <div class="small muted" style="margin-top:8px">Fixas ${brl(r.fixasPagas)} · Variáveis ${brl(r.variaveis)}</div>`;

  desenharGraficos(d);

  const cats = Object.entries(r.porCategoria ?? {}).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  $("#f-cat").innerHTML = hBars(cats, brl);

  const totalMeios = MEIOS.reduce((t, m) => t + (r.saidasPorMeio?.[m.key] ?? 0), 0);
  $("#f-meio").innerHTML = totalMeios
    ? `<div class="stack" role="img" aria-label="Saídas por meio">${MEIOS.map((m) => {
        const v = r.saidasPorMeio?.[m.key] ?? 0;
        return v ? `<span style="flex:${v};background:var(${m.color})" title="${m.key}: ${brl(v)}"></span>` : "";
      }).join("")}</div>
      <table class="tbl"><tbody>${MEIOS.map((m) => {
        const v = r.saidasPorMeio?.[m.key] ?? 0;
        return `<tr><td><i class="sw" style="background:var(${m.color})"></i>${m.key}</td><td class="num">${brl(v)}</td><td class="num muted">${((v / totalMeios) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</td></tr>`;
      }).join("")}</tbody></table>`
    : `<div class="empty">Sem saídas no período.</div>`;

  $("#f-lanc").innerHTML = drawLancamentos(d.lancamentos);

  // Formulários: mostra os valores atuais como referência.
  const fc = $("#f-correcao");
  fc.dinheiro.placeholder = `atual ${brl(s.dinheiro)}`;
  fc.vale.placeholder = `atual ${brl(s.vale)}`;
  fc.cartaoFatura.placeholder = `atual ${brl(s.cartaoFatura)}`;
  fc.cartaoLimite.placeholder = `atual ${brl(ini.cartaoLimite)}`;
  const fi = $("#f-iniciais");
  fi.dinheiro.value = ini.dinheiro;
  fi.vale.value = ini.vale;
  fi.cartaoFatura.value = ini.cartaoFatura;
  fi.cartaoLimite.value = ini.cartaoLimite;
  fi.data.value = ini.data;
}

function desenharGraficos(d) {
  const mensal = d.historico.mensal;
  const elM = $("#f-mensal");
  if (mensal.every((m) => !m.entradas && !m.saidas)) elM.innerHTML = `<div class="empty">Ainda não há lançamentos.</div>`;
  else
    barChart(
      elM,
      {
        labels: mensal.map((m) => fmtMes(m.mes)),
        series: [
          { name: "Entradas", color: "--series-1", values: mensal.map((m) => m.entradas) },
          { name: "Saídas", color: "--series-2", values: mensal.map((m) => m.saidas) },
        ],
      },
      { fmt: brlCurto, fmtTip: brl, title: "Entradas e saídas por mês" },
    );

  const pts = d.historico.saldosDiarios;
  lineChart(
    $("#f-evolucao"),
    {
      x: pts.map((p) => p.data),
      labels: pts.map((p) => fmtData(p.data)),
      series: [
        { name: "Dinheiro", color: "--series-1", values: pts.map((p) => p.dinheiro) },
        { name: "Fatura do cartão", color: "--series-2", values: pts.map((p) => p.cartaoFatura) },
        { name: "Vale", color: "--series-3", values: pts.map((p) => p.vale) },
      ],
    },
    { fmt: brlCurto, fmtTip: brl, fmtX: (x) => fmtData(x, { semana: false }), title: "Evolução dos saldos" },
  );
}

function drawLancamentos(lista) {
  const l = filtroMeio ? lista.filter((x) => x.meio === filtroMeio) : lista;
  if (!l.length) return `<div class="empty">Nenhum lançamento no período.</div>`;
  const sinal = (x) => (x.tipo === "Entrada" ? ["pos", "+"] : x.tipo === "Saída" ? ["neg", "−"] : ["muted", x.valor < 0 ? "−" : "±"]);
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Meio</th><th>Tipo</th><th class="num">Valor</th></tr></thead>
    <tbody>${l
      .map((x) => {
        const [cls, s] = sinal(x);
        return `<tr><td class="nowrap">${esc(fmtData(x.data, { semana: false }))}</td><td>${esc(x.descricao)}</td><td>${esc(x.categoria)}</td>
          <td><span class="tag">${esc(x.meio)}</span></td><td class="muted">${esc(x.tipo)}</td>
          <td class="num ${cls}">${s}${brl(Math.abs(x.valor))}</td></tr>`;
      })
      .join("")}</tbody></table></div>
    <div class="small muted" style="margin-top:8px">${l.length} lançamento(s)</div>`;
}

/** Redesenha os gráficos quando a largura muda. */
export function redesenharFinancas() {
  if (ultimo && $("#f-mensal")) desenharGraficos(ultimo);
}
