// Resumos de e-mails escritos pelo Claude Code (via MCP) e exibidos no dashboard.
// O dashboard não gera texto com a API do Claude; os resumos ficam só em memória.

const porEmail = new Map<string, { resumo: string; acao: string | null }>();
let doDia: { texto: string; geradoEm: string; emails: number } | null = null;

export function salvarResumosEmails(itens: { id: string; resumo: string; acao?: string | null }[]) {
  for (const it of itens) {
    if (!it?.id || !it.resumo) continue;
    porEmail.set(String(it.id), { resumo: String(it.resumo).slice(0, 1000), acao: it.acao ? String(it.acao).slice(0, 500) : null });
  }
  while (porEmail.size > 300) porEmail.delete(porEmail.keys().next().value!);
  return { ok: true, total: porEmail.size };
}

export const resumoDoEmail = (id: string) => porEmail.get(id) ?? null;

export function salvarResumoDoDia(texto: string, emails = 0) {
  if (!texto?.trim()) throw Object.assign(new Error("Informe o texto do resumo."), { status: 400 });
  doDia = { texto: texto.slice(0, 8000), geradoEm: new Date().toISOString(), emails };
  return { ok: true };
}

export const resumoDoDia = () => doDia;
