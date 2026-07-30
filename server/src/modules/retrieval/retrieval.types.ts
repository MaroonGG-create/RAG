export interface RetrievalResult {
  chunkId: number;
  documentId: number;
  documentName: string;
  chunkIndex: number;
  pageNo: number | null;
  content: string;
  score: number;
}

export interface RetrievalResponseData {
  results: RetrievalResult[];
  total: number;
  took: number;
}

export class RetrievalFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetrievalFailure';
  }
}
