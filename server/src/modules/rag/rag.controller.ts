import {
  BadGatewayException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ParsePositiveIntPipe } from '../../common/pipes/parse-positive-int.pipe';
import { EmbeddingFailure } from '../embedding/embedding.types';
import { LlmFailure } from '../llm/llm.types';
import { RagRequestDto } from './dto/rag-request.dto';
import { RagResponseDto } from './dto/rag-response.dto';
import { RagService } from './rag.service';
import { RagResponseData } from './rag.types';

@ApiTags('rag')
@Controller('knowledge-bases/:id/ask')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'RAG 问答' })
  @ApiOkResponse({ type: RagResponseDto })
  @ApiBadRequestResponse({ description: '请求参数校验失败' })
  @ApiNotFoundResponse({ description: '知识库不存在' })
  @ApiBadGatewayResponse({
    description:
      '问答服务暂时不可用：向量生成失败或模型调用失败',
  })
  async ask(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: RagRequestDto,
  ): Promise<RagResponseData> {
    try {
      return await this.ragService.ask(
        id,
        dto.question,
        dto.topK,
        dto.scoreThreshold,
      );
    } catch (error: unknown) {
      if (error instanceof EmbeddingFailure) {
        throw new BadGatewayException(
          '问答服务暂时不可用：向量生成失败',
        );
      }

      if (error instanceof LlmFailure) {
        throw new BadGatewayException(
          '问答服务暂时不可用：模型调用失败',
        );
      }

      throw error;
    }
  }
}
