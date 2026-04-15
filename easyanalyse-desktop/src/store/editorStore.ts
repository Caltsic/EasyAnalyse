import { open, save } from '@tauri-apps/plugin-dialog'
import { create } from 'zustand'
import {
  buildDefaultDocument,
  buildDefaultTerminalIdentity,
  findNextDeviceReference,
  getDeviceReference,
  inferSideFromDirection,
  normalizeDocumentLocal,
  normalizeRotationDeg,
} from '../lib/document'
import { getStoredLocale, translate } from '../lib/i18n'
import { makeId } from '../lib/ids'
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
  setSelection: (selection: EditorSelection | null) => void
  addDevice: (shape?: DeviceShape) => void
  addNetworkLine: (label?: string) => void
  updateDevice: (id: string, patch: Partial<DeviceDefinition>) => void
  updateDeviceView: (id: string, patch: Partial<DeviceViewDefinition>) => void
  updateNetworkLine: (id: string, patch: Partial<NetworkLineViewDefinition>) => void
  moveDevice: (id: string, position: Point) => void
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
  const suggested = ['VCC', 'GND', '3V3', '5V', ...document.devices.flatMap((device) =>
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
  ) => {
    const normalized = normalizeDocumentLocal(document)
    set((state) => ({
      document: normalized,
      filePath: options?.filePath ?? state.filePath,
      dirty: options?.dirty ?? state.dirty,
      selection: options?.selection ?? state.selection,
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
      history: [...state.history, state.document],
      future: [],
      viewportAnimationTarget: null,
      focusedDeviceId:
        selection?.entityType === 'device'
          ? selection.id ?? state.focusedDeviceId
          : state.focusedDeviceId,
      focusedLabelKey: null,
      focusedNetworkLineId: null,
    }))

    void requestValidation(normalized)
  }

  const loadDocumentFromPath = async (path: string) => {
    const result = await openDocumentFromPath(path)
    if (!result.document) {
      throw new Error('Document could not be opened')
    }

    set({
      validationReport: result.report,
    })

    replaceDocument(result.document, {
      filePath: result.path ?? path,
      dirty: false,
      selection: { entityType: 'document' },
      resetHistory: true,
      statusMessage: withLocale(get().locale, 'statusLoaded', {
        path: result.path ?? path,
      }),
    })
  }

  return {
    document: buildDefaultDocument(),
    filePath: null,
    dirty: false,
    locale: getStoredLocale(),
    validationReport: null,
    selection: { entityType: 'document' },
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
      replaceDocument(document, {
        dirty: false,
        selection: { entityType: 'document' },
        resetHistory: true,
      })
    },
    newDocument: async () => {
      try {
        const locale = get().locale
        const document = isTauriRuntime()
          ? await newDocumentCommand(withLocale(locale, 'untitledCircuit'))
          : buildDefaultDocument(withLocale(locale, 'untitledCircuit'))
        replaceDocument(document, {
          filePath: null,
          dirty: false,
          selection: { entityType: 'document' },
          resetHistory: true,
          statusMessage: withLocale(locale, 'statusNewDocument'),
        })
      } catch (error) {
        set({ statusMessage: getErrorMessage(error) })
      }
    },
    openDocument: async () => {
      try {
        const path = normalizeDialogPath(
          await open({
            multiple: false,
            directory: false,
            filters: FILE_FILTERS,
          }),
        )
        if (!path) {
          set({ statusMessage: withLocale(get().locale, 'statusOpenCancelled') })
          return
        }

        await loadDocumentFromPath(path)
      } catch (error) {
        set({ statusMessage: getErrorMessage(error) })
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
    setSelection: (selection) => set({ selection }),
    addDevice: (shape = 'rectangle') => {
      const state = get()
      let createdId = ''

      mutateDocument((draft) => {
        const id = makeId('device')
        createdId = id
        const kind = shape === 'triangle' ? 'sensor' : shape === 'circle' ? 'connector' : 'module'
        const index = draft.devices.length + 1
        draft.devices.push({
          id,
          name: `${shape === 'triangle' ? 'Sensor' : shape === 'circle' ? 'Connector' : 'Module'} ${index}`,
          kind,
          category: shape === 'triangle' ? 'input' : undefined,
          description: '',
          reference: findNextDeviceReference(draft, shape === 'circle' ? 'J' : 'U'),
          tags: [],
          terminals: [],
        })
        draft.view.devices = {
          ...(draft.view.devices ?? {}),
          [id]: {
            position: nextDevicePosition(draft),
            size: {
              width: 220,
              height: 136,
            },
            shape,
          },
        }
      }, { entityType: 'device', id: createdId })

      set({
        selection: { entityType: 'device', id: createdId },
        statusMessage: `${withLocale(state.locale, 'addDevice')} ${translate(state.locale, shape)}`,
      })
    },
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
      if (!selection?.id || selection.entityType === 'document') {
        return
      }

      if (selection.entityType === 'device') {
        get().rotateDevice(selection.id)
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
        const side = inferSideFromDirection(direction)
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
      if (!selection || selection.entityType === 'document' || !selection.id) {
        return
      }
      const selectionId = selection.id

      mutateDocument((draft) => {
        if (selection.entityType === 'device') {
          draft.devices = draft.devices.filter((device) => device.id !== selectionId)
          if (draft.view.devices?.[selectionId]) {
            const nextViews = { ...(draft.view.devices ?? {}) }
            delete nextViews[selectionId]
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

        if (selection.entityType === 'networkLine') {
          if (draft.view.networkLines?.[selectionId]) {
            const nextViews = { ...(draft.view.networkLines ?? {}) }
            delete nextViews[selectionId]
            draft.view.networkLines = nextViews
          }
        }
      }, { entityType: 'document' })

      set((state) => ({
        selection: { entityType: 'document' },
        focusedDeviceId:
          state.focusedDeviceId === selection.id ? null : state.focusedDeviceId,
        focusedLabelKey: null,
        focusedNetworkLineId:
          state.focusedNetworkLineId === selection.id ? null : state.focusedNetworkLineId,
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
