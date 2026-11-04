/** JSON Schema subset used for tool input declarations (OpenAI / MCP compatible). */
export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  enum?: Array<string | number | boolean | null>;
  default?: unknown;
};

export type ToolGroup =
  | 'nav'
  | 'sheet_read'
  | 'sheet_write'
  | 'view'
  | 'form'
  | 'automation'
  | 'dashboard'
  | 'acl'
  | 'template'
  | 'collab_meta'
  | 'share'
  | 'ai_meta'
  | 'quota'
  | 'admin';

export type ToolActor = {
  userId: string;
  account: string;
  installAdmin: boolean;
};

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  code?: string;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  actor: ToolActor,
) => Promise<ToolResult>;

export type ToolDefinition = {
  name: string;
  description: string;
  group: ToolGroup;
  /** When true, only registered/listed for installAdmin actors. */
  adminOnly?: boolean;
  inputSchema: JsonSchema;
  handler: ToolHandler;
};

export type ToolPublicMeta = {
  name: string;
  description: string;
  group: ToolGroup;
  adminOnly?: boolean;
  inputSchema: JsonSchema;
};

/** OpenAI-compatible function tool descriptor. */
export type OpenAiTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

export function toOpenAiTools(defs: ToolPublicMeta[]): OpenAiTool[] {
  return defs.map((def) => ({
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    },
  }));
}

export function toMcpTools(defs: ToolPublicMeta[]): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
}> {
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
  }));
}
