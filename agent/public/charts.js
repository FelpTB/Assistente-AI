// Gráficos em SVG, sem bibliotecas. Cores pelas variáveis --series-N (claro/escuro no CSS).
// Regras: um eixo só, legenda quando há 2+ séries, tooltip no hover, texto sempre na cor do texto.
import { esc } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
const PAD = { top: 12, right: 12, bottom: 28, left: 64 };

/** Escala "bonita" para o eixo Y: 4 a 5 marcas em passos redondos. */
function niceTicks(min, max, count = 4) {
  if (min === max) max = min + 1;
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/** Barra com as pontas de dado arredondadas (4px) e base reta. */
function barPath(x, y0, w, y1) {
  const h = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return "";
  if (y1 < y0) // para cima
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

function legend(series) {
  if (series.length < 2) return "";
  return `<div class="legend">${series
    .map((s) => `<span><i style="background:var(${s.color})"></i>${esc(s.name)}</span>`)
    .join("")}</div>`;
}

function frame(el, series, height) {
  el.classList.add("chart");
  el.innerHTML = `${legend(series)}<div class="chart-plot"><svg role="img"></svg><div class="chart-tip" hidden></div></div>`;
  const plot = el.querySelector(".chart-plot");
  const svg = el.querySelector("svg");
  const tip = el.querySelector(".chart-tip");
  const width = Math.max(plot.clientWidth, 260);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  return { svg, tip, plot, width, height };
}

function axisY(svg, ticks, y, width, fmt) {
  let out = "";
  for (const t of ticks) {
    out += `<line x1="${PAD.left}" x2="${width - PAD.right}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? "axis-zero" : "grid"}"/>`;
    out += `<text x="${PAD.left - 8}" y="${y(t) + 4}" text-anchor="end" class="tick">${esc(fmt(t))}</text>`;
  }
  return out;
}

function showTip(tip, plot, html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pw = plot.clientWidth;
  const tw = tip.offsetWidth;
  tip.style.left = `${Math.min(Math.max(x - tw / 2, 0), pw - tw)}px`;
  tip.style.top = `${Math.max(y - tip.offsetHeight - 10, 0)}px`;
}

/**
 * Barras agrupadas. data = { labels: [...], series: [{ name, color: "--series-1", values: [...] }] }
 */
export function barChart(el, data, { height = 240, fmt = String, fmtTip = fmt, title = "" } = {}) {
  const { svg, tip, plot, width } = frame(el, data.series, height);
  svg.setAttribute("aria-label", title);
  const all = data.series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * (height - PAD.top - PAD.bottom);
  const n = data.labels.length;
  const band = (width - PAD.left - PAD.right) / n;
  const k = data.series.length;
  const gap = 2; // espaço entre barras vizinhas
  const bw = Math.max(Math.min((band * 0.7 - gap * (k - 1)) / k, 28), 3);
  const groupW = bw * k + gap * (k - 1);

  let out = axisY(svg, ticks, y, width, fmt);
  data.labels.forEach((lab, i) => {
    const x0 = PAD.left + band * i + (band - groupW) / 2;
    data.series.forEach((s, j) => {
      const d = barPath(x0 + j * (bw + gap), y(0), bw, y(s.values[i]));
      if (d) out += `<path d="${d}" style="fill:var(${s.color})"/>`;
    });
    // Rótulo do eixo X: mostra todos se couber, senão pula alternados.
    const step = Math.ceil(n / Math.max(Math.floor((width - PAD.left) / 52), 1));
    if (i % step === 0) out += `<text x="${PAD.left + band * i + band / 2}" y="${height - 8}" text-anchor="middle" class="tick">${esc(lab)}</text>`;
    out += `<rect class="hit" data-i="${i}" x="${PAD.left + band * i}" y="${PAD.top}" width="${band}" height="${height - PAD.top - PAD.bottom}"/>`;
  });
  svg.innerHTML = out;

  svg.querySelectorAll(".hit").forEach((r) => {
    r.addEventListener("mouseenter", () => {
      const i = Number(r.dataset.i);
      svg.querySelectorAll(".hit").forEach((o) => o.classList.toggle("on", o === r));
      showTip(
        tip,
        plot,
        `<b>${esc(data.labels[i])}</b>${data.series
          .map((s) => `<div><i style="background:var(${s.color})"></i>${esc(s.name)}<span>${esc(fmtTip(s.values[i]))}</span></div>`)
          .join("")}`,
        PAD.left + band * i + band / 2,
        y(Math.max(0, ...data.series.map((s) => s.values[i]))),
      );
    });
  });
  svg.addEventListener("mouseleave", () => {
    tip.hidden = true;
    svg.querySelectorAll(".hit.on").forEach((o) => o.classList.remove("on"));
  });
}

/**
 * Linhas no tempo com crosshair. data = { x: ["2026-10-01", ...], labels: [...], series: [{ name, color, values }] }
 * Os pontos são espaçados pela data real (não pela posição).
 */
export function lineChart(el, data, { height = 240, fmt = String, fmtTip = fmt, fmtX = String, title = "" } = {}) {
  const { svg, tip, plot, width } = frame(el, data.series, height);
  svg.setAttribute("aria-label", title);
  const t = data.x.map((d) => Date.parse(`${d}T12:00:00Z`));
  const t0 = Math.min(...t), t1 = Math.max(...t);
  const all = data.series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const plotW = width - PAD.left - PAD.right;
  const x = (i) => PAD.left + (t1 === t0 ? plotW / 2 : ((t[i] - t0) / (t1 - t0)) * plotW);
  const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * (height - PAD.top - PAD.bottom);

  let out = axisY(svg, ticks, y, width, fmt);
  // Rótulos do eixo X: início, fim e alguns no meio.
  const marks = data.x.length <= 1 ? [0] : [0, ...[0.25, 0.5, 0.75].map((f) => Math.round(f * (data.x.length - 1))), data.x.length - 1];
  [...new Set(marks)].forEach((i) => {
    out += `<text x="${x(i)}" y="${height - 8}" text-anchor="${i === 0 ? "start" : i === data.x.length - 1 ? "end" : "middle"}" class="tick">${esc(fmtX(data.x[i]))}</text>`;
  });
  for (const s of data.series) {
    // Degraus: o saldo fica constante até o próximo lançamento.
    let d = "";
    s.values.forEach((v, i) => {
      d += i === 0 ? `M${x(i)},${y(v)}` : `H${x(i)}V${y(v)}`;
    });
    out += `<path d="${d}" class="line" style="stroke:var(${s.color})"/>`;
    if (s.values.length === 1) out += `<circle cx="${x(0)}" cy="${y(s.values[0])}" r="4" style="fill:var(${s.color})"/>`;
  }
  out += `<line class="crosshair" y1="${PAD.top}" y2="${height - PAD.bottom}" x1="0" x2="0" visibility="hidden"/>`;
  out += data.series.map((s, j) => `<circle class="dot" data-j="${j}" r="4" style="fill:var(${s.color})" visibility="hidden"/>`).join("");
  out += `<rect class="hit-area" x="${PAD.left}" y="${PAD.top}" width="${plotW}" height="${height - PAD.top - PAD.bottom}"/>`;
  svg.innerHTML = out;

  const cross = svg.querySelector(".crosshair");
  const dots = svg.querySelectorAll(".dot");
  svg.querySelector(".hit-area").addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * width;
    // Último ponto com data <= cursor (o saldo vale até o próximo lançamento).
    let i = 0;
    for (let k = 0; k < data.x.length; k++) if (x(k) <= px + 1) i = k;
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    dots.forEach((dot, j) => {
      dot.setAttribute("cx", x(i));
      dot.setAttribute("cy", y(data.series[j].values[i]));
      dot.setAttribute("visibility", "visible");
    });
    showTip(
      tip,
      plot,
      `<b>${esc(data.labels?.[i] ?? data.x[i])}</b>${data.series
        .map((s) => `<div><i style="background:var(${s.color})"></i>${esc(s.name)}<span>${esc(fmtTip(s.values[i]))}</span></div>`)
        .join("")}`,
      x(i),
      Math.min(...data.series.map((s) => y(s.values[i]))),
    );
  });
  svg.addEventListener("mouseleave", () => {
    tip.hidden = true;
    cross.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.setAttribute("visibility", "hidden"));
  });
}

/** Barras horizontais de uma série (ex.: saídas por categoria), em HTML. */
export function hBars(items, fmt) {
  if (!items.length) return `<div class="empty">Sem dados no período.</div>`;
  const max = Math.max(...items.map((i) => i.value), 1);
  return `<div class="bars">${items
    .map(
      (i) => `<div class="bar-row" title="${esc(i.label)}: ${esc(fmt(i.value))}"><span class="name">${esc(i.label)}</span>
      <div class="bar"><span style="width:${(i.value / max) * 100}%"></span></div><span class="val">${esc(fmt(i.value))}</span></div>`,
    )
    .join("")}</div>`;
}
