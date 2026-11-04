import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { toOpenAiTools, type ToolActor } from 'agent-tools';
import { Prisma } from '@prisma/client';
import {
  callOpenAiChatWithTools,
  getAnalysisLlmConfig,
  type ChatMessage,
  type ChatToolCall,
} from '../ai/openai-compatible';
import { isInstallAdmin } from '../auth/install-admin';
import { PrismaService } from '../prisma/prisma.service';
import { AgentSessionService } from './agent-session.service';
import { AgentToolsService } from './agent-tools.service';

const MAX_TOOL_ROUNDS = 12;
const SYSTEM_PROMPT = `你是智能表格产品的全局 AI 助手。你可以通过 tools 调用产品核心能力（工作区、表、记录、视图、表单、自动化、仪表盘、权限等）。
规则：
1. 先用读工具了解上下文，再写；写表必须用 commit_sheet_changes。
2. 不要编造 id；从工具结果取真实 id。
3. 权限不足时如实说明，不要绕过。
4. 用简洁中文回复用户。`;

@Injectable()
export class AgentLoopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AgentSessionService,
    private readonly tools: AgentToolsService,
  ) {}

  async resolveActor(userId: string, account: string): Promise<ToolActor> {
    return {
      userId,
      account,
      installAdmin: await isInstallAdmin(this.prisma, userId),
    };
  }

  async chat(
    sessionId: string,
    userId: string,
    account: string,
    content: string,
    clientMessageId?: string,
  ) {
    const session = await this.sessions.getOwned(sessionId, userId);
    if (session.status === 'running') {
      throw new ConflictException('会话正在处理中，请稍后再试');
    }

    if (clientMessageId) {
      const existing = await this.sessions.findByClientMessageId(
        sessionId,
        clientMessageId,
      );
      if (existing) {
        const messages = await this.prisma.agentMessage.findMany({
          where: { sessionId },
          orderBy: { createdAt: 'asc' },
        });
        return {
          sessionId,
          idempotent: true,
          messages: this.publicMessages(messages),
          assistantText: this.lastAssistantText(messages),
          toolTrace: this.toolTrace(messages, existing.createdAt),
        };
      }
    }

    const llm = getAnalysisLlmConfig();
    if (!llm) {
      throw new ServiceUnavailableException(
        '未配置 ANALYSIS_LLM_*，全局 AI 不可用',
      );
    }

    const actor = await this.resolveActor(userId, account);
    const toolMetas = this.tools.listFor(actor);
    const openAiTools = toOpenAiTools(toolMetas);

    await this.sessions.setStatus(sessionId, 'running');
    try {
      await this.sessions.appendMessage({
        sessionId,
        role: 'user',
        content,
        clientMessageId,
      });
      await this.sessions.maybeSetTitleFromFirstMessage(sessionId, content);

      const history = await this.prisma.agentMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      });
      const chatMessages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...this.toLlmMessages(history),
      ];

      const toolTrace: Array<{
        toolCallId: string;
        name: string;
        args: unknown;
        result: unknown;
      }> = [];

      let assistantText = '';
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const completion = await callOpenAiChatWithTools(
          llm.baseUrl,
          llm.apiKey,
          chatMessages,
          0.2,
          {
            model: llm.model,
            tools: openAiTools.length
              ? (openAiTools as never)
              : undefined,
          },
        );

        if (completion.toolCalls.length === 0) {
          assistantText = completion.content || '（无回复）';
          await this.sessions.appendMessage({
            sessionId,
            role: 'assistant',
            content: assistantText,
          });
          break;
        }

        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: completion.content || null,
          tool_calls: completion.toolCalls,
        };
        chatMessages.push(assistantMsg);
        await this.sessions.appendMessage({
          sessionId,
          role: 'assistant',
          content: completion.content || '',
          toolArgsJson: completion.toolCalls as unknown as Prisma.InputJsonValue,
        });

        for (const call of completion.toolCalls) {
          const args = this.parseArgs(call);
          const result = await this.tools.invoke(call.function.name, args, actor);
          toolTrace.push({
            toolCallId: call.id,
            name: call.function.name,
            args,
            result,
          });
          await this.sessions.appendMessage({
            sessionId,
            role: 'tool',
            content: JSON.stringify(result).slice(0, 200_000),
            toolName: call.function.name,
            toolCallId: call.id,
            toolArgsJson: args as Prisma.InputJsonValue,
            toolResultJson: result as unknown as Prisma.InputJsonValue,
          });
          chatMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 80_000),
          });
        }

        if (round === MAX_TOOL_ROUNDS - 1) {
          assistantText = '已达到工具调用轮次上限，请缩小任务后重试。';
          await this.sessions.appendMessage({
            sessionId,
            role: 'assistant',
            content: assistantText,
          });
        }
      }

      const messages = await this.prisma.agentMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      });
      return {
        sessionId,
        idempotent: false,
        messages: this.publicMessages(messages),
        assistantText,
        toolTrace,
      };
    } finally {
      await this.sessions.setStatus(sessionId, 'idle').catch(() => undefined);
    }
  }

  private parseArgs(call: ChatToolCall): Record<string, unknown> {
    try {
      const parsed = JSON.parse(call.function.arguments || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private toLlmMessages(
    rows: Array<{
      role: string;
      content: string;
      toolCallId: string | null;
      toolArgsJson: Prisma.JsonValue | null;
    }>,
  ): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const row of rows) {
      if (row.role === 'user') {
        out.push({ role: 'user', content: row.content });
        continue;
      }
      if (row.role === 'assistant') {
        const toolCalls = Array.isArray(row.toolArgsJson)
          ? (row.toolArgsJson as unknown as ChatToolCall[])
          : undefined;
        if (toolCalls?.length) {
          out.push({
            role: 'assistant',
            content: row.content || null,
            tool_calls: toolCalls,
          });
        } else if (row.content) {
          out.push({ role: 'assistant', content: row.content });
        }
        continue;
      }
      if (row.role === 'tool' && row.toolCallId) {
        out.push({
          role: 'tool',
          tool_call_id: row.toolCallId,
          content: row.content || '{}',
        });
      }
    }
    return out;
  }

  private publicMessages(
    rows: Array<{
      id: string;
      role: string;
      content: string;
      toolName: string | null;
      toolCallId: string | null;
      createdAt: Date;
    }>,
  ) {
    return rows
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .filter((m) => !(m.role === 'assistant' && !m.content))
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt,
      }));
  }

  private lastAssistantText(
    rows: Array<{ role: string; content: string }>,
  ): string {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role === 'assistant' && rows[i].content) return rows[i].content;
    }
    return '';
  }

  private toolTrace(
    rows: Array<{
      role: string;
      toolName: string | null;
      toolCallId: string | null;
      toolArgsJson: Prisma.JsonValue | null;
      toolResultJson: Prisma.JsonValue | null;
      createdAt: Date;
    }>,
    after: Date,
  ) {
    return rows
      .filter((m) => m.role === 'tool' && m.createdAt >= after)
      .map((m) => ({
        toolCallId: m.toolCallId ?? '',
        name: m.toolName ?? '',
        args: m.toolArgsJson,
        result: m.toolResultJson,
      }));
  }
}
