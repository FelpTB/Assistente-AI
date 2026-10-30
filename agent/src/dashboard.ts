import express, { type Express, type Request, type Response } from "express";
import { config } from "./config.js";
import { requireLogin } from "./auth.js";
import { checkClaude } from "./agent.js";
import { connectionState } from "./evolution.js";
import { AREAS, PRIORIDADES, STATUS, criarTarefa, listarTarefas, atualizarTarefa } from "./tools/tarefas.js";
import { listarAgenda } from "./tools/agenda.js";
import { listarCategorias, resumoGastos } from "./tools/gastos.js";

// API do dashboard. Lê e grava direto no Notion/Sheets/Calendar — nada fica guardado aqui.

/** Envolve um handler: devolve JSON; erros de validação viram 400, falhas das integrações 502. */
function route(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (err: any) {
      if (err?.status !== 400) console.error(`[api] ${req.method} ${req.path}`, err?.message ?? err);
      res.status(err?.status === 400 ? 400 : 502).json({ erro: err?.message ?? String(err) });
    }
  };
}

function badRequest(msg: string): never {
  throw Object.assign(new Error(msg), { status: 400 });
}

async function check(nome: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const detalhe = await fn();
    return { nome, ok: true, detalhe, ms: Date.now() - t0 };
  } catch (err: any) {
    return { nome, ok: false, detalhe: String(err?.message ?? err).slice(0, 200), ms: Date.now() - t0 };
  }
}

export function registerDashboardRoutes(app: Express) {
  const api = express.Router();
  api.use(requireLogin);

  api.get("/me", (req, res) => {
    res.json({ email: (req as any).user.email, areas: AREAS, status: STATUS, prioridades: PRIORIDADES });
  });

  api.get(
    "/status",
    route(async () => {
      const amanha = new Date(Date.now() + 86400000).toISOString();
      const integracoes = await Promise.all([
        check("WhatsApp (Evolution)", async () => {
          const s = await connectionState();
          if (s !== "open") throw new Error(`instância ${config.evolution.instance}: ${s}`);
          return `instância ${config.evolution.instance} conectada`;
        }),
        check("Claude API", async () => `modelo ${await checkClaude()}`),
        check("Notion (Tarefas)", async () => {
          await listarTarefas({ limite: 1 });
          return "banco Tarefas acessível";
        }),
        check("Google Sheets (Gastos)", async () => `${(await listarCategorias()).length} categorias`),
        check("Google Calendar", async () => {
          await listarAgenda({ de: new Date().toISOString(), ate: amanha, limite: 1 });
          return `agenda ${config.google.calendarId}`;
        }),
      ]);
      return {
        agente: {
          chatsPermitidos: config.allowedChats.length,
          modo: config.allowedChats.length ? "ativo" : "aguardando /ativar",
          modelo: config.anthropic.model,
          noArDesde: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        },
        integracoes,
      };
    }),
  );

  api.get(
    "/tarefas",
    route(async (req) => {
      const area = typeof req.query.area === "string" && req.query.area ? req.query.area : undefined;
      if (area && !(AREAS as readonly string[]).includes(area)) badRequest(`Área inválida: ${area}`);
      return listarTarefas({ area, incluirConcluidas: req.query.concluidas === "1", limite: 100 });
    }),
  );

  api.post(
    "/tarefas",
    route(async (req) => {
      const b = req.body ?? {};
      const tarefa = String(b.tarefa ?? "").trim();
      if (!tarefa) badRequest("Informe o nome da tarefa.");
      if (!(AREAS as readonly string[]).includes(b.area)) badRequest("Área inválida.");
      if (b.prioridade && !(PRIORIDADES as readonly string[]).includes(b.prioridade)) badRequest("Prioridade inválida.");
      return criarTarefa({
        tarefa,
        area: b.area,
        prazo: b.prazo || undefined,
        prioridade: b.prioridade || undefined,
        notas: b.notas || undefined,
        lembrete: Boolean(b.lembrete),
        origem: "Dashboard",
      });
    }),
  );

  api.patch(
    "/tarefas/:id",
    route(async (req) => {
      const b = req.body ?? {};
      if (b.status && !(STATUS as readonly string[]).includes(b.status)) badRequest("Status inválido.");
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{32,36}$/i.test(id)) badRequest("ID inválido.");
      return atualizarTarefa({ referencia: id, status: b.status, prioridade: b.prioridade, prazo: b.prazo });
    }),
  );

  api.get(
    "/agenda",
    route(async (req) => {
      const dias = Math.min(Math.max(Number(req.query.dias) || 7, 1), 31);
      const de = new Date();
      const ate = new Date(de.getTime() + dias * 86400000);
      return listarAgenda({ de: de.toISOString(), ate: ate.toISOString(), limite: 100 });
    }),
  );

  api.get(
    "/gastos",
    route(async (req) => {
      const mes = typeof req.query.mes === "string" && /^\d{4}-\d{2}$/.test(req.query.mes) ? req.query.mes : undefined;
      return resumoGastos({ mes });
    }),
  );

  app.use("/api", api);
}
