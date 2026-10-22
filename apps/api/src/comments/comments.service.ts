import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SheetsService } from '../sheets/sheets.service';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetsService: SheetsService,
  ) {}

  async create(
    sheetId: string,
    userId: string,
    body: string,
    mentionedUserIds: string[] = [],
  ) {
    await this.sheetsService.assertSheetAccess(sheetId, userId, 'viewer');

    const trimmed = body.trim();
    const comment = await this.prisma.comment.create({
      data: { sheetId, authorId: userId, body: trimmed },
      include: { author: { select: { id: true, name: true, email: true } } },
    });

    await this.notifyMentions({
      sheetId,
      authorId: userId,
      authorName: comment.author.name,
      commentId: comment.id,
      body: trimmed,
      mentionedUserIds,
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
      include: { author: { select: { id: true, name: true, email: true } } },
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
        include: { user: { select: { id: true, name: true, email: true } } },
      });

      const byId = new Map(members.map((row) => [row.userId, row.user]));
      const recipients = new Set<string>();

      for (const id of input.mentionedUserIds) {
        if (byId.has(id) && id !== input.authorId) recipients.add(id);
      }

      // Also resolve `@Name` / `@email` tokens from the body.
      const sorted = [...members].sort(
        (a, b) => b.user.name.length - a.user.name.length,
      );
      for (const row of sorted) {
        if (row.userId === input.authorId) continue;
        const nameToken = `@${row.user.name}`;
        const emailToken = `@${row.user.email}`;
        if (
          input.body.includes(nameToken) ||
          input.body.includes(emailToken)
        ) {
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
    } catch (error) {
      this.logger.warn(
        `comment mention notify failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
