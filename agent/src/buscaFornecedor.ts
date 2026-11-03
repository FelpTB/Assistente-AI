import { config } from "./config.js";

// Painel do projeto Busca Fornecedor: site (Lovable), banco (Supabase) e automações (n8n).
// Só leituras. As métricas são agregadas; as listas de últimas buscas e cadastros mostram registros
// individuais (só para o login do dashboard), com telefone mascarado e sem senhas, tokens ou contatos
// dos fornecedores encontrados. Nada é guardado aqui além do cache em memória.

const bf = config.buscaFornecedor;
const DIA = 86400000;

class NaoConfigurado extends Error {
  constructor(variaveis: string) {
    super(`Configure ${variaveis} no Railway para ativar este painel.`);
  }
}

/** Guarda o resultado por `ms` para não repetir consultas pesadas a cada visita. */
function cache<T>(ms: number, fn: () => Promise<T>) {
  let valor: { em: number; dados: T } | null = null;
  let pendente: Promise<T> | null = null;
  return async (forcar = false): Promise<T & { atualizadoEm: string }> => {
    if (!forcar && valor && Date.now() - valor.em < ms) return { ...valor.dados, atualizadoEm: new Date(valor.em).toISOString() };
    pendente ??= fn().finally(() => (pendente = null));
    const dados = await pendente;
    valor = { em: Date.now(), dados };
    return { ...dados, atualizadoEm: new Date(valor.em).toISOString() };
  };
}

// ---- Site (Lovable) ---------------------------------------------------------

export const statusSite = cache(60_000, async () => {
  if (!bf.siteUrl) throw new NaoConfigurado("BF_SITE_URL (endereço publicado do site)");
  const t0 = Date.now();
  try {
    const res = await fetch(bf.siteUrl, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "AssistenteAI-monitor" } });
    const html = await res.text();
    const ms = Date.now() - t0;
    return {
      url: bf.siteUrl,
      urlFinal: res.url,
      noAr: res.ok,
      httpStatus: res.status,
      tempoMs: ms,
      lento: ms > 3000,
      titulo: html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null,
      tamanhoKb: Math.round(Buffer.byteLength(html) / 1024),
      ultimaAlteracao: res.headers.get("last-modified"),
      servidor: res.headers.get("server"),
    };
  } catch (err: any) {
    return { url: bf.siteUrl, noAr: false, httpStatus: null, tempoMs: Date.now() - t0, erro: err?.name === "TimeoutError" ? "sem resposta em 10 s" : String(err?.message ?? err) };
  }
});

// ---- Banco (Supabase via PostgREST) -----------------------------------------

async function rest(tabela: string, query: string, extra: Record<string, string> = {}) {
  if (!bf.supabaseKey) throw new NaoConfigurado("BF_SUPABASE_KEY (chave service_role do Supabase)");
  const res = await fetch(`${bf.supabaseUrl}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: bf.supabaseKey, Authorization: `Bearer ${bf.supabaseKey}`, "Accept-Profile": bf.schema, ...extra },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Supabase ${tabela}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** Lê todas as linhas (só as colunas pedidas), de 1000 em 1000. */
async function todas<T>(tabela: string, select: string): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const res = await rest(tabela, `select=${select}&order=created_at.asc`, { Range: `${de}-${de + 999}` });
    const page = (await res.json()) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/** Total aproximado (estatística do Postgres): instantâneo mesmo em tabelas grandes. */
async function totalEstimado(tabela: string): Promise<number> {
  const res = await rest(tabela, "select=id&limit=1", { Prefer: "count=estimated" });
  return Number(res.headers.get("content-range")?.split("/")[1]) || 0;
}

const desde = (dias: number) => Date.now() - dias * DIA;
const conta = <T>(l: T[], f: (x: T) => boolean) => l.filter(f).length;
const recente = (dias: number) => (x: { created_at: string }) => Date.parse(x.created_at) >= desde(dias);

function distribuicao<T>(l: T[], chave: (x: T) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const x of l) {
    const k = chave(x) ?? "(vazio)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([nome, n]) => ({ nome, n }));
}

/** Contagem por dia nos últimos `dias` (fuso de São Paulo). */
function seriePorDia<T extends { created_at: string }>(l: T[], dias: number) {
  const dia = (ms: number) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: config.timezone });
  const m = new Map<string, number>();
  for (let i = dias - 1; i >= 0; i--) m.set(dia(Date.now() - i * DIA), 0);
  for (const x of l) {
    const d = dia(Date.parse(x.created_at));
    if (m.has(d)) m.set(d, m.get(d)! + 1);
  }
  return [...m.entries()].map(([data, n]) => ({ data, n }));
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export const metricasBanco = cache(10 * 60_000, async () => {
  type Consulta = { created_at: string; status: string | null; origem: string | null; qualidade: string | null; fallback: boolean | null };
  type Comprador = { created_at: string; tier_busca: string | null; telefone_verificado: boolean | null; acesso_agente: boolean | null; buscas_realizadas: number | null };
  type Fornecedor = { created_at: string; assinatura_ativa: boolean | null; plano_categoria: string | null; cadastro_incompleto: boolean | null; perfil_completude: number | null; n_creditos_pagos: number | null; n_creditos_gastos: number | null };
  type Perfil = { created_at: string; origem_cadastro: string | null; whatsapp_valido: boolean | null; error: string | null };

  const [consultas, compradores, fornecedores, perfisTotal, perfisRecentes] = await Promise.all([
    todas<Consulta>("consultas", "created_at,status,origem,qualidade,fallback"),
    todas<Comprador>("usuario_comprador", "created_at,tier_busca,telefone_verificado,acesso_agente,buscas_realizadas"),
    todas<Fornecedor>("usuario_fornecedor", "created_at,assinatura_ativa,plano_categoria,cadastro_incompleto,perfil_completude,n_creditos_pagos,n_creditos_gastos"),
    totalEstimado("company_profile"),
    // company_profile tem ~585 mil linhas e created_at sem índice: lê os mais novos pela chave primária.
    rest("company_profile", "select=created_at,origem_cadastro,whatsapp_valido,error&order=id.desc&limit=10000").then((r) => r.json() as Promise<Perfil[]>),
  ]);

  const perfis30 = perfisRecentes.filter(recente(30));
  const avaliadas = consultas.filter((c) => c.qualidade);
  const completude = fornecedores.map((f) => f.perfil_completude).filter((v): v is number => typeof v === "number");

  return {
    consultas: {
      total: consultas.length,
      ultimas24h: conta(consultas, recente(1)),
      ultimos7d: conta(consultas, recente(7)),
      ultimos30d: conta(consultas, recente(30)),
      pendentes: conta(consultas, (c) => c.status === "pending"),
      fallbackPct: pct(conta(consultas, (c) => !!c.fallback), consultas.length),
      porOrigem: distribuicao(consultas, (c) => c.origem),
      porStatus: distribuicao(consultas, (c) => c.status),
      qualidade: distribuicao(avaliadas, (c) => c.qualidade),
      avaliadas: avaliadas.length,
      porDia: seriePorDia(consultas, 30),
    },
    compradores: {
      total: compradores.length,
      novos24h: conta(compradores, recente(1)),
      novos7d: conta(compradores, recente(7)),
      novos30d: conta(compradores, recente(30)),
      telefoneVerificadoPct: pct(conta(compradores, (c) => !!c.telefone_verificado), compradores.length),
      comAgente: conta(compradores, (c) => !!c.acesso_agente),
      buscasRealizadas: compradores.reduce((s, c) => s + (Number(c.buscas_realizadas) || 0), 0),
      porTier: distribuicao(compradores, (c) => c.tier_busca),
      porDia: seriePorDia(compradores, 30),
    },
    fornecedores: {
      total: fornecedores.length,
      novos24h: conta(fornecedores, recente(1)),
      novos7d: conta(fornecedores, recente(7)),
      novos30d: conta(fornecedores, recente(30)),
      porDia: seriePorDia(fornecedores, 30),
      assinaturaAtiva: conta(fornecedores, (f) => !!f.assinatura_ativa),
      cadastroIncompleto: conta(fornecedores, (f) => !!f.cadastro_incompleto),
      completudeMedia: completude.length ? Math.round(completude.reduce((a, b) => a + b, 0) / completude.length) : null,
      creditosPagos: fornecedores.reduce((s, f) => s + (Number(f.n_creditos_pagos) || 0), 0),
      creditosGastos: fornecedores.reduce((s, f) => s + (Number(f.n_creditos_gastos) || 0), 0),
      porPlano: distribuicao(fornecedores, (f) => f.plano_categoria),
    },
    perfisEmpresa: {
      totalAproximado: perfisTotal,
      novos7d: conta(perfisRecentes, recente(7)),
      novos30d: perfis30.length,
      // Se as 10 mil linhas lidas forem todas dos últimos 30 dias, o número real é maior.
      novos30dNoLimite: perfisRecentes.length === 10000 && perfis30.length === 10000,
      cadastradosPeloSite30d: conta(perfis30, (p) => p.origem_cadastro === "bf-cadastro-perfil"),
      comErro30d: conta(perfis30, (p) => !!p.error),
      whatsappValido30d: conta(perfis30, (p) => !!p.whatsapp_valido),
    },
  };
});

// ---- Últimas buscas e cadastros (registros individuais) ----------------------

const mascarar = (tel: string | null) => (tel ? `•••• ${tel.replace(/\D/g, "").slice(-4)}` : null);
const comoLista = (v: unknown) => (Array.isArray(v) ? v.filter(Boolean).map(String) : v ? [String(v)] : []);

/** Itens de `resultados`: às vezes vêm aninhados em arrays e quase sempre dentro de { item }. */
function itensResultado(res: unknown): any[] {
  if (!Array.isArray(res)) return [];
  return res.flatMap((e) => (Array.isArray(e) ? itensResultado(e) : [e?.item ?? e])).filter((x) => x && typeof x === "object");
}

export const ultimasBuscas = cache(2 * 60_000, async () => {
  type Linha = {
    id: string;
    created_at: string;
    status: string | null;
    origem: string | null;
    qualidade: string | null;
    fallback: boolean | null;
    parametros: Record<string, any> | null;
    resultados: unknown;
    comprador: string | null;
    uf: string[] | null;
    municipio: string[] | null;
    bm_25: string | null;
    modelo_negocio: string | null;
  };
  const linhas = (await (
    await rest(
      "consultas",
      "select=id,created_at,status,origem,qualidade,fallback,parametros,resultados,comprador,uf,municipio,bm_25,modelo_negocio&order=created_at.desc&limit=40",
    )
  ).json()) as Linha[];

  const ids = [...new Set(linhas.map((l) => l.comprador).filter(Boolean))];
  const compradores = new Map<string, { nome: string | null; empresa: string | null }>();
  if (ids.length) {
    const cs = (await (await rest("usuario_comprador", `select=id,nome,empresa_nome&id=in.(${ids.join(",")})`)).json()) as any[];
    for (const c of cs) compradores.set(c.id, { nome: c.nome, empresa: c.empresa_nome });
  }

  const buscas = linhas.map((l) => {
    const p = l.parametros ?? {};
    const itens = itensResultado(l.resultados)
      .map((i) => ({
        posicao: Number(i.posicao) || null,
        empresa: i.razao_social ?? null,
        nota: i.nota != null ? Number(i.nota) : null,
        modelo: i.modelo_negocio ?? null,
        escopo: i.escopo ?? null,
        plano: i.plano_categoria ?? null,
        site: i.site || null,
      }))
      .sort((a, b) => (a.posicao ?? 999) - (b.posicao ?? 999) || (b.nota ?? 0) - (a.nota ?? 0));
    const notas = itens.map((i) => i.nota).filter((n): n is number => n != null);
    const ufs = comoLista(p.ufs_selecionadas).length ? comoLista(p.ufs_selecionadas) : (l.uf ?? []);
    return {
      id: l.id,
      em: l.created_at,
      status: l.status,
      origem: l.origem,
      qualidade: l.qualidade,
      fallback: !!l.fallback,
      comprador: l.comprador ? (compradores.get(l.comprador) ?? null) : null,
      descricao: String(p.descricao ?? p.raw ?? "").trim() || null,
      tipoBusca: p.tipo_busca ?? null,
      local:
        p.tipo_busca === "city"
          ? `${p.cidade_origem ?? "?"}${p.raio_km ? ` · raio de ${p.raio_km} km` : ""}`
          : ufs.length
            ? ufs.join(", ")
            : "Brasil",
      municipios: (l.municipio ?? []).length,
      modeloNegocio: p.modelo_negocio || l.modelo_negocio || null,
      termos: l.bm_25,
      nResultados: itens.length,
      notaMedia: notas.length ? Math.round(notas.reduce((a, b) => a + b, 0) / notas.length) : null,
      notaMin: notas.length ? Math.min(...notas) : null,
      resultados: itens,
    };
  });
  return { buscas };
});

export const ultimosCadastros = cache(2 * 60_000, async () => {
  const [compradores, fornecedores] = await Promise.all([
    rest(
      "usuario_comprador",
      "select=id,created_at,nome,empresa_nome,telefone,fonte,tier_busca,telefone_verificado,buscas_realizadas,limite_buscas,n_acessos,acesso_agente,embaixador_referente_id&order=created_at.desc&limit=25",
    ).then((r) => r.json() as Promise<any[]>),
    rest(
      "usuario_fornecedor",
      "select=id,created_at,nome,cnpj,telefone,plano_categoria,assinatura_ativa,cadastro_incompleto,perfil_completude,n_creditos,n_creditos_gastos,n_acessos,upgrade_status&order=created_at.desc&limit=25",
    ).then((r) => r.json() as Promise<any[]>),
  ]);
  return {
    compradores: compradores.map((c) => ({
      id: c.id,
      em: c.created_at,
      nome: c.nome,
      empresa: c.empresa_nome,
      telefone: mascarar(c.telefone),
      telefoneVerificado: !!c.telefone_verificado,
      fonte: c.fonte,
      tier: c.tier_busca,
      buscas: Number(c.buscas_realizadas) || 0,
      limiteBuscas: c.limite_buscas != null ? Number(c.limite_buscas) : null,
      acessos: Number(c.n_acessos) || 0,
      agente: !!c.acesso_agente,
      indicado: !!c.embaixador_referente_id,
    })),
    fornecedores: fornecedores.map((f) => ({
      id: f.id,
      em: f.created_at,
      nome: f.nome,
      cnpj: f.cnpj,
      telefone: mascarar(f.telefone),
      plano: f.plano_categoria,
      assinaturaAtiva: !!f.assinatura_ativa,
      cadastroIncompleto: !!f.cadastro_incompleto,
      completude: f.perfil_completude,
      creditos: Number(f.n_creditos) || 0,
      creditosGastos: Number(f.n_creditos_gastos) || 0,
      acessos: Number(f.n_acessos) || 0,
      upgrade: f.upgrade_status,
    })),
  };
});

// ---- Automações (n8n) -------------------------------------------------------

async function n8n(path: string) {
  if (!bf.n8nUrl || !bf.n8nApiKey) throw new NaoConfigurado("N8N_URL e N8N_API_KEY");
  const res = await fetch(`${bf.n8nUrl}/api/v1${path}`, {
    headers: { "X-N8N-API-KEY": bf.n8nApiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`n8n ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<any>;
}

export const execucoesN8n = cache(60_000, async () => {
  const [wf, recentes, erros] = await Promise.all([
    n8n("/workflows?limit=250"),
    n8n("/executions?limit=30"),
    n8n("/executions?status=error&limit=50"),
  ]);
  const workflows = new Map<string, { nome: string; ativo: boolean }>(
    (wf.data ?? []).map((w: any) => [String(w.id), { nome: w.name, ativo: !!w.active }]),
  );
  const fmt = (e: any) => {
    const ini = e.startedAt ? Date.parse(e.startedAt) : null;
    const fim = e.stoppedAt ? Date.parse(e.stoppedAt) : null;
    return {
      id: String(e.id),
      workflowId: String(e.workflowId),
      workflow: workflows.get(String(e.workflowId))?.nome ?? `Workflow ${e.workflowId}`,
      status: e.status ?? (e.finished ? "success" : "running"),
      modo: e.mode,
      inicio: e.startedAt,
      duracaoMs: ini && fim ? fim - ini : null,
      link: `${bf.n8nUrl}/workflow/${e.workflowId}/executions/${e.id}`,
    };
  };
  const errosLista = (erros.data ?? []).map(fmt);
  const errosPorWorkflow = distribuicao(errosLista.filter((e: any) => Date.parse(e.inicio) >= desde(7)), (e: any) => e.workflow);
  return {
    workflowsAtivos: [...workflows.values()].filter((w) => w.ativo).length,
    workflowsTotal: workflows.size,
    erros24h: errosLista.filter((e: any) => Date.parse(e.inicio) >= desde(1)).length,
    erros7d: errosLista.filter((e: any) => Date.parse(e.inicio) >= desde(7)).length,
    errosPorWorkflow,
    ultimosErros: errosLista.slice(0, 10),
    ultimas: (recentes.data ?? []).map(fmt),
  };
});
