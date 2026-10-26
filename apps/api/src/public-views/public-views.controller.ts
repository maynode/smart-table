import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { PublicViewsService } from './public-views.service';

@Controller()
export class PublicViewsController {
  constructor(private readonly publicViews: PublicViewsService) {}

  @Get('sheets/:sheetId/public-views/scope-options')
  @UseGuards(JwtAuthGuard)
  scopeOptions(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', ParseUUIDPipe) sheetId: string,
  ) {
    return this.publicViews.scopeOptions(sheetId, user.sub);
  }

  @Post('sheets/:sheetId/public-views')
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', ParseUUIDPipe) sheetId: string,
    @Body()
    body: {
      name?: string;
      password?: string;
      expiresAt?: string | null;
      sheetIds?: string[];
      formSheetIds?: string[];
      dashboardIds?: string[];
      analysisReportIds?: string[];
    },
  ) {
    return this.publicViews.create(sheetId, user.sub, body);
  }

  @Get('sheets/:sheetId/public-views')
  @UseGuards(JwtAuthGuard)
  list(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId', ParseUUIDPipe) sheetId: string,
  ) {
    return this.publicViews.list(sheetId, user.sub);
  }

  @Patch('public-views/:id')
  @UseGuards(JwtAuthGuard)
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      password?: string | null;
      clearPassword?: boolean;
      expiresAt?: string | null;
      enabled?: boolean;
      sheetIds?: string[];
      formSheetIds?: string[];
      dashboardIds?: string[];
      analysisReportIds?: string[];
    },
  ) {
    return this.publicViews.update(id, user.sub, body ?? {});
  }

  @Delete('public-views/:id')
  @UseGuards(JwtAuthGuard)
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publicViews.remove(id, user.sub);
  }

  @Get('public-views/:token')
  get(
    @Param('token') token: string,
    @Query('password') password?: string,
  ) {
    return this.publicViews.getPublic(token, password);
  }

  @Post('public-views/:token/verify')
  verify(@Param('token') token: string, @Body() body: { password?: string }) {
    return this.publicViews.getPublic(token, body.password);
  }

  @Post('public-views/:token/records')
  createRecord(): never {
    throw new ForbiddenException('公开只读视图不支持写入');
  }

  @Patch('public-views/:token/records/:recordId')
  updateRecord(): never {
    throw new ForbiddenException('公开只读视图不支持写入');
  }

  @Delete('public-views/:token/records/:recordId')
  deleteRecord(): never {
    throw new ForbiddenException('公开只读视图不支持写入');
  }
}
