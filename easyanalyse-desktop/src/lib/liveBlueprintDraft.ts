import type { DocumentFile, TerminalDirection } from '../types/document'
import { isRecord } from './guards'

export const LIVE_BLUEPRINT_JSON_MARKER = 'BEGIN_EASYANALYSE_BLUEPRINT_JSON'

export type LiveBlueprintDraftStatus =
  | 'marker-missing'
  | 'waiting-for-json'
  | 'partial-json'
  | 'invalid-json'
  | 'invalid-document'
  | 'ready'

export interface LiveBlueprintJsonSpan {
  json: string
  startIndex: number
  endIndex: number
}

export interface LiveBlueprintPartialJson {
  startIndex: number
  depth: number
  length: number
}

export interface LiveBlueprintJsonExtraction {
  markerFound: boolean
  markerIndex: number
  scanStartIndex: number
  candidate: LiveBlueprintJsonSpan | null
  partial: LiveBlueprintPartialJson | null
}

export interface LiveBlueprintDraftIssue {
  code: string
  message: string
  path?: string
}

export interface LiveBlueprintDraftError {
  code: string
  message: string
  index?: number
  line?: number
  column?: number
  excerpt?: string
  issues?: LiveBlueprintDraftIssue[]
}

export interface ParseLiveBlueprintDraftOptions {
  marker?: string
  lastGood?: DocumentFile | null
}

export interface LiveBlueprintDraftResult {
  status: LiveBlueprintDraftStatus
  markerFound: boolean
  hasCompleteJson: boolean
  updated: boolean
  displayDocument: DocumentFile | null
  lastGood: DocumentFile | null
  candidate: LiveBlueprintJsonSpan | null
  partial: LiveBlueprintPartialJson | null
  error?: LiveBlueprintDraftError
}

export function parseLiveBlueprintDraft(
  buffer: string,
  options: ParseLiveBlueprintDraftOptions = {},
): LiveBlueprintDraftResult {
  const marker = options.marker ?? LIVE_BLUEPRINT_JSON_MARKER
  const previousLastGood = options.lastGood ?? null
  const extraction = extractLastCompleteJsonObjectAfterMarker(buffer, marker)

  if (!extraction.markerFound) {
    return baseResult('marker-missing', extraction, previousLastGood)
  }

  if (!extraction.candidate) {
    const earlyDocument = extractFirstDisplayableDocumentFromPartial(buffer, extraction)
    if (earlyDocument) {
      return {
        status: earlyDocument.complete ? 'ready' : 'partial-json',
        markerFound: true,
        hasCompleteJson: earlyDocument.complete,
        updated: true,
        displayDocument: earlyDocument.document,
        lastGood: earlyDocument.document,
        candidate: earlyDocument.span,
        partial: extraction.partial,
      }
    }

    const status: LiveBlueprintDraftStatus = extraction.partial ? 'partial-json' : 'waiting-for-json'
    return baseResult(status, extraction, previousLastGood)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(extraction.candidate.json)
  } catch (error) {
    return {
      ...baseResult('invalid-json', extraction, previousLastGood),
      error: createJsonParseError(error, buffer, extraction.candidate),
    }
  }

  const documentCandidate = unwrapDisplayDocumentCandidate(parsed)
  const issues = collectDocumentFileIssues(documentCandidate.value, documentCandidate.path)
  if (issues.length > 0) {
    return {
      ...baseResult('invalid-document', extraction, previousLastGood),
      error: {
        code: 'invalid-document-file',
        message: 'A complete JSON object was extracted, but it is not a displayable EasyAnalyse DocumentFile.',
        issues,
      },
    }
  }

  const displayDocument = documentCandidate.value as DocumentFile
  return {
    status: 'ready',
    markerFound: true,
    hasCompleteJson: true,
    updated: true,
    displayDocument,
    lastGood: displayDocument,
    candidate: extraction.candidate,
    partial: extraction.partial,
  }
}

function unwrapDisplayDocumentCandidate(value: unknown): { value: unknown; path: string } {
  if (!isRecord(value)) {
    return { value, path: '$' }
  }

  if (
    value.schemaVersion === 'agent-response-v1' &&
    value.kind === 'blueprints' &&
    Array.isArray(value.blueprints)
  ) {
    const firstCandidate = value.blueprints[0]
    if (!isRecord(firstCandidate)) {
      return { value: undefined, path: '$.blueprints[0]' }
    }
    return { value: firstCandidate.document, path: '$.blueprints[0].document' }
  }

  return { value, path: '$' }
}

function extractFirstDisplayableDocumentFromPartial(
  buffer: string,
  extraction: LiveBlueprintJsonExtraction,
): { document: DocumentFile; span: LiveBlueprintJsonSpan; complete: boolean } | null {
  if (!extraction.markerFound || extraction.scanStartIndex < 0) return null

  const scanText = buffer.slice(extraction.scanStartIndex)
  const span = findFirstBlueprintDocumentSpan(scanText, extraction.scanStartIndex)
  if (!span) return extractFirstSynthesizedDocumentFromPartialObject(scanText, extraction.scanStartIndex)

  let parsed: unknown
  try {
    parsed = JSON.parse(span.json)
  } catch {
    return null
  }

  const issues = collectDocumentFileIssues(parsed, '$.blueprints[0].document')
  if (issues.length === 0) {
    return { document: parsed as DocumentFile, span, complete: true }
  }

  return extractFirstSynthesizedDocumentFromPartialObject(scanText, extraction.scanStartIndex)
}

function findFirstBlueprintDocumentSpan(text: string, absoluteOffset: number): LiveBlueprintJsonSpan | null {
  const rootStart = text.indexOf('{')
  if (rootStart < 0) return null

  const blueprintsValueStart = findDirectPropertyValueStart(text, rootStart, 'blueprints')
  if (blueprintsValueStart === null || text[blueprintsValueStart] !== '[') return null

  const firstCandidateStart = findFirstArrayObjectElementStart(text, blueprintsValueStart)
  if (firstCandidateStart === null) return null

  const documentValueStart = findDirectPropertyValueStart(text, firstCandidateStart, 'document')
  if (documentValueStart === null || text[documentValueStart] !== '{') return null

  return extractCompleteObjectSpanAt(text, documentValueStart, absoluteOffset)
}

function extractFirstSynthesizedDocumentFromPartialObject(
  text: string,
  absoluteOffset: number,
): { document: DocumentFile; span: LiveBlueprintJsonSpan; complete: boolean } | null {
  const rootStart = text.indexOf('{')
  if (rootStart < 0) return null

  const directDocument = synthesizeDisplayDocumentFromPartialObject(text, rootStart, absoluteOffset, '$')
  if (directDocument) return directDocument

  const documentValueStart = findFirstBlueprintDocumentValueStart(text)
  return documentValueStart === null
    ? null
    : synthesizeDisplayDocumentFromPartialObject(text, documentValueStart, absoluteOffset, '$.blueprints[0].document')
}

function findFirstBlueprintDocumentValueStart(text: string): number | null {
  const rootStart = text.indexOf('{')
  if (rootStart < 0) return null

  const blueprintsValueStart = findDirectPropertyValueStart(text, rootStart, 'blueprints')
  if (blueprintsValueStart === null || text[blueprintsValueStart] !== '[') return null

  const firstCandidateStart = findFirstArrayObjectElementStart(text, blueprintsValueStart)
  if (firstCandidateStart === null) return null

  const documentValueStart = findDirectPropertyValueStart(text, firstCandidateStart, 'document')
  return documentValueStart !== null && text[documentValueStart] === '{' ? documentValueStart : null
}

function synthesizeDisplayDocumentFromPartialObject(
  text: string,
  objectStartIndex: number,
  absoluteOffset: number,
  basePath: string,
): { document: DocumentFile; span: LiveBlueprintJsonSpan; complete: boolean } | null {
  if (text[objectStartIndex] !== '{') return null

  const schemaVersion = extractDirectPropertyJsonValueSpan(text, objectStartIndex, 'schemaVersion', absoluteOffset)
  const document = extractDirectPropertyJsonValueSpan(text, objectStartIndex, 'document', absoluteOffset)
  const devices = extractDirectPropertyJsonValueSpan(text, objectStartIndex, 'devices', absoluteOffset)
  const view = extractDirectPropertyJsonValueSpan(text, objectStartIndex, 'view', absoluteOffset)
  if (!schemaVersion || !document || !view) return null

  const partialDeviceSpans = devices
    ? null
    : extractCompleteDirectArrayObjectElementSpans(text, objectStartIndex, 'devices', absoluteOffset)
  if (!devices && (!partialDeviceSpans || partialDeviceSpans.length === 0)) return null

  let synthesized: DocumentFile
  try {
    synthesized = {
      schemaVersion: JSON.parse(schemaVersion.json),
      document: JSON.parse(document.json),
      devices: devices
        ? JSON.parse(devices.json)
        : partialDeviceSpans!.map((span) => JSON.parse(span.json)),
      view: JSON.parse(view.json),
    } as DocumentFile
  } catch {
    return null
  }

  if (!devices) {
    synthesized = restrictViewToProjectedDevices(synthesized)
  }

  const issues = collectDocumentFileIssues(synthesized, basePath)
  if (issues.length > 0) return null

  const devicesEndIndex = devices?.endIndex ?? partialDeviceSpans?.at(-1)?.endIndex ?? 0
  const endIndex = Math.max(schemaVersion.endIndex, document.endIndex, devicesEndIndex, view.endIndex)
  return {
    document: synthesized,
    complete: false,
    span: {
      json: JSON.stringify(synthesized),
      startIndex: absoluteOffset + objectStartIndex,
      endIndex,
    },
  }
}

function extractDirectPropertyJsonValueSpan(
  text: string,
  objectStartIndex: number,
  propertyName: string,
  absoluteOffset: number,
): LiveBlueprintJsonSpan | null {
  const valueStart = findDirectPropertyValueStart(text, objectStartIndex, propertyName)
  return valueStart === null ? null : extractCompleteJsonValueSpanAt(text, valueStart, absoluteOffset)
}

function restrictViewToProjectedDevices(document: DocumentFile): DocumentFile {
  const projectedDeviceIds = new Set(document.devices.map((device) => device.id))
  const projectedLabels = new Set(
    document.devices.flatMap((device) =>
      device.terminals
        .map((terminal) => terminal.label?.trim())
        .filter((label): label is string => Boolean(label)),
    ),
  )
  const viewDevices = Object.fromEntries(
    Object.entries(document.view.devices ?? {}).filter(([deviceId]) => projectedDeviceIds.has(deviceId)),
  )
  const networkLines = Object.fromEntries(
    Object.entries(document.view.networkLines ?? {}).filter(([, networkLine]) =>
      projectedLabels.has(networkLine.label.trim()),
    ),
  )

  return {
    ...document,
    view: {
      ...document.view,
      devices: viewDevices,
      networkLines,
    },
  }
}

function extractCompleteDirectArrayObjectElementSpans(
  text: string,
  objectStartIndex: number,
  propertyName: string,
  absoluteOffset: number,
): LiveBlueprintJsonSpan[] | null {
  const arrayStart = findDirectPropertyValueStart(text, objectStartIndex, propertyName)
  if (arrayStart === null || text[arrayStart] !== '[') return null

  const spans: LiveBlueprintJsonSpan[] = []
  let cursor = skipJsonWhitespace(text, arrayStart + 1)

  while (cursor < text.length) {
    if (text[cursor] === ']') {
      break
    }

    if (text[cursor] === ',') {
      cursor = skipJsonWhitespace(text, cursor + 1)
      continue
    }

    if (text[cursor] !== '{') {
      break
    }

    const span = extractCompleteObjectSpanAt(text, cursor, absoluteOffset)
    if (!span) {
      break
    }

    spans.push(span)
    cursor = skipJsonWhitespace(text, span.endIndex - absoluteOffset)

    if (text[cursor] === ',') {
      cursor = skipJsonWhitespace(text, cursor + 1)
    }
  }

  return spans
}

function findDirectPropertyValueStart(
  text: string,
  objectStartIndex: number,
  propertyName: string,
): number | null {
  if (text[objectStartIndex] !== '{') return null
  let depth = 0

  for (let index = objectStartIndex; index < text.length; index += 1) {
    const char = text[index]

    if (char === '"') {
      const token = readJsonStringToken(text, index)
      if (!token) return null
      if (depth === 1 && token.value === propertyName) {
        const cursor = skipJsonWhitespace(text, token.endIndex)
        if (text[cursor] === ':') {
          return skipJsonWhitespace(text, cursor + 1)
        }
      }
      index = token.endIndex - 1
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char !== '}') continue
    depth -= 1
    if (depth === 0) return null
  }

  return null
}

function findFirstArrayObjectElementStart(text: string, arrayStartIndex: number): number | null {
  if (text[arrayStartIndex] !== '[') return null
  const cursor = skipJsonWhitespace(text, arrayStartIndex + 1)
  return text[cursor] === '{' ? cursor : null
}

function readJsonStringToken(text: string, startIndex: number): { value: string; endIndex: number } | null {
  let escaped = false
  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char !== '"') continue

    const raw = text.slice(startIndex, index + 1)
    try {
      const value = JSON.parse(raw)
      return typeof value === 'string' ? { value, endIndex: index + 1 } : null
    } catch {
      return null
    }
  }

  return null
}

function skipJsonWhitespace(text: string, startIndex: number): number {
  let index = startIndex
  while (index < text.length && /\s/.test(text[index]!)) {
    index += 1
  }
  return index
}

function extractCompleteObjectSpanAt(
  text: string,
  startIndex: number,
  absoluteOffset: number,
): LiveBlueprintJsonSpan | null {
  if (text[startIndex] !== '{') return null
  return extractCompleteJsonContainerSpanAt(text, startIndex, absoluteOffset)
}

function extractCompleteJsonValueSpanAt(
  text: string,
  startIndex: number,
  absoluteOffset: number,
): LiveBlueprintJsonSpan | null {
  const char = text[startIndex]
  if (char === '{' || char === '[') {
    return extractCompleteJsonContainerSpanAt(text, startIndex, absoluteOffset)
  }
  if (char !== '"') return null

  const token = readJsonStringToken(text, startIndex)
  if (!token) return null
  return {
    json: text.slice(startIndex, token.endIndex),
    startIndex: absoluteOffset + startIndex,
    endIndex: absoluteOffset + token.endIndex,
  }
}

function extractCompleteJsonContainerSpanAt(
  text: string,
  startIndex: number,
  absoluteOffset: number,
): LiveBlueprintJsonSpan | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{' || char === '[') {
      depth += 1
      continue
    }

    if (char !== '}' && char !== ']') {
      continue
    }

    depth -= 1
    if (depth === 0) {
      return {
        json: text.slice(startIndex, index + 1),
        startIndex: absoluteOffset + startIndex,
        endIndex: absoluteOffset + index + 1,
      }
    }
  }

  return null
}

export function extractLastCompleteJsonObjectAfterMarker(
  buffer: string,
  marker = LIVE_BLUEPRINT_JSON_MARKER,
): LiveBlueprintJsonExtraction {
  const markerIndex = buffer.lastIndexOf(marker)
  if (markerIndex < 0) {
    return {
      markerFound: false,
      markerIndex: -1,
      scanStartIndex: -1,
      candidate: null,
      partial: null,
    }
  }

  const scanStartIndex = markerIndex + marker.length
  const scanText = buffer.slice(scanStartIndex)
  let startOffset = -1
  let depth = 0
  let inString = false
  let escaped = false
  let candidate: LiveBlueprintJsonSpan | null = null

  for (let offset = 0; offset < scanText.length; offset += 1) {
    const char = scanText[offset]

    if (startOffset < 0) {
      if (char === '{') {
        startOffset = offset
        depth = 1
        inString = false
        escaped = false
      }
      continue
    }

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char !== '}') {
      continue
    }

    depth -= 1
    if (depth === 0) {
      candidate = {
        json: scanText.slice(startOffset, offset + 1),
        startIndex: scanStartIndex + startOffset,
        endIndex: scanStartIndex + offset + 1,
      }
      startOffset = -1
    }
  }

  const partial =
    startOffset >= 0
      ? {
          startIndex: scanStartIndex + startOffset,
          depth,
          length: scanText.length - startOffset,
        }
      : null

  return {
    markerFound: true,
    markerIndex,
    scanStartIndex,
    candidate,
    partial,
  }
}

function baseResult(
  status: LiveBlueprintDraftStatus,
  extraction: LiveBlueprintJsonExtraction,
  previousLastGood: DocumentFile | null,
): LiveBlueprintDraftResult {
  return {
    status,
    markerFound: extraction.markerFound,
    hasCompleteJson: extraction.candidate !== null,
    updated: false,
    displayDocument: previousLastGood,
    lastGood: previousLastGood,
    candidate: extraction.candidate,
    partial: extraction.partial,
  }
}

function createJsonParseError(
  error: unknown,
  buffer: string,
  candidate: LiveBlueprintJsonSpan,
): LiveBlueprintDraftError {
  const message = error instanceof Error ? error.message : String(error)
  const relativeIndex = getJsonErrorOffset(message, candidate.json)
  const absoluteIndex = relativeIndex === undefined ? candidate.startIndex : candidate.startIndex + relativeIndex
  const location = getLineColumn(buffer, absoluteIndex)

  return {
    code: 'invalid-json',
    message: `A complete JSON object was extracted but JSON.parse failed: ${message}`,
    index: absoluteIndex,
    line: location.line,
    column: location.column,
    excerpt: excerptAt(buffer, absoluteIndex),
  }
}

function getJsonErrorOffset(message: string, json: string): number | undefined {
  const positionMatch = /position\s+(\d+)/i.exec(message)
  if (positionMatch?.[1]) {
    return Number(positionMatch[1])
  }

  const lineColumnMatch = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message)
  if (!lineColumnMatch?.[1] || !lineColumnMatch[2]) {
    return undefined
  }

  return getOffsetFromLineColumn(json, Number(lineColumnMatch[1]), Number(lineColumnMatch[2]))
}

function getOffsetFromLineColumn(text: string, targetLine: number, targetColumn: number): number | undefined {
  if (!Number.isFinite(targetLine) || !Number.isFinite(targetColumn) || targetLine < 1 || targetColumn < 1) {
    return undefined
  }

  let line = 1
  let column = 1
  for (let index = 0; index < text.length; index += 1) {
    if (line === targetLine && column === targetColumn) {
      return index
    }

    if (text[index] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }

  return line === targetLine && column === targetColumn ? text.length : undefined
}

function getLineColumn(text: string, index: number) {
  const boundedIndex = Math.max(0, Math.min(index, text.length))
  let line = 1
  let column = 1

  for (let cursor = 0; cursor < boundedIndex; cursor += 1) {
    if (text[cursor] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }

  return { line, column }
}

function excerptAt(text: string, index: number) {
  const start = Math.max(0, index - 48)
  const end = Math.min(text.length, index + 48)
  return text.slice(start, end)
}

function collectDocumentFileIssues(value: unknown, basePath = '$'): LiveBlueprintDraftIssue[] {
  const issues: LiveBlueprintDraftIssue[] = []

  if (!isRecord(value)) {
    return [{ code: 'document-not-object', message: 'DocumentFile must be a JSON object.', path: basePath }]
  }

  if (value.schemaVersion !== '4.0.0') {
    issues.push({
      code: 'invalid-schema-version',
      message: 'DocumentFile.schemaVersion must be 4.0.0.',
      path: `${basePath}.schemaVersion`,
    })
  }

  if (!isRecord(value.document)) {
    issues.push({
      code: 'missing-document-meta',
      message: 'DocumentFile.document must be an object.',
      path: `${basePath}.document`,
    })
  } else {
    requireString(value.document.id, `${basePath}.document.id`, 'document-id-required', issues)
    requireString(value.document.title, `${basePath}.document.title`, 'document-title-required', issues)
  }

  if (!Array.isArray(value.devices)) {
    issues.push({
      code: 'devices-not-array',
      message: 'DocumentFile.devices must be an array.',
      path: `${basePath}.devices`,
    })
  } else {
    value.devices.forEach((device, index) => collectDeviceIssues(device, `${basePath}.devices[${index}]`, issues))
  }

  if (!isRecord(value.view)) {
    issues.push({ code: 'missing-view', message: 'DocumentFile.view must be an object.', path: `${basePath}.view` })
  } else if (!isRecord(value.view.canvas)) {
    issues.push({
      code: 'missing-view-canvas',
      message: 'DocumentFile.view.canvas must be an object.',
      path: `${basePath}.view.canvas`,
    })
  } else if (value.view.canvas.units !== 'px') {
    issues.push({
      code: 'invalid-view-canvas-units',
      message: 'DocumentFile.view.canvas.units must be px.',
      path: `${basePath}.view.canvas.units`,
    })
  }

  return issues
}

function collectDeviceIssues(value: unknown, basePath: string, issues: LiveBlueprintDraftIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ code: 'device-not-object', message: 'Device must be an object.', path: basePath })
    return
  }

  requireString(value.id, `${basePath}.id`, 'device-id-required', issues)
  requireString(value.name, `${basePath}.name`, 'device-name-required', issues)
  requireString(value.kind, `${basePath}.kind`, 'device-kind-required', issues)

  if (!Array.isArray(value.terminals)) {
    issues.push({ code: 'terminals-not-array', message: 'Device.terminals must be an array.', path: `${basePath}.terminals` })
    return
  }

  value.terminals.forEach((terminal, terminalIndex) => {
    collectTerminalIssues(terminal, `${basePath}.terminals[${terminalIndex}]`, issues)
  })
}

function collectTerminalIssues(value: unknown, path: string, issues: LiveBlueprintDraftIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ code: 'terminal-not-object', message: 'Terminal must be an object.', path })
    return
  }

  requireString(value.id, `${path}.id`, 'terminal-id-required', issues)
  requireString(value.name, `${path}.name`, 'terminal-name-required', issues)

  if (!isTerminalDirection(value.direction)) {
    issues.push({
      code: 'invalid-terminal-direction',
      message: 'Terminal.direction must be input or output.',
      path: `${path}.direction`,
    })
  }
}

function requireString(
  value: unknown,
  path: string,
  code: string,
  issues: LiveBlueprintDraftIssue[],
): void {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({ code, message: `${path} must be a non-empty string.`, path })
  }
}

function isTerminalDirection(value: unknown): value is TerminalDirection {
  return value === 'input' || value === 'output'
}
