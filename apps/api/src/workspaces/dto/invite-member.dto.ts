import { WorkspaceRole } from '@prisma/client';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { ACCOUNT_MAX_LENGTH, ACCOUNT_MIN_LENGTH } from 'shared';
import { WORKSPACE_ROLES } from '../workspace-roles';

export class InviteMemberDto {
  @IsString()
  @MinLength(ACCOUNT_MIN_LENGTH)
  @MaxLength(ACCOUNT_MAX_LENGTH)
  account!: string;

  @IsIn(WORKSPACE_ROLES)
  role!: WorkspaceRole;
}
