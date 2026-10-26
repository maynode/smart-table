export interface SheetDigest {
  sheetId: string;
  sheetName: string;
  fieldCount: number;
  recordCount: number;
  fields: Array<{
    name: string;
    type: string;
    nonEmpty: number;
    empty: number;
    topValues: Array<{ value: string; count: number }>;
  }>;
}

export interface GenerateReportInput {
  baseName: string;
  digests: SheetDigest[];
  conversation: Array<{ role: string; content: string }>;
}

export interface ChatAnalysisInput {
  baseName: string;
  digests: SheetDigest[];
  conversation: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

/**
 * OpenAI-compatible chat when ANALYSIS_LLM_BASE_URL + KEY set;
 * otherwise local markdown from digests.
 */
export async function generateAnalysisMarkdown(
  input: GenerateReportInput,
): Promise<string> {
  const baseUrl = process.env.ANALYSIS_LLM_BASE_URL?.trim();
  const apiKey = process.env.ANALYSIS_LLM_API_KEY?.trim();
  if (baseUrl && apiKey) {
    try {
      const remote = await callOpenAiCompatible(baseUrl, apiKey, {
        system: [
          '你是智能表格分析助手。根据用户对话与表格数据摘要，输出一份中文 Markdown 分析报告。',
          '结构建议：# 标题、## 数据概览、## 关键发现、## 字段口径、## 建议。不要编造摘要中不存在的数字。',
        ].join(''),
        userContent: `请基于以下 JSON 生成分析报告：\n\`\`\`json\n${JSON.stringify(
          {
            baseName: input.baseName,
            digests: input.digests,
            conversation: input.conversation.slice(-12),
          },
          null,
          2,
        )}\n\`\`\``,
        temperature: 0.3,
      });
      if (remote.trim()) return remote.trim();
    } catch {
      /* fall through to local */
    }
  }
  return buildLocalReport(input);
}

/** 自由对话回复（可附带最新报告 Markdown）。 */
export async function chatAnalysisReply(
  input: ChatAnalysisInput,
): Promise<{ reply: string; reportMarkdown: string | null }> {
  const baseUrl = process.env.ANALYSIS_LLM_BASE_URL?.trim();
  const apiKey = process.env.ANALYSIS_LLM_API_KEY?.trim();
  const digestSummary = input.digests
    .map(
      (d) =>
        `「${d.sheetName}」${d.recordCount} 行 / ${d.fieldCount} 字段`,
    )
    .join('；');

  if (baseUrl && apiKey) {
    try {
      const system = [
        '你是智能表格里的分析助手，用中文与用户自然对话。',
        '你可以基于表格数据摘要回答问题、给建议；需要完整报告时输出 Markdown。',
        '不要编造摘要中不存在的数字。语气简洁友好。',
        digestSummary
          ? `当前文档可分析数据：${digestSummary}。`
          : '当前没有可读的工作表数据。',
        '若用户明确要求生成/输出分析报告，请在回复末尾追加：',
        '<<<REPORT_MARKDOWN>>>',
        '然后写完整 Markdown 报告，再写 <<<END_REPORT>>>。',
      ].join('\n');
      const messages = [
        { role: 'system' as const, content: system },
        ...input.conversation
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-16)
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
      ];
      const remote = await callOpenAiChat(baseUrl, apiKey, messages, 0.4);
      const parsed = splitReportBlock(remote);
      return {
        reply: parsed.reply || remote.trim() || '我在，请继续说明你的分析需求。',
        reportMarkdown: parsed.reportMarkdown,
      };
    } catch {
      /* fall through */
    }
  }

  const lastUser =
    [...input.conversation].reverse().find((m) => m.role === 'user')
      ?.content ?? '';
  const wantsReport = /报告|生成|分析|总结|概览|统计/.test(lastUser);
  const reportMarkdown = wantsReport
    ? buildLocalReport({
        baseName: input.baseName,
        digests: input.digests,
        conversation: input.conversation,
      })
    : null;
  const reply = wantsReport
    ? input.digests.length
      ? `已根据当前表格数据整理分析报告，请在左侧查看。覆盖：${digestSummary || '无表'}。有其他问题可以继续问我。`
      : '当前没有可分析的工作表数据，请先在文档中准备表格后再试。'
    : input.digests.length
      ? `当前可读工作表：${digestSummary}。你可以问「数据概况」「哪个字段空值多」或直接说「生成分析报告」。`
      : '当前没有可读的工作表。新建或导入数据后，再来和我聊分析需求。';
  return { reply, reportMarkdown };
}

function splitReportBlock(raw: string): {
  reply: string;
  reportMarkdown: string | null;
} {
  const start = raw.indexOf('<<<REPORT_MARKDOWN>>>');
  const end = raw.indexOf('<<<END_REPORT>>>');
  if (start >= 0 && end > start) {
    const reply = raw.slice(0, start).trim();
    const reportMarkdown = raw
      .slice(start + '<<<REPORT_MARKDOWN>>>'.length, end)
      .trim();
    return { reply: reply || '报告已生成，请在左侧查看。', reportMarkdown };
  }
  return { reply: raw.trim(), reportMarkdown: null };
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  input: { system: string; userContent: string; temperature: number },
): Promise<string> {
  return callOpenAiChat(
    baseUrl,
    apiKey,
    [
      { role: 'system', content: input.system },
      { role: 'user', content: input.userContent },
    ],
    input.temperature,
  );
}

async function callOpenAiChat(
  baseUrl: string,
  apiKey: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  temperature: number,
): Promise<string> {
  const model = process.env.ANALYSIS_LLM_MODEL?.trim() || 'gpt-4o-mini';
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages,
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM HTTP ${response.status}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

function buildLocalReport(input: GenerateReportInput): string {
  const lines: string[] = [];
  lines.push(`# ${input.baseName || '数据'} · 分析报告`);
  lines.push('');
  lines.push(`> 由分析助手根据表格数据自动生成（本地摘要模式）。`);
  lines.push('');
  lines.push('## 数据概览');
  lines.push('');
  if (input.digests.length === 0) {
    lines.push('未选择可分析的工作表。');
    return lines.join('\n');
  }
  lines.push('| 工作表 | 字段数 | 记录数 |');
  lines.push('| --- | ---: | ---: |');
  for (const d of input.digests) {
    lines.push(
      `| ${escapeMd(d.sheetName)} | ${d.fieldCount} | ${d.recordCount} |`,
    );
  }
  lines.push('');

  for (const d of input.digests) {
    lines.push(`## ${escapeMd(d.sheetName)}`);
    lines.push('');
    lines.push(
      `共 **${d.recordCount}** 条记录、**${d.fieldCount}** 个字段。`,
    );
    lines.push('');
    lines.push('### 字段与填充情况');
    lines.push('');
    lines.push('| 字段 | 类型 | 非空 | 空值 | 高频值 |');
    lines.push('| --- | --- | ---: | ---: | --- |');
    for (const f of d.fields) {
      const top =
        f.topValues.length > 0
          ? f.topValues
              .slice(0, 3)
              .map((t) => `${escapeMd(t.value)}(${t.count})`)
              .join('、')
          : '—';
      lines.push(
        `| ${escapeMd(f.name)} | ${f.type} | ${f.nonEmpty} | ${f.empty} | ${top} |`,
      );
    }
    lines.push('');

    const sparse = d.fields
      .filter((f) => d.recordCount > 0 && f.empty / d.recordCount >= 0.5)
      .map((f) => f.name);
    lines.push('### 关键发现');
    lines.push('');
    if (sparse.length > 0) {
      lines.push(
        `- 以下字段空值比例较高（≥50%）：${sparse.map(escapeMd).join('、')}。`,
      );
    } else {
      lines.push('- 各字段整体填充较完整，未发现明显大面积空值字段。');
    }
    const rich = d.fields.filter((f) => f.topValues.length >= 2);
    if (rich.length > 0) {
      const sample = rich[0];
      lines.push(
        `- 「${escapeMd(sample.name)}」取值较分散，Top 值：${sample.topValues
          .slice(0, 3)
          .map((t) => escapeMd(t.value))
          .join('、')}。`,
      );
    }
    lines.push('');
  }

  lines.push('## 建议');
  lines.push('');
  lines.push('- 对空值偏高的字段检查收集表单必填或补录流程。');
  lines.push('- 可将高频分类字段用于仪表盘分组统计。');
  lines.push('- 如需更深洞察，可配置 `ANALYSIS_LLM_BASE_URL` 启用大模型生成。');
  lines.push('');
  return lines.join('\n');
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
