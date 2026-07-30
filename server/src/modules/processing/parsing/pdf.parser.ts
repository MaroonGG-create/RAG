import { dirname, join } from 'node:path';

import type { PDFDocumentProxy } from 'pdfjs-dist';

import {
  ParsedPage,
  ParseFailure,
} from './parsed-document.types';

const pdfjsLib: typeof import('pdfjs-dist') = require('pdfjs-dist/legacy/build/pdf.js');
const pdfjsPackage = require('pdfjs-dist/package.json') as { version: string };
const CMAP_URL = `${join(
  dirname(require.resolve('pdfjs-dist/package.json')),
  'cmaps',
)}/`;

pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve(
  'pdfjs-dist/legacy/build/pdf.worker.js',
);

export const PDF_PARSER_VERSION = pdfjsPackage.version;

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

export async function parsePdfPages(filePath: string): Promise<ParsedPage[]> {
  try {
    const loadingTask = pdfjsLib.getDocument({
      url: filePath,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      disableFontFace: true,
    });
    const pdf = await loadingTask.promise;

    try {
      return await extractPages(pdf);
    } finally {
      await pdf.destroy();
    }
  } catch (error: unknown) {
    throw mapPdfError(error);
  }
}

async function extractPages(pdf: PDFDocumentProxy): Promise<ParsedPage[]> {
  const pages: ParsedPage[] = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);

    try {
      const content = await page.getTextContent();
      let text = '';

      for (const item of content.items as unknown[]) {
        if (!isTextItem(item)) {
          continue;
        }

        text += item.str;

        if (item.hasEOL) {
          text += '\n';
        }
      }

      pages.push({ pageNo, text });
    } finally {
      page.cleanup();
    }
  }

  return pages;
}

function isTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof item.str === 'string'
  );
}

function mapPdfError(error: unknown): Error {
  const name = error instanceof Error ? error.name : '';

  if (name === 'PasswordException') {
    return new ParseFailure('加密或受密码保护的 PDF 暂不支持');
  }

  if (name === 'InvalidPDFException') {
    return new ParseFailure('PDF 文件损坏或格式无法解析');
  }

  return error instanceof Error ? error : new Error('PDF 解析失败');
}
