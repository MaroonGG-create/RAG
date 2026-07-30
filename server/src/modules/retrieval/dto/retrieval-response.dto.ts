import { ApiProperty } from '@nestjs/swagger';

export class RetrievalResultDto {
  @ApiProperty({ example: 123 })
  chunkId!: number;

  @ApiProperty({ example: 45 })
  documentId!: number;

  @ApiProperty({ example: '产品手册.pdf' })
  documentName!: string;

  @ApiProperty({ example: 3 })
  chunkIndex!: number;

  @ApiProperty({ type: Number, nullable: true, example: 12 })
  pageNo!: number | null;

  @ApiProperty({ example: 'RAG 是检索增强生成。' })
  content!: string;

  @ApiProperty({ example: 0.8732 })
  score!: number;
}

export class RetrievalResponseDto {
  @ApiProperty({ type: [RetrievalResultDto] })
  results!: RetrievalResultDto[];

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 42 })
  took!: number;
}
