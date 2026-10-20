import { IsObject } from 'class-validator';

export class CreateRecordDto {
  @IsObject()
  cells!: Record<string, unknown>;
}
