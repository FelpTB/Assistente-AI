import { config } from "./config.js";

const { url, apiKey, instance } = config.evolution;

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Evolution ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : ({} as T);
}

/** IDs das mensagens que o próprio agente enviou — evita que ele responda a si mesmo. */
export const sentByAgent = new Set<string>();

export async function sendText(chatJid: string, text: string): Promise<void> {
  // WhatsApp corta mensagens muito longas; divide em partes de ~3500 caracteres.
  const parts = text.match(/[\s\S]{1,3500}(?=\n|$)|[\s\S]{1,3500}/g) ?? [text];
  for (const part of parts) {
    const r = await call<any>("POST", `/message/sendText/${encodeURIComponent(instance)}`, {
      number: chatJid,
      text: part,
    });
    const id = r?.key?.id;
    if (id) {
      sentByAgent.add(id);
      if (sentByAgent.size > 500) sentByAgent.delete(sentByAgent.values().next().value!);
    }
  }
}

export async function setPresenceTyping(chatJid: string): Promise<void> {
  try {
    await call("POST", `/chat/sendPresence/${encodeURIComponent(instance)}`, {
      number: chatJid,
      presence: "composing",
      delay: 3000,
    });
  } catch {
    /* opcional — ignora falhas */
  }
}

export async function fetchGroups(): Promise<Array<{ id: string; subject: string; size?: number }>> {
  return call("GET", `/group/fetchAllGroups/${encodeURIComponent(instance)}?getParticipants=false`);
}

export async function setWebhook(webhookUrl: string): Promise<unknown> {
  return call("POST", `/webhook/set/${encodeURIComponent(instance)}`, {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: false,
      base64: false,
      events: ["MESSAGES_UPSERT"],
    },
  });
}
