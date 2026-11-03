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
  const quem = norm(p.funcionario);
  const t = alvo
    ? tabelas.find((x) => String(x.id) === p.tabela || norm(x.name) === alvo)
    : (tabelas.find((x) => /ponto/.test(norm(x.name)) && norm(x.name).includes(quem)) ??
      tabelas.find((x) => /ponto/.test(norm(x.name))));
  if (!t) {
    const nomes = tabelas.map((x) => x.name).join(", ") || "nenhuma";
    throw new Error(`Tabela de ponto não encontrada no n8n (tabelas: ${nomes}). Defina PONTO_TABELA com o nome dela.`);
  }
  return t;
}

// ---- Interpretação das linhas -------------------------------------------------
// Formato da tabela (uma por funcionário, ex. "Ponto Felipe"): uma linha por batida.
//   Dia "01-10" (DD-MM, sem ano) · Hora "11:00" (horário local) · Tipo_ponto · createdAt (ISO, UTC)
// Tipos: Entrada, Almoco (Início), Almoco (Fim), Saída. O ano vem do createdAt.

type Linha = Record<string, unknown>;
type Batida = "entrada" | "almocoInicio" | "almocoFim" | "saida";

function tipoBatida(v: unknown): Batida | null {
  const t = norm(v);
  if (/almoc|interval/.test(t)) return /fim|volta|retorno/.test(t) ? "almocoFim" : "almocoInicio";
  if (/entrada/.test(t)) return "entrada";
  if (/saida/.test(t)) return "saida";
  return null;
}

/** Dia "AAAA-MM-DD" da batida: Dia (DD-MM) com o ano do createdAt (no fuso local). */
function diaDaBatida(l: Linha): string | null {
  const m = String(l.Dia ?? "").trim().match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?$/);
  const criado = Date.parse(String(l.createdAt ?? ""));
  const criadoLocal = Number.isNaN(criado) ? null : new Date(criado - 3 * 3600000);
  if (!m) return criadoLocal ? criadoLocal.toISOString().slice(0, 10) : null;
  const ano = m[3] ?? (criadoLocal ?? new Date()).getUTCFullYear();
  return `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function minutos(v: unknown): number | null {
  const m = String(v ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export type DiaPonto = {
  dia: string;
  semana: string;
  entrada: number | null;
  almocoInicio: number | null;
  almocoFim: number | null;
  saida: number | null;
  almoco: number; // minutos de almoço
  minutos: number; // horas trabalhadas, em minutos
  pendencias: string[];
};

/** Batidas do mês (AAAA-MM) agrupadas por dia, com almoço e horas trabalhadas. */
export async function pontoDoMes(mes: string) {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw Object.assign(new Error("Mês no formato AAAA-MM"), { status: 400 });
  const tabela = await tabelaPonto();
  const linhas: Linha[] = await paginado(`/${tabela.id}/rows`);

  const dias = new Map<string, Partial<Record<Batida, number>> & { repetidas: number }>();
  for (const l of linhas) {
    const dia = diaDaBatida(l);
    const tipo = tipoBatida(l.Tipo_ponto);
    const hora = minutos(l.Hora);
    if (!dia?.startsWith(mes) || !tipo || hora == null) continue;
    const d = dias.get(dia) ?? { repetidas: 0 };
    // Batida repetida: vale a primeira entrada/início de almoço e a última saída/volta do almoço.
    const atual = d[tipo];
    if (atual != null) {
      d.repetidas++;
      d[tipo] = tipo === "saida" || tipo === "almocoFim" ? Math.max(atual, hora) : Math.min(atual, hora);
    } else d[tipo] = hora;
    dias.set(dia, d);
  }

  const resultado: DiaPonto[] = [...dias.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, d]) => {
      const pendencias: string[] = [];
      if (d.entrada == null) pendencias.push("sem entrada");
      if (d.saida == null) pendencias.push("sem saída");
      if ((d.almocoInicio == null) !== (d.almocoFim == null))
        pendencias.push(d.almocoFim == null ? "sem volta do almoço" : "sem saída para o almoço");
      if (d.repetidas) pendencias.push(`${d.repetidas} batida(s) repetida(s)`);
      const almoco = d.almocoInicio != null && d.almocoFim != null ? Math.max(0, d.almocoFim - d.almocoInicio) : 0;
      return {
        dia,
        semana: SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()],
        entrada: d.entrada ?? null,
        almocoInicio: d.almocoInicio ?? null,
        almocoFim: d.almocoFim ?? null,
        saida: d.saida ?? null,
        almoco,
        minutos: d.entrada != null && d.saida != null ? Math.max(0, d.saida - d.entrada - almoco) : 0,
        pendencias,
      };
    });
  const total = resultado.reduce((s, d) => s + d.minutos, 0);
  const datas = linhas.map(diaDaBatida).filter((d): d is string => !!d).sort();
  return {
    mes,
    nomeMes: `${MESES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`,
    tabela: tabela.name as string,
    dias: resultado,
    diasTrabalhados: resultado.filter((d) => d.minutos > 0).length,
    totalMinutos: total,
    total: hhmm(total),
    incompletos: resultado.filter((d) => d.pendencias.length).map((d) => d.dia),
    // Explica uma planilha vazia: quantas batidas a tabela tem e de quando a quando.
    diagnostico: { linhas: linhas.length, primeiroDia: datas[0] ?? null, ultimoDia: datas.at(-1) ?? null, exemplo: linhas.at(-1) ?? null },
  };
}

// ---- Planilha -------------------------------------------------------------------

export async function planilhaPonto(mes: string) {
  const r = await pontoDoMes(mes);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Assistente AI";
  const ws = wb.addWorksheet(`Ponto ${mes}`, { views: [{ state: "frozen", ySplit: 3 }] });

  const colunas = ["Data", "Dia", "Entrada", "Saída almoço", "Volta almoço", "Saída", "Almoço", "Horas", "Observação"];
  const ALMOCO = 7;
  const HORAS = 8;
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

  const hora = (m: number | null) => (m == null ? null : hhmm(m));
  for (const d of r.dias) {
    const [a, m, dd] = d.dia.split("-").map(Number);
    const row = ws.addRow([
      new Date(Date.UTC(a, m - 1, dd)),
      d.semana,
      hora(d.entrada),
      hora(d.almocoInicio),
      hora(d.almocoFim),
      hora(d.saida),
      d.almoco / 1440,
      d.minutos / 1440,
      d.pendencias.join("; "),
    ]);
    row.getCell(1).numFmt = "dd/mm/yyyy";
    row.getCell(ALMOCO).numFmt = "[h]:mm";
    row.getCell(HORAS).numFmt = "[h]:mm";
    row.getCell(HORAS).font = { bold: true };
    for (let c = 2; c <= HORAS; c++) row.getCell(c).alignment = { horizontal: "center" };
    if (d.pendencias.length) row.getCell(colunas.length).font = { color: { argb: "FFC00000" } };
  }

  const tot = ws.addRow([]);
  tot.getCell(1).value = "Total";
  tot.getCell(2).value = `${r.diasTrabalhados} dias`;
  tot.getCell(HORAS).value = r.totalMinutos / 1440;
  tot.getCell(HORAS).numFmt = "[h]:mm";
  tot.getCell(HORAS).alignment = { horizontal: "center" };
  tot.font = { bold: true };
  tot.eachCell((c) => (c.border = { top: { style: "thin" } }));

  ws.columns.forEach((c, i) => (c.width = i === 0 ? 12 : i === colunas.length - 1 ? 32 : 13));

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
    (r.incompletos.length ? `Dias com registro incompleto (conferir): ${r.incompletos.map((d) => d.split("-").reverse().join("/")).join(", ")}\n` : "");
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
