import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { ActivityCleanupService } from './activity-cleanup.service';
import { ActivityLogService } from './activity-log.service';
import { TrackActivityDto } from './dto/track-activity.dto';

function clientIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() || '';
  }
  return req.ip || '';
}

@Controller()
export class ActivityController {
  constructor(
    private readonly activity: ActivityLogService,
    private readonly cleanup: ActivityCleanupService,
  ) {}

  /** 前端埋点：页面打开、面板等；不记录 /admin */
  @Post('activity/track')
  @UseGuards(JwtAuthGuard)
  track(
    @CurrentUser() user: JwtPayload,
    @Body() body: TrackActivityDto,
    @Req() req: FastifyRequest,
  ) {
    this.activity.trackClient(user.sub, user.account, body, clientIp(req));
    return { ok: true };
  }

  @Get('admin/activity-logs')
  @UseGuards(JwtAuthGuard)
  list(
    @CurrentUser() user: JwtPayload,
    @Query('q') q?: string,
    @Query('op') op?: string,
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
    @Query('source') source?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.activity.listForAdmin(user.sub, {
      q,
      op,
      action,
      actorId,
      source,
      from,
      to,
      limit,
      cursor,
    });
  }

  @Get('admin/activity-logs/cleanup-settings')
  @UseGuards(JwtAuthGuard)
  cleanupSettings(
    @CurrentUser() user: JwtPayload,
    @Query('dayOfMonth') dayOfMonth?: string,
    @Query('time') time?: string,
    @Query('retentionMonths') retentionMonths?: string,
  ) {
    return this.cleanup.getSettingsForAdmin(user.sub, {
      ...(dayOfMonth != null && dayOfMonth !== ''
        ? { dayOfMonth: Number(dayOfMonth) }
        : {}),
      ...(time ? { time } : {}),
      ...(retentionMonths != null && retentionMonths !== ''
        ? { retentionMonths: Number(retentionMonths) }
        : {}),
    });
  }

  @Patch('admin/activity-logs/cleanup-settings')
  @UseGuards(JwtAuthGuard)
  updateCleanupSettings(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      enabled?: boolean;
      dayOfMonth?: number;
      hour?: number;
      minute?: number;
      second?: number;
      time?: string;
      retentionMonths?: number;
    },
  ) {
    return this.cleanup.updateSettingsForAdmin(user.sub, body);
  }

  @Post('admin/activity-logs/cleanup-run')
  @UseGuards(JwtAuthGuard)
  runCleanup(@CurrentUser() user: JwtPayload) {
    return this.cleanup.runNowForAdmin(user.sub);
  }
}
