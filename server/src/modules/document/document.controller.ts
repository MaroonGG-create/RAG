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
import { DocumentResponseDto } from './dto/document-response.dto';
import { DocumentService } from './document.service';

@ApiTags('documents')
@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Get(':id')
  @ApiOperation({ summary: '获取文档详情' })
  @ApiOkResponse({ type: DocumentResponseDto })
  @ApiBadRequestResponse({ description: 'id 必须是正整数' })
  @ApiNotFoundResponse({ description: '文档不存在' })
  findOne(
    @Param('id', ParsePositiveIntPipe) id: number,
  ): Promise<DocumentResponseDto> {
    return this.documentService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除文档' })
  @ApiNoContentResponse({ description: '文档删除成功' })
  @ApiBadRequestResponse({ description: 'id 必须是正整数' })
  @ApiNotFoundResponse({ description: '文档不存在' })
  remove(
    @Param('id', ParsePositiveIntPipe) id: number,
  ): Promise<void> {
    return this.documentService.remove(id);
  }
}
