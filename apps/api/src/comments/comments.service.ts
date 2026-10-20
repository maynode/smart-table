import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SheetsService } from '../sheets/sheets.service';

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetsService: SheetsService,
  ) {}

  async create(sheetId: string, userId: string, body: string) {
    await this.sheetsService.assertSheetAccess(sheetId, userId, 'viewer');

    const comment = await this.prisma.comment.create({
      data: { sheetId, authorId: userId, body: body.trim() },
      include: { author: { select: { id: true, name: true, email: true } } },
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
}
