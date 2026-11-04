import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { ToolActor } from 'agent-tools';
import { toMcpTools, toOpenAiTools } from 'agent-tools';
import { AgentActor } from './agent-actor.decorator';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentLoopService } from './agent-loop.service';
import { AgentSessionService } from './agent-session.service';
import { AgentTokenService } from './agent-token.service';
import { AgentToolsService } from './agent-tools.service';
import {
  CreateAgentSessionDto,
  CreateAgentTokenDto,
  InvokeAgentToolDto,
  PostAgentMessageDto,
} from './dto/agent.dto';

@Controller('agent')
@UseGuards(AgentAuthGuard)
export class AgentController {
  constructor(
    private readonly sessions: AgentSessionService,
    private readonly loop: AgentLoopService,
    private readonly tools: AgentToolsService,
    private readonly tokens: AgentTokenService,
  ) {}

  @Get('tools')
  listTools(@AgentActor() actor: ToolActor) {
    const list = this.tools.listFor(actor);
    return {
      tools: list,
      openai: toOpenAiTools(list),
      mcp: toMcpTools(list),
    };
  }

  @Post('tools/:name/invoke')
  invokeTool(
    @AgentActor() actor: ToolActor,
    @Param('name') name: string,
    @Body() body: InvokeAgentToolDto,
  ) {
    return this.tools.invoke(name, body.arguments ?? {}, actor);
  }

  @Post('sessions')
  createSession(
    @AgentActor() actor: ToolActor,
    @Body() body: CreateAgentSessionDto,
  ) {
    return this.sessions.create(actor.userId, body);
  }

  @Get('sessions')
  listSessions(@AgentActor() actor: ToolActor) {
    return this.sessions.list(actor.userId);
  }

  @Get('sessions/:id')
  getSession(
    @AgentActor() actor: ToolActor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.sessions.getWithMessages(id, actor.userId);
  }

  @Post('sessions/:id/messages')
  postMessage(
    @AgentActor() actor: ToolActor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PostAgentMessageDto,
  ) {
    return this.loop.chat(
      id,
      actor.userId,
      actor.account,
      body.content,
      body.clientMessageId,
    );
  }

  @Post('sessions/:id/clear')
  clearSession(
    @AgentActor() actor: ToolActor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.sessions.clearMessages(id, actor.userId);
  }

  /** 中断卡住的 running 状态（崩溃恢复 / 用户取消） */
  @Post('sessions/:id/cancel')
  async cancelSession(
    @AgentActor() actor: ToolActor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.sessions.getOwned(id, actor.userId);
    await this.sessions.setStatus(id, 'idle');
    return { cancelled: true };
  }

  @Get('tokens')
  listTokens(@AgentActor() actor: ToolActor) {
    return this.tokens.list(actor.userId);
  }

  @Post('tokens')
  createToken(
    @AgentActor() actor: ToolActor,
    @Body() body: CreateAgentTokenDto,
  ) {
    return this.tokens.create(actor.userId, body.name ?? 'MCP Token');
  }

  @Delete('tokens/:id')
  revokeToken(
    @AgentActor() actor: ToolActor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.tokens.revoke(actor.userId, id);
  }
}
