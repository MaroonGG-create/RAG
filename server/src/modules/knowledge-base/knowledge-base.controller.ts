import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ParsePositiveIntPipe } from '../../common/pipes/parse-positive-int.pipe';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { KnowledgeBaseResponseDto } from './dto/knowledge-base-response.dto';
import { KnowledgeBaseService } from './knowledge-base.service';

@ApiTags('knowledge-bases')
@Controller('knowledge-bases')
export class KnowledgeBaseController {
  constructor(
    private readonly knowledgeBaseService: KnowledgeBaseService,
  ) {}

  @Post()
  @ApiOperation({ summary: '创建知识库' })
  @ApiCreatedResponse({ type: KnowledgeBaseResponseDto })
  @ApiBadRequestResponse({ description: '请求参数校验失败' })
  @ApiConflictResponse({ description: '知识库名称已存在' })
  create(
    @Body() dto: CreateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseResponseDto> {
    return this.knowledgeBaseService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: '获取知识库列表' })
  @ApiOkResponse({ type: KnowledgeBaseResponseDto, isArray: true })
  findAll(): Promise<KnowledgeBaseResponseDto[]> {
    return this.knowledgeBaseService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取知识库详情' })
  @ApiOkResponse({ type: KnowledgeBaseResponseDto })
  @ApiBadRequestResponse({ description: 'id 必须是正整数' })
  @ApiNotFoundResponse({ description: '知识库不存在' })
  findOne(
    @Param('id', ParsePositiveIntPipe) id: number,
  ): Promise<KnowledgeBaseResponseDto> {
    return this.knowledgeBaseService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除知识库' })
  @ApiNoContentResponse({ description: '知识库删除成功' })
  @ApiBadRequestResponse({ description: 'id 必须是正整数' })
  @ApiNotFoundResponse({ description: '知识库不存在' })
  remove(@Param('id', ParsePositiveIntPipe) id: number): Promise<void> {
    return this.knowledgeBaseService.remove(id);
  }
}
