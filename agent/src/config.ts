import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(opt("PORT", "3000")),
  timezone: opt("TZ_ASSISTENTE", "America/Sao_Paulo"),

  // Segredo que vai na URL do webhook (?token=...). Impede chamadas de terceiros.
  webhookToken: req("WEBHOOK_TOKEN"),

  evolution: {
    url: req("EVOLUTION_URL").replace(/\/$/, ""),
    apiKey: req("EVOLUTION_AUTH_KEY"),
    instance: req("EVOLUTION_INSTANCE"),
  },

  // O número é pessoal: o agente SÓ responde no(s) grupo(s) listado(s) aqui
  // e só a mensagens enviadas por você (fromMe). Todo o resto é ignorado.
  allowedChats: opt("ALLOWED_CHAT_JIDS")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "")) // tolera aspas coladas por engano
    .filter(Boolean),

  anthropic: {
    apiKey: req("CLAUDE_API_KEY"),
    model: opt("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
  },

  notion: {
    token: req("TOKEN_NOTION"),
    tasksDataSourceId: opt("NOTION_TASKS_DATA_SOURCE_ID", "5072380e-9871-4bb0-8eed-695dca78ed8b"),
  },

  google: {
    clientId: req("GOOGLE_ID_CLIENT"),
    clientSecret: req("GOOGLE_SECRET_KEY"),
    refreshToken: req("GOOGLE_REFRESH_TOKEN"),
    expensesSpreadsheetId: opt("GOOGLE_EXPENSES_SHEET_ID", "1ATjK3sX3y8_IbgA38cqs1GU3seBus5VAI2441vuzTUI"),
    calendarId: opt("GOOGLE_CALENDAR_ID", "primary"),
  },

  // Prefixo das respostas do agente: deixa claro no grupo o que veio do assistente.
  replyPrefix: opt("REPLY_PREFIX", "🤖 "),
};
