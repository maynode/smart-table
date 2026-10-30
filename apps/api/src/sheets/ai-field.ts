type AiFieldOptions = {
  provider?: string;
  model?: string;
  prompt?: string;
  sourceFieldIds?: string[];
};

type FieldOptions = {
  ai?: AiFieldOptions;
  [key: string]: unknown;
};

type FieldRow = {
  id: string;
  name: string;
  type: string;
  options: unknown;
};

/** Duck-typed so both PrismaClient and TransactionClient work. */
type FieldQueryClient = {
  field: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args: any) => Promise<FieldRow[]>;
  };
};

/** Drop client-supplied AI values so only the server fills them. */
export async function stripAiFieldInputs(
  tx: FieldQueryClient,
  sheetId: string,
  cells: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = await tx.field.findMany({
    where: { sheetId, type: 'ai' },
    select: { id: true },
  });
  if (fields.length === 0) return cells;
  const next = { ...cells };
  for (const field of fields) {
    delete next[field.id];
  }
  return next;
}

/**
 * Fills empty (or source-changed) AI cells.
 * Priority: AI_FIELD_URL → ANALYSIS_LLM_* chat → local {{字段名}} template.
 */
export async function applyAiFields(
  tx: FieldQueryClient,
  sheetId: string,
  cells: Record<string, unknown>,
  previousCells?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = await tx.field.findMany({
    where: { sheetId },
    select: { id: true, name: true, type: true, options: true },
  });
  const aiFields = fields.filter((field) => field.type === 'ai');
  if (aiFields.length === 0) return cells;

  const nextCells = { ...cells };
  const nameById = new Map(fields.map((field) => [field.id, field.name]));

  for (const field of aiFields) {
    const options = (field.options ?? {}) as FieldOptions;
    const ai = (options.ai ?? {}) as AiFieldOptions;
    const sourceIds = Array.isArray(ai.sourceFieldIds)
      ? ai.sourceFieldIds.filter((id): id is string => typeof id === 'string')
      : [];

    const existing = nextCells[field.id];
    const hasValue =
      existing !== undefined && existing !== null && existing !== '';
    const sourcesChanged =
      previousCells !== undefined &&
      sourceIds.some(
        (id) => !cellValuesEqual(previousCells[id], nextCells[id]),
      );

    if (hasValue && !sourcesChanged) {
      continue;
    }
    // On update with no previous snapshot, only fill empties.
    if (hasValue && previousCells === undefined) {
      continue;
    }

    const value = await fillAiValue({
      prompt: typeof ai.prompt === 'string' ? ai.prompt : '',
      sourceIds,
      cells: nextCells,
      nameById,
      model: typeof ai.model === 'string' ? ai.model : undefined,
    });
    nextCells[field.id] = value;
  }

  return nextCells;
}

async function fillAiValue(input: {
  prompt: string;
  sourceIds: string[];
  cells: Record<string, unknown>;
  nameById: Map<string, string>;
  model?: string;
}): Promise<string> {
  const values: Record<string, string> = {};
  for (const id of input.sourceIds) {
    const name = input.nameById.get(id) ?? id;
    values[id] = stringifyCell(input.cells[id]);
    values[name] = values[id];
  }

  const rendered = renderPrompt(
    input.prompt,
    values,
    input.sourceIds,
    input.cells,
    input.nameById,
  );

  const endpoint = process.env.AI_FIELD_URL?.trim();
  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: rendered,
          model: input.model ?? process.env.AI_FIELD_MODEL ?? 'local',
          values,
        }),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          text?: string;
          content?: string;
        };
        const text = (data.text ?? data.content ?? '').trim();
        if (text) return text;
      }
    } catch {
      // fall through to ANALYSIS_LLM / local
    }
  }

  const { callOpenAiChat, getAnalysisLlmConfig } = await import(
    '../ai/openai-compatible'
  );
  const llm = getAnalysisLlmConfig();
  if (llm) {
    try {
      const text = await callOpenAiChat(
        llm.baseUrl,
        llm.apiKey,
        [
          {
            role: 'system',
            content:
              '你是表格 AI 填值助手。根据用户提示与单元格上下文，只输出应写入该单元格的最终文本，不要解释。',
          },
          { role: 'user', content: rendered },
        ],
        0.3,
        input.model ?? process.env.AI_FIELD_MODEL ?? llm.model,
      );
      if (text.trim()) return text.trim();
    } catch {
      // fall through to local
    }
  }

  return (
    rendered || localFallback(input.sourceIds, input.cells, input.nameById)
  );
}

function renderPrompt(
  prompt: string,
  values: Record<string, string>,
  sourceIds: string[],
  cells: Record<string, unknown>,
  nameById: Map<string, string>,
): string {
  if (!prompt.trim()) {
    return localFallback(sourceIds, cells, nameById);
  }
  return prompt.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, raw: string) => {
    const key = raw.trim();
    if (key in values) return values[key];
    const byName = [...nameById.entries()].find(([, name]) => name === key);
    if (byName) return stringifyCell(cells[byName[0]]);
    return '';
  });
}

function localFallback(
  sourceIds: string[],
  cells: Record<string, unknown>,
  nameById: Map<string, string>,
): string {
  if (sourceIds.length === 0) return '';
  return sourceIds
    .map((id) => {
      const name = nameById.get(id) ?? id;
      const value = stringifyCell(cells[id]);
      return value ? `${name}: ${value}` : '';
    })
    .filter(Boolean)
    .join('；');
}

function cellValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null || a === '') {
    return b === undefined || b === null || b === '';
  }
  if (b === undefined || b === null || b === '') return false;
  if (typeof a !== 'object' && typeof b !== 'object') {
    return String(a) === String(b);
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return String(a) === String(b);
  }
}

function stringifyCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringifyCell).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.rating === 'number') return `${obj.rating} 星`;
    if (typeof obj.on === 'boolean') return obj.on ? '是' : '否';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
