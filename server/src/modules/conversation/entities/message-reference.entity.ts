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

import { Message } from './message.entity';

@Entity({ name: 'message_reference', engine: 'InnoDB' })
@Index('idx_msg', ['messageId'])
export class MessageReference {
  @PrimaryGeneratedColumn({ name: 'id', type: 'int', unsigned: true })
  id!: number;

  @Column({ name: 'message_id', type: 'int', unsigned: true })
  messageId!: number;

  // 无 FK 快照列：文档删除后仍保留原始定位信息。
  @Column({
    name: 'document_id',
    type: 'int',
    unsigned: true,
    nullable: true,
  })
  documentId!: number | null;

  // 无 FK 快照列：切片删除后仍保留原始定位信息。
  @Column({
    name: 'chunk_id',
    type: 'int',
    unsigned: true,
    nullable: true,
  })
  chunkId!: number | null;

  @Column({ name: 'document_name', type: 'varchar', length: 255 })
  documentName!: string;

  @Column({ name: 'chunk_index', type: 'int', unsigned: true })
  chunkIndex!: number;

  @Column({
    name: 'page_no',
    type: 'int',
    unsigned: true,
    nullable: true,
  })
  pageNo!: number | null;

  @Column({
    name: 'score',
    type: 'decimal',
    precision: 5,
    scale: 4,
    transformer: {
      to: (value: number): number => value,
      // mysql2 默认将 DECIMAL 返回为 string，实体统一转换为可排序的 number。
      from: (value: string): number => Number(value),
    },
  })
  score!: number;

  @Column({ name: 'content_snapshot', type: 'text' })
  contentSnapshot!: string;

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

  @ManyToOne(() => Message, (message) => message.references, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'message_id' })
  message!: Message;
}
