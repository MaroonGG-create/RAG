import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Conversation } from '../../conversation/entities/conversation.entity';
import { Document } from '../../document/entities/document.entity';

@Entity({ name: 'knowledge_base', engine: 'InnoDB' })
@Index('idx_name', ['name'])
export class KnowledgeBase {
  @PrimaryGeneratedColumn({ name: 'id', type: 'int', unsigned: true })
  id!: number;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name!: string;

  @Column({
    name: 'description',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  description!: string | null;

  @Column({
    name: 'document_count',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  documentCount!: number;

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

  @OneToMany(() => Document, (document) => document.knowledgeBase)
  documents!: Document[];

  @OneToMany(
    () => Conversation,
    (conversation) => conversation.knowledgeBase,
  )
  conversations!: Conversation[];
}
