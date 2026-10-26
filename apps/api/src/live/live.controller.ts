import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { LiveBusService } from './live-bus.service';
import { isPublicSafeLiveKind } from './live-public-safe';
import type { LiveEvent } from './live.types';

@Controller()
export class LiveController {
  constructor(
    private readonly bus: LiveBusService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('bases/:baseId/live/since')
  @UseGuards(JwtAuthGuard)
  async sinceBase(
    @CurrentUser() user: JwtPayload,
    @Param('baseId', new ParseUUIDPipe()) baseId: string,
    @Query('seq') seqRaw?: string,
  ): Promise<{ latestSeq: number; events: LiveEvent[] }> {
    const base = await this.prisma.base.findUnique({ where: { id: baseId } });
    if (!base) throw new NotFoundException('Base 不存在');
    await this.assertWorkspaceMember(base.workspaceId, user.sub);
    return this.sinceScope(`base:${baseId}`, seqRaw);
  }

  @Get('workspaces/:workspaceId/live/since')
  @UseGuards(JwtAuthGuard)
  async sinceWorkspace(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', new ParseUUIDPipe()) workspaceId: string,
    @Query('seq') seqRaw?: string,
  ): Promise<{ latestSeq: number; events: LiveEvent[] }> {
    await this.assertWorkspaceMember(workspaceId, user.sub);
    return this.sinceScope(`ws:${workspaceId}`, seqRaw);
  }

  /** 通知页 / 仅用户房：补洞 */
  @Get('live/me/since')
  @UseGuards(JwtAuthGuard)
  async sinceMe(
    @CurrentUser() user: JwtPayload,
    @Query('seq') seqRaw?: string,
  ): Promise<{ latestSeq: number; events: LiveEvent[] }> {
    return this.sinceScope(`user:${user.sub}`, seqRaw);
  }

  /** 公开只读视图：仅返回公开安全事件 */
  @Get('public-views/:token/live/since')
  async sincePublicView(
    @Param('token') token: string,
    @Query('seq') seqRaw?: string,
  ): Promise<{ latestSeq: number; events: LiveEvent[] }> {
    const view = await this.prisma.publicView.findFirst({
      where: { token, enabled: true },
      include: { sheet: { select: { baseId: true } } },
    });
    if (!view) throw new NotFoundException('公开视图不存在');
    return this.sincePublicSafe(`base:${view.sheet.baseId}`, seqRaw);
  }

  /** 公开填表：仅返回公开安全事件 */
  @Get('public/forms/:token/live/since')
  async sincePublicForm(
    @Param('token') token: string,
    @Query('seq') seqRaw?: string,
  ): Promise<{ latestSeq: number; events: LiveEvent[] }> {
    const form = await this.prisma.form.findFirst({
      where: { shareToken: token },
      select: { baseId: true, share: true },
    });
    if (!form) throw new NotFoundException('表单不存在');
    const share = form.share as { enabled?: boolean } | null;
    if (share && share.enabled === false) {
      throw new NotFoundException('表单已关闭');
    }
    return this.sincePublicSafe(`base:${form.baseId}`, seqRaw);
  }

  private async assertWorkspaceMember(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId },
      },
    });
    if (!member) throw new ForbiddenException('无访问权限');
  }

  private async sinceScope(
    scopeKey: string,
    seqRaw?: string,
  ): Promise<{ latestSeq: number; events: LiveEvent[] }> {
    const fromSeq = Math.max(0, Number(seqRaw) || 0);
    const [latestSeq, events] = await Promise.all([
      this.bus.latestSeq(scopeKey),
      this.bus.eventsSince(scopeKey, fromSeq),
    ]);
    return { latestSeq, events };
  }

  private async sincePublicSafe(
    scopeKey: string,
    seqRaw?: string,
  ): Promise<{ latestSeq: number; events: LiveEvent[] }> {
    const result = await this.sinceScope(scopeKey, seqRaw);
    return {
      latestSeq: result.latestSeq,
      events: result.events.filter((e) => isPublicSafeLiveKind(e.kind)),
    };
  }
}
