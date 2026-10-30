import { calendar } from "../google.js";
import { config } from "../config.js";

const calendarId = config.google.calendarId;
const tz = config.timezone;

function isDateOnly(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function criarEvento(input: {
  titulo: string;
  inicio: string; // "2026-11-03" (dia inteiro) ou "2026-11-03T14:00:00-03:00"
  fim?: string;
  duracaoMinutos?: number;
  descricao?: string;
  local?: string;
  lembreteMinutos?: number;
}) {
  let start: any, end: any;
  if (isDateOnly(input.inicio)) {
    start = { date: input.inicio };
    end = { date: input.fim && isDateOnly(input.fim) ? addDays(input.fim, 1) : addDays(input.inicio, 1) };
  } else {
    const ini = new Date(input.inicio);
    const fim = input.fim ? new Date(input.fim) : new Date(ini.getTime() + (input.duracaoMinutos ?? 30) * 60000);
    start = { dateTime: ini.toISOString(), timeZone: tz };
    end = { dateTime: fim.toISOString(), timeZone: tz };
  }
  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: input.titulo,
      description: input.descricao,
      location: input.local,
      start,
      end,
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: input.lembreteMinutos ?? 30 }],
      },
    },
  });
  return { id: res.data.id!, link: res.data.htmlLink, inicio: input.inicio };
}

export async function removerEvento(id: string) {
  await calendar.events.delete({ calendarId, eventId: id });
  return { removido: id };
}

export async function listarAgenda(input: { de: string; ate: string; limite?: number }) {
  const res = await calendar.events.list({
    calendarId,
    timeMin: new Date(isDateOnly(input.de) ? `${input.de}T00:00:00-03:00` : input.de).toISOString(),
    timeMax: new Date(isDateOnly(input.ate) ? `${input.ate}T23:59:59-03:00` : input.ate).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: input.limite ?? 50,
    timeZone: tz,
  });
  return (res.data.items ?? []).map((e) => ({
    id: e.id,
    titulo: e.summary,
    inicio: e.start?.dateTime ?? e.start?.date,
    fim: e.end?.dateTime ?? e.end?.date,
    local: e.location ?? undefined,
  }));
}
