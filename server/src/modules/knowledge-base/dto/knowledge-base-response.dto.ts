import { ApiProperty } from '@nestjs/swagger';

import { KnowledgeBase } from '../entities/knowledge-base.entity';

export class KnowledgeBaseResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: '产品文档库' })
  name!: string;

  @ApiProperty({
    type: String,
    example: '产品相关文档',
    nullable: true,
  })
  description!: string | null;

  @ApiProperty({ example: 0 })
  documentCount!: number;

  @ApiProperty({ example: '2026-07-24T08:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-24T08:00:00.000Z', format: 'date-time' })
  updatedAt!: string;

  static fromEntity(entity: KnowledgeBase): KnowledgeBaseResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      documentCount: entity.documentCount,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
