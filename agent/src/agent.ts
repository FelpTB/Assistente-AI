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
- Leitura de e-mails (Gmail) para resumos — você não envia e-mails.

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

export async function handleMessage(chatId: string, text: string): Promise<string> {
  const msgs = history.get(chatId) ?? [];
  msgs.push({ role: "user", content: `[agora: ${agora()}]\n${text}` });

  for (let step = 0; step < 8; step++) {
    const res = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools,
      messages: msgs,
    });

    msgs.push({ role: "assistant", content: res.content });

    if (res.stop_reason !== "tool_use") {
      const reply = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      saveHistory(chatId, msgs);
      return reply || "Feito.";
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
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
  history.set(chatId, trimmed);
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
