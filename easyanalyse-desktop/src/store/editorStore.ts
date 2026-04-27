import { open, save } from '@tauri-apps/plugin-dialog'
import { create } from 'zustand'
import {
  buildDefaultDocument,
  buildDefaultTerminalIdentity,
  findNextDeviceReference,
  getDeviceReference,
  getTerminalFlowDirection,
  inferSideFromDirection,
  normalizeDocumentLocal,
  normalizeRotationDeg,
} from '../lib/document'
import {
  getDefaultShapeForKind,
  getDefaultSizeForKind,
  getDeviceTemplateDefinition,
  getReferencePrefixForKind,
  type DeviceVisualKind,
} from '../lib/deviceSymbols'
import { setStoredTerminalAnchor } from '../lib/geometry'
import { getStoredLocale, translate } from '../lib/i18n'
import { makeId } from '../lib/ids'
import { useBlueprintStore } from './blueprintStore'
import {
  isTauriRuntime,
  newDocumentCommand,
  openDocumentFromPath,
  saveDocumentToPath,
  validateDocumentCommand,
} from '../lib/tauri'
import type {
  DeviceDefinition,
  DeviceShape,
  DeviceViewDefinition,
  DocumentFile,
  EditorSelection,
  Locale,
  NetworkLineViewDefinition,
  Point,
  TerminalDefinition,
  TerminalDirection,
  ValidationReport,
} from '../types/document'

const FILE_FILTERS = [
  {
    name: 'EASYAnalyse Semantic JSON',
    extensions: ['json'],
  },
]

const DEFAULT_DEVICE_SIZE = getDefaultSizeForKind('module')

interface ViewportAnimationTarget {
  center: Point
  zoom: number
  sequence: number
}

interface EditorState {
  document: DocumentFile
  filePath: string | null
  dirty: boolean
  locale: Locale
  validationReport: ValidationReport | null
  selection: EditorSelection | null
  pendingDeviceShape: DeviceShape | null
  pendingDeviceTemplateKey: DeviceVisualKind | null
  focusedDeviceId: string | null
  focusedLabelKey: string | null
  focusedNetworkLineId: string | null
  viewportAnimationTarget: ViewportAnimationTarget | null
  history: DocumentFile[]
  future: DocumentFile[]
  statusMessage: string | null
  initialize: () => Promise<void>
  newDocument: () => Promise<void>
  openDocument: () => Promise<void>
  saveDocument: () => Promise<void>
  saveDocumentAs: () => Promise<void>
  revalidate: () => Promise<void>
  applyBlueprintDocument: (document: DocumentFile) => void
  setSelection: (selection: EditorSelection | null) => void
  setDeviceGroupSelection: (ids: string[]) => void
  addDevice: (templateKey?: DeviceVisualKind) => void
  applyDeviceTemplate: (id: string, templateKey: DeviceVisualKind) => void
  placePendingDevice: (position?: Point) => string | null
  cancelPendingDevicePlacement: () => void
  addNetworkLine: (label?: string) => void
  updateDevice: (id: string, patch: Partial<DeviceDefinition>) => void
  updateDeviceView: (id: string, patch: Partial<DeviceViewDefinition>) => void
  updateNetworkLine: (id: string, patch: Partial<NetworkLineViewDefinition>) => void
  moveDevice: (id: string, position: Point) => void
  moveDevices: (ids: string[], delta: Point) => void
  repositionTerminal: (
    deviceId: string,
    terminalId: string,
    side: TerminalDefinition['side'],
    insertIndex: number,
    point?: Point,
    bounds?: { width: number; height: number },
  ) => void
  rotateDevice: (id: string, deltaDeg?: number) => void
  rotateSelection: () => void
  addTerminal: (deviceId: string, direction: TerminalDirection) => void
  updateTerminal: (
    deviceId: string,
    terminalId: string,
    patch: Partial<TerminalDefinition>,
  ) => void
  updateDocumentMeta: (patch: Partial<DocumentFile['document']>) => void
  updateCanvas: (patch: Partial<DocumentFile['view']['canvas']>) => void
  deleteSelection: () => void
  undo: () => void
  redo: () => void
  setLocale: (locale: Locale) => void
  focusDevice: (
    deviceId: string | null,
    target?: Omit<ViewportAnimationTarget, 'sequence'> | null,
  ) => void
  focusLabel: (labelKey: string | null) => void
  focusNetworkLine: (networkLineId: string | null) => void
  clearFocus: () => void
  resetViewportToOrigin: () => void
}

function fallbackValidation(document: DocumentFile): ValidationReport {
  return {
    detectedFormat: 'semantic-v4',
    schemaValid: true,
    semanticValid: true,
    issueCount: 0,
    issues: [],
    normalizedDocument: normalizeDocumentLocal(document),
  }
}

function withLocale(
  locale: Locale,
  key: Parameters<typeof translate>[1],
  params?: Record<string, string | number>,
) {
  return translate(locale, key, params)
}

function normalizeDialogPath(path: string | string[] | null) {
  if (typeof path === 'string') {
    return path.trim() ? path : null
  }

  if (Array.isArray(path)) {
    const first = path.find((item) => typeof item === 'string' && item.trim())
    return first ?? null
  }

  return null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getSaveStatusMessage(locale: Locale, path: string, report: ValidationReport) {
  if (report.issueCount > 0) {
    return withLocale(locale, 'statusSavedWithIssues', {
      path,
      count: report.issueCount,
    })
  }

  return withLocale(locale, 'statusSaved', { path })
}

function buildDeviceSelection(ids: string[]): EditorSelection {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (unique.length === 0) {
    return { entityType: 'document' }
  }

  if (unique.length === 1) {
    return { entityType: 'device', id: unique[0]! }
  }

  return {
    entityType: 'deviceGroup',
    ids: unique,
  }
}

function nextDevicePosition(document: DocumentFile) {
  const index = document.devices.length
  const column = index % 4
  const row = Math.floor(index / 4)
  return {
    x: 180 + column * 320,
    y: 180 + row * 220,
  }
}

function inferNetworkLineRole(label: string) {
  const upper = label.trim().toUpperCase()
  if (/(^|[_-])(GND|AGND|DGND|PGND|VSS)([_-]|$)/.test(upper) || upper === 'GND') {
    return 'ground'
  }
  if (
    /(VCC|VDD|VAA|VREF|VBAT|VIN|3V3|5V|12V|24V)/.test(upper) ||
    upper.startsWith('+')
  ) {
    return 'power'
  }
  return 'signal'
}

function summarizeDeviceViewBounds(document: DocumentFile) {
  const views = Object.values(document.view.devices ?? {}).filter((view) => view.position)
  if (!views.length) {
    return {
      minX: 120,
      maxX: 1320,
      minY: 120,
      maxY: 820,
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const view of views) {
    const position = view.position!
    const size = view.size ?? { width: 220, height: 136 }
    minX = Math.min(minX, position.x)
    minY = Math.min(minY, position.y)
    maxX = Math.max(maxX, position.x + size.width)
    maxY = Math.max(maxY, position.y + size.height)
  }

  return { minX, maxX, minY, maxY }
}

function chooseDefaultNetworkLineLabel(document: DocumentFile) {
  const existingLabels = new Set(
    Object.values(document.view.networkLines ?? {})
      .map((item) => item.label.trim())
      .filter(Boolean),
  )
  const suggested = ['3V3', '5V', 'GND', '12V', ...document.devices.flatMap((device) =>
    device.terminals.map((terminal) => terminal.label?.trim() ?? ''),
  )]
    .filter(Boolean)
    .filter((label, index, values) => values.indexOf(label) === index)

  for (const label of suggested) {
    if (!existingLabels.has(label)) {
      return label
    }
  }

  let index = 1
  while (existingLabels.has(`NET_${index}`)) {
    index += 1
  }
  return `NET_${index}`
}

function createDeviceFromTemplate(document: DocumentFile, templateKey: DeviceVisualKind) {
  const template = getDeviceTemplateDefinition(templateKey)
  const id = makeId('device')
  const index = document.devices.length + 1
  const referencePrefix = getReferencePrefixForKind(template.kind)

  return {
    id,
    device: {
      id,
      name: `${template.defaultName} ${index}`,
      kind: template.kind,
      category: template.category,
      description: '',
      reference: findNextDeviceReference(document, referencePrefix),
      tags: [],
      terminals: [],
    },
    view: {
      position: nextDevicePosition(document),
      size: getDefaultSizeForKind(template.kind),
      shape: getDefaultShapeForKind(template.kind),
    } satisfies DeviceViewDefinition,
    template,
  }
}

function getNormalizedTerminalSide(
  terminal: Pick<TerminalDefinition, 'side' | 'direction'>,
) {
  return terminal.side ?? inferSideFromDirection(getTerminalFlowDirection(terminal))
}

function inferNewTerminalSide(
  device: Pick<DeviceDefinition, 'terminals'>,
  direction: TerminalDirection,
) {
  const preferredSide = inferSideFromDirection(direction)
  const sameSideCount = device.terminals.filter(
    (terminal) => getNormalizedTerminalSide(terminal) === preferredSide,
  ).length
  const oppositeSide = preferredSide === 'left' ? 'right' : 'left'
  const oppositeSideCount = device.terminals.filter(
    (terminal) => getNormalizedTerminalSide(terminal) === oppositeSide,
  ).length

  if (sameSideCount <= oppositeSideCount + 1) {
    return preferredSide
  }

  return oppositeSide
}

function compareTerminalPlacement(left: TerminalDefinition, right: TerminalDefinition) {
  const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER
  const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER
  return (
    leftOrder - rightOrder ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  )
}

function nextNetworkLineView(document: DocumentFile, label: string): NetworkLineViewDefinition {
  const bounds = summarizeDeviceViewBounds(document)
  const role = inferNetworkLineRole(label)
  const length = Math.min(2400, Math.max(360, bounds.maxX - bounds.minX + 260))
  const existingCount = Object.keys(document.view.networkLines ?? {}).length
  const centerX = (bounds.minX + bounds.maxX) / 2
  const positionY =
    role === 'ground'
      ? bounds.maxY + 140 + existingCount * 28
      : role === 'power'
        ? bounds.minY - 140 - existingCount * 28
        : bounds.minY - 260 - existingCount * 36

  return {
    label,
    position: {
      x: centerX,
      y: positionY,
    },
    length,
    orientation: 'horizontal',
  }
}

export const useEditorStore = create<EditorState>((set, get) => {
  let validationToken = 0
  let documentOperationToken = 0

  const requestValidation = async (document: DocumentFile) => {
    const token = ++validationToken

    try {
      const report = isTauriRuntime()
        ? await validateDocumentCommand(document)
        : fallbackValidation(document)

      if (token !== validationToken) {
        return
      }

      set((state) => ({
        validationReport: report,
        document: report.normalizedDocument ?? state.document,
      }))
    } catch (error) {
      if (token !== validationToken) {
        return
      }

      set({
        validationReport: fallbackValidation(document),
        statusMessage: getErrorMessage(error),
      })
    }
  }

  const replaceDocument = (
    document: DocumentFile,
    options?: {
      filePath?: string | null
      dirty?: boolean
      selection?: EditorSelection | null
      resetHistory?: boolean
      statusMessage?: string | null
    },
  ): DocumentFile => {
    const normalized = normalizeDocumentLocal(document)
    const hasFilePathOption = Object.prototype.hasOwnProperty.call(options ?? {}, 'filePath')
    set((state) => ({
      document: normalized,
      filePath: hasFilePathOption ? (options?.filePath ?? null) : state.filePath,
      dirty: options?.dirty ?? state.dirty,
      selection: options?.selection ?? state.selection,
      pendingDeviceShape: null,
      pendingDeviceTemplateKey: null,
      history: options?.resetHistory ? [] : state.history,
      future: options?.resetHistory ? [] : state.future,
      statusMessage:
        options?.statusMessage === undefined ? state.statusMessage : options.statusMessage,
      focusedDeviceId: null,
      focusedLabelKey: null,
      focusedNetworkLineId: null,
      viewportAnimationTarget: null,
    }))

    void requestValidation(normalized)
    return normalized
  }

  const mutateDocument = (
    mutator: (draft: DocumentFile) => void,
    selection?: EditorSelection | null,
  ) => {
    const currentState = get()
    const draft = structuredClone(currentState.document)
    mutator(draft)
    const normalized = normalizeDocumentLocal(draft)

    set((state) => ({
      document: normalized,
      dirty: true,
      selection: selection ?? state.selection,
      pendingDeviceShape: null,
      pendingDeviceTemplateKey: null,
      history: [...state.history, state.document],
      future: [],
      viewportAnimationTarget: null,
      focusedDeviceId: state.focusedDeviceId,
      focusedLabelKey: null,
      focusedNetworkLineId: null,
    }))

    void requestValidation(normalized)
  }

  const loadDocumentFromPath = async (path: string, operationToken: number) => {
    const result = await openDocumentFromPath(path)
    if (operationToken !== documentOperationToken) {
      return
    }
    if (!result.document) {
      throw new Error('Document could not be opened')
    }

    set({
      validationReport: result.report,
    })

    const filePath = result.path ?? path
    const normalized = replaceDocument(result.document, {
      filePath,
      dirty: false,
      selection: { entityType: 'document' },
      resetHistory: true,
      statusMessage: withLocale(get().locale, 'statusLoaded', {
        path: filePath,
      }),
    })
    await useBlueprintStore.getState().loadForMainDocument(filePath, normalized)
  }

  return {
    document: buildDefaultDocument(),
    filePath: null,
    dirty: false,
    locale: getStoredLocale(),
    validationReport: null,
    selection: { entityType: 'document' },
    pendingDeviceShape: null,
    pendingDeviceTemplateKey: null,
    focusedDeviceId: null,
    focusedLabelKey: null,
    focusedNetworkLineId: null,
    viewportAnimationTarget: null,
    history: [],
    future: [],
    statusMessage: null,
    initialize: async () => {
      const locale = getStoredLocale()
      const document = buildDefaultDocument(withLocale(locale, 'untitledCircuit'))
      set({ locale })
      const normalized = replaceDocument(document, {
        filePath: null,
        dirty: false,
        selection: { entityType: 'document' },
        resetHistory: true,
      })
      await useBlueprintStore.getState().loadForMainDocument(null, normalized)
    },
    newDocument: async () => {
      const operationToken = ++documentOperationToken
      try {
        const locale = get().locale
        const document = isTauriRuntime()
          ? await newDocumentCommand(withLocale(locale, 'untitledCircuit'))
          : buildDefaultDocument(withLocale(locale, 'untitledCircuit'))
        if (operationToken !== documentOperationToken) {
          return
        }
        const normalized = replaceDocument(document, {
          filePath: null,
          dirty: false,
          selection: { entityType: 'document' },
          resetHistory: true,
          statusMessage: withLocale(locale, 'statusNewDocument'),
        })
        await useBlueprintStore.getState().loadForMainDocument(null, normalized)
      } catch (error) {
        if (operationToken === documentOperationToken) {
          set({ statusMessage: getErrorMessage(error) })
        }
      }
    },
    openDocument: async () => {
      const operationToken = ++documentOperationToken
      try {
        const path = normalizeDialogPath(
          await open({
            multiple: false,
            directory: false,
            filters: FILE_FILTERS,
          }),
        )
        if (operationToken !== documentOperationToken) {
          return
        }
        if (!path) {
          set({ statusMessage: withLocale(get().locale, 'statusOpenCancelled') })
          return
        }

        await loadDocumentFromPath(path, operationToken)
      } catch (error) {
        if (operationToken === documentOperationToken) {
          set({ statusMessage: getErrorMessage(error) })
        }
      }
    },
    saveDocument: async () => {
      try {
        const state = get()
        const document = normalizeDocumentLocal(state.document)
        const report = isTauriRuntime()
          ? await validateDocumentCommand(document)
          : fallbackValidation(document)

        set({
          document: report.normalizedDocument ?? document,
          validationReport: report,
        })

        if (!state.filePath) {
          await get().saveDocumentAs()
          return
        }

        const result = await saveDocumentToPath(state.filePath, report.normalizedDocument ?? document)
        set({
          filePath: result.path,
          dirty: false,
          validationReport: result.report,
          document: result.report.normalizedDocument ?? document,
          statusMessage: getSaveStatusMessage(state.locale, result.path, result.report),
        })
      } catch (error) {
        set({ statusMessage: getErrorMessage(error) })
      }
    },
    saveDocumentAs: async () => {
      try {
        const state = get()
        const path = normalizeDialogPath(
          await save({
            filters: FILE_FILTERS,
            defaultPath: state.filePath ?? `${state.document.document.title || 'easyanalyse'}.json`,
          }),
        )
        if (!path) {
          set({ statusMessage: withLocale(state.locale, 'statusSaveCancelled') })
          return
        }

        const document = normalizeDocumentLocal(state.document)
        const report = isTauriRuntime()
          ? await validateDocumentCommand(document)
          : fallbackValidation(document)

        set({
          document: report.normalizedDocument ?? document,
          validationReport: report,
        })

        const result = await saveDocumentToPath(path, report.normalizedDocument ?? document)
        set({
          filePath: result.path,
          dirty: false,
          validationReport: result.report,
          document: result.report.normalizedDocument ?? document,
          statusMessage: getSaveStatusMessage(state.locale, result.path, result.report),
        })
      } catch (error) {
        set({ statusMessage: getErrorMessage(error) })
      }
    },
    revalidate: async () => {
      const document = normalizeDocumentLocal(get().document)
      set({ document })
      void requestValidation(document)
    },
    applyBlueprintDocument: (document) => {
      ++documentOperationToken
      const normalized = normalizeDocumentLocal(document)
      set((state) => ({
        document: normalized,
        dirty: true,
        selection: { entityType: 'document' },
        pendingDeviceShape: null,
        pendingDeviceTemplateKey: null,
        history: [...state.history, state.document],
        future: [],
        focusedDeviceId: null,
        focusedLabelKey: null,
        focusedNetworkLineId: null,
        viewportAnimationTarget: null,
      }))
      void requestValidation(normalized)
    },
    setSelection: (selection) => set({ selection }),
    setDeviceGroupSelection: (ids) => set({ selection: buildDeviceSelection(ids) }),
    addDevice: (templateKey = 'module') => {
      const state = get()
      const template = getDeviceTemplateDefinition(templateKey)
      const shape = getDefaultShapeForKind(template.kind)
      set({
        pendingDeviceShape: shape,
        pendingDeviceTemplateKey: templateKey,
        statusMessage: `${withLocale(state.locale, 'addDevice')} ${template.label}`,
        focusedDeviceId: null,
        focusedLabelKey: null,
        focusedNetworkLineId: null,
        viewportAnimationTarget: null,
      })
    },
    applyDeviceTemplate: (id, templateKey) => {
      mutateDocument((draft) => {
        const device = draft.devices.find((item) => item.id === id)
        if (!device) {
          return
        }

        const template = getDeviceTemplateDefinition(templateKey)
        const currentName = device.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
        const currentKind = device.kind.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

        device.kind = template.kind
        if (!device.category?.trim()) {
          device.category = template.category
        }
        if (!device.reference?.trim()) {
          device.reference = findNextDeviceReference(draft, getReferencePrefixForKind(template.kind))
        }
        if (!device.name.trim() || currentName === currentKind || currentName.startsWith(currentKind)) {
          device.name = template.defaultName
        }

        draft.view.devices = {
          ...(draft.view.devices ?? {}),
          [id]: {
            ...(draft.view.devices?.[id] ?? {}),
            shape: getDefaultShapeForKind(template.kind),
            size: getDefaultSizeForKind(template.kind),
          },
        }
      }, { entityType: 'device', id })
    },
    placePendingDevice: (position) => {
      const state = get()
      const shape = state.pendingDeviceShape
      if (!shape) {
        return null
      }

      let createdId = ''
      mutateDocument((draft) => {
        const templateKey = state.pendingDeviceTemplateKey ?? 'module'
        const created = createDeviceFromTemplate(draft, templateKey)
        createdId = created.id
        draft.devices.push(created.device)
        draft.view.devices = {
          ...(draft.view.devices ?? {}),
          [created.id]: {
            position: position ?? nextDevicePosition(draft),
            size: created.view.size ?? DEFAULT_DEVICE_SIZE,
            shape: created.view.shape ?? shape,
          },
        }
      }, { entityType: 'device', id: createdId })

      set({
        selection: { entityType: 'device', id: createdId },
        pendingDeviceShape: null,
        pendingDeviceTemplateKey: null,
        statusMessage: `${withLocale(state.locale, 'addDevice')} ${getDeviceTemplateDefinition(state.pendingDeviceTemplateKey ?? 'module').label}`,
      })

      return createdId
    },
    cancelPendingDevicePlacement: () => set({ pendingDeviceShape: null, pendingDeviceTemplateKey: null }),
    addNetworkLine: (label) => {
      const document = get().document
      const nextLabel = (label?.trim() || chooseDefaultNetworkLineLabel(document)).trim()
      const id = makeId('networkLine')

      mutateDocument((draft) => {
        draft.view.networkLines = {
          ...(draft.view.networkLines ?? {}),
          [id]: nextNetworkLineView(draft, nextLabel),
        }
      }, { entityType: 'networkLine', id })

      set({
        selection: { entityType: 'networkLine', id },
      })
    },
    updateDevice: (id, patch) => {
      mutateDocument((draft) => {
        const device = draft.devices.find((item) => item.id === id)
        if (!device) {
          return
        }

        Object.assign(device, patch)
      }, { entityType: 'device', id })
    },
    updateDeviceView: (id, patch) => {
      mutateDocument((draft) => {
        draft.view.devices = {
          ...(draft.view.devices ?? {}),
          [id]: {
            ...(draft.view.devices?.[id] ?? {}),
            ...patch,
          },
        }
      }, { entityType: 'device', id })
    },
    updateNetworkLine: (id, patch) => {
      mutateDocument((draft) => {
        draft.view.networkLines = {
          ...(draft.view.networkLines ?? {}),
          [id]: {
            ...(draft.view.networkLines?.[id] ?? nextNetworkLineView(draft, patch.label?.trim() || 'NET')),
            ...patch,
          },
        }
      }, { entityType: 'networkLine', id })
    },
    moveDevice: (id, position) => {
      mutateDocument((draft) => {
        draft.view.devices = {
          ...(draft.view.devices ?? {}),
          [id]: {
            ...(draft.view.devices?.[id] ?? {}),
            position,
          },
        }
      }, { entityType: 'device', id })
    },
    moveDevices: (ids, delta) => {
      const unique = [...new Set(ids)]
      if (!unique.length) {
        return
      }

      mutateDocument((draft) => {
        draft.view.devices = { ...(draft.view.devices ?? {}) }
        for (const id of unique) {
          const current = draft.view.devices?.[id]
          const position = current?.position ?? nextDevicePosition(draft)
          draft.view.devices[id] = {
            ...(current ?? {}),
            position: {
              x: position.x + delta.x,
              y: position.y + delta.y,
            },
          }
        }
      }, buildDeviceSelection(unique))
    },
    repositionTerminal: (deviceId, terminalId, side, insertIndex, point, bounds) => {
      mutateDocument((draft) => {
        const device = draft.devices.find((item) => item.id === deviceId)
        const terminal = device?.terminals.find((item) => item.id === terminalId)
        if (!device || !terminal) {
          return
        }

        const targetSide = side ?? inferSideFromDirection(getTerminalFlowDirection(terminal))
        const remaining = device.terminals.filter((item) => item.id !== terminalId)
        const orderedBySide = new Map<TerminalDefinition['side'], TerminalDefinition[]>()

        for (const candidate of remaining) {
          const candidateSide = getNormalizedTerminalSide(candidate)
          const bucket = orderedBySide.get(candidateSide) ?? []
          bucket.push(candidate)
          orderedBySide.set(candidateSide, bucket)
        }

        for (const bucket of orderedBySide.values()) {
          bucket.sort(compareTerminalPlacement)
        }

        const targetBucket = [...(orderedBySide.get(targetSide) ?? [])]
        const clampedIndex = Math.max(0, Math.min(insertIndex, targetBucket.length))
        targetBucket.splice(clampedIndex, 0, terminal)
        orderedBySide.set(targetSide, targetBucket)

        terminal.side = targetSide
        setStoredTerminalAnchor(
          terminal,
          point ?? null,
          point && bounds
            ? {
                x: 0,
                y: 0,
                width: bounds.width,
                height: bounds.height,
              }
            : undefined,
        )

        for (const bucket of orderedBySide.values()) {
          bucket.forEach((item, index) => {
            item.order = index * 10
          })
        }
      }, { entityType: 'terminal', id: terminalId })
    },
    rotateDevice: (id, deltaDeg = 90) => {
      const selection = get().selection
      mutateDocument((draft) => {
        const current = draft.view.devices?.[id]?.rotationDeg ?? 0
        draft.view.devices = {
          ...(draft.view.devices ?? {}),
          [id]: {
            ...(draft.view.devices?.[id] ?? {}),
            rotationDeg: normalizeRotationDeg(current + deltaDeg),
          },
        }
      }, selection)
    },
    rotateSelection: () => {
      const selection = get().selection
      if (!selection || selection.entityType === 'document') {
        return
      }

      if (selection.entityType === 'device') {
        get().rotateDevice(selection.id)
        return
      }

      if (selection.entityType === 'deviceGroup') {
        mutateDocument((draft) => {
          draft.view.devices = { ...(draft.view.devices ?? {}) }
          for (const id of selection.ids) {
            const current = draft.view.devices?.[id]?.rotationDeg ?? 0
            draft.view.devices[id] = {
              ...(draft.view.devices?.[id] ?? {}),
              rotationDeg: normalizeRotationDeg(current + 90),
            }
          }
        }, selection)
        return
      }

      if (selection.entityType === 'networkLine') {
        return
      }

      const owner = get().document.devices.find((device) =>
        device.terminals.some((terminal) => terminal.id === selection.id),
      )
      if (owner) {
        get().rotateDevice(owner.id)
      }
    },
    addTerminal: (deviceId, direction) => {
      let createdId = ''
      mutateDocument((draft) => {
        const device = draft.devices.find((item) => item.id === deviceId)
        if (!device) {
          return
        }

        const id = makeId('terminal')
        createdId = id
        const side = inferNewTerminalSide(device, direction)
        const directionCount = device.terminals.filter(
          (terminal) => terminal.direction === direction,
        ).length
        const reference = getDeviceReference(device, draft)
        const identity = buildDefaultTerminalIdentity(direction, directionCount + 1, reference)

        device.terminals.push({
          id,
          name: identity.name,
          label: identity.label,
          direction,
          side,
          order: device.terminals.length,
          required: false,
        })
      }, { entityType: 'terminal', id: createdId })

      set({
        selection: { entityType: 'terminal', id: createdId },
      })
    },
    updateTerminal: (deviceId, terminalId, patch) => {
      mutateDocument((draft) => {
        const device = draft.devices.find((item) => item.id === deviceId)
        const terminal = device?.terminals.find((item) => item.id === terminalId)
        if (!terminal) {
          return
        }

        Object.assign(terminal, patch)
        if (patch.side !== undefined || patch.order !== undefined) {
          setStoredTerminalAnchor(terminal, null)
        }
      }, { entityType: 'terminal', id: terminalId })
    },
    updateDocumentMeta: (patch) => {
      mutateDocument((draft) => {
        Object.assign(draft.document, patch)
      }, { entityType: 'document' })
    },
    updateCanvas: (patch) => {
      mutateDocument((draft) => {
        draft.view.canvas = {
          ...draft.view.canvas,
          ...patch,
          grid: {
            ...(draft.view.canvas.grid ?? { enabled: true, size: 36, majorEvery: 5 }),
            ...(patch.grid ?? {}),
          },
        }
      }, { entityType: 'document' })
    },
    deleteSelection: () => {
      const selection = get().selection
      if (!selection || selection.entityType === 'document') {
        return
      }
      const selectedDeviceIds =
        selection.entityType === 'device'
          ? [selection.id]
          : selection.entityType === 'deviceGroup'
            ? selection.ids
            : []
      const selectionId =
        selection.entityType === 'terminal' || selection.entityType === 'networkLine'
          ? selection.id
          : null

      mutateDocument((draft) => {
        if (selection.entityType === 'device' || selection.entityType === 'deviceGroup') {
          const selectedSet = new Set(selectedDeviceIds)
          draft.devices = draft.devices.filter((device) => !selectedSet.has(device.id))
          if (draft.view.devices) {
            const nextViews = { ...(draft.view.devices ?? {}) }
            for (const deviceId of selectedSet) {
              delete nextViews[deviceId]
            }
            draft.view.devices = nextViews
          }
          return
        }

        if (selection.entityType === 'terminal') {
          for (const device of draft.devices) {
            device.terminals = device.terminals.filter((terminal) => terminal.id !== selectionId)
          }
          return
        }

        if (selection.entityType === 'networkLine' && selectionId) {
          if (draft.view.networkLines?.[selectionId]) {
            const nextViews = { ...(draft.view.networkLines ?? {}) }
            delete nextViews[selectionId]
            draft.view.networkLines = nextViews
          }
        }
      }, { entityType: 'document' })

      set((state) => ({
        selection: { entityType: 'document' },
        pendingDeviceShape: null,
        pendingDeviceTemplateKey: null,
        focusedDeviceId:
          state.focusedDeviceId && selectedDeviceIds.includes(state.focusedDeviceId)
            ? null
            : state.focusedDeviceId,
        focusedLabelKey: null,
        focusedNetworkLineId:
          state.focusedNetworkLineId && state.focusedNetworkLineId === selectionId
            ? null
            : state.focusedNetworkLineId,
        statusMessage: withLocale(state.locale, 'statusDeleted'),
      }))
    },
    undo: () => {
      const state = get()
      if (!state.history.length) {
        return
      }

      const previous = state.history[state.history.length - 1]!
      set({
        document: previous,
        history: state.history.slice(0, -1),
        future: [state.document, ...state.future],
        dirty: true,
        selection: { entityType: 'document' },
        pendingDeviceShape: null,
        pendingDeviceTemplateKey: null,
        focusedDeviceId: null,
        focusedLabelKey: null,
        focusedNetworkLineId: null,
        viewportAnimationTarget: null,
      })
      void requestValidation(previous)
    },
    redo: () => {
      const state = get()
      if (!state.future.length) {
        return
      }

      const next = state.future[0]!
      set({
        document: next,
        history: [...state.history, state.document],
        future: state.future.slice(1),
        dirty: true,
        selection: { entityType: 'document' },
        pendingDeviceShape: null,
        pendingDeviceTemplateKey: null,
        focusedDeviceId: null,
        focusedLabelKey: null,
        focusedNetworkLineId: null,
        viewportAnimationTarget: null,
      })
      void requestValidation(next)
    },
    setLocale: (locale) => {
      window.localStorage.setItem('easyanalyse.locale', locale)
      set({ locale })
    },
    focusDevice: (deviceId, target) =>
      set((state) => ({
        focusedDeviceId: deviceId,
        focusedLabelKey: null,
        focusedNetworkLineId: null,
        viewportAnimationTarget:
          deviceId && target
            ? {
                ...target,
                sequence: (state.viewportAnimationTarget?.sequence ?? 0) + 1,
              }
            : null,
      })),
    focusLabel: (labelKey) => {
      const normalized = labelKey?.trim() ? labelKey.trim() : null
      const matchingNetworkLineId = normalized
        ? Object.entries(get().document.view.networkLines ?? {}).find(
            ([, networkLine]) => networkLine.label.trim() === normalized,
          )?.[0] ?? null
        : null

      set({
        focusedDeviceId: null,
        focusedLabelKey: normalized,
        focusedNetworkLineId: matchingNetworkLineId,
        viewportAnimationTarget: null,
      })
    },
    focusNetworkLine: (networkLineId) => {
      const networkLine = networkLineId
        ? get().document.view.networkLines?.[networkLineId]
        : undefined

      set({
        focusedDeviceId: null,
        focusedLabelKey: networkLine?.label?.trim() || null,
        focusedNetworkLineId: networkLineId,
        viewportAnimationTarget: null,
      })
    },
    clearFocus: () =>
      set({
        focusedDeviceId: null,
        focusedLabelKey: null,
        focusedNetworkLineId: null,
        viewportAnimationTarget: null,
      }),
    resetViewportToOrigin: () =>
      set((state) => ({
        focusedDeviceId: null,
        focusedLabelKey: null,
        focusedNetworkLineId: null,
        viewportAnimationTarget: {
          center: { x: 0, y: 0 },
          zoom: 1,
          sequence: (state.viewportAnimationTarget?.sequence ?? 0) + 1,
        },
      })),
  }
})
