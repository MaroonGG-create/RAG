import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';

import { ParsePositiveIntPipe } from '../../common/pipes/parse-positive-int.pipe';
import { DocumentResponseDto } from './dto/document-response.dto';
import { DocumentService } from './document.service';

@ApiTags('documents')
@Controller('knowledge-bases/:kbId/documents')
export class KnowledgeBaseDocumentsController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: '上传文档',
    description:
      '文件已接收且 pending 记录已创建；后续阶段才会异步解析和向量化，因此返回 202。',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiAcceptedResponse({ type: DocumentResponseDto })
  @ApiBadRequestResponse({ description: '未上传文件或参数非法' })
  @ApiNotFoundResponse({ description: '知识库不存在' })
  @ApiConflictResponse({ description: '同一知识库已存在相同文件' })
  @ApiPayloadTooLargeResponse({ description: '文件大小超出限制' })
  @ApiUnsupportedMediaTypeResponse({
    description: '文件类型或内容不受支持',
  })
  upload(
    @Param('kbId', ParsePositiveIntPipe) knowledgeBaseId: number,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<DocumentResponseDto> {
    if (file === undefined) {
      throw new BadRequestException('未上传文件');
    }

    return this.documentService.upload(knowledgeBaseId, file);
  }

  @Get()
  @ApiOperation({ summary: '获取知识库文档列表' })
  @ApiOkResponse({ type: DocumentResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: 'id 必须是正整数' })
  @ApiNotFoundResponse({ description: '知识库不存在' })
  findAll(
    @Param('kbId', ParsePositiveIntPipe) knowledgeBaseId: number,
  ): Promise<DocumentResponseDto[]> {
    return this.documentService.findAll(knowledgeBaseId);
  }
}
