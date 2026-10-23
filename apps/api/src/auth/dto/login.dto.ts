import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  account!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}
