import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { LiveBusService } from '../live/live-bus.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveBusService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const notifications = await this.prisma.notification.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return { notifications };
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: JwtPayload) {
    const updated = await this.prisma.notification.updateMany({
      where: { userId: user.sub, readAt: null },
      data: { readAt: new Date() },
    });
    if (updated.count > 0) {
      await this.live.emit({
        baseId: null,
        actorId: user.sub,
        kind: 'notification.read',
        userId: user.sub,
        meta: { all: true, count: updated.count },
      });
    }
    return { read: true, count: updated.count };
  }

  @Post(':id/read')
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const updated = await this.prisma.notification.updateMany({
      where: { id, userId: user.sub },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) {
      throw new NotFoundException('通知不存在');
    }
    await this.live.emit({
      baseId: null,
      actorId: user.sub,
      kind: 'notification.read',
      entityId: id,
      userId: user.sub,
    });
    return { read: true };
  }
}
