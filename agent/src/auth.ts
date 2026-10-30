import crypto from "node:crypto";
import type { Request, Response, NextFunction, Express } from "express";
import { google } from "googleapis";
import { config } from "./config.js";

// Login do dashboard com Google. Só os e-mails de DASHBOARD_EMAILS entram.
// A sessão é um cookie assinado (HMAC) — nada é guardado em banco.

const SESSION_COOKIE = "aa_sessao";
const STATE_COOKIE = "aa_state";
const SESSION_DAYS = 7;

const redirectUri = `${config.dashboard.publicUrl}/auth/callback`;
const oauth = new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, redirectUri);
const secure = config.dashboard.publicUrl.startsWith("https://");

function sign(value: string): string {
  return crypto.createHmac("sha256", config.dashboard.sessionSecret).update(value).digest("base64url");
}

function encodeSession(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 86400000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeSession(token: string | undefined): { email: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.email !== "string" || Date.now() > data.exp) return null;
    if (!config.dashboard.emails.includes(data.email.toLowerCase())) return null;
    return { email: data.email };
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function setCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  const attrs = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (secure) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

export function currentUser(req: Request) {
  return decodeSession(readCookie(req, SESSION_COOKIE));
}

/** Protege as rotas /api/* do dashboard. */
export function requireLogin(req: Request, res: Response, next: NextFunction) {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ erro: "não autenticado" });
    return;
  }
  (req as any).user = user;
  next();
}

export function registerAuthRoutes(app: Express) {
  app.get("/auth/login", (_req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    setCookie(res, STATE_COOKIE, state, 600);
    const url = oauth.generateAuthUrl({
      scope: ["openid", "email"],
      state,
      prompt: "select_account",
      login_hint: config.dashboard.emails[0],
    });
    res.redirect(url);
  });

  app.get("/auth/callback", async (req, res) => {
    const state = readCookie(req, STATE_COOKIE);
    setCookie(res, STATE_COOKIE, "", 0);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code || !state || req.query.state !== state) {
      res.status(400).send("Login inválido ou expirado. <a href='/'>Tentar de novo</a>");
      return;
    }
    try {
      const { tokens } = await oauth.getToken(code);
      const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token!, audience: config.google.clientId });
      const p = ticket.getPayload();
      const email = p?.email?.toLowerCase();
      if (!email || !p?.email_verified || !config.dashboard.emails.includes(email)) {
        console.log(`[auth] acesso negado: ${email ?? "sem e-mail"}`);
        res.status(403).send("Este e-mail não tem acesso ao dashboard. <a href='/auth/login'>Entrar com outra conta</a>");
        return;
      }
      setCookie(res, SESSION_COOKIE, encodeSession(email), SESSION_DAYS * 86400);
      res.redirect("/");
    } catch (err: any) {
      console.error("[auth]", err?.message ?? err);
      res.status(500).send("Erro no login com Google. <a href='/'>Voltar</a>");
    }
  });

  app.post("/auth/logout", (_req, res) => {
    setCookie(res, SESSION_COOKIE, "", 0);
    res.json({ ok: true });
  });
}
