import { IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateAgentSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  baseId?: string;
}

export class PostAgentMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  content!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(80)
  clientMessageId?: string;
}

export class CreateAgentTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

export class InvokeAgentToolDto {
  @IsObject()
  arguments!: Record<string, unknown>;
}
