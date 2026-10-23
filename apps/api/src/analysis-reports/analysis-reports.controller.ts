import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { AnalysisReportsService } from './analysis-reports.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class AnalysisReportsController {
  constructor(private readonly reports: AnalysisReportsService) {}

  @Get('bases/:baseId/analysis-reports')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('baseId', new ParseUUIDPipe()) baseId: string,
  ) {
    return this.reports.list(baseId, user.sub);
  }

  @Post('bases/:baseId/analysis-reports')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('baseId', new ParseUUIDPipe()) baseId: string,
    @Body() body: { name?: string },
  ) {
    return this.reports.create(baseId, user.sub, body?.name);
  }

  @Get('analysis-reports/:id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.reports.get(id, user.sub);
  }

  @Post('analysis-reports/:id/answer')
  answer(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body()
    body: { optionId?: string; text?: string; skip?: boolean },
  ) {
    return this.reports.answer(id, user.sub, body ?? {});
  }

  @Post('analysis-reports/:id/generate')
  generate(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.reports.generate(id, user.sub);
  }
}
