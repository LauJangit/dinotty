export type CsvRow = string[]

export function isCsvPreviewFile(filePath: string | undefined): boolean {
  // 步骤1：没有文件路径时不启用 CSV 预览。
  if (!filePath) return false

  // 步骤2：按不区分大小写的扩展名识别 CSV 和 TSV。
  const normalizedPath = filePath.toLowerCase()
  return normalizedPath.endsWith('.csv') || normalizedPath.endsWith('.tsv')
}

export function detectCsvDelimiter(csvText: string, filePath: string): string {
  // 步骤1：TSV 文件始终优先使用制表符。
  if (filePath.toLowerCase().endsWith('.tsv')) return '\t'

  // 步骤2：提取第一条非空记录，忽略引号内的换行。
  let sampleRecord = ''
  let insideQuotes = false

  for (let characterIndex = 0; characterIndex < csvText.length; characterIndex += 1) {
    const currentCharacter = csvText[characterIndex]
    const nextCharacter = csvText[characterIndex + 1]

    if (currentCharacter === '"' && insideQuotes && nextCharacter === '"') {
      sampleRecord += '""'
      characterIndex += 1
      continue
    }

    if (currentCharacter === '"') {
      insideQuotes = !insideQuotes
      sampleRecord += currentCharacter
      continue
    }

    if ((currentCharacter === '\n' || currentCharacter === '\r') && !insideQuotes) {
      if (sampleRecord.trim() !== '') break
      sampleRecord = ''
      continue
    }

    sampleRecord += currentCharacter
  }

  // 步骤3：统计引号外的候选分隔符。
  const delimiterCandidates = [',', '\t', ';', '|']
  const delimiterCounts = [0, 0, 0, 0]
  insideQuotes = false

  for (let characterIndex = 0; characterIndex < sampleRecord.length; characterIndex += 1) {
    const currentCharacter = sampleRecord[characterIndex]
    const nextCharacter = sampleRecord[characterIndex + 1]

    if (currentCharacter === '"' && insideQuotes && nextCharacter === '"') {
      characterIndex += 1
      continue
    }

    if (currentCharacter === '"') {
      insideQuotes = !insideQuotes
      continue
    }

    if (insideQuotes) continue

    for (let candidateIndex = 0; candidateIndex < delimiterCandidates.length; candidateIndex += 1) {
      if (currentCharacter === delimiterCandidates[candidateIndex]) {
        delimiterCounts[candidateIndex] += 1
      }
    }
  }

  // 步骤4：返回出现次数最多的分隔符，无法判断时使用逗号。
  let selectedDelimiter = ','
  let highestCount = 0

  for (let candidateIndex = 0; candidateIndex < delimiterCandidates.length; candidateIndex += 1) {
    if (delimiterCounts[candidateIndex] > highestCount) {
      selectedDelimiter = delimiterCandidates[candidateIndex]
      highestCount = delimiterCounts[candidateIndex]
    }
  }

  return selectedDelimiter
}

export function parseCsvText(csvText: string, delimiter: string): CsvRow[] {
  // 步骤1：逐字符解析，保留引号内的分隔符和换行。
  const parsedRows: CsvRow[] = []
  let currentRow: CsvRow = []
  let currentField = ''
  let insideQuotes = false

  for (let characterIndex = 0; characterIndex < csvText.length; characterIndex += 1) {
    const currentCharacter = csvText[characterIndex]
    const nextCharacter = csvText[characterIndex + 1]

    if (currentCharacter === '"' && insideQuotes && nextCharacter === '"') {
      currentField += '"'
      characterIndex += 1
      continue
    }

    if (currentCharacter === '"') {
      insideQuotes = !insideQuotes
      continue
    }

    if (currentCharacter === delimiter && !insideQuotes) {
      currentRow.push(currentField)
      currentField = ''
      continue
    }

    if ((currentCharacter === '\n' || currentCharacter === '\r') && !insideQuotes) {
      if (currentCharacter === '\r' && nextCharacter === '\n') characterIndex += 1
      currentRow.push(currentField)
      parsedRows.push(currentRow)
      currentRow = []
      currentField = ''
      continue
    }

    currentField += currentCharacter
  }

  // 步骤2：补上文件末尾没有换行的最后一行。
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField)
    parsedRows.push(currentRow)
  }

  // 步骤3：删除文件末尾由空行产生的空记录。
  while (parsedRows.length > 0) {
    const lastRow = parsedRows[parsedRows.length - 1]
    if (lastRow.length !== 1 || lastRow[0] !== '') break
    parsedRows.pop()
  }

  return parsedRows
}
