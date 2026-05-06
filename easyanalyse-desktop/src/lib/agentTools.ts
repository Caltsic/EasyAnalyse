import { checkLayoutOverlaps, layoutIssuesAsValidationIssues } from './layoutValidation'
import { validateDocumentCommand } from './tauri'
import type { AgentBlueprintCandidate } from '../types/agent'
import type { DocumentFile, ValidationIssue } from '../types/document'
import type {
  AgentSelfCheckCandidateReport,
  AgentSelfCheckReport,
  AgentToolContext,
  AgentToolName,
  AgentToolResult,
  CheckBlueprintCandidateData,
  CheckLayoutOverlapsData,
  ValidateDocumentData,
} from '../types/agentTools'
import type { LayoutOverlapCheckOptions } from './layoutValidation'

const TOOL_RESULT_SCHEMA_VERSION = 'agent-tool-result-v1' as const
const SELF_CHECK_SCHEMA_VERSION = 'agent-self-check-v1' as const
const SEMANTIC_VERSION = 'easyanalyse-semantic-v4' as const

export function getAgentToolSchemas() {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'check_blueprint_candidate',
        description:
          'Validate an EasyAnalyse semantic v4 blueprint candidate and check device bounds overlaps. Connectivity must be expressed by terminal.label only; wires/nodes/junctions/signalId are forbidden.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['candidate'],
          properties: {
            candidate: {
              type: 'object',
              additionalProperties: true,
              required: ['title', 'summary', 'rationale', 'tradeoffs', 'document', 'issues'],
              properties: {
                title: { type: 'string' },
                summary: { type: 'string' },
                rationale: { type: 'string' },
                tradeoffs: { type: 'array', items: { type: 'string' } },
                issues: { type: 'array' },
                document: {
                  type: 'object',
                  additionalProperties: true,
                  required: ['schemaVersion', 'document', 'devices', 'view'],
                  properties: {
                    schemaVersion: { type: 'string', enum: ['4.0.0'] },
                    document: { type: 'object' },
                    devices: { type: 'array' },
                    view: {
                      type: 'object',
                      required: ['canvas', 'devices', 'networkLines'],
                      properties: {
                        canvas: {
                          type: 'object',
                          required: ['units'],
                          properties: { units: { type: 'string', enum: ['px'] } },
                        },
                        devices: { type: 'object' },
                        networkLines: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
            options: { type: 'object' },
          },
        },
      },
    },
  ]
}

export async function runAgentTool(
  toolName: string,
  args: unknown,
  context: AgentToolContext = {},
): Promise<AgentToolResult> {
  try {
    if (toolName === 'validate_document') return validateDocumentTool(args, context)
    if (toolName === 'check_layout_overlaps') return checkLayoutOverlapsTool(args)
    if (toolName === 'check_blueprint_candidate') return checkBlueprintCandidateTool(args, context)
    return errorResult('check_blueprint_candidate', 'Unknown read-only EasyAnalyse agent tool.', 'agent_tool.unknown')
  } catch (error) {
    return errorResult(isAgentToolName(toolName) ? toolName : 'check_blueprint_candidate', safeErrorMessage(error), 'agent_tool.exception')
  }
}

export async function selfCheckBlueprintCandidates(
  candidates: AgentBlueprintCandidate[],
  context: AgentToolContext = {},
  options?: LayoutOverlapCheckOptions,
): Promise<AgentSelfCheckReport[]> {
  return Promise.all(candidates.map((candidate) => buildSelfCheckReport(candidate, context, options, 0)))
}

async function validateDocumentTool(args: unknown, context: AgentToolContext): Promise<AgentToolResult<ValidateDocumentData>> {
  const document = extractDocumentFromArgs(args)
  if (!document) return errorResult('validate_document', 'validate_document requires a document object.', 'agent_tool.invalid_args') as AgentToolResult<ValidateDocumentData>
  const validate = context.validateDocument ?? validateDocumentCommand
  const validation = await validate(document)
  const ok = validation.schemaValid === true && validation.semanticValid === true
  return result('validate_document', ok, ok ? 'Document validation passed.' : `Document validation found ${validation.issueCount} issue(s).`, validation.issues, {
    validation,
    normalizedDocument: validation.normalizedDocument ?? null,
  })
}

function checkLayoutOverlapsTool(args: unknown): AgentToolResult<CheckLayoutOverlapsData> {
  const document = extractDocumentFromArgs(args)
  if (!document) return errorResult('check_layout_overlaps', 'check_layout_overlaps requires a document object.', 'agent_tool.invalid_args') as AgentToolResult<CheckLayoutOverlapsData>
  const options = isRecord(args) && isRecord(args.options) ? (args.options as LayoutOverlapCheckOptions) : undefined
  const layout = checkLayoutOverlaps(document, options)
  const issues = layoutIssuesAsValidationIssues(layout.issues)
  return result('check_layout_overlaps', layout.ok, layout.ok ? 'No device layout overlaps found.' : `${layout.issueCount} device layout overlap warning(s).`, issues, { layout })
}

async function checkBlueprintCandidateTool(
  args: unknown,
  context: AgentToolContext,
): Promise<AgentToolResult<CheckBlueprintCandidateData>> {
  if (!isRecord(args)) return errorResult('check_blueprint_candidate', 'check_blueprint_candidate requires an object argument.', 'agent_tool.invalid_args') as AgentToolResult<CheckBlueprintCandidateData>
  const candidate = args.candidate
  const options = isRecord(args.options) ? (args.options as LayoutOverlapCheckOptions) : undefined
  if (!isRecord(candidate) || !isDocumentFile(candidate.document)) {
    return errorResult('check_blueprint_candidate', 'check_blueprint_candidate requires candidate.document.', 'agent_tool.invalid_args') as AgentToolResult<CheckBlueprintCandidateData>
  }
  const selfCheck = await buildSelfCheckReport(candidate as AgentBlueprintCandidate | { document: DocumentFile; title?: string }, context, options, 0)
  const candidateReport = selfCheck.candidates[0]!
  const issues = [...candidateReport.validation.issues, ...candidateReport.layout.issues]
  return result('check_blueprint_candidate', selfCheck.ok, selfCheck.summary, issues, { selfCheck })
}

async function buildSelfCheckReport(
  candidate: AgentBlueprintCandidate | { document: DocumentFile; title?: string },
  context: AgentToolContext,
  options: LayoutOverlapCheckOptions | undefined,
  index: number,
): Promise<AgentSelfCheckReport> {
  const originalDocument = candidate.document
  const validate = context.validateDocument ?? validateDocumentCommand
  const validation = await validate(originalDocument)
  const validationOk = validation.schemaValid === true && validation.semanticValid === true
  const layoutDocument = validation.normalizedDocument ?? originalDocument
  const layout = checkLayoutOverlaps(layoutDocument, options)
  const layoutIssues = layoutIssuesAsValidationIssues(layout.issues)
  const report: AgentSelfCheckCandidateReport = {
    index,
    ...(candidate.title ? { title: candidate.title } : {}),
    ok: validationOk && layout.ok,
    issueCount: validation.issueCount + layout.issueCount,
    validation: {
      ok: validationOk,
      schemaValid: validation.schemaValid,
      semanticValid: validation.semanticValid,
      issueCount: validation.issueCount,
      issues: cloneIssues(validation.issues),
    },
    layout: {
      ok: layout.ok,
      issueCount: layout.issueCount,
      checkedDeviceCount: layout.checkedDeviceCount,
      checkedPairCount: layout.checkedPairCount,
      issues: layoutIssues,
    },
  }
  return {
    schemaVersion: SELF_CHECK_SCHEMA_VERSION,
    semanticVersion: SEMANTIC_VERSION,
    ok: report.ok,
    summary: report.ok ? 'Candidate self-check passed.' : `Candidate self-check found ${report.issueCount} issue(s).`,
    candidates: [report],
  }
}

function result<T>(toolName: AgentToolName, ok: boolean, summary: string, issues: ValidationIssue[], data: T): AgentToolResult<T> {
  return { schemaVersion: TOOL_RESULT_SCHEMA_VERSION, semanticVersion: SEMANTIC_VERSION, ok, toolName, summary: sanitize(summary), issueCount: issues.length, issues: cloneIssues(issues), data }
}

function errorResult(toolName: AgentToolName, message: string, code: string): AgentToolResult {
  const issue = { severity: 'error' as const, code, message: sanitize(message), entityId: null, path: null }
  return { schemaVersion: TOOL_RESULT_SCHEMA_VERSION, semanticVersion: SEMANTIC_VERSION, ok: false, toolName, summary: issue.message, issueCount: 1, issues: [issue] }
}

function extractDocumentFromArgs(args: unknown): DocumentFile | null {
  if (!isRecord(args)) return null
  return isDocumentFile(args.document) ? args.document : null
}

function isDocumentFile(value: unknown): value is DocumentFile {
  return isRecord(value) && value.schemaVersion === '4.0.0' && isRecord(value.document) && Array.isArray(value.devices) && isRecord(value.view)
}

function isAgentToolName(value: string): value is AgentToolName {
  return value === 'validate_document' || value === 'check_layout_overlaps' || value === 'check_blueprint_candidate'
}

function cloneIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({ severity: issue.severity, code: issue.code, message: sanitize(issue.message), entityId: issue.entityId ?? null, path: issue.path ?? null }))
}

function sanitize(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9._-]+/g, '[redacted-api-key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted-api-key]')
    .replace(/Authorization/gi, 'auth header')
    .replace(/apiKey/gi, 'api key')
}

function safeErrorMessage(error: unknown): string {
  return sanitize(error instanceof Error ? error.message : String(error))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
