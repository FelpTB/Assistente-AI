import { gmail } from "../google.js";
import { config } from "../config.js";

const CATEGORIAS: Record<string, string> = {
  CATEGORY_PERSONAL: "Principal",
  CATEGORY_UPDATES: "Atualizações",
  CATEGORY_FORUMS: "Fóruns",
  CATEGORY_PROMOTIONS: "Promoções",
  CATEGORY_SOCIAL: "Social",
};

/** Meia-noite de hoje no fuso do assistente, em segundos (para a busca after: do Gmail). */
function inicioDeHoje(): number {
  const dia = new Date().toLocaleDateString("sv-SE", { timeZone: config.timezone });
  // America/Sao_Paulo não tem horário de verão desde 2019: UTC-3 fixo.
  return Math.floor(new Date(`${dia}T00:00:00-03:00`).getTime() / 1000);
}

/** Texto puro de uma mensagem (prefere text/plain; senão tira as tags do HTML). */
function corpoTexto(payload: any): string {
  const partes: any[] = [];
  const andar = (p: any) => {
    if (!p) return;
    partes.push(p);
    (p.parts ?? []).forEach(andar);
  };
  andar(payload);
  const dec = (d?: string) => (d ? Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");
  const plain = partes.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain) return dec(plain.body.data);
  const html = partes.find((p) => p.mimeType === "text/html" && p.body?.data);
  return dec(html?.body?.data)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Os `n` e-mails mais recentes da caixa de entrada (fora promoções e social), com o corpo em texto. */
export async function emailsRecentes(n = 5) {
  const list = await gmail.users.messages.list({
    userId: "me",
    q: "in:inbox -category:promotions -category:social",
    maxResults: n,
  });
  const ids = (list.data.messages ?? []).map((m) => m.id!);
  const msgs = await Promise.all(ids.map((id) => gmail.users.messages.get({ userId: "me", id, format: "full" })));
  return msgs.map(({ data }) => {
    const h = Object.fromEntries((data.payload?.headers ?? []).map((x) => [x.name, x.value]));
    const labels = data.labelIds ?? [];
    return {
      id: data.id!,
      de: h.From ?? "",
      assunto: h.Subject ?? "(sem assunto)",
      recebidoEm: new Date(Number(data.internalDate)).toISOString(),
      trecho: data.snippet ?? "",
      corpo: corpoTexto(data.payload).replace(/\s+/g, " ").trim().slice(0, 3000),
      naoLido: labels.includes("UNREAD"),
      importante: labels.includes("IMPORTANT"),
      link: `https://mail.google.com/mail/u/0/#inbox/${data.threadId}`,
    };
  });
}

/** E-mails que chegaram na caixa de entrada hoje, com categoria e marcadores do Gmail. */
export async function emailsDoDia(input: { limite?: number } = {}) {
  const list = await gmail.users.messages.list({
    userId: "me",
    q: `in:inbox after:${inicioDeHoje()}`,
    maxResults: Math.min(input.limite ?? 60, 100),
  });
  const ids = (list.data.messages ?? []).map((m) => m.id!);
  const msgs = await Promise.all(
    ids.map((id) =>
      gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] }),
    ),
  );
  return msgs
    .map(({ data }) => {
      const h = Object.fromEntries((data.payload?.headers ?? []).map((x) => [x.name, x.value]));
      const labels = data.labelIds ?? [];
      const cat = labels.find((l) => l in CATEGORIAS);
      return {
        id: data.id!,
        de: h.From ?? "",
        assunto: h.Subject ?? "(sem assunto)",
        recebidoEm: new Date(Number(data.internalDate)).toISOString(),
        trecho: data.snippet ?? "",
        naoLido: labels.includes("UNREAD"),
        importante: labels.includes("IMPORTANT"),
        categoria: cat ? CATEGORIAS[cat] : "Principal",
        link: `https://mail.google.com/mail/u/0/#inbox/${data.threadId}`,
      };
    })
    .sort((a, b) => b.recebidoEm.localeCompare(a.recebidoEm));
}

/** Somente leitura: busca e-mails para resumos e relatórios. */
export async function buscarEmails(input: { consulta?: string; limite?: number }) {
  const list = await gmail.users.messages.list({
    userId: "me",
    q: input.consulta ?? "is:unread in:inbox -category:promotions -category:social",
    maxResults: Math.min(input.limite ?? 15, 30),
  });
  const ids = (list.data.messages ?? []).map((m) => m.id!);
  const msgs = await Promise.all(
    ids.map((id) =>
      gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      }),
    ),
  );
  return msgs.map(({ data }) => {
    const h = Object.fromEntries((data.payload?.headers ?? []).map((x) => [x.name, x.value]));
    return {
      id: data.id,
      de: h.From,
      assunto: h.Subject,
      data: h.Date,
      trecho: data.snippet,
      naoLido: data.labelIds?.includes("UNREAD") ?? false,
    };
  });
}
