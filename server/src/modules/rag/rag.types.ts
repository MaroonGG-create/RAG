export interface RagReference {
  chunkId: number;
  documentId: number;
  documentName: string;
  pageNo: number | null;
  content: string;
  score: number;
}

export interface RagResponseData {
  answer: string;
  references: RagReference[];
  retrievalTook: number;
  llmTook: number;
  took: number;
}
