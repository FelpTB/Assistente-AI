import type Anthropic from "@anthropic-ai/sdk";
import { AREAS, PRIORIDADES, STATUS, criarTarefa, listarTarefas, atualizarTarefa } from "./tarefas.js";
import { criarEvento, listarAgenda, removerEvento } from "./agenda.js";
import { lancarGasto, resumoGastos, listarCategorias } from "./gastos.js";
import { buscarEmails } from "./emails.js";

export const tools: Anthropic.Tool[] = [
  {
    name: "criar_tarefa",
    description:
      "Cria uma tarefa no Notion. Se o usuário der um horário ou pedir aviso, use lembrete=true para criar também um evento com notificação no Google Calendar.",
    input_schema: {
      type: "object",
      properties: {
        tarefa: { type: "string", description: "Título curto e acionável" },
        area: { type: "string", enum: [...AREAS] },
        prazo: { type: "string", description: "ISO 8601. Só data (2026-11-03) ou data e hora com fuso (2026-11-03T14:00:00-03:00)" },
        prioridade: { type: "string", enum: [...PRIORIDADES] },
        notas: { type: "string" },
        lembrete: { type: "boolean", description: "Criar aviso no Google Calendar" },
      },
      required: ["tarefa", "area"],
    },
  },
  {
    name: "listar_tarefas",
    description: "Lista tarefas do Notion, por padrão as não concluídas, ordenadas por prazo.",
    input_schema: {
      type: "object",
      properties: {
        area: { type: "string", enum: [...AREAS] },
        status: { type: "string", enum: [...STATUS] },
        incluirConcluidas: { type: "boolean" },
        ate: { type: "string", description: "Somente tarefas com prazo até esta data (ISO)" },
        limite: { type: "number" },
      },
    },
  },
  {
    name: "atualizar_tarefa",
    description: "Atualiza uma tarefa (status, prazo, prioridade, área, notas ou nome). Para concluir, use status='Concluída'.",
    input_schema: {
      type: "object",
      properties: {
        referencia: { type: "string", description: "Código (TAR-12), ID do Notion ou parte do nome" },
        status: { type: "string", enum: [...STATUS] },
        prazo: { type: "string" },
        prioridade: { type: "string", enum: [...PRIORIDADES] },
        area: { type: "string", enum: [...AREAS] },
        notas: { type: "string" },
        novoNome: { type: "string" },
      },
      required: ["referencia"],
    },
  },
  {
    name: "criar_evento",
    description: "Cria um evento no Google Calendar (compromissos, reuniões, aulas, treinos).",
    input_schema: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        inicio: { type: "string", description: "ISO 8601 com fuso, ou só a data para evento de dia inteiro" },
        fim: { type: "string" },
        duracaoMinutos: { type: "number" },
        descricao: { type: "string" },
        local: { type: "string" },
        lembreteMinutos: { type: "number", description: "Minutos antes para notificar (padrão 30)" },
      },
      required: ["titulo", "inicio"],
    },
  },
  {
    name: "listar_agenda",
    description: "Lista os eventos do Google Calendar num intervalo.",
    input_schema: {
      type: "object",
      properties: {
        de: { type: "string", description: "Data/hora inicial ISO" },
        ate: { type: "string", description: "Data/hora final ISO" },
      },
      required: ["de", "ate"],
    },
  },
  {
    name: "remover_evento",
    description: "Remove um evento do Google Calendar pelo ID (obtido em listar_agenda). Confirme com o usuário antes.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "lancar_gasto",
    description:
      "Registra uma entrada ou saída na planilha de gastos. Use uma categoria de listar_categorias. Contas recorrentes (aluguel, internet, mensalidade) são 'Fixa'; o resto é 'Variável'.",
    input_schema: {
      type: "object",
      properties: {
        data: { type: "string", description: "yyyy-mm-dd (padrão: hoje)" },
        descricao: { type: "string" },
        tipo: { type: "string", enum: ["Entrada", "Saída"] },
        natureza: { type: "string", enum: ["Fixa", "Variável"] },
        categoria: { type: "string" },
        valor: { type: "number", description: "Valor positivo em reais" },
        formaPagamento: { type: "string", description: "Pix, Cartão de crédito, Débito, Dinheiro, Boleto..." },
      },
      required: ["data", "descricao", "tipo", "natureza", "categoria", "valor"],
    },
  },
  {
    name: "listar_categorias",
    description: "Lista as categorias de gastos disponíveis na planilha.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "resumo_gastos",
    description: "Resumo financeiro de um mês: entradas, saídas, saldo, por categoria e despesas fixas cadastradas.",
    input_schema: {
      type: "object",
      properties: { mes: { type: "string", description: "aaaa-mm (padrão: mês atual)" } },
    },
  },
  {
    name: "buscar_emails",
    description:
      "Busca e-mails no Gmail (somente leitura). Aceita a sintaxe de busca do Gmail, ex.: 'is:unread newer_than:1d', 'from:fulano'.",
    input_schema: {
      type: "object",
      properties: { consulta: { type: "string" }, limite: { type: "number" } },
    },
  },
];

const handlers: Record<string, (input: any) => Promise<unknown>> = {
  criar_tarefa: criarTarefa,
  listar_tarefas: listarTarefas,
  atualizar_tarefa: atualizarTarefa,
  criar_evento: criarEvento,
  listar_agenda: listarAgenda,
  remover_evento: (i) => removerEvento(i.id),
  lancar_gasto: lancarGasto,
  listar_categorias: listarCategorias,
  resumo_gastos: resumoGastos,
  buscar_emails: buscarEmails,
};

export async function runTool(name: string, input: unknown): Promise<{ content: string; isError: boolean }> {
  const fn = handlers[name];
  if (!fn) return { content: `Ferramenta desconhecida: ${name}`, isError: true };
  try {
    const out = await fn(input);
    return { content: JSON.stringify(out), isError: false };
  } catch (err: any) {
    console.error(`[tool ${name}]`, err?.message ?? err);
    return { content: `Erro: ${err?.message ?? String(err)}`, isError: true };
  }
}
