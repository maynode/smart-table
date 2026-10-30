import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isPublishableGridContract,
  parseGridContract,
  type AiComponentAttachment,
  type AiComponentChatMessage,
  type AiComponentGridContract,
  type AiComponentOptions,
} from 'shared';
import {
  callOpenAiChat,
  getAnalysisLlmConfig,
  type ChatContentPart,
  type ChatMessage,
} from '../ai/openai-compatible';
import { PrismaService } from '../prisma/prisma.service';
import { SheetsService } from '../sheets/sheets.service';
import { StorageService } from '../storage/storage.service';

const MAX_ATTACHMENTS_PER_MESSAGE = 12;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const IMAGE_MIME = /^(image\/(png|jpe?g|webp|gif|svg\+xml))$/i;

@Injectable()
export class AiComponentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheets: SheetsService,
    private readonly storage: StorageService,
  ) {}

  async getSession(fieldId: string, userId: string) {
    const field = await this.requireFieldEditor(fieldId, userId);
    const opts = this.readOptions(field.options);
    return {
      fieldId,
      status: opts.status ?? 'draft',
      version: opts.version ?? 0,
      messages: opts.messages ?? [],
      gridContract: opts.gridContract ?? null,
      bundle: opts.bundle ?? null,
      bridgeManifest: opts.bridgeManifest ?? null,
      valueSchema: opts.valueSchema ?? null,
      hasBundle: Boolean(opts.bundle?.html || opts.bundleUrl),
      llmConfigured: Boolean(getAnalysisLlmConfig()),
    };
  }

  async uploadAttachment(
    fieldId: string,
    userId: string,
    buffer: Buffer,
    mimetype: string,
    originalName: string,
  ) {
    await this.requireFieldEditor(fieldId, userId);
    if (!buffer?.length) throw new BadRequestException('空文件');
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('文件过大（上限 12MB）');
    }
    const saved = await this.storage.saveUpload(
      buffer,
      mimetype || 'application/octet-stream',
      originalName || 'file',
    );
    return {
      url: saved.url,
      name: saved.name,
      mimetype: saved.mimetype,
      size: saved.size,
    } satisfies AiComponentAttachment;
  }

  async chat(
    fieldId: string,
    userId: string,
    textRaw: string,
    attachmentsRaw?: AiComponentAttachment[],
  ) {
    const field = await this.requireFieldEditor(fieldId, userId);
    const text = (textRaw ?? '').trim();
    const attachments = this.normalizeAttachments(attachmentsRaw);
    if (!text && attachments.length === 0) {
      throw new BadRequestException('请输入描述或上传附件');
    }

    const opts = this.readOptions(field.options);
    const userTurn: AiComponentChatMessage = {
      role: 'user',
      content: text || (attachments.length ? '（见附件）' : ''),
      ...(attachments.length ? { attachments } : {}),
    };
    const messages: AiComponentChatMessage[] = [
      ...(opts.messages ?? []),
      userTurn,
    ];

    const sheetFields = await this.prisma.field.findMany({
      where: { sheetId: field.sheetId },
      select: { id: true, name: true, type: true },
      orderBy: { order: 'asc' },
    });
    const catalog = sheetFields
      .map((f) => `- ${f.name} (${f.type}, id=${f.id})`)
      .join('\n');

    let assistant: string;
    const llm = getAnalysisLlmConfig();
    if (llm) {
      try {
        const llmMessages: ChatMessage[] = [
          {
            role: 'system',
            content: `你是智能表格「智能组件」设计师。用户要为字段生成可交互 HTML/JS 单元格组件（iframe 沙箱）。
表字段目录：
${catalog}
当前字段：${field.name} (${field.id})
用户可能附带截图/设计稿/文件，请结合附件理解需求。
用中文回复：1) 是否可行 2) 交互与值结构 3) 筛选/排序/导出怎么定 4) 还缺什么信息。不要输出大段代码；生成阶段再写代码。`,
          },
          ...(await this.toLlmMessages(messages)),
        ];
        assistant = await callOpenAiChat(
          llm.baseUrl,
          llm.apiKey,
          llmMessages,
          0.4,
          llm.model,
        );
        if (!assistant.trim()) {
          assistant = this.localAssistant(text, attachments);
        }
      } catch (error) {
        assistant = `${this.localAssistant(text, attachments)}\n\n（模型调用失败：${
          error instanceof Error ? error.message : String(error)
        }；仍可继续对话或点生成。）`;
      }
    } else {
      assistant = this.localAssistant(text, attachments);
    }

    messages.push({ role: 'assistant', content: assistant });
    const next: AiComponentOptions = {
      ...opts,
      status: opts.status === 'published' ? 'published' : 'draft',
      messages: messages.slice(-60),
    };
    await this.writeOptions(field.id, next);
    return {
      reply: assistant,
      messages,
      llmConfigured: Boolean(llm),
      canGenerate: true,
    };
  }

  async generate(fieldId: string, userId: string) {
    const field = await this.requireFieldEditor(fieldId, userId);
    const opts = this.readOptions(field.options);
    const messages = opts.messages ?? [];
    if (messages.length === 0) {
      throw new BadRequestException('请先对话描述需求（可附带图片/文件）');
    }

    const sheetFields = await this.prisma.field.findMany({
      where: { sheetId: field.sheetId },
      select: { id: true, name: true, type: true },
      orderBy: { order: 'asc' },
    });
    const catalog = sheetFields
      .map((f) => `- ${f.name} (${f.type}, id=${f.id})`)
      .join('\n');

    let produced = await this.generateViaLlm(messages, catalog, field);
    if (!produced) {
      const lastUser =
        [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      produced = this.produceBundleFallback(lastUser);
    }

    this.assertSafeBundle(produced.bundle);

    const next: AiComponentOptions = {
      ...opts,
      status: 'draft',
      bundle: produced.bundle,
      bridgeManifest: produced.bridgeManifest,
      gridContract: produced.gridContract,
      valueSchema: produced.valueSchema,
    };
    await this.writeOptions(field.id, next);
    return {
      status: 'draft' as const,
      gridContract: produced.gridContract,
      previewHint: produced.hint,
      bundleBytes: JSON.stringify(produced.bundle).length,
      bundle: produced.bundle,
      bridgeManifest: next.bridgeManifest,
      valueSchema: produced.valueSchema,
      source: produced.source,
    };
  }

  async publish(fieldId: string, userId: string) {
    const field = await this.requireFieldEditor(fieldId, userId);
    const opts = this.readOptions(field.options);
    if (!opts.bundle?.html) {
      throw new BadRequestException('请先生成组件');
    }
    if (!isPublishableGridContract(opts.gridContract)) {
      throw new BadRequestException(
        '缺少完整 gridContract（排序/筛选/导出），无法发布',
      );
    }
    this.assertSafeBundle(opts.bundle);
    const next: AiComponentOptions = {
      ...opts,
      status: 'published',
      version: (opts.version ?? 0) + 1,
      gridContract: parseGridContract(opts.gridContract)!,
    };
    await this.writeOptions(field.id, next);
    return {
      status: 'published' as const,
      version: next.version,
      gridContract: next.gridContract,
      bundle: next.bundle,
      bridgeManifest: next.bridgeManifest,
    };
  }

  private async generateViaLlm(
    messages: AiComponentChatMessage[],
    catalog: string,
    field: { id: string; name: string },
  ): Promise<{
    bundle: { html: string; css: string; js: string };
    gridContract: AiComponentGridContract;
    valueSchema: Record<string, unknown>;
    bridgeManifest: AiComponentOptions['bridgeManifest'];
    hint: string;
    source: 'llm' | 'fallback';
  } | null> {
    const llm = getAnalysisLlmConfig();
    if (!llm) return null;

    const system = `你是智能表格「智能组件」代码生成器。根据完整多轮对话与附件，输出一个可在 iframe 沙箱运行的组件。
表字段目录：
${catalog}
当前字段：${field.name} (${field.id})

宿主会把该组件 iframe 叠在表格单元格上（约 180×88 起，可竖向滚动），不是居中弹窗。请生成紧凑、适合格内操作的 UI（控件、间距、字号都按单元格密度设计）。

必须只输出一个 JSON 对象（不要 markdown 围栏），字段：
{
  "html": "字符串",
  "css": "字符串",
  "js": "字符串，可用 window.smartTable.setCell/getCell，监听 smartTable:cell",
  "gridContract": {
    "sortKey": { "path": "string", "type": "number"|"string"|"boolean" },
    "filter": { "path": "string", "ops": ["eq","gte",...], "valueType": "number"|"string"|"boolean" },
    "exportDisplay": { "template": "含 {{path}} 的模板" }
  },
  "valueSchema": { "type": "object", "properties": {} },
  "bridgeManifest": { "cell": true, "rowFields": "*", "automations": "*", "network": false },
  "hint": "短中文名称"
}
禁止：访问 parent/top/opener、document.cookie、未授权 fetch/XHR/WebSocket（network 为 false 时）。
单元格值用对象，例如 { "rating": 4 }。`;

    try {
      const raw = await callOpenAiChat(
        llm.baseUrl,
        llm.apiKey,
        [
          { role: 'system', content: system },
          ...(await this.toLlmMessages(messages)),
          {
            role: 'user',
            content:
              '请根据以上全部对话与附件，现在生成完整 JSON 组件包（含 gridContract）。',
          },
        ],
        0.2,
        llm.model,
      );
      const parsed = this.parseGeneratedJson(raw);
      if (!parsed) return null;
      const contract = parseGridContract(parsed.gridContract);
      if (!contract) return null;
      const html = String(parsed.html ?? '');
      const css = String(parsed.css ?? '');
      const js = String(parsed.js ?? '');
      if (!html.trim()) return null;
      return {
        source: 'llm',
        hint: String(parsed.hint ?? '智能组件'),
        bundle: { html, css, js },
        gridContract: contract,
        valueSchema:
          parsed.valueSchema && typeof parsed.valueSchema === 'object'
            ? (parsed.valueSchema as Record<string, unknown>)
            : { type: 'object' },
        bridgeManifest: {
          cell: true,
          rowFields: '*',
          automations: '*',
          network: false,
          ...(parsed.bridgeManifest &&
          typeof parsed.bridgeManifest === 'object'
            ? (parsed.bridgeManifest as object)
            : {}),
        },
      };
    } catch {
      return null;
    }
  }

  private parseGeneratedJson(raw: string): Record<string, unknown> | null {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = (fenced?.[1] ?? trimmed).trim();
    try {
      const value = JSON.parse(body) as unknown;
      if (!value || typeof value !== 'object') return null;
      return value as Record<string, unknown>;
    } catch {
      const start = body.indexOf('{');
      const end = body.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      try {
        return JSON.parse(body.slice(start, end + 1)) as Record<
          string,
          unknown
        >;
      } catch {
        return null;
      }
    }
  }

  private assertSafeBundle(bundle: {
    html?: string;
    css?: string;
    js?: string;
  }): void {
    const blob = `${bundle.html ?? ''}\n${bundle.js ?? ''}`;
    const banned = [
      /\bparent\./i,
      /\btop\./i,
      /\bopener\./i,
      /document\.cookie/i,
      /window\.open\s*\(/i,
    ];
    for (const re of banned) {
      if (re.test(blob)) {
        throw new BadRequestException(`组件代码包含禁止模式：${re}`);
      }
    }
  }

  private async toLlmMessages(
    messages: AiComponentChatMessage[],
  ): Promise<ChatMessage[]> {
    const out: ChatMessage[] = [];
    for (const turn of messages) {
      if (turn.role === 'system') {
        out.push({ role: 'system', content: turn.content });
        continue;
      }
      if (turn.role === 'assistant') {
        out.push({ role: 'assistant', content: turn.content });
        continue;
      }
      const attachments = turn.attachments ?? [];
      if (attachments.length === 0) {
        out.push({ role: 'user', content: turn.content });
        continue;
      }
      const parts: ChatContentPart[] = [];
      const fileNotes: string[] = [];
      for (const file of attachments) {
        if (IMAGE_MIME.test(file.mimetype)) {
          try {
            const dataUrl = await this.toDataUrl(file.url, file.mimetype);
            parts.push({
              type: 'image_url',
              image_url: { url: dataUrl, detail: 'high' },
            });
          } catch {
            fileNotes.push(`[图片加载失败: ${file.name}]`);
          }
        } else {
          fileNotes.push(
            `[附件: ${file.name} (${file.mimetype}, ${file.size} bytes) url=${file.url}]`,
          );
        }
      }
      const text = [turn.content, ...fileNotes].filter(Boolean).join('\n');
      if (text) parts.unshift({ type: 'text', text });
      out.push({
        role: 'user',
        content: parts.length ? parts : turn.content,
      });
    }
    return out;
  }

  private async toDataUrl(url: string, mimetype: string): Promise<string> {
    const { buffer, mimetype: mime } = await this.storage.readUploadBuffer(url);
    const type = mimetype || mime || 'application/octet-stream';
    return `data:${type};base64,${buffer.toString('base64')}`;
  }

  private normalizeAttachments(
    raw?: AiComponentAttachment[],
  ): AiComponentAttachment[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (item) =>
          item &&
          typeof item.url === 'string' &&
          item.url.startsWith('/files/uploads/') &&
          typeof item.name === 'string' &&
          typeof item.mimetype === 'string' &&
          typeof item.size === 'number',
      )
      .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
      .map((item) => ({
        url: item.url,
        name: item.name.slice(0, 200),
        mimetype: item.mimetype.slice(0, 120),
        size: item.size,
      }));
  }

  private localAssistant(
    text: string,
    attachments: AiComponentAttachment[],
  ): string {
    const attachHint = attachments.length
      ? `已收到 ${attachments.length} 个附件（${attachments.map((a) => a.name).join('、')}）。`
      : '';
    if (/评分|五星|星星|star|rating/i.test(text)) {
      return [
        attachHint,
        '可行。建议五星评分，单元格存 `{ "rating": 1-5 }`。',
        '筛选/排序按 rating；导出「N 星」。可点「生成组件」。',
      ]
        .filter(Boolean)
        .join('\n');
    }
    if (/开关|toggle|是否|checkbox/i.test(text)) {
      return [
        attachHint,
        '可行。建议开关，存 `{ "on": true/false }`。可点「生成组件」。',
      ]
        .filter(Boolean)
        .join('\n');
    }
    return [
      attachHint || null,
      '已记录本轮需求。可继续补充交互细节，或直接点「生成组件」。',
      '已配置 ANALYSIS_LLM 时，生成会按完整多轮对话与附件交给模型产出代码。',
      text ? `你说的是：${text.slice(0, 200)}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private produceBundleFallback(userText: string): {
    bundle: { html: string; css: string; js: string };
    gridContract: AiComponentGridContract;
    valueSchema: Record<string, unknown>;
    bridgeManifest: AiComponentOptions['bridgeManifest'];
    hint: string;
    source: 'fallback';
  } {
    if (/开关|toggle|是否/i.test(userText) && !/评分|五星|星/i.test(userText)) {
      return {
        source: 'fallback',
        hint: '开关',
        valueSchema: {
          type: 'object',
          properties: { on: { type: 'boolean' } },
        },
        bridgeManifest: {
          cell: true,
          rowFields: '*',
          automations: '*',
          network: false,
        },
        gridContract: {
          sortKey: { path: 'on', type: 'boolean' },
          filter: { path: 'on', ops: ['eq'], valueType: 'boolean' },
          exportDisplay: { template: '{{on}}' },
        },
        bundle: {
          html: `<button id="btn" type="button">关</button>`,
          css: `button{font:14px sans-serif;padding:8px 16px;border-radius:8px;border:1px solid #ccc;cursor:pointer}.on{background:#1677ff;color:#fff;border-color:#1677ff}`,
          js: `
(function(){
  var on=false, btn=document.getElementById('btn');
  function render(){ btn.textContent=on?'开':'关'; btn.className=on?'on':''; }
  btn.onclick=function(){ on=!on; render(); window.smartTable.setCell({ on: on }); };
  window.addEventListener('smartTable:cell', function(ev){
    var v=ev.detail; on=Boolean(v && v.on); render();
  });
  render();
})();`,
        },
      };
    }

    return {
      source: 'fallback',
      hint: '五星评分',
      valueSchema: {
        type: 'object',
        properties: { rating: { type: 'number' } },
      },
      bridgeManifest: {
        cell: true,
        rowFields: '*',
        automations: '*',
        network: false,
      },
      gridContract: {
        sortKey: { path: 'rating', type: 'number' },
        filter: {
          path: 'rating',
          ops: ['eq', 'gte', 'lte', 'gt', 'lt'],
          valueType: 'number',
        },
        exportDisplay: { template: '{{rating}} 星' },
      },
        bundle: {
          html: `<div id="root"></div>`,
          css: `html,body{margin:0;height:100%;overflow:hidden}#root{display:flex;align-items:center;height:100%;padding:0 6px;font:13px/1 sans-serif;box-sizing:border-box}.star{cursor:pointer;font-size:18px;margin-right:1px;user-select:none}.on{color:#f5a623}.off{color:#ccc}`,
          js: `
(function(){
  var root=document.getElementById('root'), rating=0;
  function render(){
    root.innerHTML='';
    for(var i=1;i<=5;i++){
      var s=document.createElement('span');
      s.className='star '+(i<=rating?'on':'off');
      s.textContent='★';
      s.dataset.n=String(i);
      s.onclick=function(ev){
        rating=Number(ev.currentTarget.dataset.n);
        render();
        window.smartTable.setCell({ rating: rating });
      };
      root.appendChild(s);
    }
  }
  window.addEventListener('smartTable:cell', function(ev){
    var v=ev.detail;
    rating=v && typeof v.rating==='number'?v.rating:0;
    render();
  });
  render();
})();`,
        },
    };
  }

  private readOptions(raw: unknown): AiComponentOptions {
    const opts =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const ai = opts.aiComponent;
    if (ai && typeof ai === 'object') return ai as AiComponentOptions;
    return { status: 'draft' };
  }

  private async writeOptions(
    fieldId: string,
    aiComponent: AiComponentOptions,
  ): Promise<void> {
    const field = await this.prisma.field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { options: true },
    });
    const prev =
      field.options && typeof field.options === 'object'
        ? (field.options as Record<string, unknown>)
        : {};
    await this.prisma.field.update({
      where: { id: fieldId },
      data: {
        options: { ...prev, aiComponent } as object,
      },
    });
  }

  private async requireFieldEditor(fieldId: string, userId: string) {
    const field = await this.prisma.field.findUnique({
      where: { id: fieldId },
      include: { sheet: { select: { id: true, baseId: true } } },
    });
    if (!field) throw new NotFoundException('字段不存在');
    if (field.type !== 'aiComponent') {
      throw new BadRequestException('仅智能组件字段可用');
    }
    await this.sheets.assertSheetAccess(field.sheetId, userId, 'editor');
    return field;
  }
}
