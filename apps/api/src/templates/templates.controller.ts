import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
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
  list() {
    return this.templates.list();
  }

  @Post(':key/instantiate')
  instantiate(
    @CurrentUser() user: JwtPayload,
    @Param('key') key: string,
    @Body()
    body: { workspaceId: string; folderId?: string | null },
  ) {
    if (!body.workspaceId) {
      throw new BadRequestException('workspaceId 不能为空');
    }
    return this.templates.instantiate(
      body.workspaceId,
      user.sub,
      key,
      body.folderId,
    );
  }
}
