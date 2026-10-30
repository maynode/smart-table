import { Module, forwardRef } from '@nestjs/common';
import { ActivityCoreModule } from '../activity/activity-core.module';
import { AuthModule } from '../auth/auth.module';
import { SheetsModule } from '../sheets/sheets.module';
import { CollabController } from './collab.controller';
import { CollabFanoutService } from './collab-fanout.service';
import { CollabGateway } from './collab.gateway';
import { CollabRoomService } from './collab-room.service';

@Module({
  imports: [AuthModule, ActivityCoreModule, forwardRef(() => SheetsModule)],
  controllers: [CollabController],
  providers: [CollabFanoutService, CollabRoomService, CollabGateway],
  exports: [CollabRoomService, CollabFanoutService],
})
export class CollabModule {}
