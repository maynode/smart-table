import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { SharingService } from './sharing.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Post('workspaces/:workspaceId/shares')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body()
    body: {
      targetWorkspaceId: string;
      objectType: 'base' | 'sheet';
      objectId: string;
      role: 'view' | 'edit';
    },
  ) {
    return this.sharing.create(workspaceId, user.sub, body);
  }

  @Get('workspaces/:workspaceId/shares')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query('direction') direction?: string,
  ) {
    return this.sharing.list(
      workspaceId,
      user.sub,
      direction === 'in' ? 'in' : 'out',
    );
  }

  @Delete('shares/:id')
  revoke(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sharing.revoke(id, user.sub);
  }
}
