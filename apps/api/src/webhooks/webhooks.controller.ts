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
import { WebhooksService } from './webhooks.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('workspaces/:workspaceId/webhooks')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: { url: string; events?: string[] },
  ) {
    return this.webhooks.create(workspaceId, user.sub, body);
  }

  @Get('workspaces/:workspaceId/webhooks')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.webhooks.list(workspaceId, user.sub);
  }

  @Delete('webhooks/:id')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooks.remove(id, user.sub);
  }

  @Get('webhooks/:id/deliveries')
  deliveries(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status?: string,
  ) {
    return this.webhooks.deliveries(id, user.sub, status);
  }

  @Post('webhook-deliveries/:id/retry')
  retry(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooks.retry(id, user.sub);
  }
}
