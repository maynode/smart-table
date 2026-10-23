import { IsBoolean } from 'class-validator';

export class PinWorkspaceDto {
  @IsBoolean()
  pinned!: boolean;
}
