import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { TemplatesService } from './templates.service';

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list(@Query('scope') scope?: string) {
    const normalized = scope === 'base' ? 'base' : 'workspace';
    return this.templates.list(normalized);
  }

  @Post(':key/instantiate')
  instantiate(
    @CurrentUser() user: JwtPayload,
    @Param('key') key: string,
    @Body()
    body: { workspaceId?: string; baseId?: string; name?: string },
  ) {
    if (!body.workspaceId && !body.baseId) {
      throw new BadRequestException('workspaceId 或 baseId 不能为空');
    }
    return this.templates.instantiate(
      body.workspaceId ?? '',
      user.sub,
      key,
      body.name,
      body.baseId,
    );
  }
}
