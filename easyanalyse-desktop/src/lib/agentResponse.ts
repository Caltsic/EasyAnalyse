import type {
  AgentBlueprintCandidate,
  AgentCapabilities,
  AgentCapabilityState,
  AgentResponse,
  AgentResponseBase,
  AgentResponseKind,
  AgentResponseParseIssue,
  AgentResponseParseOptions,
  AgentResponseParseResult,
  AgentResponseSemanticVersion,
} from '../types/agent'
import type { DocumentFile, ValidationIssue } from '../types/document'

export const AGENT_RESPONSE_SCHEMA_VERSION = 'agent-response-v1'
export const AGENT_RESPONSE_SEMANTIC_VERSION: AgentResponseSemanticVersion = 'easyanalyse-semantic-v4'
const SUPPORTED_KINDS = ['message', 'blueprints', 'patch', 'question', 'error'] as const
const CAPABILITY_KEYS = new Set<AgentResponseKind>(SUPPORTED_KINDS)
const FORBIDDEN_OLD_TOPOLOGY_FIELDS = new Set([
  'wires',
  'nodes',
  'junctions',
  'bends',
  'signals',
  'signalId',
  'components',
  'ports',
])
const FORBIDDEN_DEVICE_OR_TERMINAL_FIELDS = new Set(['components', 'ports', 'signalId'])

type JsonRecord = Record<string, unknown>

export function parseAgentResponse(
  input: unknown,
  options: AgentResponseParseOptions = {},
): AgentResponseParseResult {
  // Parsing is intentionally read-only; the optional main document is accepted so callers can
  // pass context without risking mutation during AgentResponse normalization.
  void options.mainDocument
  const value = typeof input === 'string' ? parseJsonObject(input) : input
  const root = asObject(value, 'AgentResponse')

  if (root.schemaVersion !== AGENT_RESPONSE_SCHEMA_VERSION) {
    throw new Error(`Unsupported AgentResponse schemaVersion: expected ${AGENT_RESPONSE_SCHEMA_VERSION}`)
  }

  if (root.semanticVersion !== AGENT_RESPONSE_SEMANTIC_VERSION) {
    throw new Error(`Unsupported AgentResponse semanticVersion: expected ${AGENT_RESPONSE_SEMANTIC_VERSION}`)
  }

  if (typeof root.kind !== 'string' || !isAgentResponseKind(root.kind)) {
    throw new Error(
      `Unsupported AgentResponse kind: expected one of message, blueprints, question, error, patch`,
    )
  }

  const base = parseBase(root, root.kind)
  const issues: AgentResponseParseIssue[] = []
  let response: AgentResponse

  switch (root.kind) {
    case 'message':
      response = {
        ...base,
        kind: 'message',
        markdown: requireString(root.markdown, 'markdown'),
      }
      break
    case 'blueprints': {
      const blueprints = requireArray(root.blueprints, 'blueprints').map((candidate, index) => {
        const parsed = parseBlueprintCandidate(candidate, index)
        issues.push(...parsed.issues.map((issue) => ({ ...issue, candidateIndex: index })))
        return parsed.candidate
      })
      response = {
        ...base,
        kind: 'blueprints',
        summary: requireString(root.summary, 'summary'),
        blueprints,
      }
      break
    }
    case 'question':
      response = {
        ...base,
        kind: 'question',
        question: requireString(root.question, 'question'),
        ...(root.options === undefined ? {} : { options: requireStringArray(root.options, 'options') }),
      }
      break
    case 'error':
      response = {
        ...base,
        kind: 'error',
        message: requireString(root.message, 'message'),
        recoverable: requireBoolean(root.recoverable, 'recoverable'),
      }
      break
    case 'patch':
      response = {
        ...base,
        kind: 'patch',
        unsupported: true,
        message:
          typeof root.message === 'string'
            ? root.message
            : 'AgentResponse patch responses are deferred in this application version.',
      }
      issues.push({
        severity: 'warning',
        code: 'unsupported-patch-response',
        message: 'Patch AgentResponse is recognized but patch application is not implemented.',
        path: 'kind',
      })
      break
  }

  return { ok: true, response, issues }
}

function parseJsonObject(input: string): JsonRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch (error) {
    throw new Error(`Invalid AgentResponse JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return asObject(parsed, 'AgentResponse')
}

function parseBase(root: JsonRecord, kind: AgentResponseKind): AgentResponseBase {
  return {
    schemaVersion: AGENT_RESPONSE_SCHEMA_VERSION,
    semanticVersion: AGENT_RESPONSE_SEMANTIC_VERSION,
    kind,
    ...(typeof root.requestId === 'string' ? { requestId: root.requestId } : {}),
    ...(typeof root.summary === 'string' ? { summary: root.summary } : {}),
    ...(root.warnings === undefined ? {} : { warnings: requireStringArray(root.warnings, 'warnings') }),
    ...(root.capabilities === undefined
      ? {}
      : { capabilities: normalizeCapabilities(root.capabilities, 'capabilities') }),
  }
}

function parseBlueprintCandidate(
  value: unknown,
  candidateIndex: number,
): { candidate: AgentBlueprintCandidate; issues: ValidationIssue[] } {
  const root = asObject(value, `blueprints[${candidateIndex}]`)
  const documentPath = `blueprints[${candidateIndex}].document`
  if (!isRecord(root.document)) {
    throw new Error(
      `${documentPath} must be an object-shaped retainable semantic v4 DocumentFile candidate`,
    )
  }
  const document = deepClone(root.document, documentPath) as DocumentFile
  const issues = collectDocumentCandidateIssues(document, candidateIndex)

  return {
    candidate: {
      title: requireString(root.title, `blueprints[${candidateIndex}].title`),
      summary: requireString(root.summary, `blueprints[${candidateIndex}].summary`),
      rationale: requireString(root.rationale, `blueprints[${candidateIndex}].rationale`),
      tradeoffs: requireStringArray(root.tradeoffs, `blueprints[${candidateIndex}].tradeoffs`),
      document,
      ...(root.highlightedLabels === undefined
        ? {}
        : {
            highlightedLabels: requireStringArray(
              root.highlightedLabels,
              `blueprints[${candidateIndex}].highlightedLabels`,
            ),
          }),
      notes: root.notes === undefined ? [] : requireStringArray(root.notes, `blueprints[${candidateIndex}].notes`),
      issues,
    },
    issues,
  }
}

function collectDocumentCandidateIssues(document: unknown, candidateIndex: number): ValidationIssue[] {
  const basePath = `blueprints[${candidateIndex}].document`
  const issues: ValidationIssue[] = []

  if (!isRecord(document)) {
    return [
      {
        severity: 'error',
        code: 'invalid-document-object',
        message: 'Blueprint candidate document must be an object.',
        path: basePath,
      },
    ]
  }

  if (document.schemaVersion !== '4.0.0') {
    issues.push({
      severity: 'error',
      code: 'invalid-document-schema-version',
      message: 'Blueprint candidate document schemaVersion should be 4.0.0.',
      path: `${basePath}.schemaVersion`,
    })
  }

  collectForbiddenFieldIssues(document, basePath, issues)
  collectSemanticDocumentIssues(document, basePath, issues)
  return issues
}

function collectForbiddenFieldIssues(document: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(document)) return

  collectForbiddenKeysAtPath(document, path, FORBIDDEN_OLD_TOPOLOGY_FIELDS, issues)

  const devices = Array.isArray(document.devices) ? document.devices : []
  devices.forEach((device, deviceIndex) => {
    if (!isRecord(device)) return
    const devicePath = `${path}.devices[${deviceIndex}]`
    collectForbiddenKeysAtPath(device, devicePath, FORBIDDEN_DEVICE_OR_TERMINAL_FIELDS, issues)

    const terminals = Array.isArray(device.terminals) ? device.terminals : []
    terminals.forEach((terminal, terminalIndex) => {
      if (!isRecord(terminal)) return
      collectForbiddenKeysAtPath(
        terminal,
        `${devicePath}.terminals[${terminalIndex}]`,
        FORBIDDEN_DEVICE_OR_TERMINAL_FIELDS,
        issues,
      )
    })
  })
}

function collectForbiddenKeysAtPath(
  value: JsonRecord,
  path: string,
  forbiddenKeys: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  Object.keys(value).forEach((key) => {
    if (!forbiddenKeys.has(key)) return
    issues.push({
      severity: 'warning',
      code: 'forbidden-old-topology-field',
      message: `Forbidden old-topology field '${key}' is present in blueprint candidate document.`,
      path: `${path}.${key}`,
    })
  })
}

function collectSemanticDocumentIssues(document: JsonRecord, basePath: string, issues: ValidationIssue[]): void {
  if (!isRecord(document.document)) {
    issues.push({
      severity: 'error',
      code: 'missing-document-meta',
      message: 'Blueprint candidate document is missing document metadata.',
      path: `${basePath}.document`,
    })
  } else {
    if (typeof document.document.id !== 'string' || document.document.id.length === 0) {
      issues.push({
        severity: 'error',
        code: 'missing-document-id',
        message: 'Blueprint candidate document metadata must include document.id.',
        path: `${basePath}.document.id`,
      })
    }
    if (typeof document.document.title !== 'string' || document.document.title.length === 0) {
      issues.push({
        severity: 'error',
        code: 'missing-document-title',
        message: 'Blueprint candidate document metadata must include document.title.',
        path: `${basePath}.document.title`,
      })
    }
  }

  const devices = Array.isArray(document.devices) ? document.devices : []
  if (!Array.isArray(document.devices)) {
    issues.push({
      severity: 'error',
      code: 'missing-devices-array',
      message: 'Blueprint candidate document must include a devices array.',
      path: `${basePath}.devices`,
    })
  }

  const usedLabels = new Set<string>()
  devices.forEach((device, deviceIndex) => {
    if (!isRecord(device)) return
    const terminals = Array.isArray(device.terminals) ? device.terminals : []
    if (!Array.isArray(device.terminals)) {
      issues.push({
        severity: 'error',
        code: 'missing-terminals-array',
        message: 'Device must include a terminals array.',
        path: `${basePath}.devices[${deviceIndex}].terminals`,
      })
    }
    terminals.forEach((terminal, terminalIndex) => {
      if (!isRecord(terminal)) return
      if (terminal.label && typeof terminal.label === 'string') usedLabels.add(terminal.label)
      if (terminal.direction !== 'input' && terminal.direction !== 'output') {
        issues.push({
          severity: 'error',
          code: 'invalid-terminal-direction',
          message: 'Terminal direction must be input or output.',
          path: `${basePath}.devices[${deviceIndex}].terminals[${terminalIndex}].direction`,
        })
      }
    })
  })

  if (!isRecord(document.view)) {
    issues.push({
      severity: 'error',
      code: 'missing-view',
      message: 'Blueprint candidate document must include a view object.',
      path: `${basePath}.view`,
    })
    return
  }
  if (!isRecord(document.view.canvas)) {
    issues.push({
      severity: 'error',
      code: 'missing-view-canvas',
      message: 'Blueprint candidate document must include view.canvas.',
      path: `${basePath}.view.canvas`,
    })
  } else if (document.view.canvas.units !== 'px') {
    issues.push({
      severity: 'error',
      code: 'invalid-view-canvas-units',
      message: 'Blueprint candidate document view.canvas.units must be px.',
      path: `${basePath}.view.canvas.units`,
    })
  }

  const networkLines = isRecord(document.view.networkLines) ? document.view.networkLines : {}
  Object.entries(networkLines).forEach(([networkLineId, networkLine]) => {
    if (!isRecord(networkLine) || typeof networkLine.label !== 'string') return
    if (!usedLabels.has(networkLine.label)) {
      issues.push({
        severity: 'warning',
        code: 'unused-network-line-label',
        message: 'Network line label is not used by any terminal in the candidate document.',
        entityId: networkLineId,
        path: `${basePath}.view.networkLines.${networkLineId}.label`,
      })
    }
  })
}

function normalizeCapabilities(value: unknown, path: string): AgentCapabilities {
  if (Array.isArray(value)) {
    return value.reduce<AgentCapabilities>((capabilities, item, index) => {
      if (typeof item !== 'string') {
        throw new Error(`${path}[${index}] must be a capability name string`)
      }
      if (CAPABILITY_KEYS.has(item as AgentResponseKind)) {
        capabilities[item as AgentResponseKind] = true
      }
      return capabilities
    }, {})
  }

  const root = asObject(value, path)
  return Object.entries(root).reduce<AgentCapabilities>((capabilities, [key, raw]) => {
    if (!CAPABILITY_KEYS.has(key as AgentResponseKind)) return capabilities
    const normalized = normalizeCapabilityValue(raw)
    if (normalized !== undefined) capabilities[key as AgentResponseKind] = normalized
    return capabilities
  }, {})
}

function normalizeCapabilityValue(value: unknown): AgentCapabilityState | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return undefined
  const lower = value.toLowerCase()
  if (lower === 'true' || lower === 'supported') return true
  if (lower === 'false') return false
  if (lower === 'deferred' || lower === 'unsupported') return lower
  return undefined
}

function isAgentResponseKind(value: string): value is AgentResponseKind {
  return SUPPORTED_KINDS.includes(value as AgentResponseKind)
}

function asObject(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${path} must be a JSON object`)
  return value
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  return value
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value
}

function requireStringArray(value: unknown, path: string): string[] {
  return requireArray(value, path).map((item, index) => requireString(item, `${path}[${index}]`))
}

function deepClone(value: unknown, path: string): unknown {
  if (value === undefined) throw new Error(`${path} is required`)
  return structuredClone(value)
}
