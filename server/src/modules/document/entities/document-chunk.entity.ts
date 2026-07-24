import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Document } from './document.entity';

@Entity({ name: 'document_chunk', engine: 'InnoDB' })
@Index('uk_doc_index', ['documentId', 'chunkIndex'], { unique: true })
@Index('uk_qdrant_point', ['qdrantPointId'], { unique: true })
@Index('idx_kb', ['kbId'])
export class DocumentChunk {
  @PrimaryGeneratedColumn({ name: 'id', type: 'int', unsigned: true })
  id!: number;

  @Column({ name: 'document_id', type: 'int', unsigned: true })
  documentId!: number;

  // 无 FK 冗余列：切片生命周期跟随 document，此列仅供按知识库直查。
  @Column({ name: 'kb_id', type: 'int', unsigned: true })
  kbId!: number;

  @Column({ name: 'chunk_index', type: 'int', unsigned: true })
  chunkIndex!: number;

  @Column({ name: 'content', type: 'text' })
  content!: string;

  @Column({ name: 'char_count', type: 'int', unsigned: true })
  charCount!: number;

  @Column({
    name: 'page_no',
    type: 'int',
    unsigned: true,
    nullable: true,
  })
  pageNo!: number | null;

  @Column({ name: 'qdrant_point_id', type: 'char', length: 36 })
  qdrantPointId!: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP(6)',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP(6)',
    onUpdate: 'CURRENT_TIMESTAMP(6)',
  })
  updatedAt!: Date;

  @ManyToOne(() => Document, (document) => document.chunks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'document_id' })
  document!: Document;
}
