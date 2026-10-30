import { sheets } from "../google.js";
import { config } from "../config.js";

const spreadsheetId = config.google.expensesSpreadsheetId;

// Três meios, cada um com saldo próprio (calculado na aba Contas da planilha):
// - Dinheiro: conta corrente (débito, Pix). Entra o salário; sai o pagamento da fatura.
// - Cartão: crédito. Compras aumentam a fatura; o pagamento da fatura (com Dinheiro) libera o limite.
// - Vale: benefício da empresa, independente do Dinheiro.
export const MEIOS = ["Dinheiro", "Cartão", "Vale"] as const;
export const TIPOS = ["Entrada", "Saída", "Pagamento de fatura"] as const;
const CATEGORIA_FATURA = "Pagamento de fatura";

/** Converte "2026-10-30" no número de série de data do Google Sheets. */
function serialDate(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

function fromSerial(n: number): string {
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
}

const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: config.timezone });
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function listarCategorias() {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categorias!A2:B" });
  return (r.data.values ?? []).filter(([c]) => c).map(([categoria, tipo]) => ({ categoria, tipo }));
}

export async function lancarGasto(input: {
  data?: string; // ISO yyyy-mm-dd (padrão: hoje)
  descricao: string;
  tipo: (typeof TIPOS)[number];
  meio: (typeof MEIOS)[number];
  natureza?: "Fixa" | "Variável";
  categoria?: string;
  valor: number;
  origem?: string;
}) {
  if (!(TIPOS as readonly string[]).includes(input.tipo)) throw new Error(`Tipo inválido: ${input.tipo}. Use ${TIPOS.join(", ")}.`);
  if (!(MEIOS as readonly string[]).includes(input.meio)) throw new Error(`Meio inválido: ${input.meio}. Use ${MEIOS.join(", ")}.`);
  if (!(Number(input.valor) > 0)) throw new Error("Informe um valor positivo.");

  const fatura = input.tipo === "Pagamento de fatura";
  // A fatura é paga com o Dinheiro e não é despesa: as compras já entraram como Saída no Cartão.
  const meio = fatura ? "Dinheiro" : input.meio;
  const categoria = fatura ? CATEGORIA_FATURA : input.categoria;
  if (!fatura) {
    const cats = await listarCategorias();
    const doTipo = cats.filter((c) => c.tipo === input.tipo).map((c) => c.categoria);
    if (!categoria || !doTipo.includes(categoria))
      throw new Error(`Categoria "${categoria ?? ""}" não existe para ${input.tipo}. Escolha uma destas: ${doTipo.join(", ")}.`);
  }

  const data = input.data || hoje();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Lançamentos!A:H",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        serialDate(data),
        input.descricao,
        input.tipo,
        fatura ? "" : (input.natureza ?? "Variável"),
        categoria,
        Math.abs(input.valor),
        meio,
        input.origem ?? "WhatsApp",
      ]],
    },
  });
  return { ok: true, data, descricao: input.descricao, tipo: input.tipo, meio, categoria, valor: Math.abs(input.valor), saldos: await saldos() };
}

/** Saldos atuais dos três meios, lidos da aba Contas (a planilha é a fonte da verdade). */
export async function saldos() {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Contas!A4:B7",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const v = (i: number) => round2(Number(r.data.values?.[i]?.[1]) || 0);
  return {
    dinheiro: v(0),
    vale: v(1),
    cartaoFatura: v(2),
    cartaoLimiteDisponivel: v(3),
  };
}

type Lancamento = {
  data: string;
  descricao: string;
  tipo: string;
  natureza: string;
  categoria: string;
  valor: number;
  meio: string;
};

/**
 * Relatório de um período. O registro é contínuo; o período só filtra por data.
 * Padrão: mês atual. `mes` (aaaa-mm) é um atalho para o mês inteiro.
 */
export async function resumoGastos(input: { de?: string; ate?: string; mes?: string }) {
  let { de, ate } = input;
  if (input.mes && /^\d{4}-\d{2}$/.test(input.mes)) {
    const [y, m] = input.mes.split("-").map(Number);
    de = `${input.mes}-01`;
    ate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  if (!de) de = `${hoje().slice(0, 7)}-01`;
  if (!ate) ate = hoje();

  const r = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Lançamentos!A2:H",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const linhas: Lancamento[] = (r.data.values ?? [])
    .filter((l) => typeof l[0] === "number")
    .map((l) => ({
      data: fromSerial(l[0]),
      descricao: l[1],
      tipo: l[2],
      natureza: l[3],
      categoria: l[4],
      valor: Number(l[5]) || 0,
      meio: l[6],
    }))
    .filter((l) => l.data >= de! && l.data <= ate!)
    .sort((a, b) => a.data.localeCompare(b.data));

  const soma = (f: (l: Lancamento) => boolean) => round2(linhas.filter(f).reduce((s, l) => s + l.valor, 0));
  const saidas = linhas.filter((l) => l.tipo === "Saída");

  const porCategoria: Record<string, number> = {};
  for (const l of saidas) porCategoria[l.categoria] = round2((porCategoria[l.categoria] ?? 0) + l.valor);

  const saidasPorMeio = Object.fromEntries(MEIOS.map((m) => [m, soma((l) => l.tipo === "Saída" && l.meio === m)]));
  const entradasPorMeio = Object.fromEntries(MEIOS.map((m) => [m, soma((l) => l.tipo === "Entrada" && l.meio === m)]));

  const entradas = soma((l) => l.tipo === "Entrada");
  const totalSaidas = soma((l) => l.tipo === "Saída");
  return {
    de,
    ate,
    entradas,
    saidas: totalSaidas,
    saldoDoPeriodo: round2(entradas - totalSaidas),
    fixasPagas: soma((l) => l.tipo === "Saída" && l.natureza === "Fixa"),
    variaveis: soma((l) => l.tipo === "Saída" && l.natureza === "Variável"),
    faturasPagas: soma((l) => l.tipo === "Pagamento de fatura"),
    entradasPorMeio,
    saidasPorMeio,
    porCategoria,
    saldosAtuais: await saldos(),
    ultimosLancamentos: linhas.slice(-15),
  };
}
