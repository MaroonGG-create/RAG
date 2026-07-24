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

import { Conversation } from './conversation.entity';
import { MessageReference } from './message-reference.entity';

export const MESSAGE_ROLES = ['user', 'assistant'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_STATUSES = ['completed', 'failed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

@Entity({ name: 'message', engine: 'InnoDB' })
@Index('idx_conv', ['conversationId', 'id'])
export class Message {
  @PrimaryGeneratedColumn({ name: 'id', type: 'int', unsigned: true })
  id!: number;

  @Column({ name: 'conversation_id', type: 'int', unsigned: true })
  conversationId!: number;

  @Column({
    name: 'role',
    type: 'enum',
    enum: [...MESSAGE_ROLES],
  })
  role!: MessageRole;

  @Column({ name: 'content', type: 'text' })
  content!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: [...MESSAGE_STATUSES],
    default: 'completed',
  })
  status!: MessageStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

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
    () => Conversation,
    (conversation) => conversation.messages,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;

  @OneToMany(
    () => MessageReference,
    (messageReference) => messageReference.message,
  )
  references!: MessageReference[];
}
