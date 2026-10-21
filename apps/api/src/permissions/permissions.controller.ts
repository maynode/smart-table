import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import {
  PermissionsService,
  type AclConfig,
} from './permissions.service';

@Controller('permissions')
@UseGuards(JwtAuthGuard)
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('baseId', new ParseUUIDPipe()) baseId: string,
  ) {
    return this.permissions.listForBase(baseId, user.sub);
  }

  @Get(':objectType/:objectId')
  get(
    @CurrentUser() user: JwtPayload,
    @Param('objectType') objectType: string,
    @Param('objectId', new ParseUUIDPipe()) objectId: string,
  ) {
    return this.permissions.getSettings(objectType, objectId, user.sub);
  }

  @Put(':objectType/:objectId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('objectType') objectType: string,
    @Param('objectId', new ParseUUIDPipe()) objectId: string,
    @Body()
    body: {
      everyone?: AclConfig;
      members?: Array<AclConfig & { userId: string }>;
    },
  ) {
    return this.permissions.updateSettings(
      objectType,
      objectId,
      user.sub,
      body ?? {},
    );
  }

  @Delete(':objectType/:objectId/members/:memberId')
  removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('objectType') objectType: string,
    @Param('objectId', new ParseUUIDPipe()) objectId: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
  ) {
    return this.permissions.removeMember(
      objectType,
      objectId,
      user.sub,
      memberId,
    );
  }
}
