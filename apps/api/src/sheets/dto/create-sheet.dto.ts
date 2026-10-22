import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSheetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /** 默认 true：写入空白表模板列+空行；测试可传 false 得到空表 */
  @IsOptional()
  @IsBoolean()
  seed?: boolean;
}
