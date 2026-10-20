import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export const NOTIFY_ADAPTER = 'NOTIFY_ADAPTER';

export interface StartGroupChatInput {
  baseId: string;
  name: string;
  memberIds: string[];
}

export interface AddGroupMembersInput {
  groupChatId: string;
  memberIds: string[];
}

export interface NotifyAdapter {
  startGroupChat(input: StartGroupChatInput): Promise<{ groupChatId: string }>;
  addGroupMembers(
    input: AddGroupMembersInput,
  ): Promise<{ groupChatId: string; memberIds: string[] }>;
}

/**
 * Local stand-in for WeCom's group-chat APIs. Task 20 swaps in a WeCom adapter
 * once real credentials exist; the runner only depends on this interface.
 */
@Injectable()
export class LocalNotifyAdapter implements NotifyAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async startGroupChat(
    input: StartGroupChatInput,
  ): Promise<{ groupChatId: string }> {
    const id = randomUUID();
    await this.prisma.groupChat.create({
      data: {
        id,
        baseId: input.baseId,
        name: input.name,
        memberIds: input.memberIds as Prisma.InputJsonValue,
      },
    });
    return { groupChatId: id };
  }

  async addGroupMembers(
    input: AddGroupMembersInput,
  ): Promise<{ groupChatId: string; memberIds: string[] }> {
    const chat = await this.prisma.groupChat.findUnique({
      where: { id: input.groupChatId },
    });
    if (!chat) {
      throw new Error('群聊不存在');
    }
    const existing = (chat.memberIds ?? []) as string[];
    const memberIds = [...new Set([...existing, ...input.memberIds])];
    await this.prisma.groupChat.update({
      where: { id: chat.id },
      data: { memberIds: memberIds as Prisma.InputJsonValue },
    });
    return { groupChatId: chat.id, memberIds };
  }
}
