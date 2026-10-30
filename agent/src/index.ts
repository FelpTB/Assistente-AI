import express from "express";
import { config } from "./config.js";
import { sendText, sentByAgent, setPresenceTyping } from "./evolution.js";
import { handleMessage, resetHistory } from "./agent.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, servico: "assistente-ai", chatsPermitidos: config.allowedChats.length });
});

const processed = new Set<string>();
const queues = new Map<string, Promise<void>>();

function extractText(message: any): string {
  if (!message) return "";
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.documentMessage?.caption ??
    ""
  ).trim();
}

app.post("/webhook/evolution", (req, res) => {
  if (req.query.token !== config.webhookToken) {
    res.status(401).json({ erro: "token inválido" });
    return;
  }
  res.sendStatus(200); // responde rápido; processa em segundo plano

  const body = req.body ?? {};
  const event = String(body.event ?? "").toLowerCase().replace("_", ".");
  if (event !== "messages.upsert") return;

  const items = Array.isArray(body.data) ? body.data : [body.data];
  for (const data of items) {
    if (!data?.key) continue;
    const { remoteJid, fromMe, id } = data.key;
    const text = extractText(data.message);

    // Regras de segurança (número pessoal):
    if (!fromMe) continue; // só mensagens enviadas por você
    if (!text) continue;
    if (sentByAgent.has(id) || processed.has(id)) continue; // não responde a si mesmo / duplicadas
    if (text.startsWith(config.replyPrefix.trim())) continue;

    // Modo de configuração: sem chat liberado, "/ativar" informa o ID do chat.
    if (config.allowedChats.length === 0) {
      if (text === "/ativar") {
        console.log(`[ativar] ID do chat: ${remoteJid}`);
        sendText(remoteJid, `${config.replyPrefix}ID deste chat: ${remoteJid}\nColoque esse valor em ALLOWED_CHAT_JIDS no Railway.`).catch(console.error);
      }
      continue;
    }
    if (!config.allowedChats.includes(remoteJid)) continue;

    processed.add(id);
    if (processed.size > 1000) processed.delete(processed.values().next().value!);

    const prev = queues.get(remoteJid) ?? Promise.resolve();
    const next = prev.then(() => processMessage(remoteJid, text)).catch(console.error);
    queues.set(remoteJid, next);
  }
});

async function processMessage(chatJid: string, text: string) {
  console.log(`[msg] ${chatJid}: ${text.slice(0, 120)}`);
  if (text === "/reset") {
    resetHistory(chatJid);
    await sendText(chatJid, `${config.replyPrefix}Memória da conversa limpa.`);
    return;
  }
  await setPresenceTyping(chatJid);
  try {
    const reply = await handleMessage(chatJid, text);
    await sendText(chatJid, `${config.replyPrefix}${reply}`);
  } catch (err: any) {
    console.error("[erro]", err);
    await sendText(chatJid, `${config.replyPrefix}Tive um erro ao processar: ${err?.message ?? err}`).catch(() => {});
  }
}

app.listen(config.port, () => {
  console.log(`Assistente AI ouvindo na porta ${config.port}`);
  if (config.allowedChats.length === 0)
    console.log('Nenhum chat liberado. Envie "/ativar" no seu grupo solo para descobrir o ID.');
});
