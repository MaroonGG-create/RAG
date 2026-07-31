import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';

import { SkipResponseWrap } from '../../common/decorators/skip-response-wrap.decorator';
import { ParsePositiveIntPipe } from '../../common/pipes/parse-positive-int.pipe';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';

@ApiTags('chat')
@Controller('knowledge-bases/:id/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @SkipResponseWrap()
  @ApiOperation({ summary: 'SSE 流式知识库问答' })
  @ApiOkResponse({ description: 'text/event-stream' })
  @ApiBadRequestResponse({ description: '请求参数校验失败' })
  @ApiNotFoundResponse({ description: '知识库或会话不存在' })
  @ApiConflictResponse({ description: '当前会话正在生成回答' })
  async chat(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: ChatRequestDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const abortController = new AbortController();
    const closeHandler = (): void => abortController.abort();
    request.on('close', closeHandler);

    try {
      await this.chatService.streamChat(
        id,
        dto.question,
        dto.conversationId,
        dto.topK,
        dto.scoreThreshold,
        response,
        abortController.signal,
      );
    } finally {
      request.off('close', closeHandler);
    }
  }
}
