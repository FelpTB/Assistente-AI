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

/** Desembrulha formatos especiais (mensagens temporárias, visualização única, editadas). */
function unwrap(message: any): any {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.documentWithCaptionMessage?.message ??
      m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

function extractText(raw: any): string {
  const message = unwrap(raw);
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
  const event = String(body.event ?? "").toLowerCase().replace(/_/g, ".");
  if (event !== "messages.upsert") {
    console.log(`[webhook] evento ignorado: ${body.event}`);
    return;
  }

  const items = Array.isArray(body.data) ? body.data : [body.data];
  for (const data of items) {
    if (!data?.key) continue;
    const { remoteJid, fromMe, id } = data.key;
    const text = extractText(data.message);

    // Regras de segurança (número pessoal):
    if (!fromMe) continue; // só mensagens enviadas por você (as dos outros nem vão para o log)
    if (sentByAgent.has(id) || processed.has(id)) continue; // não responde a si mesmo / duplicadas

    const tipo = Object.keys(unwrap(data.message) ?? {}).join(",") || "vazio";
    console.log(`[webhook] chat=${remoteJid} tipo=${tipo} texto=${text ? "sim" : "não"}`);
    if (!text) continue;
    if (text.startsWith(config.replyPrefix.trim())) continue;

    // Modo de configuração: sem chat liberado, "/ativar" informa o ID do chat.
    if (config.allowedChats.length === 0) {
      if (text === "/ativar") {
        console.log(`[ativar] ID do chat: ${remoteJid}`);
        sendText(remoteJid, `${config.replyPrefix}ID deste chat: ${remoteJid}\nColoque esse valor em ALLOWED_CHAT_JIDS no Railway.`).catch(console.error);
      }
      continue;
    }
    if (!config.allowedChats.includes(remoteJid)) {
      console.log(`[ignorada] chat ${remoteJid} não está em ALLOWED_CHAT_JIDS (${config.allowedChats.join(", ")})`);
      continue;
    }

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
    await sendText(chatJid, `${config.replyPrefix}Tive um erro ao processar: ${err?.message ?? err}`).catch((e) => console.error("[erro ao enviar resposta]", e));
  }
}

app.listen(config.port, () => {
  console.log(`Assistente AI ouvindo na porta ${config.port}`);
  if (config.allowedChats.length === 0)
    console.log('Nenhum chat liberado. Envie "/ativar" no seu grupo solo para descobrir o ID.');
  else console.log(`Chats liberados: ${config.allowedChats.join(", ")}`);
  console.log(`Modelo: ${config.anthropic.model}`);
});
