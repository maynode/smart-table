import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LiveBusService } from '../live/live-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import { SheetsService } from '../sheets/sheets.service';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetsService: SheetsService,
    private readonly live: LiveBusService,
  ) {}

  async create(
    sheetId: string,
    userId: string,
    body: string,
    mentionedUserIds: string[] = [],
  ) {
    const sheet = await this.sheetsService.assertSheetAccess(
      sheetId,
      userId,
      'viewer',
    );

    const trimmed = body.trim();
    const comment = await this.prisma.comment.create({
      data: { sheetId, authorId: userId, body: trimmed },
      include: { author: { select: { id: true, account: true } } },
    });

    await this.live.emit({
      baseId: sheet.baseId,
      actorId: userId,
      kind: 'comment.changed',
      entityId: comment.id,
      meta: { sheetId },
    });

    await this.notifyMentions({
      sheetId,
      authorId: userId,
      authorName: comment.author.account,
      commentId: comment.id,
      body: trimmed,
      mentionedUserIds,
      baseId: sheet.baseId,
    });

    return {
      id: comment.id,
      sheetId: comment.sheetId,
      body: comment.body,
      createdAt: comment.createdAt,
      author: comment.author,
    };
  }

  async list(sheetId: string, userId: string) {
    await this.sheetsService.assertSheetAccess(sheetId, userId, 'viewer');

    const comments = await this.prisma.comment.findMany({
      where: { sheetId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, account: true } } },
    });

    return comments.map((comment) => ({
      id: comment.id,
      sheetId: comment.sheetId,
      body: comment.body,
      createdAt: comment.createdAt,
      author: comment.author,
    }));
  }

  private async notifyMentions(input: {
    sheetId: string;
    authorId: string;
    authorName: string;
    commentId: string;
    body: string;
    mentionedUserIds: string[];
    baseId: string;
  }): Promise<void> {
    try {
      const sheet = await this.prisma.sheet.findUnique({
        where: { id: input.sheetId },
        select: {
          id: true,
          name: true,
          baseId: true,
          base: { select: { workspaceId: true, name: true } },
        },
      });
      if (!sheet) return;

      const members = await this.prisma.workspaceMember.findMany({
        where: { workspaceId: sheet.base.workspaceId },
        include: { user: { select: { id: true, account: true } } },
      });

      const byId = new Map(members.map((row) => [row.userId, row.user]));
      const recipients = new Set<string>();

      for (const id of input.mentionedUserIds) {
        if (byId.has(id) && id !== input.authorId) recipients.add(id);
      }

      // Resolve `@account` tokens from the body (longest first).
      const sorted = [...members].sort(
        (a, b) => b.user.account.length - a.user.account.length,
      );
      for (const row of sorted) {
        if (row.userId === input.authorId) continue;
        if (input.body.includes(`@${row.user.account}`)) {
          recipients.add(row.userId);
        }
      }

      if (recipients.size === 0) return;

      const title = `${input.authorName} 在评论中提到了你`;
      const preview =
        input.body.length > 120 ? `${input.body.slice(0, 120)}…` : input.body;
      const data = {
        kind: 'comment_mention',
        sheetId: sheet.id,
        sheetName: sheet.name,
        baseId: sheet.baseId,
        commentId: input.commentId,
      } as unknown as Prisma.InputJsonValue;

      await this.prisma.notification.createMany({
        data: [...recipients].map((userId) => ({
          userId,
          title,
          body: preview,
          data,
        })),
      });
      for (const recipientId of recipients) {
        await this.live.emit({
          baseId: input.baseId,
          actorId: input.authorId,
          kind: 'notification.created',
          entityId: input.commentId,
          userId: recipientId,
          meta: { kind: 'comment_mention' },
        });
      }
    } catch (error) {
      this.logger.warn(
        `comment mention notify failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
