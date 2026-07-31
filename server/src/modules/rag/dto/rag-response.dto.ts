import { ApiProperty } from '@nestjs/swagger';

export class RagReferenceDto {
  @ApiProperty({ example: 123 })
  chunkId!: number;

  @ApiProperty({ example: 45 })
  documentId!: number;

  @ApiProperty({ example: '产品手册.pdf' })
  documentName!: string;

  @ApiProperty({ type: Number, nullable: true, example: 12 })
  pageNo!: number | null;

  @ApiProperty({ example: 'RAG 是检索增强生成。' })
  content!: string;

  @ApiProperty({ example: 0.8732 })
  score!: number;
}

export class RagResponseDto {
  @ApiProperty({ example: 'RAG 是检索增强生成。' })
  answer!: string;

  @ApiProperty({ type: [RagReferenceDto] })
  references!: RagReferenceDto[];

  @ApiProperty({ example: 42 })
  retrievalTook!: number;

  @ApiProperty({ example: 1200 })
  llmTook!: number;

  @ApiProperty({ example: 1242 })
  took!: number;
}
