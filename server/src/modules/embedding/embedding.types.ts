export interface EmbeddingApiRequest {
  model: string;
  input: string[];
}

export interface EmbeddingApiItem {
  embedding: number[];
  index: number;
}

export interface EmbeddingApiResponse {
  data: EmbeddingApiItem[];
  model: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

export interface EmbeddedChunk {
  chunkId: number;
  chunkIndex: number;
  qdrantPointId: string;
  content: string;
  charCount: number;
  pageNo: number | null;
  kbId: number;
  documentId: number;
  vector: number[];
}

export interface EmbeddingResult {
  documentId: number;
  chunks: EmbeddedChunk[];
  totalChunks: number;
  vectorDimension: number;
  batchCount: number;
}

export class EmbeddingFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingFailure';
  }
}
