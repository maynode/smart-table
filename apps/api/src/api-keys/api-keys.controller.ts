import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { ApiKeysService, type ApiScope } from './api-keys.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post('workspaces/:workspaceId/api-keys')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: { name: string; scopes?: ApiScope[] },
  ) {
    return this.apiKeys.create(workspaceId, user.sub, body);
  }

  @Get('workspaces/:workspaceId/api-keys')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.apiKeys.list(workspaceId, user.sub);
  }

  @Delete('api-keys/:id')
  revoke(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apiKeys.revoke(id, user.sub);
  }
}
