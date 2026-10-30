import notionPkg from "@notionhq/client";
const { Client } = notionPkg;
import { config } from "../config.js";
import { criarEvento, removerEvento } from "./agenda.js";

const notion = new Client({ auth: config.notion.token });
const dataSourceId = config.notion.tasksDataSourceId;

export const AREAS = ["Trabalho", "Academia", "Faculdade", "Projetos", "Pessoal"] as const;
export const STATUS = ["A fazer", "Em andamento", "Concluída"] as const;
export const PRIORIDADES = ["Alta", "Média", "Baixa"] as const;

type Tarefa = {
  id: string;
  codigo: string;
  tarefa: string;
  area?: string;
  status?: string;
  prazo?: string;
  prioridade?: string;
  notas?: string;
  url: string;
};

function texto(rich: any[] | undefined): string {
  return (rich ?? []).map((r) => r.plain_text).join("");
}

function parsePage(p: any): Tarefa {
  const pr = p.properties;
  const uid = pr["ID"]?.unique_id;
  return {
    id: p.id,
    codigo: uid ? `${uid.prefix ?? "TAR"}-${uid.number}` : "",
    tarefa: texto(pr["Tarefa"]?.title),
    area: pr["Área"]?.select?.name,
    status: pr["Status"]?.status?.name,
    prazo: pr["Prazo"]?.date?.start,
    prioridade: pr["Prioridade"]?.select?.name,
    notas: texto(pr["Notas"]?.rich_text) || undefined,
    url: p.url,
  };
}

export async function criarTarefa(input: {
  tarefa: string;
  area: string;
  prazo?: string; // ISO: "2026-11-03" ou "2026-11-03T14:00:00-03:00"
  prioridade?: string;
  notas?: string;
  lembrete?: boolean;
  origem?: string;
}) {
  const props: Record<string, any> = {
    Tarefa: { title: [{ text: { content: input.tarefa } }] },
    "Área": { select: { name: input.area } },
    Status: { status: { name: "A fazer" } },
    Origem: { select: { name: input.origem ?? "WhatsApp" } },
    Lembrete: { checkbox: Boolean(input.lembrete && input.prazo) },
  };
  if (input.prazo) props.Prazo = { date: { start: input.prazo } };
  if (input.prioridade) props.Prioridade = { select: { name: input.prioridade } };
  if (input.notas) props.Notas = { rich_text: [{ text: { content: input.notas } }] };

  let eventoId: string | undefined;
  if (input.lembrete && input.prazo) {
    const ev = await criarEvento({
      titulo: `[${input.area}] ${input.tarefa}`,
      inicio: input.prazo,
      descricao: input.notas,
      lembreteMinutos: 30,
    });
    eventoId = ev.id;
    props["ID Evento Calendar"] = { rich_text: [{ text: { content: eventoId } }] };
  }

  const page = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    properties: props,
  } as any);
  return { ...parsePage(page), lembreteCriado: Boolean(eventoId) };
}

export async function listarTarefas(input: {
  area?: string;
  status?: string;
  incluirConcluidas?: boolean;
  ate?: string; // prazo até esta data (ISO)
  limite?: number;
}) {
  const filtros: any[] = [];
  if (input.area) filtros.push({ property: "Área", select: { equals: input.area } });
  if (input.status) filtros.push({ property: "Status", status: { equals: input.status } });
  else if (!input.incluirConcluidas) filtros.push({ property: "Status", status: { does_not_equal: "Concluída" } });
  if (input.ate) filtros.push({ property: "Prazo", date: { on_or_before: input.ate } });

  const res: any = await (notion as any).dataSources.query({
    data_source_id: dataSourceId,
    filter: filtros.length ? { and: filtros } : undefined,
    sorts: [{ property: "Prazo", direction: "ascending" }],
    page_size: Math.min(input.limite ?? 30, 100),
  });
  return res.results.map(parsePage);
}

async function acharTarefa(ref: string): Promise<any> {
  // Aceita o ID do Notion, o código TAR-12 ou parte do nome.
  const m = ref.match(/^TAR-?(\d+)$/i);
  if (m) {
    const r: any = await (notion as any).dataSources.query({
      data_source_id: dataSourceId,
      filter: { property: "ID", unique_id: { equals: Number(m[1]) } },
    });
    if (r.results[0]) return r.results[0];
  }
  if (/^[0-9a-f-]{32,36}$/i.test(ref)) return notion.pages.retrieve({ page_id: ref });
  const r: any = await (notion as any).dataSources.query({
    data_source_id: dataSourceId,
    filter: { property: "Tarefa", title: { contains: ref } },
    page_size: 5,
  });
  if (r.results.length === 1) return r.results[0];
  if (r.results.length > 1)
    throw new Error(`Mais de uma tarefa encontrada para "${ref}": ${r.results.map((p: any) => parsePage(p).codigo + " " + parsePage(p).tarefa).join("; ")}`);
  throw new Error(`Tarefa "${ref}" não encontrada.`);
}

export async function atualizarTarefa(input: {
  referencia: string;
  status?: string;
  prazo?: string;
  prioridade?: string;
  area?: string;
  notas?: string;
  novoNome?: string;
}) {
  const page = await acharTarefa(input.referencia);
  const props: Record<string, any> = {};
  if (input.status) props.Status = { status: { name: input.status } };
  if (input.prazo) props.Prazo = { date: { start: input.prazo } };
  if (input.prioridade) props.Prioridade = { select: { name: input.prioridade } };
  if (input.area) props["Área"] = { select: { name: input.area } };
  if (input.notas) props.Notas = { rich_text: [{ text: { content: input.notas } }] };
  if (input.novoNome) props.Tarefa = { title: [{ text: { content: input.novoNome } }] };

  // Concluída → remove o lembrete do Calendar, se houver.
  if (input.status === "Concluída") {
    const evId = texto(page.properties["ID Evento Calendar"]?.rich_text);
    if (evId) {
      await removerEvento(evId).catch(() => {});
      props["ID Evento Calendar"] = { rich_text: [] };
    }
  }

  const upd = await notion.pages.update({ page_id: page.id, properties: props });
  return parsePage(upd);
}
