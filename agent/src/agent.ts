import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { tools, runTool } from "./tools/index.js";

const client = new Anthropic({
  apiKey: config.anthropic.apiKey,
  // Chaves sem workspace próprio exigem o workspace no cabeçalho de cada chamada.
  defaultHeaders: config.anthropic.workspaceId
    ? { "anthropic-workspace-id": config.anthropic.workspaceId }
    : undefined,
});

// Memória curta por conversa, só em RAM (nada pessoal fica em banco).
// Reinicia quando o servidor reinicia — o histórico real fica no Notion/Sheets/Calendar.
const history = new Map<string, Anthropic.MessageParam[]>();
const MAX_TURNS = 20;

function agora(): string {
  return new Date().toLocaleString("pt-BR", {
    timeZone: config.timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// O prompt de sistema precisa ser fixo: blocos de raciocínio (thinking) ficam presos ao
// prompt em que foram criados, e a API rejeita o histórico se ele mudar. A data/hora vai
// em cada mensagem do usuário.
const SYSTEM_PROMPT = `Você é o assistente pessoal do Felipe, conversando com ele pelo WhatsApp.
Cada mensagem dele começa com [agora: ...], a data e hora atuais (fuso America/Sao_Paulo, UTC-3). Ao montar datas ISO, use o fuso -03:00.

O que você faz:
- Tarefas (Notion), separadas por área: Trabalho, Academia, Faculdade, Projetos, Pessoal.
- Agenda e lembretes (Google Calendar).
- Gastos e entradas (Google Sheets), num registro contínuo com saldo em três meios:
  • Dinheiro: conta corrente (débito, Pix). Recebe o salário.
  • Cartão: crédito. Compras aumentam a fatura e consomem o limite disponível (limite total = disponível + fatura); "paguei a fatura" é um lançamento tipo "Pagamento de fatura", que sai do Dinheiro e libera o limite.
  • Vale: benefício da empresa (multiuso), separado do Dinheiro. Recebe o crédito do vale junto com o salário.
- Leitura de e-mails (Gmail) para resumos. O único e-mail que você envia é a planilha mensal de ponto (enviar_ponto), e só com aprovação dele.

Como agir:
- Mensagens curtas como "academia amanhã 7h" ou "gastei 45 no almoço" são pedidos: execute direto, sem pedir confirmação, inferindo área/categoria/natureza com bom senso. Se for "hoje", use a data de hoje.
- Pergunte só quando faltar algo essencial (ex.: valor de um gasto). Confirme antes de remover ou alterar algo em massa.
- Se o usuário mandar várias coisas numa mensagem, crie tudo.
- Todo lançamento precisa do que foi pago e do meio. "Pix" e "débito" são Dinheiro; "crédito" é Cartão. Se o meio não estiver claro, pergunte antes de lançar.
- A categoria é você quem escolhe pela descrição, entre as existentes (chame listar_categorias se não souber). Salário e vale chegando são duas entradas: uma em Dinheiro, outra em Vale.
- Depois de lançar, diga o saldo do meio usado (vem na resposta da ferramenta).
- Ao mencionar tarefas, mostre o código (TAR-n).

Formato da resposta (WhatsApp):
- Português, curto e direto. Use *negrito* com um asterisco, listas com "•". Sem tabelas, sem markdown de títulos (#).
- Depois de executar, confirme em 1–2 linhas o que foi feito. Valores em R$ no formato brasileiro (R$ 1.234,56).`;

/** Toda chamada de ferramenta precisa de um resultado na mensagem seguinte; sem isso a API recusa
 *  o histórico inteiro (erro "tool_use ids were found without tool_result blocks"). Completa o que faltar. */
function repararHistorico(msgs: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    out.push(m);
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    const ids = m.content.filter((b) => b.type === "tool_use").map((b) => (b as Anthropic.ToolUseBlockParam).id);
    if (!ids.length) continue;
    const prox = msgs[i + 1];
    const respondidos = new Set(
      prox?.role === "user" && Array.isArray(prox.content)
        ? prox.content.filter((b) => b.type === "tool_result").map((b) => (b as Anthropic.ToolResultBlockParam).tool_use_id)
        : [],
    );
    const faltando = ids.filter((id) => !respondidos.has(id));
    if (!faltando.length) continue;
    const resultados: Anthropic.ToolResultBlockParam[] = faltando.map((id) => ({ type: "tool_result", tool_use_id: id, content: "Não executada.", is_error: true }));
    if (prox?.role === "user") {
      // Os resultados precisam vir antes de qualquer texto na mensagem seguinte.
      const conteudo = Array.isArray(prox.content) ? prox.content : [{ type: "text" as const, text: prox.content }];
      out.push({ role: "user", content: [...resultados, ...conteudo] });
      i++;
    } else {
      out.push({ role: "user", content: resultados });
    }
  }
  return out;
}

const historicoInvalido = (err: any) =>
  err?.status === 400 && /tool_use|tool_result|messages\.\d+/i.test(String(err?.error?.error?.message ?? err?.message ?? ""));

export async function handleMessage(chatId: string, text: string): Promise<string> {
  try {
    return await conversar(chatId, text);
  } catch (err) {
    // Histórico corrompido: começa do zero e tenta uma vez só com a mensagem atual.
    if (!historicoInvalido(err)) throw err;
    console.error("[agent] histórico inválido; memória da conversa reiniciada", (err as any)?.error?.error?.message);
    history.delete(chatId);
    return conversar(chatId, text);
  }
}

async function conversar(chatId: string, text: string): Promise<string> {
  // Trabalha numa cópia: se algo falhar no meio, o histórico guardado não fica com pedaços do turno.
  const msgs = repararHistorico(history.get(chatId) ?? []);
  msgs.push({ role: "user", content: `[agora: ${agora()}]\n${text}` });

  for (let step = 0; step < 8; step++) {
    const res = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools,
      messages: msgs,
    });

    const usos = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason === "max_tokens" && usos.length) {
      // Resposta cortada no meio de chamadas de ferramenta: a última pode estar incompleta.
      // Não executa nada desse trecho e pede para continuar em partes menores.
      msgs.push({ role: "assistant", content: res.content.filter((b) => b.type !== "tool_use") });
      if (!Array.isArray(msgs.at(-1)!.content) || !(msgs.at(-1)!.content as unknown[]).length) msgs.pop();
      msgs.push({ role: "user", content: "[sistema] Sua resposta foi cortada por tamanho e nenhuma ação foi executada. Faça as ações em grupos menores (até 5 por vez)." });
      continue;
    }

    msgs.push({ role: "assistant", content: res.content });

    if (!usos.length) {
      const reply = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      saveHistory(chatId, msgs);
      return reply || "Feito.";
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of usos) {
      console.log(`[tool] ${block.name}`, JSON.stringify(block.input));
      const r = await runTool(block.name, block.input);
      results.push({ type: "tool_result", tool_use_id: block.id, content: r.content, is_error: r.isError });
    }
    msgs.push({ role: "user", content: results });
  }

  saveHistory(chatId, msgs);
  return "Não consegui concluir esse pedido agora. Pode tentar de novo de outro jeito?";
}

function saveHistory(chatId: string, msgs: Anthropic.MessageParam[]) {
  // Raciocínio de pedidos já respondidos não precisa voltar à API; guardá-lo só arrisca
  // o erro "Invalid signature in thinking block" (ex.: depois de trocar o prompt ou o modelo).
  msgs = msgs.map((m) =>
    m.role === "assistant" && Array.isArray(m.content)
      ? { ...m, content: m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking") }
      : m,
  );
  // Mantém só os últimos turnos, sempre começando numa mensagem de texto do usuário
  // (para não deixar um tool_result órfão no início).
  let trimmed = msgs;
  if (msgs.length > MAX_TURNS * 2) {
    trimmed = msgs.slice(-MAX_TURNS * 2);
    const start = trimmed.findIndex((m) => m.role === "user" && typeof m.content === "string");
    trimmed = start >= 0 ? trimmed.slice(start) : [];
  }
  history.set(chatId, repararHistorico(trimmed));
}

/** Coloca no histórico uma mensagem que o agente mandou por conta própria (ex.: aviso do dia 1),
 *  para que a resposta do Felipe ("pode enviar") tenha contexto. */
export function anotarAviso(chatId: string, motivo: string, texto: string) {
  const msgs = [...(history.get(chatId) ?? [])];
  msgs.push(
    { role: "user", content: `[agora: ${agora()}]\n[Aviso automático do sistema, não escrito pelo Felipe] ${motivo}` },
    { role: "assistant", content: texto },
  );
  saveHistory(chatId, msgs);
}

export function resetHistory(chatId: string) {
  history.delete(chatId);
}

/** Pede ao Claude um texto curto (relatórios do dashboard). Sem ferramentas, sem histórico. */
export async function gerarTexto(system: string, prompt: string): Promise<string> {
  const res = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error("O modelo não gerou o resumo para este conteúdo.");
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Verifica se a chave e o modelo da Claude API respondem (não gera texto, não tem custo). */
export async function checkClaude(): Promise<string> {
  const m = await client.models.retrieve(config.anthropic.model);
  return m.display_name ?? m.id;
}
