// Utilitários compartilhados do dashboard.
export const TZ = "America/Sao_Paulo";
export const $ = (sel, el = document) => el.querySelector(sel);

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const brl = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** R$ abreviado para eixos: R$ 1,2 mil. */
export const brlCurto = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

let onUnauthorized = () => {};
export const setOnUnauthorized = (fn) => (onUnauthorized = fn);

export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    onUnauthorized();
    throw new Error("Sessão expirada. Entre novamente.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro ?? `Erro ${res.status}`);
  return data;
}

/** Carrega um bloco de forma independente: se uma integração falhar, os outros continuam. */
export async function fill(el, loader, draw) {
  el.innerHTML = `<div class="loading">Carregando…</div>`;
  try {
    const data = await loader();
    el.innerHTML = draw(data);
    return data;
  } catch (err) {
    el.innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

// ---- Datas -----------------------------------------------------------------
export const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
export const hojeISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
export function fmtData(s, { hora = true, semana = true } = {}) {
  if (!s) return "";
  const opts = { day: "2-digit", month: "short", ...(semana ? { weekday: "short" } : {}) };
  if (isDateOnly(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("pt-BR", { timeZone: "UTC", ...opts });
  }
  const d = new Date(s);
  const dia = d.toLocaleDateString("pt-BR", { timeZone: TZ, ...opts });
  return hora ? `${dia} ${d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}` : dia;
}
export const fmtHora = (s) => new Date(s).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export function fmtMes(aaaamm, longo = false) {
  const [y, m] = aaaamm.split("-").map(Number);
  const txt = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { timeZone: "UTC", month: longo ? "long" : "short", year: "2-digit" });
  return txt.replace(".", "").replace(" de ", "/");
}
export const diaDe = (s) => (isDateOnly(s) ? s : new Date(s).toLocaleDateString("sv-SE", { timeZone: TZ }));
export const addDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
