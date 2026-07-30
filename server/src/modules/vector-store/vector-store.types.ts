export type QdrantDistance = 'Cosine';

export type QdrantFieldSchema = 'integer';

export interface QdrantPayload {
  [key: string]: string | number | null;
  chunkId: number;
  knowledgeBaseId: number;
  documentId: number;
  documentName: string;
  chunkIndex: number;
  pageNo: number | null;
  content: string;
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: QdrantPayload;
}

export interface QdrantScoredPoint {
  id: string;
  score: number;
  payload: QdrantPayload;
}

export interface QdrantVectorConfig {
  size: number;
  distance: string;
}

export interface QdrantMatchCondition {
  key: string;
  match: {
    value: string | number | boolean | null;
  };
}

export interface QdrantFilter {
  must: QdrantMatchCondition[];
}

export interface StoreResult {
  documentId: number;
  chunkCount: number;
  vectorCount: number;
  collectionName: string;
}

export class VectorStoreFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VectorStoreFailure';
  }
}
