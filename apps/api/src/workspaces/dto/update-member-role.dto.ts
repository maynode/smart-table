import { WorkspaceRole } from '@prisma/client';
import { IsIn } from 'class-validator';
import { WORKSPACE_ROLES } from '../workspace-roles';

export class UpdateMemberRoleDto {
  @IsIn(WORKSPACE_ROLES)
  role!: WorkspaceRole;
}
