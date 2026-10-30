import { gmail } from "../google.js";

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
