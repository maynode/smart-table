import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateAvatarDto {
  @IsString()
  @MinLength(1, { message: '请选择头像' })
  @MaxLength(64, { message: '头像种子过长' })
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: '头像种子无效' })
  avatarSeed!: string;
}
