import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { AuditService } from './audit.service';

@Controller('workspaces/:workspaceId/audit-logs')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query()
    query: {
      action?: string;
      objectType?: string;
      actorId?: string;
      limit?: string;
    },
  ) {
    return this.audit.list(workspaceId, user.sub, query);
  }
}
