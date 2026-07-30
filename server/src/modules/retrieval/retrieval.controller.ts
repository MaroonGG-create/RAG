import {
  BadGatewayException,
  Body,
  Controller,
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
import { RetrievalRequestDto } from './dto/retrieval-request.dto';
import { RetrievalResponseDto } from './dto/retrieval-response.dto';
import { RetrievalService } from './retrieval.service';
import { RetrievalResponseData } from './retrieval.types';

@ApiTags('retrieval')
@Controller('knowledge-bases/:id/retrieve')
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Post()
  @ApiOperation({ summary: '向量检索' })
  @ApiOkResponse({ type: RetrievalResponseDto })
  @ApiBadRequestResponse({ description: '请求参数校验失败' })
  @ApiNotFoundResponse({ description: '知识库不存在' })
  @ApiBadGatewayResponse({
    description: '检索服务暂时不可用：向量生成失败',
  })
  async retrieve(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: RetrievalRequestDto,
  ): Promise<RetrievalResponseData> {
    try {
      return await this.retrievalService.search(
        id,
        dto.query,
        dto.topK,
        dto.scoreThreshold,
      );
    } catch (error: unknown) {
      if (error instanceof EmbeddingFailure) {
        throw new BadGatewayException(
          '检索服务暂时不可用：向量生成失败',
        );
      }

      throw error;
    }
  }
}
