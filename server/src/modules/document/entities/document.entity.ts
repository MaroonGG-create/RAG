import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { KnowledgeBase } from '../../knowledge-base/entities/knowledge-base.entity';
import { DocumentChunk } from './document-chunk.entity';

export const DOCUMENT_STATUSES = [
  'pending',
  'parsing',
  'chunking',
  'embedding',
  'completed',
  'failed',
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

@Entity({ name: 'document', engine: 'InnoDB' })
@Index('uk_kb_hash', ['kbId', 'fileHash'], { unique: true })
@Index('idx_kb_status', ['kbId', 'status'])
export class Document {
  @PrimaryGeneratedColumn({ name: 'id', type: 'int', unsigned: true })
  id!: number;

  @Column({ name: 'kb_id', type: 'int', unsigned: true })
  kbId!: number;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string;

  @Column({
    name: 'file_ext',
    type: 'varchar',
    length: 10,
    comment: '文件格式由应用层校验，仅允许 pdf、md、txt',
  })
  fileExt!: string;

  // MVP 单文件上限为 20MB，BIGINT 在该范围内可安全映射为 number。
  @Column({ name: 'file_size', type: 'bigint', unsigned: true })
  fileSize!: number;

  @Column({ name: 'file_hash', type: 'char', length: 64 })
  fileHash!: string;

  @Column({ name: 'storage_path', type: 'varchar', length: 500 })
  storagePath!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: [...DOCUMENT_STATUSES],
    default: 'pending',
  })
  status!: DocumentStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({
    name: 'chunk_count',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  chunkCount!: number;

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

  @ManyToOne(
    () => KnowledgeBase,
    (knowledgeBase) => knowledgeBase.documents,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'kb_id' })
  knowledgeBase!: KnowledgeBase;

  @OneToMany(() => DocumentChunk, (chunk) => chunk.document)
  chunks!: DocumentChunk[];
}
