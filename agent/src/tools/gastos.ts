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
  origem?: string;
};

/** Todos os lançamentos, em ordem de data. Inclui ajustes e pagamentos de fatura. */
async function lerLancamentos(): Promise<Lancamento[]> {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Lançamentos!A2:H",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (r.data.values ?? [])
    .filter((l) => typeof l[0] === "number")
    .map((l) => ({
      data: fromSerial(l[0]),
      descricao: l[1],
      tipo: l[2],
      natureza: l[3],
      categoria: l[4],
      valor: Number(l[5]) || 0,
      meio: l[6],
      origem: l[7],
    }))
    .sort((a, b) => a.data.localeCompare(b.data));
}

// ---- Valores iniciais e correções -------------------------------------------

export async function valoresIniciais() {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Contas!B12:B16",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const v = (i: number) => Number(r.data.values?.[i]?.[0]) || 0;
  return { dinheiro: v(0), vale: v(1), cartaoFatura: v(2), cartaoLimite: v(3), data: v(4) ? fromSerial(v(4)) : hoje() };
}

/** Inicializa o monitoramento: grava os saldos do dia informado (aba Contas, B12:B16). */
export async function definirValoresIniciais(input: {
  dinheiro: number;
  vale: number;
  cartaoFatura: number;
  cartaoLimite: number;
  data?: string;
}) {
  for (const k of ["dinheiro", "vale", "cartaoFatura", "cartaoLimite"] as const)
    if (!Number.isFinite(Number(input[k]))) throw Object.assign(new Error(`Valor inválido em ${k}.`), { status: 400 });
  const data = input.data || hoje();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Contas!B12:B16",
    valueInputOption: "RAW",
    requestBody: {
      values: [[round2(Number(input.dinheiro))], [round2(Number(input.vale))], [round2(Number(input.cartaoFatura))], [round2(Number(input.cartaoLimite))], [serialDate(data)]],
    },
  });
  return { iniciais: await valoresIniciais(), saldos: await saldos() };
}

/**
 * Corrige um saldo para o valor real informado, lançando a diferença como "Ajuste".
 * Ajustes mudam o saldo mas não entram nos relatórios de entradas e saídas.
 * Para o Cartão, o valor real é a fatura em aberto.
 */
export async function corrigirSaldo(input: { meio: (typeof MEIOS)[number]; valorReal: number; motivo?: string; origem?: string }) {
  if (!(MEIOS as readonly string[]).includes(input.meio)) throw Object.assign(new Error(`Meio inválido: ${input.meio}.`), { status: 400 });
  const real = Number(input.valorReal);
  if (!Number.isFinite(real)) throw Object.assign(new Error("Informe o valor real."), { status: 400 });

  const atuais = await saldos();
  const atual = input.meio === "Dinheiro" ? atuais.dinheiro : input.meio === "Vale" ? atuais.vale : atuais.cartaoFatura;
  const diferenca = round2(real - atual);
  if (diferenca === 0) return { meio: input.meio, diferenca: 0, saldos: atuais };

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Lançamentos!A:H",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[serialDate(hoje()), input.motivo || "Correção de saldo", "Ajuste", "", "Ajuste de saldo", diferenca, input.meio, input.origem ?? "Dashboard"]],
    },
  });
  return { meio: input.meio, anterior: atual, diferenca, saldos: await saldos() };
}

export async function atualizarLimite(limite: number) {
  if (!(Number(limite) >= 0)) throw Object.assign(new Error("Limite inválido."), { status: 400 });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Contas!B15",
    valueInputOption: "RAW",
    requestBody: { values: [[round2(Number(limite))]] },
  });
  return saldos();
}

// ---- Histórico --------------------------------------------------------------

/** Lançamentos de um período (o mais recente primeiro). */
export async function listarLancamentos(input: { de: string; ate: string }) {
  return (await lerLancamentos()).filter((l) => l.data >= input.de && l.data <= input.ate).reverse();
}

/**
 * Séries para gráficos: entradas e saídas por mês (últimos `meses`) e a evolução
 * diária dos saldos desde a data dos valores iniciais.
 */
export async function historico(input: { meses?: number } = {}) {
  const [todos, ini] = await Promise.all([lerLancamentos(), valoresIniciais()]);
  const n = Math.min(Math.max(input.meses ?? 12, 1), 36);

  const [y, m] = hoje().split("-").map(Number);
  const meses: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    meses.push(d.toISOString().slice(0, 7));
  }
  const mensal = meses.map((mes) => {
    const doMes = todos.filter((l) => l.data.startsWith(mes));
    const soma = (f: (l: Lancamento) => boolean) => round2(doMes.filter(f).reduce((s, l) => s + l.valor, 0));
    return {
      mes,
      entradas: soma((l) => l.tipo === "Entrada"),
      saidas: soma((l) => l.tipo === "Saída"),
      saidasPorMeio: Object.fromEntries(MEIOS.map((mm) => [mm, soma((l) => l.tipo === "Saída" && l.meio === mm)])),
    };
  });

  // Mesma regra da aba Contas, aplicada dia a dia.
  let dinheiro = ini.dinheiro, vale = ini.vale, fatura = ini.cartaoFatura;
  const pontos = new Map<string, { data: string; dinheiro: number; vale: number; cartaoFatura: number }>();
  pontos.set(ini.data, { data: ini.data, dinheiro, vale, cartaoFatura: fatura });
  for (const l of todos.filter((l) => l.data >= ini.data)) {
    const v = l.valor;
    if (l.tipo === "Pagamento de fatura") { dinheiro -= v; fatura -= v; }
    else if (l.meio === "Dinheiro") dinheiro += l.tipo === "Saída" ? -v : v;
    else if (l.meio === "Vale") vale += l.tipo === "Saída" ? -v : v;
    else if (l.meio === "Cartão") fatura += l.tipo === "Saída" ? v : l.tipo === "Entrada" ? -v : v; // Entrada no cartão = estorno
    pontos.set(l.data, { data: l.data, dinheiro: round2(dinheiro), vale: round2(vale), cartaoFatura: round2(fatura) });
  }
  const hj = hoje();
  if (!pontos.has(hj) && hj > ini.data) pontos.set(hj, { data: hj, dinheiro: round2(dinheiro), vale: round2(vale), cartaoFatura: round2(fatura) });

  return { mensal, saldosDiarios: [...pontos.values()], iniciais: ini };
}

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

  const linhas = (await lerLancamentos()).filter((l) => l.data >= de! && l.data <= ate!);

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
