import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BasesModule } from './bases/bases.module';
import { CommentsModule } from './comments/comments.module';
import { AutomationsModule } from './automations/automations.module';
import { FormsModule } from './forms/forms.module';
import { HealthController } from './health.controller';
import { MetricsModule } from './metrics/metrics.module';
import { PrismaModule } from './prisma/prisma.module';
import { SheetsModule } from './sheets/sheets.module';
import { StorageModule } from './storage/storage.module';
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
    AutomationsModule,
    FormsModule,
    StorageModule,
    MetricsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
