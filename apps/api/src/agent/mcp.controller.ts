import {
  Body,
  Controller,
  Headers,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { toMcpTools, type ToolActor } from 'agent-tools';
import { AgentActor } from './agent-actor.decorator';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentToolsService } from './agent-tools.service';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

/**
 * Minimal MCP JSON-RPC over HTTP (tools/list + tools/call).
 * Cursor / Claude Desktop 推荐走 apps/mcp stdio 桥；此端点供远程与桥接复用。
 */
@Controller('mcp')
export class McpController {
  constructor(private readonly tools: AgentToolsService) {}

  @Post()
  @UseGuards(AgentAuthGuard)
  async handle(
    @AgentActor() actor: ToolActor,
    @Body() body: JsonRpcRequest | JsonRpcRequest[],
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Content-Type', 'application/json');
    if (Array.isArray(body)) {
      return Promise.all(body.map((item) => this.dispatch(item, actor)));
    }
    return this.dispatch(body, actor);
  }

  /** Health-style probe without auth returns 401 — keeps scanners honest. */
  @Post('health-auth')
  probe(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少访问令牌');
    }
    return { ok: true };
  }

  private async dispatch(req: JsonRpcRequest, actor: ToolActor) {
    const id = req.id ?? null;
    const method = req.method ?? '';
    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'smart-table', version: '0.1.0' },
          },
        };
      }
      if (method === 'notifications/initialized' || method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
      }
      if (method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: toMcpTools(this.tools.listFor(actor)) },
        };
      }
      if (method === 'tools/call') {
        const name = String(req.params?.name ?? '');
        const args =
          (req.params?.arguments as Record<string, unknown> | undefined) ?? {};
        const result = await this.tools.invoke(name, args, actor);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: !result.ok,
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'error');
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message },
      };
    }
  }
}
