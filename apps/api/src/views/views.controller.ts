import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import type { ViewQuery } from 'shared';
import { ViewsService } from './views.service';

@Controller('sheets')
@UseGuards(JwtAuthGuard)
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Post(':sheetId/query')
  @HttpCode(HttpStatus.OK)
  query(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', new ParseUUIDPipe()) sheetId: string,
    @Body() query: ViewQuery,
  ) {
    return this.views.query(sheetId, user.sub, query ?? {});
  }
}
