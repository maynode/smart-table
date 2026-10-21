import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { FoldersService } from './folders.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get('workspaces/:workspaceId/folders')
  tree(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', new ParseUUIDPipe()) workspaceId: string,
  ) {
    return this.folders.tree(workspaceId, user.sub);
  }

  @Post('workspaces/:workspaceId/folders')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', new ParseUUIDPipe()) workspaceId: string,
    @Body() body: { name: string; parentId?: string | null },
  ) {
    return this.folders.create(workspaceId, user.sub, body);
  }

  @Patch('folders/:id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { name?: string; parentId?: string | null },
  ) {
    return this.folders.update(id, user.sub, body);
  }

  @Delete('folders/:id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.folders.remove(id, user.sub);
  }

  @Post('bases/:baseId/move')
  moveBase(
    @CurrentUser() user: JwtPayload,
    @Param('baseId', new ParseUUIDPipe()) baseId: string,
    @Body() body: { folderId?: string | null },
  ) {
    return this.folders.moveBase(baseId, user.sub, body.folderId ?? null);
  }
}
