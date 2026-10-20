import { Module } from '@nestjs/common';
import { SheetsModule } from '../sheets/sheets.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [SheetsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
