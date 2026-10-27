import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { StorageModule } from '../storage/storage.module';
import { assertJwtSecretOrExit } from './assert-jwt-secret';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
@Global()
@Module({
  imports: [
    StorageModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: assertJwtSecretOrExit(config.get<string>('JWT_SECRET'), {
          nodeEnv: config.get<string>('NODE_ENV') ?? process.env.NODE_ENV,
          strictEnv: config.get<string>('STRICT_ENV') ?? process.env.STRICT_ENV,
        }),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ??
            '7d') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
