import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgentSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    input?: { title?: string; workspaceId?: string; baseId?: string },
  ) {
    return this.prisma.agentSession.create({
      data: {
        userId,
        title: input?.title?.trim() || '新对话',
        workspaceId: input?.workspaceId || null,
        baseId: input?.baseId || null,
      },
    });
  }

  async list(userId: string, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 100);
    return this.prisma.agentSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take,
      select: {
        id: true,
        title: true,
        workspaceId: true,
        baseId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getOwned(sessionId: string, userId: string) {
    const session = await this.prisma.agentSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('会话不存在');
    if (session.userId !== userId) {
      throw new ForbiddenException('无权访问该会话');
    }
    return session;
  }

  async getWithMessages(sessionId: string, userId: string) {
    const session = await this.getOwned(sessionId, userId);
    const messages = await this.prisma.agentMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    return { ...session, messages };
  }

  async findByClientMessageId(sessionId: string, clientMessageId: string) {
    return this.prisma.agentMessage.findFirst({
      where: { sessionId, clientMessageId },
    });
  }

  async appendMessage(data: {
    sessionId: string;
    role: string;
    content?: string;
    toolName?: string;
    toolCallId?: string;
    toolArgsJson?: Prisma.InputJsonValue;
    toolResultJson?: Prisma.InputJsonValue;
    clientMessageId?: string;
  }) {
    const message = await this.prisma.agentMessage.create({
      data: {
        sessionId: data.sessionId,
        role: data.role,
        content: data.content ?? '',
        toolName: data.toolName,
        toolCallId: data.toolCallId,
        toolArgsJson: data.toolArgsJson,
        toolResultJson: data.toolResultJson,
        clientMessageId: data.clientMessageId,
      },
    });
    await this.prisma.agentSession.update({
      where: { id: data.sessionId },
      data: { updatedAt: new Date() },
    });
    return message;
  }

  async setStatus(sessionId: string, status: 'idle' | 'running') {
    await this.prisma.agentSession.update({
      where: { id: sessionId },
      data: { status },
    });
  }

  async maybeSetTitleFromFirstMessage(sessionId: string, content: string) {
    const session = await this.prisma.agentSession.findUnique({
      where: { id: sessionId },
      select: { title: true },
    });
    if (!session || session.title !== '新对话') return;
    const title = content.trim().slice(0, 40) || '新对话';
    await this.prisma.agentSession.update({
      where: { id: sessionId },
      data: { title },
    });
  }

  async clearMessages(sessionId: string, userId: string) {
    await this.getOwned(sessionId, userId);
    await this.prisma.agentMessage.deleteMany({ where: { sessionId } });
    await this.prisma.agentSession.update({
      where: { id: sessionId },
      data: { title: '新对话', status: 'idle' },
    });
    return { cleared: true };
  }
}
