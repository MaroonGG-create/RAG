import { ApiProperty } from '@nestjs/swagger';

import {
  Document,
  DOCUMENT_STATUSES,
  DocumentStatus,
} from '../entities/document.entity';

export type DocumentFileExtension = 'pdf' | 'md' | 'txt';

export class DocumentResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 1 })
  knowledgeBaseId!: number;

  @ApiProperty({ example: 'product-manual.pdf' })
  fileName!: string;

  @ApiProperty({ enum: ['pdf', 'md', 'txt'], example: 'pdf' })
  fileExt!: DocumentFileExtension;

  @ApiProperty({ example: 1024 })
  fileSize!: number;

  @ApiProperty({ enum: DOCUMENT_STATUSES, example: 'pending' })
  status!: DocumentStatus;

  @ApiProperty({ type: String, nullable: true, example: null })
  errorMessage!: string | null;

  @ApiProperty({ example: 0 })
  chunkCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  static fromEntity(entity: Document): DocumentResponseDto {
    return {
      id: entity.id,
      knowledgeBaseId: entity.kbId,
      fileName: entity.fileName,
      fileExt: entity.fileExt as DocumentFileExtension,
      // mysql2 会把 BIGINT 读成字符串；上传上限远低于安全整数范围，在 API 边界统一转回 number。
      fileSize: Number(entity.fileSize),
      status: entity.status,
      errorMessage: entity.errorMessage,
      chunkCount: entity.chunkCount,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
