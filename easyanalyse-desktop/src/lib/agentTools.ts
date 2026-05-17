import { checkLayoutOverlaps, layoutIssuesAsValidationIssues } from './layoutValidation'
import { validateDocumentCommand } from './tauri'
import type { AgentBlueprintCandidate } from '../types/agent'
import type { DocumentFile, ValidationIssue } from '../types/document'
import type {
  AgentFormatCheckReport,
  AgentSelfCheckCandidateReport,
  AgentSelfCheckReport,
  AgentToolContext,
  AgentToolExecutor,
  AgentToolName,
  AgentToolRuntimeContext,
  AgentToolResult,
  CheckBlueprintCandidateData,
  CheckBlueprintFormatData,
  CheckDocumentFormatData,
  CheckLayoutOverlapsData,
  CreateBlueprintCandidateData,
  GetCurrentDocumentData,
  GetEasyAnalyseFormatRulesData,
  ValidateDocumentData,
} from '../types/agentTools'
import type { LayoutOverlapCheckOptions } from './layoutValidation'

const TOOL_RESULT_SCHEMA_VERSION = 'agent-tool-result-v1' as const
const SELF_CHECK_SCHEMA_VERSION = 'agent-self-check-v1' as const
const SEMANTIC_VERSION = 'easyanalyse-semantic-v4' as const
const EASYANALYSE_FORMAT_RULES = [
  'EasyAnalyse semantic v4 hard format:',
  '- DocumentFile must be JSON object { schemaVersion:"4.0.0", document:{id,title,...}, devices:[], view:{canvas:{units:"px"}, devices?:{}, networkLines?:{}}, extensions? }.',
  '- Required persisted fields: schemaVersion, document.id, document.title, devices, view.canvas.units, device id/name/kind/terminals, terminal id/name/direction.',
  '- Terminal direction values are only input or output. Connectivity is expressed by exact terminal.label equality only.',
  '- Unknown persisted fields at schema locations are format errors unless placed under properties or extensions.',
  '- Forbidden old topology fields include wires, nodes, junctions, bends, signals, signalId, components, and ports.',
  '- view.networkLines are optional visual label rails. They never define connectivity.',
  '- Hard format checks ignore semantic quality and layout readability issues; advisory tools can report those separately.',
].join('\n')

export function getAgentToolSchemas() {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'get_current_document',
        description: 'Return the current EasyAnalyse semantic v4 document if one was injected into the agent runtime. This is read-only.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_easyanalyse_format_rules',
        description: 'Return concise EasyAnalyse semantic v4 authoring and hard-format rules. Use this when the exact persisted JSON shape is unclear.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {},
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'check_document_format',
        description:
          [
            'Hard-check one EasyAnalyse DocumentFile candidate for JSON/schema/openability only.',
            'This tool fails for invalid JSON, unsupported schemaVersion, missing required persisted fields, or schema/unknown-field problems that can stop the document from opening or displaying.',
            'Semantic warnings, connectivity quality, and layout overlap warnings are advisory and are not hard failures for this tool.',
          ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            document: {
              description: 'A semantic v4 DocumentFile object, or a JSON string containing one.',
              oneOf: [{ type: 'object', additionalProperties: true }, { type: 'string' }],
            },
            json: { type: 'string', description: 'Optional JSON string containing a semantic v4 DocumentFile.' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'check_blueprint_format',
        description:
          [
            'Hard-check one AgentBlueprintCandidate and its DocumentFile for persisted format only.',
            'Fix ok=false results before creating or returning a blueprint candidate.',
            'Semantic and layout issues are not hard failures here; use advisory tools separately if useful.',
          ].join(' '),
        parameters: buildBlueprintCandidateToolParameters(),
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'create_blueprint_candidate',
        description:
          [
            'Create/store one AgentBlueprintCandidate through the injected EasyAnalyse runtime callback.',
            'The runtime first runs check_blueprint_format; if hard format fails, this tool returns ok=false and does not store anything.',
            'This tool cannot mutate the main document directly.',
          ].join(' '),
        parameters: buildBlueprintCandidateToolParameters(),
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'validate_document',
        description:
          [
            'Advisory full validation for an EasyAnalyse semantic v4 DocumentFile.',
            'It may report semantic issues that are useful to fix, but these are not a hard finalization gate by themselves.',
          ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['document'],
          properties: {
            document: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'check_layout_overlaps',
        description:
          [
            'Advisory layout check for device-device overlaps and visual network lines crossing device bounds.',
            'Layout issues are hints for improving readability, not hard schema failures.',
          ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['document'],
          properties: {
            document: { type: 'object', additionalProperties: true },
            options: { type: 'object' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'check_blueprint_candidate',
        description:
          [
            'Advisory full self-check for one complete EasyAnalyse semantic v4 blueprint candidate.',
            'It combines document validation and layout-overlap checks, including device-device overlaps and visual network lines crossing device bounds.',
            'Use results as repair hints; issueCount>0 is not a hard finalization gate by itself.',
            'Connectivity is expressed only by equal terminal.label strings; wires, nodes, junctions, bend points, components, ports, and signalId are forbidden.',
            'Every device requires id, name, kind, terminals[]. Every terminal requires id, name, direction input/output, and usually label. view.canvas.units must be px.',
            'view.networkLines are optional visual rails; place them outside device bounds or omit them if a clean rail cannot be drawn.',
            'For layout, view.devices[deviceId].position is the top-left coordinate; use wide spacing such as x=80,380,680,980 and y=96,320,544 to avoid overlap.',
          ].join(' '),
        parameters: buildBlueprintCandidateToolParameters({ includeOptions: true }),
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
    if (toolName === 'get_current_document') return getCurrentDocumentTool(context)
    if (toolName === 'get_easyanalyse_format_rules') return getEasyAnalyseFormatRulesTool(context)
    if (toolName === 'check_document_format') return checkDocumentFormatTool(args, context)
    if (toolName === 'check_blueprint_format') return checkBlueprintFormatTool(args, context)
    if (toolName === 'create_blueprint_candidate') return createBlueprintCandidateTool(args, context)
    if (toolName === 'validate_document') return validateDocumentTool(args, context)
    if (toolName === 'check_layout_overlaps') return checkLayoutOverlapsTool(args)
    if (toolName === 'check_blueprint_candidate') return checkBlueprintCandidateTool(args, context)
    return errorResult('check_blueprint_format', 'Unknown EasyAnalyse agent tool.', 'agent_tool.unknown')
  } catch (error) {
    return errorResult(isAgentToolName(toolName) ? toolName : 'check_blueprint_format', safeErrorMessage(error), 'agent_tool.exception')
  }
}

export const defaultAgentToolExecutor: AgentToolExecutor = runAgentTool

export async function selfCheckBlueprintCandidates(
  candidates: AgentBlueprintCandidate[],
  context: AgentToolContext = {},
  options?: LayoutOverlapCheckOptions,
): Promise<AgentSelfCheckReport[]> {
  return Promise.all(candidates.map((candidate) => buildSelfCheckReport(candidate, context, options, 0)))
}

async function getCurrentDocumentTool(context: AgentToolRuntimeContext): Promise<AgentToolResult<GetCurrentDocumentData>> {
  const document = await resolveCurrentDocument(context)
  return result('get_current_document', true, document ? 'Current document returned.' : 'No current document is available in this runtime context.', [], {
    hasDocument: Boolean(document),
    document: document ? cloneDocument(document) : null,
  })
}

async function getEasyAnalyseFormatRulesTool(context: AgentToolRuntimeContext): Promise<AgentToolResult<GetEasyAnalyseFormatRulesData>> {
  const rules = context.getEasyAnalyseFormatRules ? await context.getEasyAnalyseFormatRules() : EASYANALYSE_FORMAT_RULES
  return result('get_easyanalyse_format_rules', true, 'EasyAnalyse format rules returned.', [], { rules })
}

async function checkDocumentFormatTool(
  args: unknown,
  context: AgentToolRuntimeContext,
): Promise<AgentToolResult<CheckDocumentFormatData>> {
  return checkDocumentFormatValue(extractDocumentFormatInput(args), 'check_document_format', context)
}

async function checkBlueprintFormatTool(
  args: unknown,
  context: AgentToolRuntimeContext,
): Promise<AgentToolResult<CheckBlueprintFormatData>> {
  const checked = await checkBlueprintFormatValue(args, context)
  return result('check_blueprint_format', checked.format.ok, formatSummary('Blueprint candidate', checked.format), checked.format.issues, checked)
}

async function createBlueprintCandidateTool(
  args: unknown,
  context: AgentToolRuntimeContext,
): Promise<AgentToolResult<CreateBlueprintCandidateData>> {
  const checked = await checkBlueprintFormatValue(args, context)
  if (!checked.format.ok) {
    return result('create_blueprint_candidate', false, 'Blueprint candidate was not created because hard format checks failed.', checked.format.issues, {
      created: false,
      format: checked.format,
    })
  }
  if (!context.createBlueprintCandidate) {
    return result('create_blueprint_candidate', false, 'Blueprint candidate was not created because no runtime creation callback was injected.', [
      issue('error', 'agent_tool.missing_runtime_callback', 'create_blueprint_candidate requires an injected createBlueprintCandidate callback.', null, null),
    ], {
      created: false,
      format: checked.format,
    })
  }
  const candidate = extractBlueprintCandidate(args)
  if (!candidate) {
    return result('create_blueprint_candidate', false, 'Blueprint candidate was not created because candidate arguments were malformed.', [
      issue('error', 'agent_tool.invalid_args', 'create_blueprint_candidate requires candidate.', null, null),
    ], {
      created: false,
      format: checked.format,
    })
  }
  const createResult = await context.createBlueprintCandidate(cloneCandidate(candidate), {
    format: checked.format,
    sourceTool: 'create_blueprint_candidate',
  })
  return result('create_blueprint_candidate', true, 'Blueprint candidate created.', [], {
    created: true,
    format: checked.format,
    result: cloneDetails(createResult),
  })
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
  return result('check_layout_overlaps', layout.ok, layout.ok ? 'No layout overlaps found.' : `${layout.issueCount} layout overlap warning(s).`, issues, { layout })
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
      checkedNetworkLineCount: layout.checkedNetworkLineCount,
      checkedPairCount: layout.checkedPairCount,
      checkedNetworkLineDevicePairCount: layout.checkedNetworkLineDevicePairCount,
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

function buildBlueprintCandidateToolParameters(options: { includeOptions?: boolean } = {}) {
  return {
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
          highlightedLabels: { type: 'array', items: { type: 'string' } },
          notes: { type: 'array', items: { type: 'string' } },
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
                required: ['canvas'],
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
      ...(options.includeOptions ? { options: { type: 'object' } } : {}),
    },
  }
}

async function checkBlueprintFormatValue(
  args: unknown,
  context: AgentToolRuntimeContext,
): Promise<CheckBlueprintFormatData> {
  const candidate = extractBlueprintCandidate(args)
  if (!candidate) {
    const issues = [issue('error', 'agent_tool.invalid_args', 'check_blueprint_format requires candidate.', null, null)]
    return { format: buildFormatReport(false, false, issues) }
  }

  const candidateIssues = collectCandidateFormatIssues(candidate)
  const documentResult = await checkDocumentFormatValue(candidate.document, 'check_blueprint_format', context)
  const documentData = documentResult.data
  const documentIssues = documentData?.format.issues ?? documentResult.issues
  const issues = [...candidateIssues, ...documentIssues]
  const format = buildFormatReport(
    candidateIssues.length === 0 && Boolean(documentData?.format.ok),
    Boolean(documentData?.format.parsed),
    issues,
    {
      schemaValid: candidateIssues.length === 0 && Boolean(documentData?.format.schemaValid),
      semanticValid: documentData?.format.semanticValid,
    },
  )
  return { format, ...(documentData ? { document: documentData } : {}) }
}

async function checkDocumentFormatValue(
  rawDocument: unknown,
  toolName: AgentToolName,
  context: AgentToolRuntimeContext,
): Promise<AgentToolResult<CheckDocumentFormatData>> {
  const parsed = parseDocumentInput(rawDocument)
  if (!parsed.ok) {
    const issues = [issue('error', parsed.code, parsed.message, null, parsed.path ?? null)]
    const format = buildFormatReport(false, false, issues)
    return result(toolName, false, formatSummary('Document', format), issues, { format, normalizedDocument: null })
  }

  const structuralIssues = collectDocumentOpenabilityIssues(parsed.value)
  const validation = isDocumentFile(parsed.value)
    ? await (context.validateDocument ?? validateDocumentCommand)(parsed.value)
    : null
  const validationIssues = validation ? collectHardValidationIssues(validation) : []
  const normalizedDocument = validation?.normalizedDocument ?? (isDocumentFile(parsed.value) ? parsed.value : null)
  if (validation && !normalizedDocument && validationIssues.length === 0) {
    validationIssues.push(issue('error', 'schema.parse', 'Document did not match the supported semantic v4 model.', null, null))
  }
  const issues = [...structuralIssues, ...validationIssues]
  const format = buildFormatReport(
    issues.length === 0 && Boolean(normalizedDocument),
    true,
    issues,
    {
      schemaValid: issues.length === 0 && Boolean(normalizedDocument) && (validation?.schemaValid ?? true),
      semanticValid: validation?.semanticValid,
    },
  )

  return result(toolName, format.ok, formatSummary('Document', format), issues, {
    format,
    ...(validation ? { validation } : {}),
    normalizedDocument,
  })
}

function extractDocumentFormatInput(args: unknown): unknown {
  if (!isRecord(args)) return args
  if (args.document !== undefined) return args.document
  if (args.json !== undefined) return args.json
  return args
}

function parseDocumentInput(value: unknown): { ok: true; value: unknown } | { ok: false; code: string; message: string; path?: string } {
  if (typeof value !== 'string') return { ok: true, value }
  try {
    return { ok: true, value: JSON.parse(value) as unknown }
  } catch (error) {
    return {
      ok: false,
      code: 'format.invalid_json',
      message: `Document JSON could not be parsed: ${safeErrorMessage(error)}`,
    }
  }
}

function collectCandidateFormatIssues(candidate: AgentBlueprintCandidate): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const allowedKeys = new Set(['title', 'summary', 'rationale', 'tradeoffs', 'document', 'highlightedLabels', 'notes', 'issues', 'selfCheck', 'toolIssues'])
  Object.keys(candidate as unknown as Record<string, unknown>).forEach((key) => {
    if (!allowedKeys.has(key)) issues.push(issue('error', 'format.unknown_field', `Unknown blueprint candidate field '${key}'.`, null, `candidate.${key}`))
  })
  if (!isNonEmptyString(candidate.title)) issues.push(issue('error', 'format.required', 'Blueprint candidate title must be a non-empty string.', null, 'candidate.title'))
  if (!isNonEmptyString(candidate.summary)) issues.push(issue('error', 'format.required', 'Blueprint candidate summary must be a non-empty string.', null, 'candidate.summary'))
  if (!isNonEmptyString(candidate.rationale)) issues.push(issue('error', 'format.required', 'Blueprint candidate rationale must be a non-empty string.', null, 'candidate.rationale'))
  if (!Array.isArray(candidate.tradeoffs)) issues.push(issue('error', 'format.required', 'Blueprint candidate tradeoffs must be an array.', null, 'candidate.tradeoffs'))
  if (!Array.isArray(candidate.issues)) issues.push(issue('error', 'format.required', 'Blueprint candidate issues must be an array.', null, 'candidate.issues'))
  if (!isRecord(candidate.document)) issues.push(issue('error', 'format.required', 'Blueprint candidate document must be an object.', null, 'candidate.document'))
  return issues
}

function collectDocumentOpenabilityIssues(document: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!isRecord(document)) {
    return [issue('error', 'format.invalid_document_object', 'Document must be a JSON object.', null, null)]
  }

  collectUnknownFields(document, new Set(['schemaVersion', 'document', 'devices', 'view', 'extensions']), '', issues)
  if (document.schemaVersion !== '4.0.0') {
    issues.push(issue('error', 'format.schema_version', 'Document schemaVersion must be 4.0.0.', null, 'schemaVersion'))
  }
  if (!isRecord(document.document)) {
    issues.push(issue('error', 'format.required', 'Document metadata must be an object.', null, 'document'))
  } else {
    collectUnknownFields(document.document, new Set(['id', 'title', 'description', 'createdAt', 'updatedAt', 'source', 'language', 'tags', 'extensions']), 'document', issues)
    if (!isNonEmptyString(document.document.id)) issues.push(issue('error', 'format.required', 'Document metadata id must be a non-empty string.', null, 'document.id'))
    if (!isNonEmptyString(document.document.title)) issues.push(issue('error', 'format.required', 'Document metadata title must be a non-empty string.', null, 'document.title'))
  }
  if (!Array.isArray(document.devices)) {
    issues.push(issue('error', 'format.required', 'Document devices must be an array.', null, 'devices'))
  } else {
    document.devices.forEach((device, index) => collectDeviceFormatIssues(device, `devices[${index}]`, issues))
  }
  if (!isRecord(document.view)) {
    issues.push(issue('error', 'format.required', 'Document view must be an object.', null, 'view'))
  } else {
    collectViewFormatIssues(document.view, 'view', issues)
  }
  return issues
}

function collectDeviceFormatIssues(device: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(device)) {
    issues.push(issue('error', 'format.invalid_device_object', 'Each device must be an object.', null, path))
    return
  }
  collectUnknownFields(device, new Set(['id', 'name', 'kind', 'category', 'description', 'reference', 'tags', 'properties', 'terminals', 'extensions']), path, issues)
  if (!isNonEmptyString(device.id)) issues.push(issue('error', 'format.required', 'Device id must be a non-empty string.', null, `${path}.id`))
  if (!isNonEmptyString(device.name)) issues.push(issue('error', 'format.required', 'Device name must be a non-empty string.', null, `${path}.name`))
  if (!isNonEmptyString(device.kind)) issues.push(issue('error', 'format.required', 'Device kind must be a non-empty string.', null, `${path}.kind`))
  if (!Array.isArray(device.terminals)) {
    issues.push(issue('error', 'format.required', 'Device terminals must be an array.', null, `${path}.terminals`))
    return
  }
  device.terminals.forEach((terminal, terminalIndex) => collectTerminalFormatIssues(terminal, `${path}.terminals[${terminalIndex}]`, issues))
}

function collectTerminalFormatIssues(terminal: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(terminal)) {
    issues.push(issue('error', 'format.invalid_terminal_object', 'Each terminal must be an object.', null, path))
    return
  }
  collectUnknownFields(terminal, new Set(['id', 'name', 'label', 'direction', 'role', 'description', 'pin', 'required', 'side', 'order', 'extensions']), path, issues)
  if (!isNonEmptyString(terminal.id)) issues.push(issue('error', 'format.required', 'Terminal id must be a non-empty string.', null, `${path}.id`))
  if (!isNonEmptyString(terminal.name)) issues.push(issue('error', 'format.required', 'Terminal name must be a non-empty string.', null, `${path}.name`))
  if (terminal.direction !== 'input' && terminal.direction !== 'output') {
    issues.push(issue('error', 'format.required', 'Terminal direction must be input or output.', null, `${path}.direction`))
  }
}

function collectViewFormatIssues(view: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  collectUnknownFields(view, new Set(['canvas', 'devices', 'networkLines', 'focus', 'extensions']), path, issues)
  if (!isRecord(view.canvas)) {
    issues.push(issue('error', 'format.required', 'View canvas must be an object.', null, `${path}.canvas`))
  } else {
    collectUnknownFields(view.canvas, new Set(['units', 'grid', 'background', 'extensions']), `${path}.canvas`, issues)
    if (view.canvas.units !== 'px') issues.push(issue('error', 'format.required', 'View canvas units must be px.', null, `${path}.canvas.units`))
  }
  if (view.devices !== undefined && !isRecord(view.devices)) {
    issues.push(issue('error', 'format.required', 'View devices must be an object when present.', null, `${path}.devices`))
  } else if (isRecord(view.devices)) {
    Object.entries(view.devices).forEach(([deviceId, deviceView]) => {
      if (!isRecord(deviceView)) {
        issues.push(issue('error', 'format.invalid_view_device_object', 'Each view.devices entry must be an object.', deviceId, `${path}.devices.${deviceId}`))
      }
    })
  }
  if (view.networkLines !== undefined && !isRecord(view.networkLines)) {
    issues.push(issue('error', 'format.required', 'View networkLines must be an object when present.', null, `${path}.networkLines`))
  } else if (isRecord(view.networkLines)) {
    Object.entries(view.networkLines).forEach(([networkLineId, networkLine]) => {
      if (!isRecord(networkLine)) {
        issues.push(issue('error', 'format.invalid_network_line_object', 'Each view.networkLines entry must be an object.', networkLineId, `${path}.networkLines.${networkLineId}`))
        return
      }
      collectUnknownFields(networkLine, new Set(['label', 'position', 'length', 'orientation', 'extensions']), `${path}.networkLines.${networkLineId}`, issues)
      if (!isNonEmptyString(networkLine.label)) {
        issues.push(issue('error', 'format.required', 'Network line label must be a non-empty string.', networkLineId, `${path}.networkLines.${networkLineId}.label`))
      }
      if (!isPointLike(networkLine.position)) {
        issues.push(issue('error', 'format.required', 'Network line position must contain finite x and y numbers.', networkLineId, `${path}.networkLines.${networkLineId}.position`))
      }
    })
  }
}

function collectUnknownFields(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>, path: string, issues: ValidationIssue[]): void {
  Object.keys(value).forEach((key) => {
    if (allowedKeys.has(key)) return
    issues.push(issue('error', 'format.unknown_field', `Unknown field '${key}' is not part of the persisted EasyAnalyse schema at ${path || 'document root'}.`, null, path ? `${path}.${key}` : key))
  })
}

function collectHardValidationIssues(validation: import('../types/document').ValidationReport): ValidationIssue[] {
  return cloneIssues(validation.issues.filter((item) => item.severity === 'error' && item.code.startsWith('schema.')))
}

function buildFormatReport(
  ok: boolean,
  parsed: boolean,
  issues: ValidationIssue[],
  options: { schemaValid?: boolean; semanticValid?: boolean } = {},
): AgentFormatCheckReport {
  return {
    ok,
    parsed,
    schemaValid: options.schemaValid ?? ok,
    ...(options.semanticValid === undefined ? {} : { semanticValid: options.semanticValid }),
    issueCount: issues.length,
    issues: cloneIssues(issues),
  }
}

function formatSummary(label: string, format: AgentFormatCheckReport): string {
  return format.ok
    ? `${label} hard format check passed.`
    : `${label} hard format check found ${format.issueCount} issue(s).`
}

async function resolveCurrentDocument(context: AgentToolRuntimeContext): Promise<DocumentFile | null> {
  const document = context.getCurrentDocument ? await context.getCurrentDocument() : context.currentDocument
  return document ?? null
}

function extractBlueprintCandidate(args: unknown): AgentBlueprintCandidate | null {
  if (!isRecord(args) || !isRecord(args.candidate)) return null
  return args.candidate as unknown as AgentBlueprintCandidate
}

function cloneCandidate(candidate: AgentBlueprintCandidate): AgentBlueprintCandidate {
  return cloneDetails(candidate) as AgentBlueprintCandidate
}

function cloneDocument(document: DocumentFile): DocumentFile {
  return cloneDetails(document) as DocumentFile
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPointLike(value: unknown): boolean {
  return isRecord(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y)
}

function result<T>(toolName: AgentToolName, ok: boolean, summary: string, issues: ValidationIssue[], data: T): AgentToolResult<T> {
  return { schemaVersion: TOOL_RESULT_SCHEMA_VERSION, semanticVersion: SEMANTIC_VERSION, ok, toolName, summary: sanitize(summary), issueCount: issues.length, issues: cloneIssues(issues), data }
}

function errorResult(toolName: AgentToolName, message: string, code: string): AgentToolResult {
  const item = issue('error', code, message, null, null)
  return { schemaVersion: TOOL_RESULT_SCHEMA_VERSION, semanticVersion: SEMANTIC_VERSION, ok: false, toolName, summary: item.message, issueCount: 1, issues: [item] }
}

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  entityId: string | null,
  path: string | null,
): ValidationIssue {
  return { severity, code, message: sanitize(message), entityId, path }
}

function extractDocumentFromArgs(args: unknown): DocumentFile | null {
  if (!isRecord(args)) return null
  return isDocumentFile(args.document) ? args.document : null
}

function isDocumentFile(value: unknown): value is DocumentFile {
  return isRecord(value) && value.schemaVersion === '4.0.0' && isRecord(value.document) && Array.isArray(value.devices) && isRecord(value.view)
}

function isAgentToolName(value: string): value is AgentToolName {
  return value === 'get_current_document'
    || value === 'get_easyanalyse_format_rules'
    || value === 'check_document_format'
    || value === 'check_blueprint_format'
    || value === 'create_blueprint_candidate'
    || value === 'validate_document'
    || value === 'check_layout_overlaps'
    || value === 'check_blueprint_candidate'
}

function cloneIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    message: sanitize(issue.message),
    entityId: issue.entityId ?? null,
    path: issue.path ?? null,
    ...(issue.details === undefined ? {} : { details: cloneDetails(issue.details) }),
  }))
}

function sanitize(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9._-]+/g, '[redacted-api-key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted-api-key]')
    .replace(/Authorization/gi, 'auth header')
    .replace(/apiKey/gi, 'api key')
}

function cloneDetails(value: unknown): unknown {
  if (value === null || value === undefined) return value
  try {
    return JSON.parse(sanitize(JSON.stringify(value))) as unknown
  } catch {
    return sanitize(String(value))
  }
}

function safeErrorMessage(error: unknown): string {
  return sanitize(error instanceof Error ? error.message : String(error))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
