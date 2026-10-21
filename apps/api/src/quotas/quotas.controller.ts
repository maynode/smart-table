import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { QuotasService } from './quotas.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class QuotasController {
  constructor(private readonly quotas: QuotasService) {}

  @Get('workspaces/:workspaceId/quota')
  get(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.quotas.get(workspaceId, user.sub);
  }

  @Get('admin/quotas')
  overview(@CurrentUser() user: JwtPayload) {
    return this.quotas.adminOverview(user.sub);
  }

  @Put('admin/quotas')
  update(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      scope: 'installation' | 'workspace';
      workspaceId?: string;
      maxSeats?: number;
      maxStorageBytes?: number;
      maxAutomationRunsPerMonth?: number;
    },
  ) {
    return this.quotas.updatePolicy(user.sub, body);
  }
}
