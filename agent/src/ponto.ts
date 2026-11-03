import ExcelJS from "exceljs";
import { config } from "./config.js";
import { gmail } from "./google.js";

// Planilha mensal do ponto do Felipe: lê a data table de ponto do n8n, organiza as batidas
// por dia, calcula as horas e envia o .xlsx por e-mail (Gmail). Nada fica guardado aqui.

const p = config.ponto;
const n8nUrl = config.buscaFornecedor.n8nUrl;
const n8nKey = config.buscaFornecedor.n8nApiKey;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// ---- n8n Data Tables ---------------------------------------------------------

// A documentação pública do n8n não fixa o caminho; versões usam /data-tables ou /datatables.
let basePath: string | null = null;

async function n8n(path: string): Promise<any> {
  if (!n8nUrl || !n8nKey) throw new Error("Configure N8N_URL e N8N_API_KEY para ler o ponto.");
  const bases = basePath ? [basePath] : ["/data-tables", "/datatables"];
  let ultimo = "";
  for (const base of bases) {
    const res = await fetch(`${n8nUrl}/api/v1${base}${path}`, {
      headers: { "X-N8N-API-KEY": n8nKey, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      basePath = base;
      return res.json();
    }
    const erro = `n8n ${base}${path}: ${res.status} ${(await res.text()).slice(0, 200)}`;
    if (res.status === 403) {
      ultimo = `${erro} — a chave do n8n (N8N_API_KEY) não tem acesso às data tables. Crie uma chave com os escopos dataTable:list/read e dataTableRow:read (ou sem restrição de escopo).`;
    } else if (!ultimo || res.status !== 404) {
      ultimo = erro;
    }
    if (res.status !== 404 && res.status !== 403) break;
  }
  throw new Error(ultimo);
}

async function paginado(path: string): Promise<any[]> {
  const itens: any[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 200; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await n8n(`${path}${sep}limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    itens.push(...(Array.isArray(r) ? r : (r.data ?? [])));
    cursor = r.nextCursor ?? null;
    if (!cursor) break;
  }
  return itens;
}

/** Tabelas do n8n com as colunas (para conferir a estrutura pelo dashboard). */
export async function tabelasN8n() {
  const tabelas = await paginado("");
  return tabelas.map((t) => ({ id: t.id, nome: t.name, colunas: (t.columns ?? []).map((c: any) => ({ nome: c.name, tipo: c.type })) }));
}

async function tabelaPonto() {
  const tabelas = await paginado("");
  const alvo = norm(p.tabela);
  const t = alvo
    ? tabelas.find((x) => String(x.id) === p.tabela || norm(x.name) === alvo)
    : tabelas.find((x) => /ponto/.test(norm(x.name)));
  if (!t) {
    const nomes = tabelas.map((x) => x.name).join(", ") || "nenhuma";
    throw new Error(`Tabela de ponto não encontrada no n8n (tabelas: ${nomes}). Defina PONTO_TABELA com o nome dela.`);
  }
  return t;
}

// ---- Interpretação das linhas -------------------------------------------------

type Linha = Record<string, unknown>;
const INTERNAS = /^(id|createdat|updatedat|created_at|updated_at)$/;

/** Descobre as colunas pelo nome: funcionário, data, horários e observação. */
function mapearColunas(linhas: Linha[]) {
  const nomes = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
  const acha = (re: RegExp) => nomes.find((n) => re.test(norm(n)));
  const funcionario = p.colunaFuncionario || acha(/funcionari|colaborador|employee|^nome|usuario|^user/);
  const data = acha(/^data$|^dia$|^date$|^data[ _]/);
  const obs = acha(/obs|justific|nota|coment/);
  // Colunas de horário: nomes de batida ou valores com hora.
  const horarios = nomes.filter(
    (n) =>
      !INTERNAS.test(norm(n)) &&
      n !== funcionario &&
      n !== obs &&
      (/entrada|saida|inicio|fim|almoco|intervalo|retorno|batida|hora|horario|registro|timestamp|marcac/.test(norm(n)) ||
        linhas.some((l) => typeof l[n] === "string" && /^\d{1,2}:\d{2}/.test(String(l[n])))),
  );
  return { nomes, funcionario, data, obs, horarios };
}

/** Converte um valor em data/hora local (America/Sao_Paulo, UTC-3 fixo). */
function local(v: unknown, diaBase?: string): { dia: string; min: number | null } | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const hora = s.match(/^(\d{1,2}):(\d{2})/);
  if (hora && diaBase) return { dia: diaBase, min: Number(hora[1]) * 60 + Number(hora[2]) };
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (br) return { dia: `${br[3]}-${br[2]}-${br[1]}`, min: br[4] ? Number(br[4]) * 60 + Number(br[5]) : null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { dia: s, min: null };
  // Sem fuso ("2026-10-01 08:00"): já é hora local.
  const semFuso = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::[\d.]+)?$/);
  if (semFuso) return { dia: semFuso[1], min: Number(semFuso[2]) * 60 + Number(semFuso[3]) };
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t - 3 * 3600000);
  return { dia: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** Dia da coluna de data. Colunas "date" do n8n vêm como meia-noite UTC: vale a data escrita, sem converter o fuso. */
function diaDe(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.0+)?)?Z?)?$/);
  return iso ? iso[1] : local(s)?.dia;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export type DiaPonto = { dia: string; semana: string; batidas: number[]; minutos: number; incompleto: boolean; obs: string };

/** Linhas do funcionário no mês (AAAA-MM), agrupadas por dia com as horas trabalhadas. */
export async function pontoDoMes(mes: string) {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw Object.assign(new Error("Mês no formato AAAA-MM"), { status: 400 });
  const tabela = await tabelaPonto();
  const linhas: Linha[] = await paginado(`/${tabela.id}/rows`);
  const col = mapearColunas(linhas);
  if (!col.funcionario) throw new Error(`Não achei a coluna do funcionário (colunas: ${col.nomes.join(", ")}). Defina PONTO_COLUNA_FUNCIONARIO.`);
  if (!col.horarios.length && !col.data) throw new Error(`Não achei colunas de data/horário (colunas: ${col.nomes.join(", ")}).`);

  const quem = norm(p.funcionario);
  const fCol = col.funcionario;
  const doFuncionario = linhas.filter((l) => norm(l[fCol]).includes(quem));
  // Datas que aparecem nas linhas do funcionário (para explicar uma planilha vazia).
  const diasVistos = doFuncionario
    .flatMap((l) => {
      const base = col.data ? diaDe(l[col.data]) : undefined;
      return col.horarios.map((c) => local(l[c], base)?.dia).concat(base);
    })
    .filter((d): d is string => !!d)
    .sort();
  const dias = new Map<string, { batidas: Set<number>; obs: string[] }>();
  for (const l of linhas) {
    if (!norm(l[fCol]).includes(quem)) continue;
    const base = col.data ? diaDe(l[col.data]) : undefined;
    for (const c of col.horarios) {
      const v = local(l[c], base);
      if (!v || !v.dia.startsWith(mes)) continue;
      const d = dias.get(v.dia) ?? { batidas: new Set(), obs: [] };
      if (v.min != null) d.batidas.add(v.min);
      dias.set(v.dia, d);
    }
    if (base?.startsWith(mes)) {
      const d = dias.get(base) ?? { batidas: new Set(), obs: [] };
      const o = col.obs ? String(l[col.obs] ?? "").trim() : "";
      if (o && !d.obs.includes(o)) d.obs.push(o);
      dias.set(base, d);
    }
  }

  const resultado: DiaPonto[] = [...dias.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, d]) => {
      const batidas = [...d.batidas].sort((a, b) => a - b);
      let minutos = 0;
      for (let i = 0; i + 1 < batidas.length; i += 2) minutos += batidas[i + 1] - batidas[i];
      return {
        dia,
        semana: SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()],
        batidas,
        minutos,
        incompleto: batidas.length % 2 === 1,
        obs: d.obs.join("; "),
      };
    });
  const total = resultado.reduce((s, d) => s + d.minutos, 0);
  return {
    mes,
    nomeMes: `${MESES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`,
    tabela: tabela.name as string,
    colunas: col,
    dias: resultado,
    diasTrabalhados: resultado.filter((d) => d.minutos > 0).length,
    totalMinutos: total,
    total: hhmm(total),
    incompletos: resultado.filter((d) => d.incompleto).map((d) => d.dia),
    diagnostico: {
      linhas: linhas.length,
      doFuncionario: doFuncionario.length,
      nomesNaTabela: new Set(linhas.map((l) => norm(l[fCol]))).size,
      primeiroDia: diasVistos[0] ?? null,
      ultimoDia: diasVistos.at(-1) ?? null,
      exemplo: doFuncionario.at(-1) ?? null, // uma linha do próprio Felipe, como veio do n8n
    },
  };
}

// ---- Planilha -------------------------------------------------------------------

export async function planilhaPonto(mes: string) {
  const r = await pontoDoMes(mes);
  const maxBatidas = Math.max(4, ...r.dias.map((d) => d.batidas.length + (d.batidas.length % 2)));
  const pares = maxBatidas / 2;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Assistente AI";
  const ws = wb.addWorksheet(`Ponto ${mes}`, { views: [{ state: "frozen", ySplit: 3 }] });

  const colunas = ["Data", "Dia"];
  for (let i = 1; i <= pares; i++) colunas.push(`Entrada ${i}`, `Saída ${i}`);
  colunas.push("Horas", "Observação");

  ws.mergeCells(1, 1, 1, colunas.length);
  ws.getCell(1, 1).value = `Ponto de ${p.funcionario} · ${r.nomeMes}`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.addRow([]);
  const cab = ws.addRow(colunas);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
    c.alignment = { horizontal: "center" };
  });

  for (const d of r.dias) {
    const [a, m, dd] = d.dia.split("-").map(Number);
    const linha: (string | number | Date | null)[] = [new Date(Date.UTC(a, m - 1, dd)), d.semana];
    for (let i = 0; i < maxBatidas; i++) linha.push(d.batidas[i] != null ? hhmm(d.batidas[i]) : null);
    linha.push(d.minutos / 1440, [d.incompleto ? "Batida ímpar: confira" : "", d.obs].filter(Boolean).join(" · "));
    const row = ws.addRow(linha);
    row.getCell(1).numFmt = "dd/mm/yyyy";
    row.getCell(colunas.length - 1).numFmt = "[h]:mm";
    if (d.incompleto) row.getCell(colunas.length).font = { color: { argb: "FFC00000" } };
    if (d.semana === "sábado" || d.semana === "domingo") row.font = { color: { argb: "FF7F7F7F" } };
  }

  const tot = ws.addRow([]);
  tot.getCell(1).value = "Total";
  tot.getCell(2).value = `${r.diasTrabalhados} dias`;
  tot.getCell(colunas.length - 1).value = r.totalMinutos / 1440;
  tot.getCell(colunas.length - 1).numFmt = "[h]:mm";
  tot.font = { bold: true };
  tot.eachCell((c) => (c.border = { top: { style: "thin" } }));

  ws.columns.forEach((c, i) => (c.width = i === 0 ? 12 : i === colunas.length - 1 ? 36 : 10));
  ws.getColumn(colunas.length).width = 36;

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { ...r, arquivo: `Ponto ${p.funcionario} ${mes}.xlsx`, buffer };
}

// ---- E-mail ---------------------------------------------------------------------

const assunto = (nomeMes: string) => `Ponto ${p.funcionario} - ${nomeMes}`;

function mimeHeader(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;
}

/** Gera a planilha do mês e envia para PONTO_EMAIL. */
export async function enviarPonto(mes: string) {
  const r = await planilhaPonto(mes);
  if (!r.dias.length) throw new Error(`Não há registros de ponto de ${p.funcionario} em ${r.nomeMes}.`);
  const fronteira = `aa-${Date.now().toString(36)}`;
  const texto =
    `Segue a planilha de ponto de ${p.funcionario} de ${r.nomeMes}.\n\n` +
    `Dias com registro: ${r.diasTrabalhados}\nTotal de horas: ${r.total}\n` +
    (r.incompletos.length ? `Dias com batida ímpar (conferir): ${r.incompletos.map((d) => d.split("-").reverse().join("/")).join(", ")}\n` : "");
  const mime = [
    `To: ${p.email}`,
    `Subject: ${mimeHeader(assunto(r.nomeMes))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${fronteira}"`,
    "",
    `--${fronteira}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(texto).toString("base64"),
    `--${fronteira}`,
    `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="${mimeHeader(r.arquivo)}"`,
    `Content-Disposition: attachment; filename="${mimeHeader(r.arquivo)}"`,
    "Content-Transfer-Encoding: base64",
    "",
    r.buffer.toString("base64").replace(/.{76}/g, "$&\r\n"),
    `--${fronteira}--`,
  ].join("\r\n");
  try {
    await gmail.users.messages.send({ userId: "me", requestBody: { raw: Buffer.from(mime).toString("base64url") } });
  } catch (err: any) {
    if (err?.code === 403 || /insufficient/i.test(err?.message ?? ""))
      throw new Error("O token do Google não tem permissão de envio. Gere um novo GOOGLE_REFRESH_TOKEN com o escopo gmail.send.");
    throw err;
  }
  return { enviadoPara: p.email, mes: r.nomeMes, diasTrabalhados: r.diasTrabalhados, total: r.total, incompletos: r.incompletos };
}

/** Já existe e-mail enviado com o ponto desse mês? (evita reenviar depois de reiniciar o servidor) */
export async function pontoJaEnviado(mes: string) {
  const nomeMes = `${MESES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`;
  const r = await gmail.users.messages.list({ userId: "me", q: `in:sent to:${p.email} subject:"${assunto(nomeMes)}"`, maxResults: 1 });
  return (r.data.messages ?? []).length > 0;
}

/** AAAA-MM do mês anterior ao de hoje (fuso do assistente). */
export function mesAnterior(): string {
  const [a, m] = new Date().toLocaleDateString("sv-SE", { timeZone: config.timezone }).split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}
