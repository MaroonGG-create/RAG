export interface ChunkResult {
  documentId: number;
  chunkCount: number;
  totalChars: number;
}

export interface PreparedChunk {
  chunkIndex: number;
  content: string;
  charCount: number;
  pageNo: number | null;
  qdrantPointId: string;
}

export class ChunkFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChunkFailure';
  }
}
