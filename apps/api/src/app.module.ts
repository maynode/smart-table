import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BasesModule } from './bases/bases.module';
import { CommentsModule } from './comments/comments.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { SheetsModule } from './sheets/sheets.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    AuthModule,
    WorkspacesModule,
    BasesModule,
    SheetsModule,
    CommentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
