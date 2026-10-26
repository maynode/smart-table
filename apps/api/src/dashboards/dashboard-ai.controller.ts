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
import { DashboardAiService } from './dashboard-ai.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class DashboardAiController {
  constructor(private readonly ai: DashboardAiService) {}

  @Get('dashboards/:id/ai/session')
  getSession(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.ai.getSession(id, user.sub);
  }

  @Delete('dashboards/:id/ai/session/messages')
  clearMessages(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.ai.clearMessages(id, user.sub);
  }

  @Post('dashboards/:id/ai/chat')
  chat(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { text?: string; clientMessageId?: string },
  ) {
    return this.ai.chat(
      id,
      user.sub,
      body?.text ?? '',
      body?.clientMessageId,
    );
  }
}
