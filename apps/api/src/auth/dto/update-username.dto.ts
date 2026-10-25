import { IsString, MaxLength, MinLength } from 'class-validator';
import { ACCOUNT_MAX_LENGTH, ACCOUNT_MIN_LENGTH } from 'shared';

export class UpdateUsernameDto {
  @IsString()
  @MinLength(ACCOUNT_MIN_LENGTH)
  @MaxLength(ACCOUNT_MAX_LENGTH)
  account!: string;
}
