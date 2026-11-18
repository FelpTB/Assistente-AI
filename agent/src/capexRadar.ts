import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "./config.js";

// Capex Radar (ferramenta da Busca Fornecedor em desenvolvimento): o dashboard só MONITORA.
// Lê pelas ferramentas de leitura do MCP do próprio Capex Radar; triagem e análise (aprovar, vincular,
// descartar notícias, corrigir projetos) ficam com o Claude Code, conectado direto a esse MCP.
// Nenhuma ferramenta de escrita é chamada daqui.

const cr = config.capexRadar;
const LEITURA = new Set(["resumo_radar", "buscar_projetos", "obter_projeto", "buscar_noticias", "obter_noticia", "historico_alteracoes"]);

async function chamar(nome: string, args: Record<string, unknown> = {}) {
  if (!LEITURA.has(nome)) throw new Error(`Ferramenta não permitida no dashboard: ${nome}`);
  const transporte = new StreamableHTTPClientTransport(new URL(`${cr.url}/mcp`), {
    requestInit: cr.token ? { headers: { Authorization: `Bearer ${cr.token}` } } : undefined,
  });
  const cliente = new Client({ name: "assistente-ai-dashboard", version: "1.0.0" });
  try {
    await cliente.connect(transporte);
    const r: any = await cliente.callTool({ name: nome, arguments: args }, undefined, { timeout: 30_000 });
    const texto = r.content?.find((c: any) => c.type === "text")?.text ?? "";
    if (r.isError) throw new Error(`Capex Radar (${nome}): ${texto.slice(0, 300)}`);
    try {
      return JSON.parse(texto);
    } catch {
      return texto;
    }
  } finally {
    await cliente.close().catch(() => {});
  }
}

const caches = new Map<string, { em: number; dados: unknown }>();
async function emCache<T>(chave: string, ms: number, forcar: boolean, fn: () => Promise<T>): Promise<T> {
  const c = caches.get(chave);
  if (!forcar && c && Date.now() - c.em < ms) return c.dados as T;
  const dados = await fn();
  caches.set(chave, { em: Date.now(), dados });
  return dados;
}

/** Visão geral do monitoramento: resumo, notícias a revisar, maiores e mais recentes projetos. */
export function visaoCapex(forcar = false) {
  return emCache("visao", 2 * 60_000, forcar, async () => {
    const [resumo, revisar, processando, maiores, recentes] = await Promise.all([
      chamar("resumo_radar"),
      chamar("buscar_noticias", { situacao: "revisar", limite: 50 }),
      chamar("buscar_noticias", { situacao: "processando", limite: 1 }),
      chamar("buscar_projetos", { ordem: "valor", limite: 10 }),
      chamar("buscar_projetos", { ordem: "recentes", limite: 10 }),
    ]);
    return { url: cr.url, resumo, revisar, processandoTotal: processando?.total ?? 0, maiores, recentes, atualizadoEm: new Date().toISOString() };
  });
}

const ESTAGIOS = ["anuncio", "licenciamento", "funding", "contratacao_epc", "mobilizacao", "operacao", "desaceleracao", "cancelado"];

export function projetosCapex(q: Record<string, unknown>) {
  const args: Record<string, unknown> = { limite: Math.min(Number(q.limite) || 50, 100), ordem: q.ordem === "recentes" ? "recentes" : "valor" };
  if (q.texto) args.texto = String(q.texto).slice(0, 100);
  if (q.empresa) args.empresa = String(q.empresa).slice(0, 100);
  if (q.uf && /^[A-Za-z]{2}$/.test(String(q.uf))) args.uf = String(q.uf).toUpperCase();
  if (["ativo", "em_revisao", "descartado"].includes(String(q.status))) args.status = q.status;
  if (ESTAGIOS.includes(String(q.estagio))) args.estagio = q.estagio;
  return emCache(`projetos:${JSON.stringify(args)}`, 2 * 60_000, q.forcar === "1", () => chamar("buscar_projetos", args));
}

const uuid = (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Object.assign(new Error("Id inválido"), { status: 400 });
  return id;
};

export const projetoCapex = (id: string) => emCache(`projeto:${id}`, 2 * 60_000, false, () => chamar("obter_projeto", { id: uuid(id) }));

export function noticiasCapex(q: Record<string, unknown>) {
  const situacao = ["revisar", "processando", "nao_triadas", "vinculadas", "descartadas", "todas"].includes(String(q.situacao)) ? String(q.situacao) : "revisar";
  const args: Record<string, unknown> = { situacao, limite: Math.min(Number(q.limite) || 30, 50) };
  if (q.empresa) args.empresa = String(q.empresa).slice(0, 100);
  if (q.texto) args.texto = String(q.texto).slice(0, 100);
  return emCache(`noticias:${JSON.stringify(args)}`, 2 * 60_000, q.forcar === "1", () => chamar("buscar_noticias", args));
}
