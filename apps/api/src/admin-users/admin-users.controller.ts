import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { AdminUsersService } from './admin-users.service';

@Controller('admin/users')
@UseGuards(JwtAuthGuard)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('q') q?: string,
    @Query('identity') identity?: string,
  ) {
    return this.users.list(user.sub, q, identity);
  }

  @Post(':id/impersonate')
  impersonate(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.impersonate(user.sub, id);
  }

  @Post(':id/blacklist')
  blacklist(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { blacklisted?: boolean },
  ) {
    return this.users.setBlacklisted(
      user.sub,
      id,
      body.blacklisted !== false,
    );
  }

  @Post(':id/message')
  message(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { content?: string },
  ) {
    return this.users.sendMessage(user.sub, id, body.content ?? '');
  }

  @Post(':id/unlock-login')
  unlockLogin(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.unlockLogin(user.sub, id);
  }

  @Post(':id/install-admin')
  setInstallAdmin(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { installAdmin?: boolean },
  ) {
    return this.users.setInstallAdmin(
      user.sub,
      id,
      body.installAdmin !== false,
    );
  }
}
