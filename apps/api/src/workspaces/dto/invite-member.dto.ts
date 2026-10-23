import { WorkspaceRole } from '@prisma/client';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { WORKSPACE_ROLES } from '../workspace-roles';

export class InviteMemberDto {
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  account!: string;

  @IsIn(WORKSPACE_ROLES)
  role!: WorkspaceRole;
}
