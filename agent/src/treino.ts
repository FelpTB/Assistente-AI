import { sheets } from "./google.js";
import { config } from "./config.js";

// Ficha de treino (esfera Academia): planilha "Ficha de Treino" no Google Sheets.
// Abas: Exercícios (ficha da semana e peso atual), Sessões, Séries, Evoluções, Cardio e Regras (pontuação).
// Pontos: série válida (≥ mínimo de repetições), evolução de peso e hora de cardio.

const spreadsheetId = config.google.treinoSpreadsheetId;
const ABA_SERIES_ID = 2; // sheetId da aba Séries (para apagar uma série lançada por engano)

// ---- Datas (planilha em America/Sao_Paulo, UTC-3 fixo) ------------------------

const EPOCA = Date.UTC(1899, 11, 30);
const agoraSerial = () => (Date.now() - 3 * 3600000 - EPOCA) / 86400000;
/** Número de data/hora do Sheets → "2026-11-17T19:02:00-03:00". */
const isoLocal = (n: unknown) => (typeof n === "number" ? `${new Date(EPOCA + n * 86400000).toISOString().slice(0, 16)}:00-03:00` : null);
const hojeLocal = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);

async function ler(range: string): Promise<any[][]> {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: "UNFORMATTED_VALUE" });
  return r.data.values ?? [];
}

async function acrescentar(range: string, linha: unknown[]) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [linha] },
  });
}

const erro = (msg: string) => Object.assign(new Error(msg), { status: 400 });
const num = (v: unknown) => (v === "" || v == null ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---- Leitura ---------------------------------------------------------------------

export async function regras() {
  const v = (await ler("Regras!B2:B7")).map((l) => Number(l[0]));
  return {
    pontosSerie: v[0] ?? 1,
    pontosEvolucao: v[1] ?? 5,
    pontosHoraCardio: v[2] ?? 2,
    minRepeticoes: v[3] ?? 8,
    repsParaSubir: v[4] ?? 12,
    seriesBase: v[5] ?? 3,
  };
}

type Exercicio = { linha: number; treino: string; grupo: string; nome: string; cardio: boolean; descanso: number | null; series: number; peso: number | null; ordem: number };

async function exercicios(): Promise<Exercicio[]> {
  return (await ler("Exercícios!A2:I"))
    .map((l, i) => ({
      linha: i + 2,
      treino: String(l[0] ?? ""),
      grupo: String(l[1] ?? ""),
      nome: String(l[2] ?? ""),
      cardio: String(l[3] ?? "").toLowerCase() === "cardio",
      descanso: num(l[4]),
      series: num(l[5]) ?? 3,
      peso: num(l[6]),
      ordem: num(l[7]) ?? 99,
      ativo: l[8] !== false && String(l[8]).toUpperCase() !== "FALSE",
    }))
    .filter((e) => e.nome && e.ativo)
    .map(({ ativo, ...e }) => e);
}

type Serie = { linha: number; quando: string | null; sessao: string; treino: string; exercicio: string; serie: number; peso: number | null; reps: number; valida: boolean; pontos: number };

async function series(): Promise<Serie[]> {
  return (await ler("Séries!A2:I")).map((l, i) => ({
    linha: i + 2,
    quando: isoLocal(l[0]),
    sessao: String(l[1] ?? ""),
    treino: String(l[2] ?? ""),
    exercicio: String(l[3] ?? ""),
    serie: Number(l[4]) || 0,
    peso: num(l[5]),
    reps: Number(l[6]) || 0,
    valida: l[7] === true || String(l[7]).toUpperCase() === "TRUE",
    pontos: Number(l[8]) || 0,
  }));
}

async function sessoes() {
  return (await ler("Sessões!A2:F")).map((l, i) => ({
    linha: i + 2,
    id: String(l[0] ?? ""),
    inicio: isoLocal(l[1]),
    fim: isoLocal(l[2]),
    treino: String(l[3] ?? ""),
    status: String(l[4] ?? ""),
    pontos: Number(l[5]) || 0,
  }));
}

const evolucoes = async () =>
  (await ler("Evoluções!A2:F")).map((l) => ({ quando: isoLocal(l[0]), sessao: String(l[1] ?? ""), exercicio: String(l[2] ?? ""), de: num(l[3]), para: num(l[4]), pontos: Number(l[5]) || 0 }));

const cardios = async () =>
  (await ler("Cardio!A2:E")).map((l) => ({ quando: isoLocal(l[0]), sessao: String(l[1] ?? ""), exercicio: String(l[2] ?? ""), minutos: Number(l[3]) || 0, pontos: Number(l[4]) || 0 }));

// ---- Ficha e treino em andamento --------------------------------------------------

/** A ficha da semana: treinos com os exercícios, peso atual, último desempenho e o treino em andamento. */
export async function ficha() {
  const [exs, ss, sess, rg] = await Promise.all([exercicios(), series(), sessoes(), regras()]);
  const ordemTreinos = [...new Set(exs.map((e) => e.treino))];
  const ultimaSessao = (t: string) => sess.filter((s) => s.treino === t && s.status === "Concluída").at(-1)?.inicio ?? null;
  const ultimaSerie = (nome: string) => ss.filter((s) => s.exercicio === nome).at(-1) ?? null;
  const ativa = sess.filter((s) => s.status === "Em andamento").at(-1) ?? null;
  return {
    regras: rg,
    treinos: ordemTreinos.map((t) => {
      const lista = exs.filter((e) => e.treino === t).sort((a, b) => a.ordem - b.ordem);
      return {
        nome: t,
        cardio: lista.every((e) => e.cardio),
        descanso: lista.find((e) => e.descanso)?.descanso ?? null,
        ultimaVez: ultimaSessao(t),
        exercicios: lista.map((e) => {
          const u = ultimaSerie(e.nome);
          return { nome: e.nome, grupo: e.grupo, cardio: e.cardio, series: e.series, peso: e.peso, descanso: e.descanso, ultima: u ? { quando: u.quando, peso: u.peso, reps: u.reps } : null };
        }),
      };
    }),
    ativa: ativa ? await detalheSessao(ativa.id, { exs, ss, rg }) : null,
  };
}

async function detalheSessao(id: string, cache?: { exs?: Exercicio[]; ss?: Serie[]; rg?: Awaited<ReturnType<typeof regras>> }) {
  const [sess, exs, ss, evs, cds, rg] = await Promise.all([
    sessoes(),
    cache?.exs ?? exercicios(),
    cache?.ss ?? series(),
    evolucoes(),
    cardios(),
    cache?.rg ?? regras(),
  ]);
  const s = sess.find((x) => x.id === id);
  if (!s) throw erro("Sessão não encontrada.");
  const minhas = ss.filter((x) => x.sessao === id);
  const evsSessao = evs.filter((x) => x.sessao === id);
  const cdsSessao = cds.filter((x) => x.sessao === id);
  const lista = exs.filter((e) => e.treino === s.treino).sort((a, b) => a.ordem - b.ordem);
  const pontos = r2(minhas.reduce((a, x) => a + x.pontos, 0) + evsSessao.reduce((a, x) => a + x.pontos, 0) + cdsSessao.reduce((a, x) => a + x.pontos, 0));
  return {
    id: s.id,
    treino: s.treino,
    inicio: s.inicio,
    status: s.status,
    pontos,
    exercicios: lista.map((e) => {
      const feitas = minhas.filter((x) => x.exercicio === e.nome);
      // Pode subir o peso quando alguma série neste treino, no peso atual, chegou às repetições-alvo.
      const podeSubir = !e.cardio && e.peso != null && feitas.some((x) => x.peso === e.peso && x.reps >= rg.repsParaSubir);
      return {
        nome: e.nome,
        grupo: e.grupo,
        cardio: e.cardio,
        descanso: e.descanso,
        series: e.series,
        peso: e.peso,
        feitas: feitas.map((x) => ({ serie: x.serie, peso: x.peso, reps: x.reps, valida: x.valida, pontos: x.pontos })),
        evoluiu: evsSessao.filter((x) => x.exercicio === e.nome).map((x) => ({ de: x.de, para: x.para })),
        cardioMin: cdsSessao.filter((x) => x.exercicio === e.nome).reduce((a, x) => a + x.minutos, 0),
        podeSubir,
      };
    }),
  };
}

// ---- Ações ----------------------------------------------------------------------------

export async function iniciarTreino(treino: string) {
  const exs = await exercicios();
  if (!exs.some((e) => e.treino === treino)) throw erro(`Treino desconhecido: ${treino}`);
  const ativa = (await sessoes()).filter((s) => s.status === "Em andamento").at(-1);
  if (ativa) throw erro(`Já há um treino em andamento (${ativa.treino}). Finalize-o antes de começar outro.`);
  const id = `S${Date.now().toString(36).toUpperCase()}`;
  await acrescentar("Sessões!A:F", [id, agoraSerial(), "", treino, "Em andamento", ""]);
  return detalheSessao(id);
}

async function sessaoAberta(id: string) {
  const s = (await sessoes()).find((x) => x.id === id);
  if (!s) throw erro("Sessão não encontrada.");
  if (s.status !== "Em andamento") throw erro("Este treino já foi finalizado.");
  return s;
}

export async function registrarSerie(input: { sessao: string; exercicio: string; peso: number; reps: number }) {
  const s = await sessaoAberta(input.sessao);
  const [exs, ss, rg] = await Promise.all([exercicios(), series(), regras()]);
  const e = exs.find((x) => x.nome === input.exercicio && x.treino === s.treino);
  if (!e || e.cardio) throw erro("Exercício não faz parte deste treino.");
  const reps = Math.round(Number(input.reps));
  const peso = Number(input.peso);
  if (!(reps > 0) || reps > 100) throw erro("Informe as repetições.");
  if (!(peso >= 0) || peso > 1000) throw erro("Informe o peso em kg.");
  const n = ss.filter((x) => x.sessao === s.id && x.exercicio === e.nome).length + 1;
  const valida = reps >= rg.minRepeticoes;
  await acrescentar("Séries!A:I", [agoraSerial(), s.id, s.treino, e.nome, n, peso, reps, valida, valida ? rg.pontosSerie : 0]);
  // Primeiro registro do exercício: o peso usado vira o peso atual da ficha (sem pontos de evolução).
  if (e.peso == null && peso > 0) await definirPeso(e.linha, peso);
  return detalheSessao(s.id);
}

/** Apaga a última série lançada de um exercício neste treino (correção de digitação). */
export async function desfazerSerie(input: { sessao: string; exercicio: string }) {
  const s = await sessaoAberta(input.sessao);
  const ultima = (await series()).filter((x) => x.sessao === s.id && x.exercicio === input.exercicio).at(-1);
  if (!ultima) throw erro("Nenhuma série para desfazer.");
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ deleteDimension: { range: { sheetId: ABA_SERIES_ID, dimension: "ROWS", startIndex: ultima.linha - 1, endIndex: ultima.linha } } }] },
  });
  return detalheSessao(s.id);
}

async function definirPeso(linha: number, peso: number) {
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `Exercícios!G${linha}`, valueInputOption: "RAW", requestBody: { values: [[peso]] } });
}

export async function subirPeso(input: { sessao: string; exercicio: string; pesoNovo: number }) {
  const s = await sessaoAberta(input.sessao);
  const d = await detalheSessao(s.id);
  const ex = d.exercicios.find((x) => x.nome === input.exercicio);
  if (!ex) throw erro("Exercício não faz parte deste treino.");
  const rg = await regras();
  if (!ex.podeSubir) throw erro(`Faça uma série com ${rg.repsParaSubir} repetições no peso atual para liberar a subida.`);
  const novo = Number(input.pesoNovo);
  if (!(novo > (ex.peso ?? 0)) || novo > 1000) throw erro("O novo peso precisa ser maior que o atual.");
  const e = (await exercicios()).find((x) => x.nome === ex.nome && x.treino === s.treino)!;
  await definirPeso(e.linha, novo);
  await acrescentar("Evoluções!A:F", [agoraSerial(), s.id, ex.nome, ex.peso, novo, rg.pontosEvolucao]);
  return detalheSessao(s.id);
}

export async function registrarCardio(input: { sessao: string; exercicio: string; minutos: number }) {
  const s = await sessaoAberta(input.sessao);
  const e = (await exercicios()).find((x) => x.nome === input.exercicio && x.treino === s.treino);
  if (!e?.cardio) throw erro("Exercício de cardio não faz parte deste treino.");
  const minutos = Math.round(Number(input.minutos));
  if (!(minutos > 0) || minutos > 600) throw erro("Informe os minutos.");
  const rg = await regras();
  await acrescentar("Cardio!A:E", [agoraSerial(), s.id, e.nome, minutos, r2((minutos / 60) * rg.pontosHoraCardio)]);
  return detalheSessao(s.id);
}

export async function finalizarTreino(id: string) {
  const s = await sessaoAberta(id);
  const d = await detalheSessao(id);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Sessões!C${s.linha}:F${s.linha}`,
    valueInputOption: "RAW",
    requestBody: { values: [[agoraSerial(), s.treino, "Concluída", d.pontos]] },
  });
  return { ...d, status: "Concluída" };
}

/** Cancela um treino aberto por engano (só se nada foi registrado nele). */
export async function cancelarTreino(id: string) {
  const s = await sessaoAberta(id);
  const d = await detalheSessao(id);
  if (d.exercicios.some((e) => e.feitas.length || e.cardioMin || e.evoluiu.length)) throw erro("Este treino já tem registros; finalize-o em vez de cancelar.");
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `Sessões!C${s.linha}:F${s.linha}`, valueInputOption: "RAW", requestBody: { values: [[agoraSerial(), s.treino, "Cancelada", 0]] } });
  return { ok: true };
}

// ---- Relatório mensal ------------------------------------------------------------------

export async function relatorioTreino(mes?: string) {
  const m = mes || hojeLocal().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) throw erro("Mês no formato AAAA-MM");
  const [ss, evs, cds, sess] = await Promise.all([series(), evolucoes(), cardios(), sessoes()]);
  const doMes = <T extends { quando: string | null }>(l: T[]) => l.filter((x) => x.quando?.startsWith(m));
  const sm = doMes(ss);
  const em = doMes(evs);
  const cm = doMes(cds);
  const sessoesMes = sess.filter((s) => s.status === "Concluída" && s.inicio?.startsWith(m));

  const pontosSeries = r2(sm.reduce((a, x) => a + x.pontos, 0));
  const pontosEvolucao = r2(em.reduce((a, x) => a + x.pontos, 0));
  const pontosCardio = r2(cm.reduce((a, x) => a + x.pontos, 0));

  // Pontos por dia do mês.
  const [ano, mm] = m.split("-").map(Number);
  const nDias = new Date(Date.UTC(ano, mm, 0)).getUTCDate();
  const porDia = Array.from({ length: nDias }, (_, i) => {
    const dia = `${m}-${String(i + 1).padStart(2, "0")}`;
    const soma = (l: { quando: string | null; pontos: number }[]) => l.filter((x) => x.quando?.startsWith(dia)).reduce((a, x) => a + x.pontos, 0);
    return { data: dia, series: soma(sm), evolucao: soma(em), cardio: soma(cm) };
  });

  const porTreino = [...new Set(sessoesMes.map((s) => s.treino))].map((t) => ({ treino: t, sessoes: sessoesMes.filter((s) => s.treino === t).length }));

  // Recorde de peso por exercício no mês.
  const recordes = [...new Set(sm.map((x) => x.exercicio))]
    .map((ex) => {
      const l = sm.filter((x) => x.exercicio === ex && x.peso != null);
      const max = Math.max(...l.map((x) => x.peso!));
      return { exercicio: ex, treino: l[0]?.treino ?? "", maiorPeso: Number.isFinite(max) ? max : null, series: l.length };
    })
    .sort((a, b) => a.treino.localeCompare(b.treino));

  return {
    mes: m,
    pontos: r2(pontosSeries + pontosEvolucao + pontosCardio),
    pontosSeries,
    pontosEvolucao,
    pontosCardio,
    treinos: sessoesMes.length,
    diasTreinados: new Set(sessoesMes.map((s) => s.inicio!.slice(0, 10))).size,
    seriesValidas: sm.filter((x) => x.valida).length,
    seriesInvalidas: sm.filter((x) => !x.valida).length,
    evolucoes: em.map((x) => ({ quando: x.quando, exercicio: x.exercicio, de: x.de, para: x.para })),
    cardioMinutos: cm.reduce((a, x) => a + x.minutos, 0),
    porTreino,
    porDia,
    recordes,
  };
}
