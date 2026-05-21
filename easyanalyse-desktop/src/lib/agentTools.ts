import { checkLayoutOverlaps, layoutIssuesAsValidationIssues } from './layoutValidation'
import { validateDocumentCommand } from './tauri'
import { diffBlueprintDocument } from './blueprintDiff'
import { deriveCircuitInsights } from './circuitDescription'
import { isRecord } from './guards'
import type { AgentBlueprintCandidate } from '../types/agent'
import type { DocumentFile, ValidationIssue } from '../types/document'
import type { BlueprintRecord, BlueprintWorkspaceFile } from '../types/blueprint'
import type {
  AgentBlueprintRecordSummary,
  AgentDocumentSummary,
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
  CompareBlueprintCandidateData,
  CreateBlueprintCandidateData,
  GetBlueprintCandidateData,
  GetBlueprintWorkspaceData,
  GetCurrentDocumentData,
  GetCurrentSelectionData,
  GetEasyAnalyseFormatRulesData,
  SummarizeTopologyData,
  ValidateDocumentData,
} from '../types/agentTools'
import type { LayoutOverlapCheckOptions } from './layoutValidation'

const TOOL_RESULT_SCHEMA_VERSION = 'agent-tool-result-v1' as const
const SELF_CHECK_SCHEMA_VERSION = 'agent-self-check-v1' as const
const SEMANTIC_VERSION = 'easyanalyse-semantic-v4' as const
const DEFAULT_AGENT_LAYOUT_OPTIONS: LayoutOverlapCheckOptions = { includeTextDeviceOverlaps: true }
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
        name: 'get_blueprint_workspace',
        description:
          [
            'Return the current blueprint workspace summary, including candidate ids, titles, validation states, document hashes, and counts.',
            'This is read-only and omits full blueprint documents by default; call get_blueprint_candidate when you need one candidate document.',
          ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            includeDocuments: { type: 'boolean', description: 'When true, include full DocumentFile JSON for every returned blueprint. Defaults to false.' },
            includeArchived: { type: 'boolean', description: 'When true, include archived candidates. Deleted candidates are always omitted. Defaults to true.' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_blueprint_candidate',
        description:
          [
            'Return one blueprint candidate record from the current blueprint workspace.',
            'If blueprintId is omitted, the selected blueprint is returned. This is read-only.',
          ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            blueprintId: { type: 'string', description: 'Optional blueprint id. Defaults to the selected blueprint id.' },
            includeDocument: { type: 'boolean', description: 'When true, include the full candidate DocumentFile JSON. Defaults to true.' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'compare_blueprint_candidate',
        description:
          [
            'Compare one blueprint candidate against the current main document and return a structured diff summary.',
            'If blueprintId is omitted, the selected blueprint is compared. This is read-only.',
          ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            blueprintId: { type: 'string', description: 'Optional blueprint id. Defaults to the selected blueprint id.' },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_current_selection',
        description: 'Return the editor selection, focused device/label/network line, and selected blueprint id. This is read-only.',
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
        name: 'summarize_topology',
        description:
          [
            'Return a compact topology and coordinate summary for a document, selected blueprint, or current document.',
            'Use this to reason about device relationships, terminal-label connectivity, and rendered bounds without reading full JSON.',
          ].join(' '),
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: {
              type: 'string',
              enum: ['current_document', 'selected_blueprint'],
              description: 'Defaults to current_document unless blueprintId is provided.',
            },
            blueprintId: { type: 'string', description: 'Optional blueprint id. When provided, summarizes that blueprint candidate.' },
            document: { type: 'object', additionalProperties: true, description: 'Optional DocumentFile object to summarize directly.' },
          },
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
            'It also reports terminal/network-line text labels that overlap module bounds with concrete coordinates.',
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
            'It combines document validation and layout-overlap checks, including device-device overlaps, visual network lines crossing device bounds, and text labels covering modules.',
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
    if (toolName === 'get_blueprint_workspace') return getBlueprintWorkspaceTool(args, context)
    if (toolName === 'get_blueprint_candidate') return getBlueprintCandidateTool(args, context)
    if (toolName === 'compare_blueprint_candidate') return compareBlueprintCandidateTool(args, context)
    if (toolName === 'get_current_selection') return getCurrentSelectionTool(context)
    if (toolName === 'summarize_topology') return summarizeTopologyTool(args, context)
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

async function getBlueprintWorkspaceTool(
  args: unknown,
  context: AgentToolRuntimeContext,
): Promise<AgentToolResult<GetBlueprintWorkspaceData>> {
  const workspace = await resolveBlueprintWorkspace(context)
  const selectedBlueprintId = await resolveSelectedBlueprintId(context)
  if (!workspace) {
    return result('get_blueprint_workspace', true, 'No blueprint workspace is available in this runtime context.', [], {
      hasWorkspace: false,
      selectedBlueprintId,
      workspace: null,
    })
  }
  const includeDocuments = getBooleanArg(args, 'includeDocuments', false)
  const includeArchived = getBooleanArg(args, 'includeArchived', true)
  const blueprints = workspace.blueprints
    .filter((record) => record.lifecycleStatus !== 'deleted')
    .filter((record) => includeArchived || record.lifecycleStatus === 'active')
    .map((record) => summarizeBlueprintRecord(record, { includeDocument: includeDocuments }))
  return result('get_blueprint_workspace', true, `Blueprint workspace returned with ${blueprints.length} candidate(s).`, [], {
    hasWorkspace: true,
    selectedBlueprintId,
    workspace: {
      workspaceId: workspace.workspaceId,
      blueprintWorkspaceVersion: workspace.blueprintWorkspaceVersion,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      ...(workspace.mainDocument ? { mainDocument: cloneDetails(workspace.mainDocument) as BlueprintWorkspaceFile['mainDocument'] } : {}),
      blueprintCount: blueprints.length,
      blueprints,
    },
  })
}

async function getBlueprintCandidateTool(
  args: unknown,
  context: AgentToolRuntimeContext,
): Promise<AgentToolResult<GetBlueprintCandidateData>> {
  const workspace = await resolveBlueprintWorkspace(context)
  const selectedBlueprintId = await resolveSelectedBlueprintId(context)
  const requestedBlueprintId = getStringArg(args, 'blueprintId') ?? selectedBlueprintId
  if (!workspace) {
    return result('get_blueprint_candidate', false, 'No blueprint workspace is available in this runtime context.', [
      issue('error', 'agent_tool.no_blueprint_workspace', 'get_blueprint_candidate requires an injected blueprint workspace.', null, null),
    ], {
      hasWorkspace: false,
      selectedBlueprintId,
      requestedBlueprintId,
      found: false,
      blueprint: null,
    })
  }
  if (!requestedBlueprintId) {
    return result('get_blueprint_candidate', false, 'No blueprint id was provided and no blueprint is selected.', [
      issue('error', 'agent_tool.no_selected_blueprint', 'Pass blueprintId or select a blueprint before calling get_blueprint_candidate.', null, 'blueprintId'),
    ], {
      hasWorkspace: true,
      selectedBlueprintId,
      requestedBlueprintId: null,
      found: false,
      blueprint: null,
    })
  }
  const record = findBlueprintRecord(workspace, requestedBlueprintId)
  const includeDocument = getBooleanArg(args, 'includeDocument', true)
  return result('get_blueprint_candidate', Boolean(record), record ? `Blueprint candidate "${record.title}" returned.` : `Blueprint candidate "${requestedBlueprintId}" was not found.`, record ? [] : [
    issue('error', 'agent_tool.blueprint_not_found', `Blueprint candidate "${requestedBlueprintId}" was not found in the current workspace.`, requestedBlueprintId, 'blueprintId'),
  ], {
    hasWorkspace: true,
    selectedBlueprintId,
    requestedBlueprintId,
    found: Boolean(record),
    blueprint: record ? summarizeBlueprintRecord(record, { includeDocument }) : null,
  })
}

async function compareBlueprintCandidateTool(
  args: unknown,
  context: AgentToolRuntimeContext,
): Promise<AgentToolResult<CompareBlueprintCandidateData>> {
  const workspace = await resolveBlueprintWorkspace(context)
  const currentDocument = await resolveCurrentDocument(context)
  const selectedBlueprintId = await resolveSelectedBlueprintId(context)
  const requestedBlueprintId = getStringArg(args, 'blueprintId') ?? selectedBlueprintId
  if (!workspace) {
    return result('compare_blueprint_candidate', false, 'No blueprint workspace is available in this runtime context.', [
      issue('error', 'agent_tool.no_blueprint_workspace', 'compare_blueprint_candidate requires an injected blueprint workspace.', null, null),
    ], {
      selectedBlueprintId,
      requestedBlueprintId,
      found: false,
      hasCurrentDocument: Boolean(currentDocument),
    })
  }
  if (!currentDocument) {
    return result('compare_blueprint_candidate', false, 'No current document is available for blueprint comparison.', [
      issue('error', 'agent_tool.no_current_document', 'compare_blueprint_candidate requires a current main document.', null, null),
    ], {
      selectedBlueprintId,
      requestedBlueprintId,
      found: false,
      hasCurrentDocument: false,
    })
  }
  if (!requestedBlueprintId) {
    return result('compare_blueprint_candidate', false, 'No blueprint id was provided and no blueprint is selected.', [
      issue('error', 'agent_tool.no_selected_blueprint', 'Pass blueprintId or select a blueprint before calling compare_blueprint_candidate.', null, 'blueprintId'),
    ], {
      selectedBlueprintId,
      requestedBlueprintId: null,
      found: false,
      hasCurrentDocument: true,
    })
  }
  const record = findBlueprintRecord(workspace, requestedBlueprintId)
  if (!record) {
    return result('compare_blueprint_candidate', false, `Blueprint candidate "${requestedBlueprintId}" was not found.`, [
      issue('error', 'agent_tool.blueprint_not_found', `Blueprint candidate "${requestedBlueprintId}" was not found in the current workspace.`, requestedBlueprintId, 'blueprintId'),
    ], {
      selectedBlueprintId,
      requestedBlueprintId,
      found: false,
      hasCurrentDocument: true,
    })
  }
  const diff = diffBlueprintDocument(currentDocument, record.document)
  return result('compare_blueprint_candidate', true, diff.hasChanges ? `Blueprint "${record.title}" differs from the current document.` : `Blueprint "${record.title}" matches the current document.`, [], {
    selectedBlueprintId,
    requestedBlueprintId,
    found: true,
    hasCurrentDocument: true,
    diff,
  })
}

async function getCurrentSelectionTool(context: AgentToolRuntimeContext): Promise<AgentToolResult<GetCurrentSelectionData>> {
  const selectedBlueprintId = await resolveSelectedBlueprintId(context)
  const selection = context.getCurrentSelection ? await context.getCurrentSelection() : context.currentSelection ?? null
  const focus = context.getEditorFocus ? await context.getEditorFocus() : null
  return result('get_current_selection', true, 'Current editor selection returned.', [], {
    selection: selection ? cloneDetails(selection) as GetCurrentSelectionData['selection'] : null,
    focus: focus ? cloneDetails(focus) as GetCurrentSelectionData['focus'] : null,
    selectedBlueprintId,
  })
}

async function summarizeTopologyTool(
  args: unknown,
  context: AgentToolRuntimeContext,
): Promise<AgentToolResult<SummarizeTopologyData>> {
  const resolved = await resolveTopologyDocument(args, context)
  if (!resolved.document) {
    return result('summarize_topology', false, resolved.summary, [
      issue('error', resolved.code, resolved.summary, resolved.blueprintId ?? null, resolved.path ?? null),
    ], buildEmptyTopologyData(resolved.source, resolved.blueprintId))
  }
  const insights = deriveCircuitInsights(resolved.document)
  const data: SummarizeTopologyData = {
    source: resolved.source,
    ...(resolved.blueprintId ? { blueprintId: resolved.blueprintId } : {}),
    documentSummary: summarizeDocument(resolved.document),
    devices: insights.devices.map((device) => ({
      id: device.id,
      title: device.title,
      reference: device.reference,
      kind: device.kind,
      bounds: cloneDetails(device.bounds) as SummarizeTopologyData['devices'][number]['bounds'],
      connectionLabels: [...device.connectionLabels],
      terminals: device.terminals.map((terminal) => ({
        id: terminal.id,
        name: terminal.name,
        direction: terminal.direction,
        label: terminal.connectionLabel,
        point: cloneDetails(terminal.point) as SummarizeTopologyData['devices'][number]['terminals'][number]['point'],
      })),
    })),
    connectionGroups: insights.connectionGroups.map((group) => ({
      key: group.key,
      label: group.label,
      terminalIds: [...group.terminalIds],
      deviceIds: [...group.deviceIds],
      point: cloneDetails(group.point) as SummarizeTopologyData['connectionGroups'][number]['point'],
    })),
    deviceRelations: Object.values(insights.deviceRelationsById).map((relation) => ({
      deviceId: relation.deviceId,
      title: relation.title,
      upstreamDeviceIds: [...relation.upstreamDeviceIds],
      downstreamDeviceIds: [...relation.downstreamDeviceIds],
      relatedTerminalIds: [...relation.relatedTerminalIds],
      connectionLabels: [...relation.connectionLabels],
    })),
    networkLines: insights.networkLines.map((line) => ({
      id: line.id,
      label: line.label,
      position: cloneDetails(line.position) as SummarizeTopologyData['networkLines'][number]['position'],
      length: line.length,
      orientation: line.orientation,
      start: cloneDetails(line.start) as SummarizeTopologyData['networkLines'][number]['start'],
      end: cloneDetails(line.end) as SummarizeTopologyData['networkLines'][number]['end'],
    })),
    labelSuggestions: [...insights.labelSuggestions],
  }
  return result('summarize_topology', true, `Topology summary returned for ${data.documentSummary.deviceCount} device(s) and ${data.connectionGroups.length} connection group(s).`, [], data)
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
  if (isRecord(createResult) && createResult.ok === false) {
    const message = typeof createResult.message === 'string'
      ? createResult.message
      : 'Blueprint candidate was not created because the runtime rejected the request.'
    const code = typeof createResult.code === 'string' ? createResult.code : 'agent_tool.runtime_rejected'
    return result('create_blueprint_candidate', false, message, [
      issue('error', code, message, null, null, { runtimeResult: cloneDetails(createResult) }),
    ], {
      created: false,
      format: checked.format,
      result: cloneDetails(createResult),
    })
  }
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
  const options = mergeAgentLayoutOptions(isRecord(args) && isRecord(args.options) ? (args.options as LayoutOverlapCheckOptions) : undefined)
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
  const options = mergeAgentLayoutOptions(isRecord(args.options) ? (args.options as LayoutOverlapCheckOptions) : undefined)
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
  const layout = checkLayoutOverlaps(layoutDocument, mergeAgentLayoutOptions(options))
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
      checkedTextBoxCount: layout.checkedTextBoxCount,
      checkedPairCount: layout.checkedPairCount,
      checkedNetworkLineDevicePairCount: layout.checkedNetworkLineDevicePairCount,
      checkedTextDevicePairCount: layout.checkedTextDevicePairCount,
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
    const issues = [issue('error', 'agent_tool.invalid_args', 'check_blueprint_format requires candidate.', null, null, {
      expected: '{ candidate: { title, summary, rationale, tradeoffs, document, issues } }',
      actualType: describeType(args),
      actualSummary: summarizeValue(args),
      fix: 'Wrap the blueprint candidate in a top-level candidate object and include every required candidate field.',
    })]
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
    return [issue('error', 'format.invalid_document_object', 'Document must be a JSON object.', null, null, {
      expected: 'DocumentFile object',
      actualType: describeType(document),
      actualSummary: summarizeValue(document),
      fix: 'Return a complete semantic v4 DocumentFile object, not an array, string, or partial object.',
    })]
  }

  collectUnknownFields(document, new Set(['schemaVersion', 'document', 'devices', 'view', 'extensions']), '', issues)
  if (document.schemaVersion !== '4.0.0') {
    issues.push(issue('error', 'format.schema_version', 'Document schemaVersion must be 4.0.0.', null, 'schemaVersion', expectedDetails('literal "4.0.0"', document.schemaVersion, 'Set document.schemaVersion exactly to "4.0.0".')))
  }
  if (!isRecord(document.document)) {
    issues.push(issue('error', 'format.required', 'Document metadata must be an object.', null, 'document', expectedDetails('object with id and title', document.document, 'Add document: { id: "...", title: "..." }.')))
  } else {
    collectUnknownFields(document.document, new Set(['id', 'title', 'description', 'createdAt', 'updatedAt', 'source', 'language', 'tags', 'extensions']), 'document', issues)
    if (!isNonEmptyString(document.document.id)) issues.push(issue('error', 'format.required', 'Document metadata id must be a non-empty string.', null, 'document.id', expectedDetails('non-empty string', document.document.id, 'Add a stable document.id string.')))
    if (!isNonEmptyString(document.document.title)) issues.push(issue('error', 'format.required', 'Document metadata title must be a non-empty string.', null, 'document.title', expectedDetails('non-empty string', document.document.title, 'Add a human-readable document.title string.')))
  }
  if (!Array.isArray(document.devices)) {
    issues.push(issue('error', 'format.required', 'Document devices must be an array.', null, 'devices', expectedDetails('array of devices', document.devices, 'Add devices: [] or an array of complete device objects.')))
  } else {
    document.devices.forEach((device, index) => collectDeviceFormatIssues(device, `devices[${index}]`, issues))
  }
  if (!isRecord(document.view)) {
    issues.push(issue('error', 'format.required', 'Document view must be an object.', null, 'view', expectedDetails('object with canvas', document.view, 'Add view: { canvas: { units: "px" }, devices: {}, networkLines: {} }.')))
  } else {
    collectViewFormatIssues(document.view, 'view', issues)
  }
  return issues
}

function collectDeviceFormatIssues(device: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(device)) {
    issues.push(issue('error', 'format.invalid_device_object', 'Each device must be an object.', null, path, expectedDetails('device object', device, 'Replace this entry with { id, name, kind, terminals }.')))
    return
  }
  collectUnknownFields(device, new Set(['id', 'name', 'kind', 'category', 'description', 'reference', 'tags', 'properties', 'terminals', 'extensions']), path, issues)
  if (!isNonEmptyString(device.id)) issues.push(issue('error', 'format.required', 'Device id must be a non-empty string.', null, `${path}.id`, expectedDetails('non-empty string', device.id, 'Add a globally unique device id such as r1, u1, c_filter.')))
  if (!isNonEmptyString(device.name)) issues.push(issue('error', 'format.required', 'Device name must be a non-empty string.', null, `${path}.name`, expectedDetails('non-empty string', device.name, 'Add a readable device name such as R1, U1, Filter capacitor.')))
  if (!isNonEmptyString(device.kind)) issues.push(issue('error', 'format.required', 'Device kind must be a non-empty string.', null, `${path}.kind`, expectedDetails('non-empty string', device.kind, 'Add a canonical device kind such as resistor, capacitor, op-amp, regulator, connector.')))
  if (!Array.isArray(device.terminals)) {
    issues.push(issue('error', 'format.required', 'Device terminals must be an array.', null, `${path}.terminals`, expectedDetails('array of terminals', device.terminals, 'Add terminals: [] or an array of terminal objects with id, name, direction, and label.')))
    return
  }
  device.terminals.forEach((terminal, terminalIndex) => collectTerminalFormatIssues(terminal, `${path}.terminals[${terminalIndex}]`, issues))
}

function collectTerminalFormatIssues(terminal: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(terminal)) {
    issues.push(issue('error', 'format.invalid_terminal_object', 'Each terminal must be an object.', null, path, expectedDetails('terminal object', terminal, 'Replace this terminal with { id, name, direction, label }.')))
    return
  }
  collectUnknownFields(terminal, new Set(['id', 'name', 'label', 'direction', 'role', 'description', 'pin', 'required', 'side', 'order', 'extensions']), path, issues)
  if (!isNonEmptyString(terminal.id)) issues.push(issue('error', 'format.required', 'Terminal id must be a non-empty string.', null, `${path}.id`, expectedDetails('non-empty string', terminal.id, 'Add a globally unique terminal id such as r1-a, u1-vcc, op1-out.')))
  if (!isNonEmptyString(terminal.name)) issues.push(issue('error', 'format.required', 'Terminal name must be a non-empty string.', null, `${path}.name`, expectedDetails('non-empty string', terminal.name, 'Add a readable terminal name such as A, B, IN, OUT, VCC, GND.')))
  if (terminal.direction !== 'input' && terminal.direction !== 'output') {
    issues.push(issue('error', 'format.required', 'Terminal direction must be input or output.', null, `${path}.direction`, expectedDetails('"input" | "output"', terminal.direction, 'Use direction "input" or "output"; do not use passive, inout, bidirectional, power, or ground.')))
  }
}

function collectViewFormatIssues(view: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  collectUnknownFields(view, new Set(['canvas', 'devices', 'networkLines', 'focus', 'extensions']), path, issues)
  if (!isRecord(view.canvas)) {
    issues.push(issue('error', 'format.required', 'View canvas must be an object.', null, `${path}.canvas`, expectedDetails('object with units:"px"', view.canvas, 'Add view.canvas: { units: "px" }.')))
  } else {
    collectUnknownFields(view.canvas, new Set(['units', 'grid', 'background', 'extensions']), `${path}.canvas`, issues)
    if (view.canvas.units !== 'px') issues.push(issue('error', 'format.required', 'View canvas units must be px.', null, `${path}.canvas.units`, expectedDetails('literal "px"', view.canvas.units, 'Set view.canvas.units exactly to "px".')))
  }
  if (view.devices !== undefined && !isRecord(view.devices)) {
    issues.push(issue('error', 'format.required', 'View devices must be an object when present.', null, `${path}.devices`, expectedDetails('object keyed by device id', view.devices, 'Use view.devices: { [deviceId]: { position: { x, y } } }.')))
  } else if (isRecord(view.devices)) {
    Object.entries(view.devices).forEach(([deviceId, deviceView]) => {
      if (!isRecord(deviceView)) {
        issues.push(issue('error', 'format.invalid_view_device_object', 'Each view.devices entry must be an object.', deviceId, `${path}.devices.${deviceId}`, expectedDetails('object with position', deviceView, 'Use { position: { x: number, y: number }, shape?: "rectangle" }.')))
      }
    })
  }
  if (view.networkLines !== undefined && !isRecord(view.networkLines)) {
    issues.push(issue('error', 'format.required', 'View networkLines must be an object when present.', null, `${path}.networkLines`, expectedDetails('object keyed by network line id', view.networkLines, 'Use view.networkLines: {} or entries with label, position, length, orientation.')))
  } else if (isRecord(view.networkLines)) {
    Object.entries(view.networkLines).forEach(([networkLineId, networkLine]) => {
      if (!isRecord(networkLine)) {
        issues.push(issue('error', 'format.invalid_network_line_object', 'Each view.networkLines entry must be an object.', networkLineId, `${path}.networkLines.${networkLineId}`, expectedDetails('network line object', networkLine, 'Use { label, position: { x, y }, length, orientation }.')))
        return
      }
      collectUnknownFields(networkLine, new Set(['label', 'position', 'length', 'orientation', 'extensions']), `${path}.networkLines.${networkLineId}`, issues)
      if (!isNonEmptyString(networkLine.label)) {
        issues.push(issue('error', 'format.required', 'Network line label must be a non-empty string.', networkLineId, `${path}.networkLines.${networkLineId}.label`, expectedDetails('non-empty string matching a terminal label', networkLine.label, 'Set label to an existing terminal label or remove this optional network line.')))
      }
      if (!isPointLike(networkLine.position)) {
        issues.push(issue('error', 'format.required', 'Network line position must contain finite x and y numbers.', networkLineId, `${path}.networkLines.${networkLineId}.position`, expectedDetails('{ x: number, y: number }', networkLine.position, 'Add position with finite x and y numbers.')))
      }
    })
  }
}

function collectUnknownFields(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>, path: string, issues: ValidationIssue[]): void {
  Object.keys(value).forEach((key) => {
    if (allowedKeys.has(key)) return
    issues.push(issue('error', 'format.unknown_field', `Unknown field '${key}' is not part of the persisted EasyAnalyse schema at ${path || 'document root'}.`, null, path ? `${path}.${key}` : key, {
      field: key,
      allowedKeys: [...allowedKeys].sort(),
      actualType: describeType(value[key]),
      actualSummary: summarizeValue(value[key]),
      fix: key === 'wires' || key === 'nodes' || key === 'junctions' || key === 'components' || key === 'ports' || key === 'signalId'
        ? 'Remove this old topology field. Express connectivity only by matching terminal.label strings.'
        : 'Remove this field, rename it to a supported field, or place non-standard metadata under extensions/properties where allowed.',
    }))
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

async function resolveBlueprintWorkspace(context: AgentToolRuntimeContext): Promise<BlueprintWorkspaceFile | null> {
  const workspace = context.getBlueprintWorkspace ? await context.getBlueprintWorkspace() : context.blueprintWorkspace
  return workspace ?? null
}

async function resolveSelectedBlueprintId(context: AgentToolRuntimeContext): Promise<string | null> {
  const selectedBlueprintId = context.getSelectedBlueprintId ? await context.getSelectedBlueprintId() : context.selectedBlueprintId
  return selectedBlueprintId?.trim() || null
}

function findBlueprintRecord(workspace: BlueprintWorkspaceFile, blueprintId: string): BlueprintRecord | null {
  return workspace.blueprints.find((record) => record.id === blueprintId && record.lifecycleStatus !== 'deleted') ?? null
}

function summarizeBlueprintRecord(
  record: BlueprintRecord,
  options: { includeDocument?: boolean } = {},
): AgentBlueprintRecordSummary {
  const agentCandidate = record.extensions?.agentCandidate
  const agentIssueCount =
    (agentCandidate?.issues?.length ?? 0)
    + (agentCandidate?.parseIssues?.length ?? 0)
    + (agentCandidate?.toolIssues?.length ?? 0)
  return {
    id: record.id,
    title: record.title,
    ...(record.description ? { description: record.description } : {}),
    lifecycleStatus: record.lifecycleStatus,
    validationState: record.validationState,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.baseMainDocumentHash ? { baseMainDocumentHash: record.baseMainDocumentHash } : {}),
    documentHash: record.documentHash,
    validationIssueCount: record.validationReport?.issueCount ?? 0,
    agentIssueCount,
    documentSummary: summarizeDocument(record.document),
    ...(options.includeDocument ? { document: cloneDocument(record.document) } : {}),
  }
}

function summarizeDocument(document: DocumentFile): AgentDocumentSummary {
  return {
    id: document.document.id,
    title: document.document.title,
    deviceCount: document.devices.length,
    networkLineCount: Object.keys(document.view.networkLines ?? {}).length,
    ...(document.document.updatedAt ? { updatedAt: document.document.updatedAt } : {}),
  }
}

async function resolveTopologyDocument(
  args: unknown,
  context: AgentToolRuntimeContext,
): Promise<{
  document: DocumentFile | null
  source: SummarizeTopologyData['source']
  blueprintId?: string
  summary: string
  code: string
  path?: string
}> {
  if (isRecord(args) && isDocumentFile(args.document)) {
    return {
      document: args.document,
      source: 'provided_document',
      summary: 'Provided document topology resolved.',
      code: 'agent_tool.ok',
    }
  }

  const sourceArg = getStringArg(args, 'source')
  const blueprintId = getStringArg(args, 'blueprintId')
  if (blueprintId || sourceArg === 'selected_blueprint') {
    const workspace = await resolveBlueprintWorkspace(context)
    const selectedBlueprintId = await resolveSelectedBlueprintId(context)
    const requestedBlueprintId = blueprintId ?? selectedBlueprintId
    if (!workspace) {
      return {
        document: null,
        source: 'selected_blueprint',
        ...(requestedBlueprintId ? { blueprintId: requestedBlueprintId } : {}),
        summary: 'No blueprint workspace is available in this runtime context.',
        code: 'agent_tool.no_blueprint_workspace',
      }
    }
    if (!requestedBlueprintId) {
      return {
        document: null,
        source: 'selected_blueprint',
        summary: 'No blueprint id was provided and no blueprint is selected.',
        code: 'agent_tool.no_selected_blueprint',
        path: 'blueprintId',
      }
    }
    const record = findBlueprintRecord(workspace, requestedBlueprintId)
    return {
      document: record?.document ?? null,
      source: 'selected_blueprint',
      blueprintId: requestedBlueprintId,
      summary: record ? `Selected blueprint "${record.title}" topology resolved.` : `Blueprint candidate "${requestedBlueprintId}" was not found.`,
      code: record ? 'agent_tool.ok' : 'agent_tool.blueprint_not_found',
      path: record ? undefined : 'blueprintId',
    }
  }

  const currentDocument = await resolveCurrentDocument(context)
  return {
    document: currentDocument,
    source: 'current_document',
    summary: currentDocument ? 'Current document topology resolved.' : 'No current document is available in this runtime context.',
    code: currentDocument ? 'agent_tool.ok' : 'agent_tool.no_current_document',
  }
}

function buildEmptyTopologyData(source: SummarizeTopologyData['source'], blueprintId?: string): SummarizeTopologyData {
  return {
    source,
    ...(blueprintId ? { blueprintId } : {}),
    documentSummary: { deviceCount: 0, networkLineCount: 0 },
    devices: [],
    connectionGroups: [],
    deviceRelations: [],
    networkLines: [],
    labelSuggestions: [],
  }
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
  details?: Record<string, unknown>,
): ValidationIssue {
  return {
    severity,
    code,
    message: sanitize(message),
    entityId,
    path,
    ...(details ? { details: cloneDetails(details) } : {}),
  }
}

function expectedDetails(expected: string, actual: unknown, fix: string): Record<string, unknown> {
  return {
    expected,
    actualType: describeType(actual),
    actualSummary: summarizeValue(actual),
    fix,
  }
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function summarizeValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  const serialized = safeStringify(value)
  return serialized ? truncate(serialized.replace(/\s+/g, ' '), 240) : describeType(value)
}

function mergeAgentLayoutOptions(options: LayoutOverlapCheckOptions | undefined): LayoutOverlapCheckOptions {
  return { ...DEFAULT_AGENT_LAYOUT_OPTIONS, ...(options ?? {}) }
}

function getStringArg(args: unknown, key: string): string | null {
  if (!isRecord(args)) return null
  const value = args[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function getBooleanArg(args: unknown, key: string, fallback: boolean): boolean {
  if (!isRecord(args)) return fallback
  return typeof args[key] === 'boolean' ? args[key] : fallback
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
    || value === 'get_blueprint_workspace'
    || value === 'get_blueprint_candidate'
    || value === 'compare_blueprint_candidate'
    || value === 'get_current_selection'
    || value === 'summarize_topology'
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

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`
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

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}
