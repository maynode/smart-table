import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
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
  constructor(private readonly activity: ActivityLogService) {}

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
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.activity.listForAdmin(user.sub, {
      q,
      op,
      action,
      actorId,
      source,
      limit,
      cursor,
    });
  }
}
