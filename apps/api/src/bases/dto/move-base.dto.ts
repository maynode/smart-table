import { IsUUID } from 'class-validator';

export class MoveBaseDto {
  @IsUUID()
  workspaceId!: string;
}
