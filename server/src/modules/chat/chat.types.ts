export interface ReferenceSnapshot {
  chunkId: number;
  documentId: number;
  documentName: string;
  pageNo: number | null;
  content: string;
  score: number;
}

export interface ChatMetadataEvent {
  conversationId: number;
  userMessageId: number;
}

export interface ChatTokenEvent {
  delta: string;
}

export interface ChatDoneEvent {
  assistantMessageId: number;
}

export interface ChatErrorEvent {
  message: string;
}
