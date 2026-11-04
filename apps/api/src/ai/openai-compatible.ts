export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ChatTextPart = { type: 'text'; text: string };
export type ChatImagePart = {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
};
export type ChatContentPart = ChatTextPart | ChatImagePart;

export type ChatToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: ChatRole;
  /** Plain string or OpenAI-compatible multimodal parts. */
  content: string | ChatContentPart[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ChatToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatCompletionResult = {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
};

/** Returns credentials when ANALYSIS_LLM_* is configured. */
export function getAnalysisLlmConfig(): {
  baseUrl: string;
  apiKey: string;
  model: string;
} | null {
  const baseUrl = process.env.ANALYSIS_LLM_BASE_URL?.trim();
  const apiKey = process.env.ANALYSIS_LLM_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl,
    apiKey,
    model: process.env.ANALYSIS_LLM_MODEL?.trim() || 'gpt-4o-mini',
  };
}

export async function callOpenAiChat(
  baseUrl: string,
  apiKey: string,
  messages: ChatMessage[],
  temperature: number,
  model?: string,
): Promise<string> {
  const result = await callOpenAiChatWithTools(
    baseUrl,
    apiKey,
    messages,
    temperature,
    { model },
  );
  return result.content;
}

export async function callOpenAiChatWithTools(
  baseUrl: string,
  apiKey: string,
  messages: ChatMessage[],
  temperature: number,
  options?: {
    model?: string;
    tools?: ChatToolDefinition[];
    toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  },
): Promise<ChatCompletionResult> {
  const resolvedModel =
    options?.model?.trim() ||
    process.env.ANALYSIS_LLM_MODEL?.trim() ||
    'gpt-4o-mini';
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model: resolvedModel,
    temperature,
    messages,
  };
  if (options?.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? 'auto';
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `LLM HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`,
    );
  }
  const data = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string | null;
      message?: {
        content?: string | null;
        tool_calls?: ChatToolCall[];
      };
    }>;
  };
  const choice = data.choices?.[0];
  const message = choice?.message;
  return {
    content: message?.content?.trim() ?? '',
    toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : [],
    finishReason: choice?.finish_reason ?? null,
  };
}

export async function callOpenAiCompatible(
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
