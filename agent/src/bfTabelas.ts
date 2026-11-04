import { config } from "./config.js";

// Tabelas do painel de admin do Busca Fornecedor, mostradas na aba do dashboard.
// Cada tabela declara só as colunas exibidas: segredos (hash de chave, código OTP, chave de API,
// token) nunca são pedidos ao banco; telefones e e-mails chegam mascarados.

const bf = config.buscaFornecedor;
const DIA = 86400000;

type Tipo = "texto" | "data" | "bool" | "num" | "tel" | "email" | "link" | "json" | "url-secreta" | "segredo-se-chave";
type Coluna = { c: string; nome: string; tipo?: Tipo };
type Tabela = {
  id: string;
  schema: "busca_fornecedor" | "public";
  tabela: string;
  nome: string;
  grupo: string;
  descricao?: string;
  tempo: string | null; // coluna de data para "últimas 24 h / 7 dias"
  ordem: string; // order= do PostgREST
  colunas: Coluna[];
  agrupar?: string[]; // distribuições calculadas nas linhas mais recentes
  pendente?: string; // filtro PostgREST do que precisa de atenção
  pendenteNome?: string;
  estimado?: boolean; // tabela grande: total pela estatística do Postgres
  limite?: number;
  funil?: { por: string; etapas: { c: string; nome: string }[] };
};

const d = (c: string, nome = "Quando"): Coluna => ({ c, nome, tipo: "data" });

export const TABELAS: Tabela[] = [
  // ---- Atendimento
  {
    id: "feedbacks", schema: "busca_fornecedor", tabela: "feedback_usuario", nome: "Feedbacks", grupo: "Atendimento",
    descricao: "Mensagens de usuários (erros, sugestões).", tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at"), { c: "motivo", nome: "Motivo" }, { c: "status", nome: "Status" }, { c: "text", nome: "Mensagem", tipo: "texto" }, { c: "email_contato", nome: "E-mail", tipo: "email" }, { c: "telefone_contato", nome: "Telefone", tipo: "tel" }],
    agrupar: ["status", "motivo"], pendente: "status=not.in.(Respondido,Resolvido,Fechado)", pendenteNome: "sem resposta",
  },
  {
    id: "contests", schema: "public", tabela: "site_contests", nome: "Contests de site", grupo: "Atendimento",
    descricao: "Disputas de site informado por fornecedores.", tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at"), { c: "tipo", nome: "Tipo" }, { c: "status", nome: "Status" }, { c: "site_informado", nome: "Site", tipo: "link" }, { c: "cnpj_usuario", nome: "CNPJ do usuário" }, { c: "cnpj_conflito", nome: "CNPJ em conflito" }, { c: "notas", nome: "Notas", tipo: "texto" }, d("resolvido_em", "Resolvido em")],
    agrupar: ["status", "tipo"], pendente: "status=not.in.(resolvido,rejeitado)", pendenteNome: "em aberto",
  },
  {
    id: "mensagens", schema: "busca_fornecedor", tabela: "mensagens_comprador_fornecedor", nome: "Mensagens comprador → fornecedor", grupo: "Atendimento",
    tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at"), { c: "fornecedor_cnpj_basico", nome: "CNPJ básico" }, { c: "mensagem", nome: "Mensagem", tipo: "texto" }, { c: "lida", nome: "Lida", tipo: "bool" }, { c: "contato_email", nome: "E-mail", tipo: "email" }, { c: "contato_telefone", nome: "Telefone", tipo: "tel" }],
    agrupar: ["lida"], pendente: "lida=is.false", pendenteNome: "não lidas",
  },
  {
    id: "avaliacoes", schema: "busca_fornecedor", tabela: "avaliacoes_fornecedor", nome: "Avaliações com estrelas", grupo: "Atendimento",
    tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at"), { c: "fornecedor_cnpj_basico", nome: "CNPJ básico" }, { c: "nota_geral", nome: "Geral", tipo: "num" }, { c: "nota_resolve", nome: "Resolve", tipo: "num" }, { c: "nota_responde_rapido", nome: "Responde rápido", tipo: "num" }, { c: "comentario", nome: "Comentário", tipo: "texto" }],
    agrupar: ["nota_geral"],
  },

  // ---- Busca
  {
    id: "aparicoes", schema: "busca_fornecedor", tabela: "aparicoes", nome: "Aparições", grupo: "Busca",
    descricao: "Cada vez que um fornecedor aparece num resultado.", tempo: "created_at", ordem: "created_at.desc", estimado: true,
    colunas: [d("created_at"), { c: "cnpj_basico", nome: "CNPJ básico" }, { c: "nota", nome: "Nota", tipo: "num" }, { c: "revelada", nome: "Revelada", tipo: "bool" }],
    agrupar: ["revelada"],
  },
  {
    id: "motor-config", schema: "public", tabela: "busca_motor_config", nome: "Motor de busca: modo ativo", grupo: "Busca",
    tempo: "updated_at", ordem: "updated_at.desc",
    colunas: [d("updated_at", "Alterado em"), { c: "modo", nome: "Modo" }],
  },
  {
    id: "motor-comparacao", schema: "public", tabela: "busca_motor_comparacao", nome: "Motor de busca: comparações n8n × API", grupo: "Busca",
    tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at"), { c: "modo", nome: "Modo" }, { c: "n8n_ok", nome: "n8n ok", tipo: "bool" }, { c: "n8n_ms", nome: "n8n ms", tipo: "num" }, { c: "api_ok", nome: "API ok", tipo: "bool" }, { c: "api_ms", nome: "API ms", tipo: "num" }, { c: "api_total", nome: "API resultados", tipo: "num" }, { c: "api_erro", nome: "Erro da API", tipo: "texto" }],
    agrupar: ["modo", "n8n_ok", "api_ok"],
  },
  {
    id: "shortlinks", schema: "public", tabela: "consulta_shortlinks", nome: "Links públicos de consulta", grupo: "Busca",
    tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at"), { c: "code", nome: "Código" }, { c: "view_count", nome: "Visualizações", tipo: "num" }, { c: "max_views", nome: "Máximo", tipo: "num" }, d("expires_at", "Expira em")],
  },

  // ---- Mensageria
  {
    id: "emails", schema: "busca_fornecedor", tabela: "emails_enviados", nome: "E-mails enviados", grupo: "Mensageria",
    tempo: "criado_em", ordem: "criado_em.desc",
    colunas: [d("criado_em"), { c: "tipo_template", nome: "Template" }, { c: "status_ultimo", nome: "Status" }, { c: "motivo_ultimo_evento", nome: "Motivo", tipo: "texto" }, { c: "email_destinatario", nome: "Destinatário", tipo: "email" }, { c: "cnpj_basico", nome: "CNPJ básico" }, { c: "variante", nome: "Variante" }],
    agrupar: ["status_ultimo", "tipo_template"],
  },
  {
    id: "sms", schema: "busca_fornecedor", tabela: "sms_enviados", nome: "SMS enviados", grupo: "Mensageria",
    tempo: "criado_em", ordem: "criado_em.desc",
    colunas: [d("criado_em"), { c: "tipo_template", nome: "Template" }, { c: "status_ultimo", nome: "Status" }, { c: "motivo_ultimo_evento", nome: "Motivo", tipo: "texto" }, { c: "telefone", nome: "Telefone", tipo: "tel" }, { c: "cnpj_basico", nome: "CNPJ básico" }],
    agrupar: ["status_ultimo", "tipo_template"],
  },
  {
    id: "whatsapp", schema: "busca_fornecedor", tabela: "whatsapp_envios", nome: "WhatsApp enviados", grupo: "Mensageria",
    tempo: "updated_at", ordem: "updated_at.desc.nullslast",
    colunas: [d("updated_at", "Atualizado"), { c: "status", nome: "Status" }, { c: "whatsapp_status", nome: "Status WhatsApp" }, { c: "etapa1", nome: "Etapa 1" }, { c: "etapa2", nome: "Etapa 2" }, { c: "etapa3", nome: "Etapa 3" }, { c: "cnpj_empresa", nome: "CNPJ" }, { c: "numero_telefone", nome: "Telefone", tipo: "tel" }, { c: "variante", nome: "Variante" }],
    agrupar: ["status", "whatsapp_status"],
  },
  {
    id: "ligacoes", schema: "busca_fornecedor", tabela: "ligacoes_enviadas", nome: "Ligações", grupo: "Mensageria",
    tempo: "criado_em", ordem: "criado_em.desc",
    colunas: [d("criado_em"), { c: "status_ultimo", nome: "Status" }, { c: "motivo_encerramento", nome: "Encerramento" }, { c: "duracao_segundos", nome: "Duração (s)", tipo: "num" }, { c: "nota_satisfacao", nome: "Satisfação", tipo: "num" }, { c: "vai_cadastrar", nome: "Vai cadastrar", tipo: "bool" }, { c: "uf_buscada", nome: "UF" }, { c: "segmento_buscado", nome: "Segmento" }, { c: "telefone", nome: "Telefone", tipo: "tel" }, { c: "transcricao", nome: "Transcrição", tipo: "texto" }],
    agrupar: ["status_ultimo", "vai_cadastrar"],
  },

  // ---- Engajamento
  {
    id: "eng-compradores", schema: "busca_fornecedor", tabela: "engajamento_compradores", nome: "Engajamento de compradores", grupo: "Engajamento",
    tempo: "criado_em", ordem: "criado_em.desc",
    colunas: [d("criado_em"), { c: "primeira_consulta_sem_cadastro", nome: "1ª consulta sem cadastro", tipo: "bool" }, { c: "converteu", nome: "Converteu", tipo: "bool" }, d("converteu_em", "Converteu em"), { c: "telefone", nome: "Telefone", tipo: "tel" }],
    agrupar: ["converteu"],
  },
  {
    id: "eng-fornecedores", schema: "busca_fornecedor", tabela: "engajamento_fornecedores", nome: "Engajamento de fornecedores", grupo: "Engajamento",
    tempo: "engajamento_atualizado_em", ordem: "engajamento_atualizado_em.desc.nullslast",
    colunas: [d("engajamento_atualizado_em", "Atualizado"), { c: "nome_fantasia", nome: "Empresa" }, { c: "cnpj", nome: "CNPJ" }, { c: "engajamento_email", nome: "E-mail" }, { c: "engajamento_sms", nome: "SMS" }, { c: "engajamento_whatsapp", nome: "WhatsApp" }, { c: "engajamento_ligacao", nome: "Ligação" }, { c: "aparicoes_busca", nome: "Aparições", tipo: "num" }, { c: "aparicoes_mes", nome: "No mês", tipo: "num" }, { c: "cadastrado_primeiro_contato", nome: "Cadastrou no 1º contato", tipo: "bool" }],
    agrupar: ["engajamento_email", "engajamento_whatsapp", "engajamento_sms"],
  },
  {
    id: "tel-engajamento", schema: "busca_fornecedor", tabela: "telefone_engajamento", nome: "Engajamento por telefone", grupo: "Engajamento",
    tempo: "criado_em", ordem: "criado_em.desc",
    colunas: [d("criado_em"), { c: "canal", nome: "Canal" }, { c: "status", nome: "Status" }, { c: "cnpj_basico", nome: "CNPJ básico" }, { c: "telefone", nome: "Telefone", tipo: "tel" }],
    agrupar: ["canal", "status"],
  },
  {
    id: "ab-landing", schema: "public", tabela: "ab_supplier_landing", nome: "Teste A/B da landing", grupo: "Engajamento",
    tempo: "created_at", ordem: "created_at.desc", limite: 20,
    colunas: [d("created_at"), { c: "variant", nome: "Variante" }, { c: "visited", nome: "Visitou", tipo: "bool" }, { c: "cta_clicked", nome: "Clicou", tipo: "bool" }, { c: "signup_completed", nome: "Cadastrou", tipo: "bool" }],
    funil: { por: "variant", etapas: [{ c: "visited", nome: "Visitaram" }, { c: "cta_clicked", nome: "Clicaram" }, { c: "signup_completed", nome: "Cadastraram" }] },
  },

  // ---- Cadastro de perfis
  {
    id: "fila-perfil", schema: "busca_fornecedor", tabela: "fila_cadastro_perfil", nome: "Fila de cadastro de perfil", grupo: "Cadastro de perfis",
    tempo: "updated_at", ordem: "updated_at.desc.nullslast",
    colunas: [d("updated_at", "Atualizado"), { c: "razao_social", nome: "Empresa" }, { c: "municipio", nome: "Município" }, { c: "uf", nome: "UF" }, { c: "url_site", nome: "Site", tipo: "link" }, { c: "status", nome: "Status" }, { c: "discovery_status", nome: "Descoberta" }, { c: "attempts", nome: "Tentativas", tipo: "num" }, { c: "last_error", nome: "Último erro", tipo: "texto" }, { c: "worker", nome: "Worker" }],
    agrupar: ["status", "discovery_status"], pendente: "last_error=not.is.null", pendenteNome: "com erro",
  },
  {
    id: "fila-metricas", schema: "busca_fornecedor", tabela: "fila_cadastro_metricas", nome: "Métricas da fila de cadastro", grupo: "Cadastro de perfis",
    tempo: "criado_em", ordem: "criado_em.desc",
    colunas: [d("criado_em"), { c: "cnpj_basico", nome: "CNPJ básico" }, { c: "worker", nome: "Worker" }, { c: "url", nome: "Site", tipo: "link" }, { c: "paginas_visitadas", nome: "Páginas", tipo: "num" }, { c: "chars", nome: "Caracteres", tipo: "num" }, { c: "vetores", nome: "Vetores", tipo: "num" }, { c: "resultado_validacao", nome: "Validação" }, { c: "desfecho", nome: "Desfecho" }, { c: "obs", nome: "Obs.", tipo: "texto" }],
    agrupar: ["desfecho", "resultado_validacao", "worker"],
  },
  {
    id: "fila-vetores", schema: "busca_fornecedor", tabela: "fila_cadastro_vetores", nome: "Vetores da fila de cadastro", grupo: "Cadastro de perfis",
    tempo: "atualizado_em", ordem: "atualizado_em.desc.nullslast",
    colunas: [d("atualizado_em", "Atualizado"), { c: "cnpj_basico", nome: "CNPJ básico" }, { c: "vetores", nome: "Vetores", tipo: "num" }, { c: "nomes", nome: "Nomes", tipo: "json" }],
  },
  {
    id: "perfil-jobs", schema: "public", tabela: "perfil_site_jobs", nome: "Fila de geração de perfil (site)", grupo: "Cadastro de perfis",
    tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at"), { c: "cnpj", nome: "CNPJ" }, { c: "site", nome: "Site", tipo: "link" }, { c: "status", nome: "Status" }, { c: "tentativas", nome: "Tentativas", tipo: "num" }, { c: "erro", nome: "Erro", tipo: "texto" }],
    agrupar: ["status"], pendente: "erro=not.is.null", pendenteNome: "com erro",
  },
  {
    id: "perfil-layout", schema: "busca_fornecedor", tabela: "perfil_layout", nome: "Editor de perfil: layouts", grupo: "Cadastro de perfis",
    tempo: "updated_at", ordem: "updated_at.desc.nullslast",
    colunas: [d("updated_at", "Atualizado"), { c: "cnpj_basico", nome: "CNPJ básico" }, { c: "status", nome: "Status" }, { c: "posicao_blocos", nome: "Posição dos blocos" }],
    agrupar: ["status"],
  },
  {
    id: "perfil-blocos", schema: "busca_fornecedor", tabela: "perfil_blocos", nome: "Editor de perfil: blocos", grupo: "Cadastro de perfis",
    tempo: "updated_at", ordem: "updated_at.desc.nullslast",
    colunas: [d("updated_at", "Atualizado"), { c: "tipo", nome: "Tipo" }, { c: "ordem", nome: "Ordem", tipo: "num" }, { c: "colunas", nome: "Colunas", tipo: "num" }, { c: "visivel", nome: "Visível", tipo: "bool" }],
    agrupar: ["tipo"],
  },
  {
    id: "perfil-midia", schema: "busca_fornecedor", tabela: "perfil_midia", nome: "Editor de perfil: mídia", grupo: "Cadastro de perfis",
    tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at"), { c: "cnpj_basico", nome: "CNPJ básico" }, { c: "file_name", nome: "Arquivo" }, { c: "mime_type", nome: "Tipo" }, { c: "file_size", nome: "Bytes", tipo: "num" }],
    agrupar: ["mime_type"],
  },
  {
    id: "documentos", schema: "busca_fornecedor", tabela: "supplier_documents", nome: "Documentos de fornecedor", grupo: "Cadastro de perfis",
    tempo: "uploaded_at", ordem: "uploaded_at.desc",
    colunas: [d("uploaded_at", "Enviado em"), { c: "document_type", nome: "Tipo" }, { c: "display_name", nome: "Nome" }, { c: "file_name", nome: "Arquivo" }, { c: "file_size", nome: "Bytes", tipo: "num" }],
    agrupar: ["document_type"],
  },

  // ---- Sistema e acesso
  {
    id: "variaveis", schema: "busca_fornecedor", tabela: "variaveis_sistema", nome: "Configurações (variáveis do sistema)", grupo: "Sistema e acesso",
    tempo: "atualizado_em", ordem: "grupo.asc.nullslast,chave.asc", limite: 100,
    colunas: [{ c: "grupo", nome: "Grupo" }, { c: "chave", nome: "Chave" }, { c: "valor", nome: "Valor", tipo: "segredo-se-chave" }, { c: "tipo", nome: "Tipo" }, { c: "descricao", nome: "Descrição", tipo: "texto" }, { c: "editavel", nome: "Editável", tipo: "bool" }, d("atualizado_em", "Atualizado")],
  },
  {
    id: "plan-rank", schema: "busca_fornecedor", tabela: "plan_rank", nome: "Ranking de planos", grupo: "Sistema e acesso",
    tempo: null, ordem: "peso.desc", limite: 50,
    colunas: [{ c: "plano_categoria", nome: "Plano" }, { c: "peso", nome: "Peso", tipo: "num" }],
  },
  {
    id: "admins", schema: "busca_fornecedor", tabela: "app_admins", nome: "Admins", grupo: "Sistema e acesso",
    tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at", "Desde"), { c: "user_id", nome: "Usuário (ID)" }],
  },
  {
    id: "api-keys", schema: "busca_fornecedor", tabela: "api_keys", nome: "Chaves de API", grupo: "Sistema e acesso",
    descricao: "Só prefixo e metadados; o hash da chave nunca é lido.", tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at", "Criada"), { c: "name", nome: "Nome" }, { c: "key_prefix", nome: "Prefixo" }, { c: "scopes", nome: "Escopos", tipo: "json" }, { c: "active", nome: "Ativa", tipo: "bool" }, d("last_used_at", "Último uso"), d("expires_at", "Expira"), d("revoked_at", "Revogada")],
    agrupar: ["active"],
  },
  {
    id: "busca-api-chaves", schema: "public", tabela: "busca_api_chaves", nome: "Chaves do motor de busca", grupo: "Sistema e acesso",
    descricao: "Só prefixo; a chave em si nunca é lida.", tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at", "Criada"), { c: "key_prefix", nome: "Prefixo" }, d("last_used_at", "Último uso")],
  },
  {
    id: "webhook-config", schema: "public", tabela: "webhook_config", nome: "URL do webhook n8n", grupo: "Sistema e acesso",
    tempo: "updated_at", ordem: "updated_at.desc",
    colunas: [d("updated_at", "Alterada em"), { c: "n8n_webhook_url", nome: "URL (parcial)", tipo: "url-secreta" }],
  },
  {
    id: "webhook-eventos", schema: "busca_fornecedor", tabela: "webhook_eventos_processados", nome: "Webhooks já processados", grupo: "Sistema e acesso",
    tempo: "processado_em", ordem: "processado_em.desc", estimado: true,
    colunas: [d("processado_em", "Processado em"), { c: "id_evento", nome: "Evento" }],
  },
  {
    id: "whatsapp-otp", schema: "public", tabela: "whatsapp_otp", nome: "Login por WhatsApp (códigos)", grupo: "Sistema e acesso",
    descricao: "Tentativas de login; o código nunca é lido.", tempo: "created_at", ordem: "created_at.desc",
    colunas: [d("created_at", "Pedido em"), { c: "phone", nome: "Telefone", tipo: "tel" }, { c: "attempts", nome: "Tentativas", tipo: "num" }, d("consumed_at", "Usado em"), d("expires_at", "Expira")],
  },
];

// ---- Acesso ao PostgREST -------------------------------------------------------

async function rest(t: Tabela, query: string, extra: Record<string, string> = {}, method = "GET") {
  if (!bf.supabaseKey) throw new Error("Configure BF_SUPABASE_KEY no Railway para ativar este painel.");
  const res = await fetch(`${bf.supabaseUrl}/rest/v1/${t.tabela}?${query}`, {
    method,
    headers: { apikey: bf.supabaseKey, Authorization: `Bearer ${bf.supabaseKey}`, "Accept-Profile": t.schema, ...extra },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${t.tabela}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function contar(t: Tabela, filtro = "", estimado = false): Promise<number> {
  const res = await rest(t, `select=*${filtro ? `&${filtro}` : ""}`, { Prefer: `count=${estimado ? "estimated" : "exact"}`, Range: "0-0" }, "HEAD");
  return Number(res.headers.get("content-range")?.split("/")[1]) || 0;
}

/** Executa `fns` com no máximo `n` ao mesmo tempo (não sobrecarrega a API do Supabase). */
async function emLotes<T>(fns: (() => Promise<T>)[], n = 6): Promise<T[]> {
  const out: T[] = new Array(fns.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < fns.length) {
        const k = i++;
        out[k] = await fns[k]();
      }
    }),
  );
  return out;
}

const caches = new Map<string, { em: number; dados: unknown }>();
async function emCache<T>(chave: string, ms: number, forcar: boolean, fn: () => Promise<T>): Promise<T> {
  const c = caches.get(chave);
  if (!forcar && c && Date.now() - c.em < ms) return c.dados as T;
  const dados = await fn();
  caches.set(chave, { em: Date.now(), dados });
  return dados;
}

// ---- Mascaramento ----------------------------------------------------------------

const SEGREDO = /key|token|secret|senha|password|apikey|api_key|credencial/i;

function formatar(v: unknown, tipo: Tipo | undefined, linha: Record<string, unknown>): unknown {
  if (v == null || v === "") return null;
  switch (tipo) {
    case "tel":
      return `•••• ${String(v).replace(/\D/g, "").slice(-4)}`;
    case "email": {
      const [u, dom] = String(v).split("@");
      return dom ? `${u.slice(0, 1)}•••@${dom}` : "•••";
    }
    case "url-secreta":
      try {
        const u = new URL(String(v));
        return `${u.origin}/…${u.pathname.slice(-6)}`;
      } catch {
        return "•••";
      }
    case "segredo-se-chave":
      return SEGREDO.test(String(linha.chave ?? "")) ? "•••" : String(v).slice(0, 200);
    case "json":
      return JSON.stringify(v).slice(0, 300);
    case "texto":
      return String(v).slice(0, 600);
    default:
      return typeof v === "string" ? v.slice(0, 300) : v;
  }
}

// ---- API -------------------------------------------------------------------------

const ISO = (ms: number) => new Date(ms).toISOString();

/** Lista as tabelas com totais (para os cabeçalhos recolhidos). */
export function resumoTabelas(forcar = false) {
  return emCache("resumo", 5 * 60_000, forcar, async () => {
    const itens = await emLotes(
      TABELAS.map((t) => async () => {
        try {
          const [total, ult24h, pendentes] = await Promise.all([
            contar(t, "", t.estimado),
            t.tempo ? contar(t, `${t.tempo}=gte.${ISO(Date.now() - DIA)}`) : Promise.resolve(null),
            t.pendente ? contar(t, t.pendente) : Promise.resolve(null),
          ]);
          return { id: t.id, total, ult24h, pendentes, erro: null };
        } catch (err: any) {
          return { id: t.id, total: null, ult24h: null, pendentes: null, erro: String(err?.message ?? err) };
        }
      }),
    );
    const porId = new Map(itens.map((x) => [x.id, x]));
    return {
      atualizadoEm: new Date().toISOString(),
      tabelas: TABELAS.map((t) => ({
        id: t.id,
        nome: t.nome,
        grupo: t.grupo,
        descricao: t.descricao ?? null,
        pendenteNome: t.pendenteNome ?? null,
        estimado: !!t.estimado,
        ...porId.get(t.id),
      })),
    };
  });
}

/** Detalhe de uma tabela: contagens, distribuições e as linhas mais recentes. */
export function detalheTabela(id: string, forcar = false) {
  const t = TABELAS.find((x) => x.id === id);
  if (!t) throw Object.assign(new Error("Tabela desconhecida"), { status: 400 });
  return emCache(`t:${id}`, 2 * 60_000, forcar, async () => {
    const select = t.colunas.map((c) => c.c).join(",");
    const limite = t.limite ?? 25;
    const [linhas, ult7d, amostra] = await Promise.all([
      rest(t, `select=${select}&order=${t.ordem}&limit=${limite}`).then((r) => r.json() as Promise<Record<string, unknown>[]>),
      t.tempo ? contar(t, `${t.tempo}=gte.${ISO(Date.now() - 7 * DIA)}`) : Promise.resolve(null),
      // Distribuições e funil: até 1000 linhas mais recentes, só das colunas necessárias.
      t.agrupar?.length || t.funil
        ? rest(
            t,
            `select=${[...new Set([...(t.agrupar ?? []), ...(t.funil ? [t.funil.por, ...t.funil.etapas.map((e) => e.c)] : [])])].join(",")}&order=${t.ordem}&limit=1000`,
          ).then((r) => r.json() as Promise<Record<string, unknown>[]>)
        : Promise.resolve([]),
    ]);

    const rotulo = (v: unknown) => (v == null || v === "" ? "(vazio)" : v === true ? "sim" : v === false ? "não" : String(v));
    const distribuicoes = (t.agrupar ?? []).map((c) => {
      const m = new Map<string, number>();
      for (const l of amostra) m.set(rotulo(l[c]), (m.get(rotulo(l[c])) ?? 0) + 1);
      return {
        coluna: t.colunas.find((x) => x.c === c)?.nome ?? c,
        itens: [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([nome, n]) => ({ nome, n })),
      };
    });

    let funil = null;
    if (t.funil) {
      const f = t.funil;
      const grupos = new Map<string, Record<string, unknown>[]>();
      for (const l of amostra) grupos.set(rotulo(l[f.por]), [...(grupos.get(rotulo(l[f.por])) ?? []), l]);
      funil = {
        etapas: f.etapas.map((e) => e.nome),
        grupos: [...grupos.entries()].sort().map(([nome, ls]) => ({ nome, total: ls.length, etapas: f.etapas.map((e) => ls.filter((l) => l[e.c] === true).length) })),
      };
    }

    return {
      id: t.id,
      ult7d,
      amostra: amostra.length,
      distribuicoes,
      funil,
      colunas: t.colunas.map((c) => ({ c: c.c, nome: c.nome, tipo: c.tipo ?? null })),
      linhas: linhas.map((l) => Object.fromEntries(t.colunas.map((c) => [c.c, formatar(l[c.c], c.tipo, l)]))),
      atualizadoEm: new Date().toISOString(),
    };
  });
}
