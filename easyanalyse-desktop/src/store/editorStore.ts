import { open, save } from '@tauri-apps/plugin-dialog'
import { create } from 'zustand'
import {
  buildDefaultDocument,
  countPortsForComponent,
  getComponentRotation,
  normalizeDocumentLocal,
  setComponentRotation,
} from '../lib/document'
import {
  clamp,
  createPolylineBendPoint,
  derivePortAnchor,
  getEndpointPosition,
  getGeometryCenter,
  midpoint,
  translateGeometry,
} from '../lib/geometry'
import { getShapeLabel, getStoredLocale, translate } from '../lib/i18n'
import { makeId, makeLabel } from '../lib/ids'
import {
  isTauriRuntime,
  newDocumentCommand,
  openDocumentFromPath,
  saveDocumentToPath,
  summarizeDiffCommand,
  validateDocumentCommand,
} from '../lib/tauri'
import type {
  AnnotationEntity,
  AnnotationTarget,
  ComponentEntity,
  ComponentGeometry,
  DiffSummary,
  DocumentFile,
  EditorSelection,
  EndpointRef,
  Locale,
  PlacementMode,
  Point,
  PortAnchor,
  PortEntity,
  Route,
  ValidationReport,
} from '../types/document'

const RECENT_FILES_KEY = 'easyanalyse.recentFiles'

interface EditorState {
  document: DocumentFile
  filePath: string | null
  dirty: boolean
  validationReport: ValidationReport | null
  selection: EditorSelection | null
  selectedEntities: EditorSelection[]
  connectMode: boolean
  connectionSource: EndpointRef | null
  connectionDraftPoints: Point[]
  draftRouteKind: Route['kind']
  placementMode: PlacementMode | null
  recentFiles: string[]
  diffSummary: DiffSummary | null
  history: DocumentFile[]
  future: DocumentFile[]
  statusMessage: string | null
  locale: Locale
  initialize: () => Promise<void>
  revalidate: () => Promise<void>
  newDocument: () => Promise<void>
  openDocument: () => Promise<void>
  reopenRecent: (path: string) => Promise<void>
  saveDocument: () => Promise<void>
  saveDocumentAs: () => Promise<void>
  setSelection: (selection: EditorSelection | null) => void
  setSelectedEntities: (selection: EditorSelection[]) => void
  addComponent: (shape: ComponentGeometry['type']) => void
  placePendingAt: (point: Point) => void
  cancelPlacement: () => void
  updateComponent: (id: string, patch: Partial<ComponentEntity>) => void
  updateComponentGeometry: (id: string, geometry: ComponentGeometry) => void
  updateComponentRotation: (id: string, rotationDeg: number) => void
  moveComponentCenter: (id: string, x: number, y: number) => void
  addPort: (direction: PortEntity['direction'], componentId?: string) => void
  updatePort: (id: string, patch: Partial<PortEntity>) => void
  movePort: (id: string, point: Point) => void
  addNode: () => void
  updateNode: (
    id: string,
    patch: Partial<DocumentFile['nodes'][number]>,
  ) => void
  moveNode: (id: string, x: number, y: number) => void
  addAnnotation: (
    kind: AnnotationEntity['kind'],
    target?: AnnotationTarget,
  ) => void
  updateAnnotation: (id: string, patch: Partial<AnnotationEntity>) => void
  updateWire: (id: string, patch: Partial<DocumentFile['wires'][number]>) => void
  moveWireBendPoint: (id: string, index: number, point: Point) => void
  addWireBendPoint: (id: string) => void
  beginConnection: () => void
  cancelConnection: () => void
  addConnectionBendPoint: (point: Point) => void
  setDraftRouteKind: (kind: Route['kind']) => void
  useConnectionEndpoint: (endpoint: EndpointRef) => void
  deleteSelection: () => void
  updateDocumentMeta: (patch: Partial<DocumentFile['document']>) => void
  updateCanvas: (patch: Partial<DocumentFile['canvas']>) => void
  undo: () => void
  redo: () => void
  setStatusMessage: (message: string | null) => void
  setLocale: (locale: Locale) => void
  rotateSelectionClockwise: () => void
}

function fallbackValidation(document: DocumentFile): ValidationReport {
  return {
    schemaValid: true,
    semanticValid: true,
    issueCount: 0,
    issues: [],
    normalizedDocument: normalizeDocumentLocal(document),
  }
}

function loadRecentFiles() {
  try {
    const raw = window.localStorage.getItem(RECENT_FILES_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function saveRecentFiles(paths: string[]) {
  window.localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(paths))
}

function nextPortAnchor(
  geometry: ComponentGeometry,
  direction: PortEntity['direction'],
  existingCount: number,
): PortAnchor {
  const offset = clamp(0.2 + existingCount * 0.18, 0.15, 0.85)

  if (geometry.type === 'rectangle') {
    return {
      kind: 'rectangle-side',
      side: direction === 'input' ? 'left' : 'right',
      offset,
    }
  }

  if (geometry.type === 'circle') {
    return {
      kind: 'circle-angle',
      angleDeg: direction === 'input' ? 180 + existingCount * 18 : existingCount * -18,
    }
  }

  return {
    kind: 'triangle-edge',
    edgeIndex: direction === 'input' ? 2 : 1,
    offset,
  }
}

function defaultWireRoute(
  document: DocumentFile,
  source: EndpointRef,
  target: EndpointRef,
  kind: Route['kind'],
  bendPoints: Point[] = [],
): Route {
  if (kind === 'straight') {
    return { kind: 'straight' }
  }

  if (bendPoints.length) {
    return {
      kind: 'polyline',
      bendPoints,
    }
  }

  const sourcePoint = getEndpointPosition(document, source)
  const targetPoint = getEndpointPosition(document, target)

  if (!sourcePoint || !targetPoint) {
    return { kind: 'polyline', bendPoints: [{ x: 0, y: 0 }] }
  }

  return {
    kind: 'polyline',
    bendPoints: createPolylineBendPoint(sourcePoint, targetPoint),
  }
}

function pushRecentFile(path: string, current: string[]) {
  const next = [path, ...current.filter((item) => item !== path)].slice(0, 6)
  saveRecentFiles(next)
  return next
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

function withLocale(locale: Locale, key: Parameters<typeof translate>[1], params?: Record<string, string | number>) {
  return translate(locale, key, params)
}

function localizedUntitledTitle(locale: Locale) {
  return locale === 'zh-CN' ? '未命名电路' : 'Untitled circuit'
}

function localizedWorkspaceTitle(locale: Locale) {
  return locale === 'zh-CN' ? '工作区草稿' : 'Workspace Draft'
}

function selectionList(selection: EditorSelection | null) {
  return selection ? [selection] : []
}

function dedupeSelections(selections: EditorSelection[]) {
  const seen = new Set<string>()
  const next: EditorSelection[] = []

  for (const selection of selections) {
    const key = `${selection.entityType}:${selection.id ?? ''}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    next.push(selection)
  }

  return next
}

function firstSaveBlockingMessage(
  locale: Locale,
  report: ValidationReport,
  document: DocumentFile,
) {
  const orphanNodes = document.nodes.filter((node) => node.connectedWireIds.length < 2)
  if (orphanNodes.length) {
    return withLocale(locale, 'statusSaveBlockedNode', {
      id: orphanNodes[0]!.id,
      count: orphanNodes.length,
    })
  }

  const issue = report.issues.find((candidate) => candidate.severity === 'error')
  return issue?.message ?? withLocale(locale, 'statusSaveBlocked')
}

export function untitledTitle(locale: Locale) {
  return locale === 'zh-CN' ? '未命名电路' : 'Untitled circuit'
}

export function workspaceTitle(locale: Locale) {
  return locale === 'zh-CN' ? '工作区草稿' : 'Workspace Draft'
}

function buildComponentGeometry(
  shape: ComponentGeometry['type'],
  point: Point,
): ComponentGeometry {
  switch (shape) {
    case 'rectangle':
      return {
        type: 'rectangle',
        x: point.x - 110,
        y: point.y - 68,
        width: 220,
        height: 136,
      }
    case 'circle':
      return {
        type: 'circle',
        cx: point.x,
        cy: point.y,
        radius: 72,
      }
    case 'triangle':
      return {
        type: 'triangle',
        vertices: [
          { x: point.x, y: point.y - 88 },
          { x: point.x + 96, y: point.y + 72 },
          { x: point.x - 96, y: point.y + 72 },
        ],
      }
  }
}

function normalizeRotation(rotationDeg: number) {
  const normalized = rotationDeg % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function isAnnotationTargetEntityType(
  entityType: EditorSelection['entityType'],
): entityType is AnnotationTarget['entityType'] {
  return (
    entityType === 'component' ||
    entityType === 'port' ||
    entityType === 'node' ||
    entityType === 'wire'
  )
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
      selectedEntities?: EditorSelection[]
      diffSummary?: DiffSummary | null
      resetHistory?: boolean
      statusMessage?: string | null
    },
  ) => {
    const normalized = normalizeDocumentLocal(document)
    const nextSelection = options?.selection ?? get().selection
    const nextSelectedEntities =
      options?.selectedEntities ?? selectionList(nextSelection)

    set((state) => ({
      document: normalized,
      filePath: options?.filePath ?? state.filePath,
      dirty: options?.dirty ?? state.dirty,
      selection: nextSelection,
      selectedEntities: nextSelectedEntities,
      diffSummary:
        options?.diffSummary === undefined ? state.diffSummary : options.diffSummary,
      history: options?.resetHistory ? [] : state.history,
      future: options?.resetHistory ? [] : state.future,
      statusMessage:
        options?.statusMessage === undefined
          ? state.statusMessage
          : options.statusMessage,
      connectMode: false,
      connectionSource: null,
      connectionDraftPoints: [],
      placementMode: null,
    }))

    void requestValidation(normalized)
  }

  const mutateDocument = (
    mutator: (draft: DocumentFile) => void,
    selection?: EditorSelection | null,
    selectedEntities?: EditorSelection[],
  ) => {
    const current = get().document
    const draft = structuredClone(current)
    mutator(draft)
    const normalized = normalizeDocumentLocal(draft)
    const nextSelection = selection ?? get().selection
    const nextSelectedEntities =
      selectedEntities ??
      (selection === undefined ? get().selectedEntities : selectionList(nextSelection))

    set((state) => ({
      document: normalized,
      dirty: true,
      selection: nextSelection,
      selectedEntities: nextSelectedEntities,
      history: [...state.history, state.document],
      future: [],
      diffSummary: null,
    }))

    void requestValidation(normalized)
  }

  const loadDocumentFromPath = async (path: string) => {
    const previous = get().document
    const result = await openDocumentFromPath(path)
    const resolvedPath = result.path ?? path
    const diffSummary = await summarizeDiffCommand(previous, result.document).catch(
      () => null,
    )

    const recentFiles = pushRecentFile(resolvedPath, get().recentFiles)

    set({
      recentFiles,
      validationReport: result.report,
    })

    replaceDocument(result.document, {
      filePath: resolvedPath,
      dirty: false,
      selection: { entityType: 'document' },
      selectedEntities: [{ entityType: 'document' }],
      diffSummary,
      resetHistory: true,
      statusMessage: withLocale(get().locale, 'statusLoaded', { path: resolvedPath }),
    })
  }

  const prepareDocumentForSave = async () => {
    const state = get()
    const normalizedDocument = normalizeDocumentLocal(state.document)
    const report = isTauriRuntime()
      ? await validateDocumentCommand(normalizedDocument)
      : fallbackValidation(normalizedDocument)
    const document = report.normalizedDocument ?? normalizedDocument

    set({
      document,
      validationReport: report,
    })

    if (!report.schemaValid || !report.semanticValid) {
      set({
        statusMessage: firstSaveBlockingMessage(state.locale, report, document),
      })
      return null
    }

    return {
      document,
      report,
    }
  }

  return {
    document: buildDefaultDocument(),
    filePath: null,
    dirty: false,
    validationReport: null,
    selection: { entityType: 'document' },
    selectedEntities: [{ entityType: 'document' }],
    connectMode: false,
    connectionSource: null,
    connectionDraftPoints: [],
    draftRouteKind: 'straight',
    placementMode: null,
    recentFiles: [],
    diffSummary: null,
    history: [],
    future: [],
    statusMessage: null,
    locale: 'zh-CN',
    initialize: async () => {
      const recentFiles = loadRecentFiles()
      const locale = getStoredLocale()
      set({ recentFiles, locale })

      if (isTauriRuntime()) {
        try {
          const document = await newDocumentCommand(localizedWorkspaceTitle(locale))
          replaceDocument(document, {
            filePath: null,
            dirty: false,
            selection: { entityType: 'document' },
            selectedEntities: [{ entityType: 'document' }],
            resetHistory: true,
          })
          return
        } catch {
          // Fall back to local default document.
        }
      }

      replaceDocument(buildDefaultDocument(localizedWorkspaceTitle(locale)), {
        filePath: null,
        dirty: false,
        selection: { entityType: 'document' },
        selectedEntities: [{ entityType: 'document' }],
        resetHistory: true,
      })
    },
    revalidate: async () => {
      await requestValidation(get().document)
    },
    newDocument: async () => {
      const locale = get().locale
      const title = localizedUntitledTitle(locale)
      const document = isTauriRuntime()
        ? await newDocumentCommand(title).catch(() => buildDefaultDocument(title))
        : buildDefaultDocument(title)

      replaceDocument(document, {
        filePath: null,
        dirty: false,
        selection: { entityType: 'document' },
        selectedEntities: [{ entityType: 'document' }],
        diffSummary: null,
        resetHistory: true,
        statusMessage: withLocale(locale, 'statusNewDocument'),
      })
    },
    openDocument: async () => {
      try {
        const path = normalizeDialogPath(
          await open({
            multiple: false,
            directory: false,
            filters: [{ name: 'AI Native Circuit JSON', extensions: ['json'] }],
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
    reopenRecent: async (path) => {
      try {
        await loadDocumentFromPath(path)
      } catch (error) {
        set({ statusMessage: getErrorMessage(error) })
      }
    },
    saveDocument: async () => {
      const { filePath, recentFiles, locale } = get()

      if (!filePath) {
        await get().saveDocumentAs()
        return
      }

      try {
        const prepared = await prepareDocumentForSave()
        if (!prepared) {
          return
        }

        const result = await saveDocumentToPath(filePath, prepared.document)
        set({
          filePath: result.path,
          dirty: false,
          validationReport: result.report,
          recentFiles: pushRecentFile(result.path, recentFiles),
          statusMessage: withLocale(locale, 'statusSaved', { path: result.path }),
        })
      } catch (error) {
        set({ statusMessage: getErrorMessage(error) })
      }
    },
    saveDocumentAs: async () => {
      try {
        const { document, locale } = get()
        const suggested =
          document.document.title.trim().replace(/[\\/:*?"<>|]+/g, '-')
            .replace(/\s+/g, '-')
            .toLowerCase() || 'easyanalyse-document'
        const path = normalizeDialogPath(
          await save({
            title: withLocale(locale, 'saveAs'),
            defaultPath: `${suggested}.json`,
            filters: [{ name: 'AI Native Circuit JSON', extensions: ['json'] }],
          }),
        )

        if (!path) {
          set({ statusMessage: withLocale(locale, 'statusSaveCancelled') })
          return
        }

        const prepared = await prepareDocumentForSave()
        if (!prepared) {
          return
        }

        const result = await saveDocumentToPath(path, prepared.document)
        set({
          filePath: result.path,
          dirty: false,
          validationReport: result.report,
          recentFiles: pushRecentFile(result.path, get().recentFiles),
          statusMessage: withLocale(locale, 'statusSaved', { path: result.path }),
        })
      } catch (error) {
        set({ statusMessage: getErrorMessage(error) })
      }
    },
    setSelection: (selection) =>
      set({
        selection,
        selectedEntities: selectionList(selection),
      }),
    setSelectedEntities: (selectedEntities) => {
      const next = dedupeSelections(selectedEntities)
      set({
        selection: next[0] ?? null,
        selectedEntities: next,
      })
    },
    addComponent: (shape) => {
      const { placementMode, locale } = get()
      const sameMode =
        placementMode?.kind === 'component' && placementMode.shape === shape

      if (sameMode) {
        set({
          placementMode: null,
          statusMessage: withLocale(locale, 'statusPlacementCancelled'),
        })
        return
      }

      set({
        placementMode: {
          kind: 'component',
          shape,
        },
        connectMode: false,
        connectionSource: null,
        connectionDraftPoints: [],
        statusMessage: withLocale(locale, 'statusPlacementComponent', {
          shape: getShapeLabel(locale, shape),
        }),
      })
    },
    placePendingAt: (point) => {
      const { placementMode } = get()
      if (!placementMode) {
        return
      }

      let createdSelection: EditorSelection | null = null

      mutateDocument((draft) => {
        if (placementMode.kind === 'component') {
          const index = draft.components.length + 1
          const id = makeId('component')
          draft.components.push({
            id,
            name: makeLabel(placementMode.shape, index),
            geometry: buildComponentGeometry(placementMode.shape, point),
            description: '',
            tags: [],
          })
          createdSelection = { entityType: 'component', id }
          return
        }

        const id = makeId('node')
        draft.nodes.push({
          id,
          position: point,
          connectedWireIds: [],
          role: 'junction',
          description: '',
        })
        createdSelection = { entityType: 'node', id }
      }, createdSelection)

      set({
        placementMode: null,
        selection: createdSelection,
        selectedEntities: selectionList(createdSelection),
      })
    },
    cancelPlacement: () =>
      set({
        placementMode: null,
        statusMessage: withLocale(get().locale, 'statusPlacementCancelled'),
      }),
    updateComponent: (id, patch) => {
      mutateDocument((draft) => {
        const component = draft.components.find((item) => item.id === id)
        if (!component) {
          return
        }

        Object.assign(component, patch)
      }, { entityType: 'component', id })
    },
    updateComponentGeometry: (id, geometry) => {
      mutateDocument((draft) => {
        const component = draft.components.find((item) => item.id === id)
        if (!component) {
          return
        }

        component.geometry = geometry
      }, { entityType: 'component', id })
    },
    updateComponentRotation: (id, rotationDeg) => {
      mutateDocument((draft) => {
        const component = draft.components.find((item) => item.id === id)
        if (!component) {
          return
        }

        Object.assign(component, setComponentRotation(component, normalizeRotation(rotationDeg)))
      }, { entityType: 'component', id })
    },
    moveComponentCenter: (id, x, y) => {
      mutateDocument((draft) => {
        const component = draft.components.find((item) => item.id === id)
        if (!component) {
          return
        }

        const currentCenter = getGeometryCenter(component.geometry)
        component.geometry = translateGeometry(
          component.geometry,
          x - currentCenter.x,
          y - currentCenter.y,
        )
      }, { entityType: 'component', id })
    },
    addPort: (direction, componentId) => {
      const state = get()
      const targetComponentId =
        componentId ??
        (state.selection?.entityType === 'component'
          ? state.selection.id
          : state.selection?.entityType === 'port'
            ? state.document.ports.find((port) => port.id === state.selection?.id)
                ?.componentId
            : undefined)

      if (!targetComponentId) {
        set({ statusMessage: withLocale(state.locale, 'statusSelectComponent') })
        return
      }

      let createdId = ''

      mutateDocument((draft) => {
        const component = draft.components.find((item) => item.id === targetComponentId)
        if (!component) {
          return
        }

        const existingCount = countPortsForComponent(
          targetComponentId,
          direction,
          draft,
        )

        const id = makeId('port')
        createdId = id
        draft.ports.push({
          id,
          componentId: targetComponentId,
          name: `${direction === 'input' ? 'IN' : 'OUT'}_${existingCount + 1}`,
          direction,
          anchor: nextPortAnchor(component.geometry, direction, existingCount),
          description: '',
        })
      })

      if (createdId) {
        set({
          selection: { entityType: 'port', id: createdId },
          selectedEntities: [{ entityType: 'port', id: createdId }],
        })
      }
    },
    updatePort: (id, patch) => {
      mutateDocument((draft) => {
        const port = draft.ports.find((item) => item.id === id)
        if (!port) {
          return
        }

        Object.assign(port, patch)
      }, { entityType: 'port', id })
    },
    movePort: (id, point) => {
      mutateDocument((draft) => {
        const port = draft.ports.find((item) => item.id === id)
        if (!port) {
          return
        }

        const component = draft.components.find((item) => item.id === port.componentId)
        if (!component) {
          return
        }

        port.anchor = derivePortAnchor(component, point)
      }, { entityType: 'port', id })
    },
    addNode: () => {
      const { placementMode, locale } = get()
      if (placementMode?.kind === 'node') {
        set({
          placementMode: null,
          statusMessage: withLocale(locale, 'statusPlacementCancelled'),
        })
        return
      }

      set({
        placementMode: { kind: 'node' },
        connectMode: false,
        connectionSource: null,
        connectionDraftPoints: [],
        statusMessage: withLocale(locale, 'statusPlacementNode'),
      })
    },
    updateNode: (id, patch) => {
      mutateDocument((draft) => {
        const node = draft.nodes.find((item) => item.id === id)
        if (!node) {
          return
        }

        Object.assign(node, patch)
      }, { entityType: 'node', id })
    },
    moveNode: (id, x, y) => {
      mutateDocument((draft) => {
        const node = draft.nodes.find((item) => item.id === id)
        if (!node) {
          return
        }

        node.position = { x, y }
      }, { entityType: 'node', id })
    },
    addAnnotation: (kind, target) => {
      const state = get()
      const selection = state.selection
      const derivedTarget =
        target ??
        (selection &&
        selection.id &&
        isAnnotationTargetEntityType(selection.entityType)
          ? { entityType: selection.entityType, refId: selection.id }
          : undefined)

      if (target && !isAnnotationTargetEntityType(target.entityType)) {
        set({
          statusMessage: withLocale(state.locale, 'statusInvalidAnnotationTarget'),
        })
        return
      }

      if (
        selection?.entityType === 'annotation' &&
        !target
      ) {
        set({
          statusMessage: withLocale(state.locale, 'statusInvalidAnnotationTarget'),
        })
        return
      }

      if (!derivedTarget) {
        set({ statusMessage: withLocale(state.locale, 'statusSelectTarget') })
        return
      }

      let createdId = ''

      mutateDocument((draft) => {
        const id = makeId('annotation')
        createdId = id
        draft.annotations.push({
          id,
          kind,
          target: derivedTarget,
          text: kind === 'signal' ? '3.3V PWM' : 'Describe this element',
        })
      })

      set({
        selection: { entityType: 'annotation', id: createdId },
        selectedEntities: [{ entityType: 'annotation', id: createdId }],
      })
    },
    updateAnnotation: (id, patch) => {
      mutateDocument((draft) => {
        const annotation = draft.annotations.find((item) => item.id === id)
        if (!annotation) {
          return
        }

        Object.assign(annotation, patch)
      }, { entityType: 'annotation', id })
    },
    updateWire: (id, patch) => {
      mutateDocument((draft) => {
        const wire = draft.wires.find((item) => item.id === id)
        if (!wire) {
          return
        }

        Object.assign(wire, patch)
      }, { entityType: 'wire', id })
    },
    moveWireBendPoint: (id, index, point) => {
      mutateDocument((draft) => {
        const wire = draft.wires.find((item) => item.id === id)
        if (!wire || wire.route.kind !== 'polyline') {
          return
        }

        wire.route.bendPoints[index] = point
      }, { entityType: 'wire', id })
    },
    addWireBendPoint: (id) => {
      mutateDocument((draft) => {
        const wire = draft.wires.find((item) => item.id === id)
        if (!wire || wire.route.kind !== 'polyline') {
          return
        }

        const source = getEndpointPosition(draft, wire.source)
        const target = getEndpointPosition(draft, wire.target)
        if (!source || !target) {
          wire.route.bendPoints.push({ x: 0, y: 0 })
          return
        }

        const last = wire.route.bendPoints.at(-1) ?? source
        wire.route.bendPoints.push(midpoint(last, target))
      }, { entityType: 'wire', id })
    },
    beginConnection: () => {
      set((state) => {
        const connectMode = !state.connectMode

        return {
          connectMode,
          connectionSource: null,
          connectionDraftPoints: [],
          placementMode: null,
          statusMessage: connectMode
            ? null
            : withLocale(state.locale, 'statusConnectionCancelled'),
        }
      })
    },
    cancelConnection: () => {
      set({
        connectMode: false,
        connectionSource: null,
        connectionDraftPoints: [],
        statusMessage: withLocale(get().locale, 'statusConnectionCancelled'),
      })
    },
    addConnectionBendPoint: (point) => {
      set((state) => {
        if (
          !state.connectMode ||
          !state.connectionSource ||
          state.draftRouteKind !== 'polyline'
        ) {
          return state
        }

        const nextBendPoints = [...state.connectionDraftPoints, point]
        return {
          connectionDraftPoints: nextBendPoints,
          statusMessage: withLocale(state.locale, 'statusAddedBendPoint', {
            index: nextBendPoints.length,
          }),
        }
      })
    },
    setDraftRouteKind: (kind) =>
      set((state) => ({
        draftRouteKind: kind,
        connectionDraftPoints: kind === 'polyline' ? state.connectionDraftPoints : [],
      })),
    useConnectionEndpoint: (endpoint) => {
      const state = get()

      if (!state.connectMode) {
        set({
          selection: { entityType: endpoint.entityType, id: endpoint.refId },
          selectedEntities: [{ entityType: endpoint.entityType, id: endpoint.refId }],
        })
        return
      }

      if (!state.connectionSource) {
        set({
          connectionSource: endpoint,
          connectionDraftPoints: [],
          statusMessage: withLocale(state.locale, 'statusConnectionSource', {
            id: endpoint.refId,
          }),
        })
        return
      }

      if (
        state.connectionSource.entityType === endpoint.entityType &&
        state.connectionSource.refId === endpoint.refId
      ) {
        return
      }

      let createdId = ''

      mutateDocument((draft) => {
        const id = makeId('wire')
        createdId = id
        draft.wires.push({
          id,
          serialNumber: `W${draft.wires.length + 1}`,
          source: state.connectionSource!,
          target: endpoint,
          route: defaultWireRoute(
            draft,
            state.connectionSource!,
            endpoint,
            state.draftRouteKind,
            state.connectionDraftPoints,
          ),
          description: '',
        })
      })

      set({
        selection: { entityType: 'wire', id: createdId },
        selectedEntities: [{ entityType: 'wire', id: createdId }],
        connectionSource: null,
        connectionDraftPoints: [],
        statusMessage: withLocale(state.locale, 'statusCreatedWire', { id: createdId }),
      })
    },
    deleteSelection: () => {
      const selectedEntities = get().selectedEntities.filter(
        (selection) => selection.entityType !== 'document' && selection.id,
      )
      if (!selectedEntities.length) {
        return
      }

      const componentIds = new Set(
        selectedEntities
          .filter((selection) => selection.entityType === 'component')
          .map((selection) => selection.id!),
      )
      const portIds = new Set(
        selectedEntities
          .filter((selection) => selection.entityType === 'port')
          .map((selection) => selection.id!),
      )
      const nodeIds = new Set(
        selectedEntities
          .filter((selection) => selection.entityType === 'node')
          .map((selection) => selection.id!),
      )
      const wireIds = new Set(
        selectedEntities
          .filter((selection) => selection.entityType === 'wire')
          .map((selection) => selection.id!),
      )
      const annotationIds = new Set(
        selectedEntities
          .filter((selection) => selection.entityType === 'annotation')
          .map((selection) => selection.id!),
      )

      mutateDocument((draft) => {
        for (const port of draft.ports) {
          if (componentIds.has(port.componentId)) {
            portIds.add(port.id)
          }
        }

        draft.components = draft.components.filter((item) => !componentIds.has(item.id))
        draft.ports = draft.ports.filter((item) => !portIds.has(item.id))
        draft.nodes = draft.nodes.filter((item) => !nodeIds.has(item.id))

        draft.wires = draft.wires.filter((wire) => {
          const remove =
            wireIds.has(wire.id) ||
            portIds.has(wire.source.refId) ||
            portIds.has(wire.target.refId) ||
            nodeIds.has(wire.source.refId) ||
            nodeIds.has(wire.target.refId)

          if (remove) {
            wireIds.add(wire.id)
          }

          return !remove
        })

        draft.annotations = draft.annotations.filter((annotation) => {
          if (annotationIds.has(annotation.id)) {
            return false
          }

          return (
            !componentIds.has(annotation.target.refId) &&
            !portIds.has(annotation.target.refId) &&
            !nodeIds.has(annotation.target.refId) &&
            !wireIds.has(annotation.target.refId)
          )
        })
      }, { entityType: 'document' })
    },
    updateDocumentMeta: (patch) => {
      mutateDocument((draft) => {
        Object.assign(draft.document, patch)
      }, { entityType: 'document' })
    },
    updateCanvas: (patch) => {
      mutateDocument((draft) => {
        Object.assign(draft.canvas, patch)
      }, { entityType: 'document' })
    },
    undo: () => {
      const state = get()
      if (!state.history.length) {
        return
      }

      const previous = state.history[state.history.length - 1]
      const nextHistory = state.history.slice(0, -1)
      const future = [state.document, ...state.future]

      set({
        document: previous,
        history: nextHistory,
        future,
        dirty: true,
        selection: { entityType: 'document' },
        selectedEntities: [{ entityType: 'document' }],
        connectMode: false,
        connectionSource: null,
        connectionDraftPoints: [],
        placementMode: null,
      })

      void requestValidation(previous)
    },
    redo: () => {
      const state = get()
      if (!state.future.length) {
        return
      }

      const next = state.future[0]
      const future = state.future.slice(1)

      set({
        document: next,
        history: [...state.history, state.document],
        future,
        dirty: true,
        selection: { entityType: 'document' },
        selectedEntities: [{ entityType: 'document' }],
        connectMode: false,
        connectionSource: null,
        connectionDraftPoints: [],
        placementMode: null,
      })

      void requestValidation(next)
    },
    setStatusMessage: (message) => set({ statusMessage: message }),
    setLocale: (locale) => {
      window.localStorage.setItem('easyanalyse.locale', locale)
      set({
        locale,
        statusMessage: withLocale(locale, 'statusLocaleSwitched'),
      })
    },
    rotateSelectionClockwise: () => {
      const selection = get().selection
      if (selection?.entityType !== 'component' || !selection.id) {
        return
      }

      const component = get().document.components.find((item) => item.id === selection.id)
      if (!component) {
        return
      }

      get().updateComponentRotation(selection.id, getComponentRotation(component) + 90)
    },
  }
})
