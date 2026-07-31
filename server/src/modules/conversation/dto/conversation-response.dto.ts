import { ApiProperty } from '@nestjs/swagger';

import { Conversation } from '../entities/conversation.entity';

export class ConversationResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: '什么是 RAG？' })
  title!: string;

  @ApiProperty({ example: '2026-07-31T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-07-31T10:05:00.000Z' })
  updatedAt!: Date;

  static fromEntity(
    conversation: Conversation,
  ): ConversationResponseDto {
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }
}
