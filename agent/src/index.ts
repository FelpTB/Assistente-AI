import express from "express";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { sendText, sentByAgent, setPresenceTyping } from "./evolution.js";
import { anotarAviso, handleMessage, resetHistory } from "./agent.js";
import { mesAnterior, pontoDoMes, pontoJaEnviado } from "./ponto.js";
import { registerAuthRoutes } from "./auth.js";
import { registerDashboardRoutes } from "./dashboard.js";

const app = express();
app.set("trust proxy", 1); // Railway fica atrás de um proxy HTTPS
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, servico: "assistente-ai", chatsPermitidos: config.allowedChats.length });
});

// Dashboard: a página é pública (só tem o botão de login); os dados ficam em /api, que exige login.
registerAuthRoutes(app);
registerDashboardRoutes(app);
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

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
      if (text.toLowerCase() === "/ativar") {
        console.log(`[ativar] ID do chat: ${remoteJid}`);
        sendText(remoteJid, `${config.replyPrefix}ID deste chat: ${remoteJid}\nColoque esse valor em ALLOWED_CHAT_JIDS no Railway.`).catch(console.error);
      } else {
        console.log('[ignorada] ALLOWED_CHAT_JIDS vazio: só "/ativar" é respondido');
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
  // "/ponto" ou "/ponto 2026-10": roda agora a rotina do ponto (prepara a planilha e pede aprovação).
  const cmdPonto = text.trim().match(/^\/ponto(?:\s+(\d{4})-(\d{1,2}))?$/i);
  if (cmdPonto) {
    const mes = cmdPonto[1] ? `${cmdPonto[1]}-${cmdPonto[2].padStart(2, "0")}` : mesAnterior();
    await prepararPonto(chatJid, mes, true);
    return;
  }
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

// ---- Ponto mensal: no dia 1, prepara a planilha do mês anterior e pede aprovação no grupo ----
const pontoAvisado = new Set<string>();

async function verificarPontoMensal() {
  const chat = config.allowedChats[0];
  if (!chat) return;
  const agora = new Date().toLocaleString("sv-SE", { timeZone: config.timezone }); // "2026-11-01 09:05:00"
  if (agora.slice(8, 10) !== "01" || Number(agora.slice(11, 13)) < config.ponto.horaAviso) return;
  const mes = mesAnterior();
  if (pontoAvisado.has(mes)) return;
  pontoAvisado.add(mes);
  await prepararPonto(chat, mes, false);
}

/** Prepara a planilha do mês e pede aprovação no grupo. Manual = disparado por /ponto (ignora "já enviado"). */
async function prepararPonto(chat: string, mes: string, manual: boolean) {
  try {
    const jaEnviado = await pontoJaEnviado(mes);
    if (jaEnviado && !manual) return;
    const r = await pontoDoMes(mes);
    const texto = r.dias.length
      ? `Planilha de ponto de *${r.nomeMes}* pronta:\n• ${r.diasTrabalhados} dias com registro\n• Total: *${r.total}*` +
        (r.incompletos.length ? `\n• Registro incompleto em ${r.incompletos.length} dia(s): ${r.incompletos.map((d) => d.slice(8, 10) + "/" + d.slice(5, 7)).join(", ")}` : "") +
        (jaEnviado ? `\n\n⚠️ Essa planilha já foi enviada antes. Quer mandar de novo para ${config.ponto.email}?` : `\n\nPosso enviar para ${config.ponto.email}?`)
      : `Não encontrei registros de ponto de ${config.ponto.funcionario} em ${r.nomeMes}, então não há planilha para enviar.`;
    await sendText(chat, `${config.replyPrefix}${texto}`);
    anotarAviso(chat, `${manual ? "Comando /ponto" : "Dia 1"}: planilha de ponto de ${r.nomeMes} (mes=${mes}) preparada; pedir aprovação para enviar.`, texto);
  } catch (err: any) {
    console.error("[ponto]", err?.message ?? err);
    await sendText(chat, `${config.replyPrefix}Não consegui preparar a planilha de ponto: ${err?.message ?? err}`).catch(console.error);
  }
}

setInterval(() => verificarPontoMensal().catch(console.error), 10 * 60000);

app.listen(config.port, () => {
  console.log(`Assistente AI ouvindo na porta ${config.port}`);
  if (config.allowedChats.length === 0)
    console.log('Nenhum chat liberado. Envie "/ativar" no seu grupo solo para descobrir o ID.');
  else console.log(`Chats liberados: ${config.allowedChats.join(", ")}`);
  console.log(`Modelo: ${config.anthropic.model}`);
  verificarPontoMensal().catch(console.error);
  console.log(`Dashboard: ${config.dashboard.publicUrl} (login: ${config.dashboard.emails.join(", ")})`);
});
