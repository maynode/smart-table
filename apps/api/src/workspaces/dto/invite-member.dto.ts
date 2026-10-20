import { WorkspaceRole } from '@prisma/client';
import { IsEmail, IsIn, MaxLength } from 'class-validator';
import { WORKSPACE_ROLES } from '../workspace-roles';

export class InviteMemberDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(WORKSPACE_ROLES)
  role!: WorkspaceRole;
}
