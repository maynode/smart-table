import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LiveBusService } from './live-bus.service';
import { LiveController } from './live.controller';
import { LiveGateway } from './live.gateway';
import { LiveRoomService } from './live-room.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [LiveController],
  providers: [LiveBusService, LiveRoomService, LiveGateway],
  exports: [LiveBusService],
})
export class LiveModule {}
