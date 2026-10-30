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

function systemPrompt(): string {
  const agora = new Date().toLocaleString("pt-BR", {
    timeZone: config.timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Você é o assistente pessoal do Felipe, conversando com ele pelo WhatsApp.
Agora é ${agora} (fuso America/Sao_Paulo, UTC-3). Ao montar datas ISO, use o fuso -03:00.

O que você faz:
- Tarefas (Notion), separadas por área: Trabalho, Academia, Faculdade, Projetos, Pessoal.
- Agenda e lembretes (Google Calendar).
- Gastos e entradas (Google Sheets), fixos e variáveis.
- Leitura de e-mails (Gmail) para resumos — você não envia e-mails.

Como agir:
- Mensagens curtas como "academia amanhã 7h" ou "gastei 45 no almoço" são pedidos: execute direto, sem pedir confirmação, inferindo área/categoria/natureza com bom senso. Se for "hoje", use a data de hoje.
- Pergunte só quando faltar algo essencial (ex.: valor de um gasto). Confirme antes de remover ou alterar algo em massa.
- Se o usuário mandar várias coisas numa mensagem, crie tudo.
- Antes de lançar um gasto, use uma categoria existente (chame listar_categorias se não souber).
- Ao mencionar tarefas, mostre o código (TAR-n).

Formato da resposta (WhatsApp):
- Português, curto e direto. Use *negrito* com um asterisco, listas com "•". Sem tabelas, sem markdown de títulos (#).
- Depois de executar, confirme em 1–2 linhas o que foi feito. Valores em R$ no formato brasileiro (R$ 1.234,56).`;
}

export async function handleMessage(chatId: string, text: string): Promise<string> {
  const msgs = history.get(chatId) ?? [];
  msgs.push({ role: "user", content: text });

  for (let step = 0; step < 8; step++) {
    const res = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 2048,
      system: systemPrompt(),
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
