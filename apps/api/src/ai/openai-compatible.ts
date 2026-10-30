export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatTextPart = { type: 'text'; text: string };
export type ChatImagePart = {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
};
export type ChatContentPart = ChatTextPart | ChatImagePart;

export type ChatMessage = {
  role: ChatRole;
  /** Plain string or OpenAI-compatible multimodal parts. */
  content: string | ChatContentPart[];
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
  const resolvedModel =
    model?.trim() ||
    process.env.ANALYSIS_LLM_MODEL?.trim() ||
    'gpt-4o-mini';
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      temperature,
      messages,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `LLM HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`,
    );
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
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
