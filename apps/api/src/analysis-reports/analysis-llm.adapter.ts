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
      const remote = await callOpenAiCompatible(baseUrl, apiKey, input);
      if (remote.trim()) return remote.trim();
    } catch {
      /* fall through to local */
    }
  }
  return buildLocalReport(input);
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  input: GenerateReportInput,
): Promise<string> {
  const model = process.env.ANALYSIS_LLM_MODEL?.trim() || 'gpt-4o-mini';
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const system = [
    '你是智能表格分析助手。根据用户对话与表格数据摘要，输出一份中文 Markdown 分析报告。',
    '结构建议：# 标题、## 数据概览、## 关键发现、## 字段口径、## 建议。不要编造摘要中不存在的数字。',
  ].join('');
  const userPayload = JSON.stringify(
    {
      baseName: input.baseName,
      digests: input.digests,
      conversation: input.conversation.slice(-12),
    },
    null,
    2,
  );
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `请基于以下 JSON 生成分析报告：\n\`\`\`json\n${userPayload}\n\`\`\``,
        },
      ],
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
