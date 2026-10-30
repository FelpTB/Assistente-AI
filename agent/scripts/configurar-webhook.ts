/**
 * Aponta o webhook da instância da Evolution para o agente.
 *   npm run webhook -- https://SEU-AGENTE.up.railway.app
 * Usa EVOLUTION_URL, EVOLUTION_AUTH_KEY, EVOLUTION_INSTANCE e WEBHOOK_TOKEN do .env.
 */
import "dotenv/config";

const base = process.argv[2];
const { EVOLUTION_URL, EVOLUTION_AUTH_KEY, EVOLUTION_INSTANCE, WEBHOOK_TOKEN } = process.env;
if (!base || !EVOLUTION_URL || !EVOLUTION_AUTH_KEY || !EVOLUTION_INSTANCE || !WEBHOOK_TOKEN) {
  console.error("Uso: npm run webhook -- https://seu-agente.up.railway.app  (e preencha o .env)");
  process.exit(1);
}

const webhookUrl = `${base.replace(/\/$/, "")}/webhook/evolution?token=${encodeURIComponent(WEBHOOK_TOKEN)}`;
const res = await fetch(`${EVOLUTION_URL.replace(/\/$/, "")}/webhook/set/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: EVOLUTION_AUTH_KEY },
  body: JSON.stringify({
    webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: ["MESSAGES_UPSERT"] },
  }),
});
console.log(res.status, await res.text());
