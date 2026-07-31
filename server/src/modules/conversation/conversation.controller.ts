import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ParsePositiveIntPipe } from '../../common/pipes/parse-positive-int.pipe';
import { ConversationService } from './conversation.service';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { MessageService } from './message.service';

@ApiTags('conversations')
@Controller()
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
  ) {}

  @Get('knowledge-bases/:id/conversations')
  @ApiOperation({ summary: '获取知识库会话列表' })
  @ApiOkResponse({ type: ConversationResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: 'id 必须是正整数' })
  @ApiNotFoundResponse({ description: '知识库不存在' })
  async listConversations(
    @Param('id', ParsePositiveIntPipe) id: number,
  ): Promise<ConversationResponseDto[]> {
    await this.conversationService.validateKnowledgeBaseExists(id);
    const conversations =
      await this.conversationService.findConversationsByKnowledgeBaseId(
        id,
      );

    return conversations.map(ConversationResponseDto.fromEntity);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: '获取会话消息历史' })
  @ApiOkResponse({ type: MessageResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: 'id 必须是正整数' })
  @ApiNotFoundResponse({ description: '会话不存在' })
  async listMessages(
    @Param('id', ParsePositiveIntPipe) id: number,
  ): Promise<MessageResponseDto[]> {
    await this.conversationService.findConversationOrThrow(id);
    const messages =
      await this.messageService.findMessagesByConversationId(id);

    return messages.map(MessageResponseDto.fromEntity);
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除会话' })
  @ApiNoContentResponse({ description: '会话删除成功' })
  @ApiBadRequestResponse({ description: 'id 必须是正整数' })
  @ApiNotFoundResponse({ description: '会话不存在' })
  remove(
    @Param('id', ParsePositiveIntPipe) id: number,
  ): Promise<void> {
    return this.conversationService.remove(id);
  }
}
