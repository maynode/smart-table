import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import type { ViewQuery } from 'shared';
import {
  CreateSavedViewDto,
  UpdateSavedViewDto,
} from './dto/saved-view.dto';
import { ViewsService } from './views.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Post('sheets/:sheetId/query')
  @HttpCode(HttpStatus.OK)
  query(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', new ParseUUIDPipe()) sheetId: string,
    @Body() query: ViewQuery,
  ) {
    return this.views.query(sheetId, user.sub, query ?? {});
  }

  @Get('sheets/:sheetId/saved-views')
  listSaved(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', new ParseUUIDPipe()) sheetId: string,
  ) {
    return this.views.listSaved(sheetId, user.sub);
  }

  @Post('sheets/:sheetId/saved-views')
  createSaved(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', new ParseUUIDPipe()) sheetId: string,
    @Body() dto: CreateSavedViewDto,
  ) {
    return this.views.createSaved(sheetId, user.sub, dto);
  }

  @Patch('saved-views/:viewId')
  updateSaved(
    @CurrentUser() user: JwtPayload,
    @Param('viewId', new ParseUUIDPipe()) viewId: string,
    @Body() dto: UpdateSavedViewDto,
  ) {
    return this.views.updateSaved(viewId, user.sub, dto);
  }

  @Delete('saved-views/:viewId')
  deleteSaved(
    @CurrentUser() user: JwtPayload,
    @Param('viewId', new ParseUUIDPipe()) viewId: string,
  ) {
    return this.views.deleteSaved(viewId, user.sub);
  }
}
