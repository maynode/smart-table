import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { DashboardsService } from './dashboards.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Post('bases/:baseId/dashboards')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('baseId', new ParseUUIDPipe()) baseId: string,
    @Body() body: { name: string; kind?: string },
  ) {
    return this.dashboards.create(baseId, user.sub, body.name, body.kind);
  }

  @Get('bases/:baseId/dashboards')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('baseId', new ParseUUIDPipe()) baseId: string,
    @Query('kind') kind?: string,
  ) {
    return this.dashboards.list(baseId, user.sub, kind);
  }

  @Get('dashboards/:id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.dashboards.get(id, user.sub);
  }

  @Get('dashboards/:id/data')
  data(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.dashboards.data(id, user.sub);
  }

  @Post('dashboards/:id/widgets')
  addWidget(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body()
    body: {
      type: string;
      title: string;
      sheetId?: string;
      config?: Record<string, unknown>;
      layout?: Record<string, unknown>;
    },
  ) {
    return this.dashboards.addWidget(id, user.sub, body);
  }

  @Patch('dashboards/:id/widgets/:widgetId')
  updateWidget(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('widgetId', new ParseUUIDPipe()) widgetId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.dashboards.updateWidget(id, widgetId, user.sub, body);
  }

  @Delete('dashboards/:id/widgets/:widgetId')
  deleteWidget(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('widgetId', new ParseUUIDPipe()) widgetId: string,
  ) {
    return this.dashboards.deleteWidget(id, widgetId, user.sub);
  }

  @Post('dashboards/:id/widgets/:widgetId/query')
  queryWidget(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('widgetId', new ParseUUIDPipe()) widgetId: string,
  ) {
    return this.dashboards.queryWidget(id, widgetId, user.sub);
  }

  @Post('dashboards/:id/schedules')
  createSchedule(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { cron: string; channel?: string },
  ) {
    return this.dashboards.createSchedule(id, user.sub, body);
  }

  @Get('dashboards/:id/schedules')
  listSchedules(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.dashboards.listSchedules(id, user.sub);
  }

  @Post('dashboards/:id/schedules/:scheduleId/run')
  runSchedule(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('scheduleId', new ParseUUIDPipe()) scheduleId: string,
  ) {
    return this.dashboards.runSchedule(id, scheduleId, user.sub);
  }
}
