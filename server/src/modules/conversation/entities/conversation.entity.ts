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
import { Message } from './message.entity';

@Entity({ name: 'conversation', engine: 'InnoDB' })
@Index('idx_kb', ['kbId'])
export class Conversation {
  @PrimaryGeneratedColumn({ name: 'id', type: 'int', unsigned: true })
  id!: number;

  @Column({ name: 'kb_id', type: 'int', unsigned: true })
  kbId!: number;

  @Column({ name: 'title', type: 'varchar', length: 200 })
  title!: string;

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
    (knowledgeBase) => knowledgeBase.conversations,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'kb_id' })
  knowledgeBase!: KnowledgeBase;

  @OneToMany(() => Message, (message) => message.conversation)
  messages!: Message[];
}
