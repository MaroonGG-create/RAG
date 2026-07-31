export const MAX_DOCUMENT_FILE_SIZE_MB = 20
export const MAX_DOCUMENT_FILE_SIZE_BYTES =
  MAX_DOCUMENT_FILE_SIZE_MB * 1024 * 1024
export const ACCEPT_DOCUMENT_EXTENSIONS = '.pdf,.md,.txt'

const DOCUMENT_EXTENSIONS = ['pdf', 'md', 'txt'] as const

export function isAllowedDocumentFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase()

  return (
    extension !== undefined &&
    DOCUMENT_EXTENSIONS.some((allowed) => allowed === extension)
  )
}
