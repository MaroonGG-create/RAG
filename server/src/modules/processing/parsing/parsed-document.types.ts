export interface ParsedPage {
  pageNo: number | null;
  text: string;
}

export interface ParsedDocument {
  documentId: number;
  fileExt: 'pdf' | 'md' | 'txt';
  parser: 'pdfjs' | 'plaintext';
  parserVersion: string;
  fileHash: string;
  parsedAt: string;
  pages: ParsedPage[];
  totalChars: number;
}

export class ParseFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseFailure';
  }
}
