import {
  callOpenAiChat,
  getAnalysisLlmConfig,
} from '../ai/openai-compatible';
import type { SheetDigest } from '../ai/sheet-digest.types';

export const WIDGET_TYPES = [
  'bar',
  'horizontalBar',
  'line',
  'pie',
  'combo',
  'wordcloud',
  'metric',
  'table',
  'text',
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

export type DashboardWidgetCatalogItem = {
  id: string;
  type: string;
  title: string;
  sheetId: string | null;
  config: Record<string, unknown>;
  layout: Record<string, unknown>;
  order: number;
};

export type DashboardAiAction =
  | {
      op: 'add_widget';
      type: WidgetType;
      title: string;
      sheetId?: string;
      config?: Record<string, unknown>;
      layout?: { w?: number; h?: number };
    }
  | {
      op: 'update_widget';
      widgetId: string;
      title?: string;
      type?: WidgetType;
      sheetId?: string;
      config?: Record<string, unknown>;
      layout?: { w?: number; h?: number };
      order?: number;
    }
  | {
      op: 'delete_widget';
      widgetId: string;
    };

export type DashboardActionResult = {
  op: DashboardAiAction['op'];
  widgetId?: string;
  ok: boolean;
  detail?: string;
};

export type ChatDashboardAiInput = {
  baseName: string;
  digests: SheetDigest[];
  widgets: DashboardWidgetCatalogItem[];
  conversation: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  userText: string;
};

export type ChatDashboardAiOutput = {
  reply: string;
  actions: DashboardAiAction[];
};

const ACTIONS_START = '<<<DASHBOARD_ACTIONS>>>';
const ACTIONS_END = '<<<END_ACTIONS>>>';

export function hasExplicitDeleteIntent(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  return /删除|移除|删掉|去掉|清掉|delete|remove/i.test(t);
}

export function parseDashboardActions(raw: string): {
  reply: string;
  actions: unknown[];
} {
  const start = raw.indexOf(ACTIONS_START);
  const end = raw.indexOf(ACTIONS_END);
  if (start >= 0 && end > start) {
    const reply = raw.slice(0, start).trim();
    const jsonText = raw.slice(start + ACTIONS_START.length, end).trim();
    let actions: unknown[] = [];
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      if (Array.isArray(parsed)) actions = parsed;
    } catch {
      actions = [];
    }
    return {
      reply: reply || '已根据你的要求更新仪表盘。',
      actions,
    };
  }
  return { reply: raw.trim(), actions: [] };
}

export function validateDashboardActions(
  rawActions: unknown[],
  ctx: {
    digests: SheetDigest[];
    widgets: DashboardWidgetCatalogItem[];
    userText: string;
  },
): { actions: DashboardAiAction[]; errors: string[] } {
  const errors: string[] = [];
  const actions: DashboardAiAction[] = [];
  const sheetIds = new Set(ctx.digests.map((d) => d.sheetId));
  const fieldIdsBySheet = new Map<string, Set<string>>();
  for (const d of ctx.digests) {
    fieldIdsBySheet.set(d.sheetId, new Set(d.fields.map((f) => f.id)));
  }
  const widgetIds = new Set(ctx.widgets.map((w) => w.id));
  const allowDelete = hasExplicitDeleteIntent(ctx.userText);

  for (const item of rawActions) {
    if (!item || typeof item !== 'object') {
      errors.push('动作格式无效');
      continue;
    }
    const op = (item as { op?: unknown }).op;
    if (op === 'add_widget') {
      const a = item as Record<string, unknown>;
      const type = String(a.type ?? '');
      if (!(WIDGET_TYPES as readonly string[]).includes(type)) {
        errors.push(`不支持的图表类型：${type}`);
        continue;
      }
      const title =
        typeof a.title === 'string' && a.title.trim()
          ? a.title.trim()
          : '未命名图表';
      const sheetId =
        typeof a.sheetId === 'string' && a.sheetId ? a.sheetId : undefined;
      if (type !== 'text' && !sheetId) {
        errors.push('添加图表需要 sheetId');
        continue;
      }
      if (sheetId && !sheetIds.has(sheetId)) {
        errors.push('工作表不可读或不存在');
        continue;
      }
      const config =
        a.config && typeof a.config === 'object' && !Array.isArray(a.config)
          ? (a.config as Record<string, unknown>)
          : {};
      const fieldErr = validateConfigFields(config, sheetId, fieldIdsBySheet);
      if (fieldErr) {
        errors.push(fieldErr);
        continue;
      }
      actions.push({
        op: 'add_widget',
        type: type as WidgetType,
        title,
        sheetId,
        config,
        layout: normalizeLayout(a.layout),
      });
      continue;
    }
    if (op === 'update_widget') {
      const a = item as Record<string, unknown>;
      const widgetId = typeof a.widgetId === 'string' ? a.widgetId : '';
      if (!widgetId || !widgetIds.has(widgetId)) {
        errors.push('要更新的图表不存在');
        continue;
      }
      const patch: DashboardAiAction = {
        op: 'update_widget',
        widgetId,
      };
      if (typeof a.title === 'string' && a.title.trim()) {
        patch.title = a.title.trim();
      }
      if (a.type !== undefined) {
        const type = String(a.type);
        if (!(WIDGET_TYPES as readonly string[]).includes(type)) {
          errors.push(`不支持的图表类型：${type}`);
          continue;
        }
        patch.type = type as WidgetType;
      }
      if (typeof a.sheetId === 'string' && a.sheetId) {
        if (!sheetIds.has(a.sheetId)) {
          errors.push('工作表不可读或不存在');
          continue;
        }
        patch.sheetId = a.sheetId;
      }
      if (a.config && typeof a.config === 'object' && !Array.isArray(a.config)) {
        const config = a.config as Record<string, unknown>;
        const existing = ctx.widgets.find((w) => w.id === widgetId);
        const sheetId =
          patch.sheetId ??
          (typeof existing?.sheetId === 'string' ? existing.sheetId : undefined);
        const fieldErr = validateConfigFields(config, sheetId, fieldIdsBySheet);
        if (fieldErr) {
          errors.push(fieldErr);
          continue;
        }
        patch.config = config;
      }
      if (a.layout !== undefined) {
        patch.layout = normalizeLayout(a.layout);
      }
      if (typeof a.order === 'number' && Number.isFinite(a.order)) {
        patch.order = Math.max(0, Math.floor(a.order));
      }
      actions.push(patch);
      continue;
    }
    if (op === 'delete_widget') {
      const a = item as Record<string, unknown>;
      const widgetId = typeof a.widgetId === 'string' ? a.widgetId : '';
      if (!widgetId || !widgetIds.has(widgetId)) {
        errors.push('要删除的图表不存在');
        continue;
      }
      if (!allowDelete) {
        errors.push('删除需明确确认（请在消息中说明删除意图）');
        continue;
      }
      actions.push({ op: 'delete_widget', widgetId });
      continue;
    }
    errors.push(`未知动作：${String(op)}`);
  }

  return { actions, errors };
}

function validateConfigFields(
  config: Record<string, unknown>,
  sheetId: string | undefined,
  fieldIdsBySheet: Map<string, Set<string>>,
): string | null {
  if (!sheetId) return null;
  const allowed = fieldIdsBySheet.get(sheetId);
  if (!allowed) return '工作表字段不可用';
  for (const key of ['dimensionFieldId', 'metricFieldId'] as const) {
    const id = config[key];
    if (id === undefined || id === null || id === '') continue;
    if (typeof id !== 'string' || !allowed.has(id)) {
      return `字段 ${key} 无效`;
    }
  }
  return null;
}

function normalizeLayout(raw: unknown): { w?: number; h?: number } | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const layout: { w?: number; h?: number } = {};
  if (typeof o.w === 'number' && Number.isFinite(o.w)) {
    layout.w = Math.min(12, Math.max(3, Math.round(o.w)));
  }
  if (typeof o.h === 'number' && Number.isFinite(o.h)) {
    layout.h = Math.min(6, Math.max(2, Math.round(o.h)));
  }
  return Object.keys(layout).length ? layout : undefined;
}

/** LLM 或本地兜底：生成回复与原始动作列表。 */
export async function chatDashboardAgentReply(
  input: ChatDashboardAiInput,
): Promise<ChatDashboardAiOutput> {
  const llm = getAnalysisLlmConfig();
  const digestSummary = input.digests
    .map(
      (d) =>
        `「${d.sheetName}」${d.recordCount} 行 / ${d.fieldCount} 字段`,
    )
    .join('；');

  if (llm) {
    try {
      const system = [
        '你是智能表格仪表盘 AI 助手，用中文与用户对话。',
        '你可以解读数据摘要，并直接增删改仪表盘图表。',
        '不要编造摘要中不存在的数字或字段 id。',
        digestSummary
          ? `可读工作表：${digestSummary}。`
          : '当前没有可读的工作表。',
        '当前图表目录与字段 id 见用户上下文 JSON。',
        '若需要改画布，在回复末尾追加：',
        ACTIONS_START,
        'JSON 数组，元素 op 为 add_widget | update_widget | delete_widget。',
        'add_widget 需 type/title；非 text 需 sheetId；config 可用 dimensionFieldId/metricFieldId/aggregation；layout 为 {w,h}（12 列栅格）。',
        'delete_widget 仅在用户明确要求删除时输出。',
        ACTIONS_END,
      ].join('\n');
      const contextUser = [
        `仪表盘上下文：`,
        '```json',
        JSON.stringify(
          {
            baseName: input.baseName,
            digests: input.digests,
            widgets: input.widgets,
          },
          null,
          2,
        ),
        '```',
      ].join('\n');
      const messages = [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: contextUser },
        ...input.conversation
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-16)
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
      ];
      const remote = await callOpenAiChat(
        llm.baseUrl,
        llm.apiKey,
        messages,
        0.3,
      );
      const parsed = parseDashboardActions(remote);
      return {
        reply:
          parsed.reply ||
          remote.trim() ||
          '我在，可以说「加一张柱状图」或问数据概况。',
        actions: parsed.actions as DashboardAiAction[],
      };
    } catch {
      /* fall through */
    }
  }

  return localDashboardAgentReply(input);
}

export function localDashboardAgentReply(
  input: ChatDashboardAiInput,
): ChatDashboardAiOutput {
  const text = input.userText.trim();
  const digestSummary = input.digests
    .map((d) => `「${d.sheetName}」${d.recordCount} 行`)
    .join('；');

  if (!input.digests.length && !input.widgets.length) {
    return {
      reply: '当前没有可读工作表，也没有图表。先准备数据后再让我帮你搭仪表盘。',
      actions: [],
    };
  }

  if (/删除|移除|删掉|去掉/i.test(text) && input.widgets.length) {
    const byTitle = input.widgets.find((w) =>
      text.includes(w.title),
    );
    const target = byTitle ?? (/最后|最新|刚才/.test(text)
      ? input.widgets[input.widgets.length - 1]
      : input.widgets.length === 1
        ? input.widgets[0]
        : null);
    if (target) {
      return {
        reply: `好的，已删除图表「${target.title}」。`,
        actions: [{ op: 'delete_widget', widgetId: target.id }],
      };
    }
    return {
      reply: `当前有 ${input.widgets.length} 张图：${input.widgets
        .map((w) => w.title)
        .join('、')}。请说明要删除哪一张（可直接写标题）。`,
      actions: [],
    };
  }

  if (/改|调整|放大|缩小|加宽|布局|尺寸|宽|高/.test(text) && input.widgets.length) {
    const target =
      input.widgets.find((w) => text.includes(w.title)) ??
      input.widgets[input.widgets.length - 1];
    let w = 6;
    let h = 3;
    if (/放大|加宽|大/.test(text)) {
      w = 8;
      h = 4;
    } else if (/缩小|小/.test(text)) {
      w = 4;
      h = 2;
    }
    return {
      reply: `已调整「${target.title}」尺寸为 ${w}×${h}。`,
      actions: [
        {
          op: 'update_widget',
          widgetId: target.id,
          layout: { w, h },
        },
      ],
    };
  }

  if (/重命名|改名|标题/.test(text) && input.widgets.length) {
    const match = text.match(/[「「"](.+?)[」」"]/);
    const newTitle = match?.[1]?.trim();
    const target =
      input.widgets.find((w) => text.includes(w.title)) ??
      input.widgets[input.widgets.length - 1];
    if (newTitle) {
      return {
        reply: `已将「${target.title}」重命名为「${newTitle}」。`,
        actions: [
          { op: 'update_widget', widgetId: target.id, title: newTitle },
        ],
      };
    }
  }

  const wantsAdd =
    /添加|加一|新建|创建|放一|来一|柱状|折线|饼图|指标|表格|图表|统计/.test(
      text,
    );
  if (wantsAdd && input.digests.length) {
    const sheet = pickSheet(input.digests, text);
    const type = pickType(text);
    const dim =
      sheet.fields.find((f) =>
        ['text', 'singleSelect', 'multiSelect', 'select'].includes(f.type),
      ) ?? sheet.fields[0];
    const metric =
      sheet.fields.find((f) => f.type === 'number') ??
      sheet.fields.find((f) => f.id !== dim?.id) ??
      dim;
    const title =
      type === 'metric'
        ? `${sheet.sheetName}·指标`
        : dim
          ? `按${dim.name}统计`
          : `${sheet.sheetName}图表`;
    const action: DashboardAiAction =
      type === 'text'
        ? {
            op: 'add_widget',
            type,
            title,
            layout: { w: 6, h: 3 },
            config: { textContent: digestSummary || sheet.sheetName },
          }
        : {
            op: 'add_widget',
            type,
            title,
            sheetId: sheet.sheetId,
            layout: { w: type === 'metric' ? 4 : 6, h: 3 },
            config:
              type === 'metric'
                ? {
                    metricFieldId: metric?.id,
                    aggregation: metric?.type === 'number' ? 'sum' : 'count',
                  }
                : {
                    dimensionFieldId: dim?.id,
                    metricFieldId: metric?.id,
                    aggregation: metric?.type === 'number' ? 'sum' : 'count',
                  },
          };
    return {
      reply: `已添加${typeLabel(type)}「${title}」（基于「${sheet.sheetName}」）。`,
      actions: [action],
    };
  }

  if (/概况|概览|有什么|数据|多少|空值/.test(text) && input.digests.length) {
    const lines = input.digests.map((d) => {
      const sparse = d.fields
        .filter((f) => d.recordCount > 0 && f.empty / d.recordCount >= 0.5)
        .map((f) => f.name);
      return `「${d.sheetName}」${d.recordCount} 行 / ${d.fieldCount} 字段${
        sparse.length ? `；空值偏高：${sparse.join('、')}` : ''
      }`;
    });
    return {
      reply: `数据概况：\n${lines.join('\n')}\n可以说「加一张柱状图」让我直接上图。`,
      actions: [],
    };
  }

  return {
    reply: input.digests.length
      ? `当前可读：${digestSummary}。画布上有 ${input.widgets.length} 张图。可以说「加一张柱状图」「删除某某图」或「放大最后一张」。`
      : `画布上有 ${input.widgets.length} 张图。可以说「删除某某」或调整布局。`,
    actions: [],
  };
}

function pickSheet(digests: SheetDigest[], text: string): SheetDigest {
  const hit = digests.find((d) => text.includes(d.sheetName));
  return hit ?? digests[0];
}

function pickType(text: string): WidgetType {
  if (/折线|趋势|line/i.test(text)) return 'line';
  if (/饼|占比|pie/i.test(text)) return 'pie';
  if (/条形|横条|horizontal/i.test(text)) return 'horizontalBar';
  if (/指标|kpi|metric/i.test(text)) return 'metric';
  if (/表格|明细|table/i.test(text)) return 'table';
  if (/词云|word/i.test(text)) return 'wordcloud';
  if (/组合|combo/i.test(text)) return 'combo';
  if (/文本|说明|text/i.test(text)) return 'text';
  return 'bar';
}

function typeLabel(type: WidgetType): string {
  const map: Record<WidgetType, string> = {
    bar: '柱状图',
    horizontalBar: '条形图',
    line: '折线图',
    pie: '饼图',
    combo: '组合图',
    wordcloud: '词云',
    metric: '指标卡',
    table: '表格',
    text: '文本',
  };
  return map[type] ?? type;
}
