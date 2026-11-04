import type {
  ToolActor,
  ToolDefinition,
  ToolPublicMeta,
  ToolResult,
} from './types';

export class AgentToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(def: ToolDefinition): void {
    if (this.tools.has(def.name)) {
      throw new Error(`Duplicate tool registration: ${def.name}`);
    }
    this.tools.set(def.name, def);
  }

  registerAll(defs: ToolDefinition[]): void {
    for (const def of defs) this.register(def);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(actor?: ToolActor): ToolPublicMeta[] {
    const out: ToolPublicMeta[] = [];
    for (const def of this.tools.values()) {
      if (def.adminOnly && !actor?.installAdmin) continue;
      out.push({
        name: def.name,
        description: def.description,
        group: def.group,
        adminOnly: def.adminOnly,
        inputSchema: def.inputSchema,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async invoke(
    name: string,
    args: Record<string, unknown>,
    actor: ToolActor,
  ): Promise<ToolResult> {
    const def = this.tools.get(name);
    if (!def) {
      return { ok: false, error: `Unknown tool: ${name}`, code: 'TOOL_NOT_FOUND' };
    }
    if (def.adminOnly && !actor.installAdmin) {
      return {
        ok: false,
        error: 'Tool requires installAdmin',
        code: 'TOOL_FORBIDDEN',
      };
    }
    try {
      return await def.handler(args ?? {}, actor);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'tool failed');
      const code =
        error &&
        typeof error === 'object' &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'code' in error.response
          ? String((error.response as { code?: unknown }).code ?? 'TOOL_ERROR')
          : 'TOOL_ERROR';
      return { ok: false, error: message, code };
    }
  }
}

export function createAgentToolRegistry(): AgentToolRegistry {
  return new AgentToolRegistry();
}
