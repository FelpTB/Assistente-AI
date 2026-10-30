import { sheets } from "../google.js";
import { config } from "../config.js";

const spreadsheetId = config.google.expensesSpreadsheetId;

/** Converte "2026-10-30" no número de série de data do Google Sheets. */
function serialDate(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

function fromSerial(n: number): string {
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
}

export async function listarCategorias() {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categorias!A2:B" });
  return (r.data.values ?? []).map(([categoria, tipo]) => ({ categoria, tipo }));
}

export async function lancarGasto(input: {
  data: string; // ISO yyyy-mm-dd
  descricao: string;
  tipo: "Entrada" | "Saída";
  natureza: "Fixa" | "Variável";
  categoria: string;
  valor: number;
  formaPagamento?: string;
  origem?: string;
}) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Lançamentos!A:H",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        serialDate(input.data),
        input.descricao,
        input.tipo,
        input.natureza,
        input.categoria,
        Math.abs(input.valor),
        input.formaPagamento ?? "",
        input.origem ?? "WhatsApp",
      ]],
    },
  });
  return { ok: true, ...input };
}

export async function resumoGastos(input: { mes?: string }) {
  // mes = "2026-10". Calcula aqui (não depende da célula B3 do Resumo).
  const mes = input.mes ?? new Date().toLocaleDateString("sv-SE", { timeZone: config.timezone }).slice(0, 7);
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Lançamentos!A2:H",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const linhas = (r.data.values ?? [])
    .filter((l) => typeof l[0] === "number" && fromSerial(l[0]).startsWith(mes))
    .map((l) => ({
      data: fromSerial(l[0]),
      descricao: l[1],
      tipo: l[2],
      natureza: l[3],
      categoria: l[4],
      valor: Number(l[5]) || 0,
    }));

  const soma = (f: (l: (typeof linhas)[number]) => boolean) =>
    Math.round(linhas.filter(f).reduce((s, l) => s + l.valor, 0) * 100) / 100;

  const porCategoria: Record<string, number> = {};
  for (const l of linhas.filter((l) => l.tipo === "Saída"))
    porCategoria[l.categoria] = Math.round(((porCategoria[l.categoria] ?? 0) + l.valor) * 100) / 100;

  const fixasCad = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Despesas Fixas!A2:F",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const fixasAtivas = (fixasCad.data.values ?? [])
    .filter((l) => l[5] === true)
    .map((l) => ({ descricao: l[0], categoria: l[1], valor: Number(l[2]) || 0, vencimentoDia: l[3] }));

  const entradas = soma((l) => l.tipo === "Entrada");
  const saidas = soma((l) => l.tipo === "Saída");
  return {
    mes,
    entradas,
    saidas,
    saldo: Math.round((entradas - saidas) * 100) / 100,
    fixasPagas: soma((l) => l.tipo === "Saída" && l.natureza === "Fixa"),
    variaveis: soma((l) => l.tipo === "Saída" && l.natureza === "Variável"),
    porCategoria,
    fixasCadastradas: fixasAtivas,
    ultimosLancamentos: linhas.slice(-10),
  };
}
