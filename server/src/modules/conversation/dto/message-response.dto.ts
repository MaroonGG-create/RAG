import { ApiProperty } from '@nestjs/swagger';

import { MessageReference } from '../entities/message-reference.entity';
import { Message } from '../entities/message.entity';

export class MessageReferenceResponseDto {
  @ApiProperty({ example: 45, nullable: true })
  documentId!: number | null;

  @ApiProperty({ example: 123, nullable: true })
  chunkId!: number | null;

  @ApiProperty({ example: '产品手册.pdf' })
  documentName!: string;

  @ApiProperty({ example: 3 })
  chunkIndex!: number;

  @ApiProperty({ type: Number, nullable: true, example: 12 })
  pageNo!: number | null;

  @ApiProperty({ example: 0.8732 })
  score!: number;

  @ApiProperty({ example: '切片内容快照...' })
  contentSnapshot!: string;

  static fromEntity(
    reference: MessageReference,
  ): MessageReferenceResponseDto {
    return {
      documentId: reference.documentId,
      chunkId: reference.chunkId,
      documentName: reference.documentName,
      chunkIndex: reference.chunkIndex,
      pageNo: reference.pageNo,
      score: reference.score,
      contentSnapshot: reference.contentSnapshot,
    };
  }
}

export class MessageResponseDto {
  @ApiProperty({ example: 5 })
  id!: number;

  @ApiProperty({ example: 'user' })
  role!: string;

  @ApiProperty({ example: '什么是 RAG？' })
  content!: string;

  @ApiProperty({ example: 'completed' })
  status!: string;

  @ApiProperty({ nullable: true, example: null })
  errorMessage!: string | null;

  @ApiProperty({ example: '2026-07-31T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ type: [MessageReferenceResponseDto] })
  references!: MessageReferenceResponseDto[];

  static fromEntity(message: Message): MessageResponseDto {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      errorMessage: message.errorMessage,
      createdAt: message.createdAt,
      references: (message.references ?? []).map((reference) =>
        MessageReferenceResponseDto.fromEntity(reference),
      ),
    };
  }
}
