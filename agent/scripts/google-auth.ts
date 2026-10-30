/**
 * Gera o GOOGLE_REFRESH_TOKEN. Rode no seu computador:
 *   GOOGLE_ID_CLIENT=... GOOGLE_SECRET_KEY=... npm run google-auth
 * Abra o link, faça login com felipe@abcadvise.com.br e copie o token exibido.
 */
import "dotenv/config";
import http from "node:http";
import { google } from "googleapis";

const clientId = process.env.GOOGLE_ID_CLIENT;
const clientSecret = process.env.GOOGLE_SECRET_KEY;
if (!clientId || !clientSecret) {
  console.error("Defina GOOGLE_ID_CLIENT e GOOGLE_SECRET_KEY (no .env ou na linha de comando).");
  process.exit(1);
}

const PORT = 53682;
const redirect = `http://localhost:${PORT}/callback`;
const oauth = new google.auth.OAuth2(clientId, clientSecret, redirect);

const url = oauth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
});

http
  .createServer(async (req, res) => {
    if (!req.url?.startsWith("/callback")) return res.end();
    const code = new URL(req.url, redirect).searchParams.get("code");
    if (!code) return res.end("Sem código.");
    const { tokens } = await oauth.getToken(code);
    res.end("Pronto! Volte ao terminal.");
    console.log("\nGOOGLE_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
    process.exit(0);
  })
  .listen(PORT, () => console.log(`Abra este link no navegador:\n\n${url}\n`));
