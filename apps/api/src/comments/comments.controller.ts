import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtPayload } from '../auth/jwt-auth.guard';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';

@Controller('sheets/:sheetId/comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId') sheetId: string,
  ) {
    return this.commentsService.list(sheetId, user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param('sheetId') sheetId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.create(
      sheetId,
      user.sub,
      dto.body,
      dto.mentionedUserIds ?? [],
    );
  }
}
