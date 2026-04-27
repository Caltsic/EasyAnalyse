import { CircuitCanvasRenderer } from './canvas/CircuitCanvasRenderer'
import { useEditorStore } from '../store/editorStore'
import type { ThemeMode } from '../lib/theme'

interface CanvasViewProps {
  theme: ThemeMode
}

export function CanvasView({ theme }: CanvasViewProps) {
  const document = useEditorStore((state) => state.document)
  const selection = useEditorStore((state) => state.selection)
  const locale = useEditorStore((state) => state.locale)
  const pendingDeviceShape = useEditorStore((state) => state.pendingDeviceShape)
  const pendingDeviceTemplateKey = useEditorStore((state) => state.pendingDeviceTemplateKey)
  const focusedDeviceId = useEditorStore((state) => state.focusedDeviceId)
  const focusedLabelKey = useEditorStore((state) => state.focusedLabelKey)
  const focusedNetworkLineId = useEditorStore((state) => state.focusedNetworkLineId)
  const viewportAnimationTarget = useEditorStore((state) => state.viewportAnimationTarget)
  const moveDevice = useEditorStore((state) => state.moveDevice)
  const moveDevices = useEditorStore((state) => state.moveDevices)
  const repositionTerminal = useEditorStore((state) => state.repositionTerminal)
  const updateNetworkLine = useEditorStore((state) => state.updateNetworkLine)
  const setSelection = useEditorStore((state) => state.setSelection)
  const setDeviceGroupSelection = useEditorStore((state) => state.setDeviceGroupSelection)
  const placePendingDevice = useEditorStore((state) => state.placePendingDevice)
  const focusDevice = useEditorStore((state) => state.focusDevice)
  const focusNetworkLine = useEditorStore((state) => state.focusNetworkLine)
  const clearFocus = useEditorStore((state) => state.clearFocus)
  const resetViewportToOrigin = useEditorStore((state) => state.resetViewportToOrigin)

  return (
    <CircuitCanvasRenderer
      document={document}
      locale={locale}
      theme={theme}
      interactive
      selection={selection}
      pendingDeviceShape={pendingDeviceShape}
      pendingDeviceTemplateKey={pendingDeviceTemplateKey}
      focusedDeviceId={focusedDeviceId}
      focusedLabelKey={focusedLabelKey}
      focusedNetworkLineId={focusedNetworkLineId}
      viewportAnimationTarget={viewportAnimationTarget}
      onMoveDevice={moveDevice}
      onMoveDevices={moveDevices}
      onRepositionTerminal={repositionTerminal}
      onUpdateNetworkLine={updateNetworkLine}
      onSetSelection={setSelection}
      onSetDeviceGroupSelection={setDeviceGroupSelection}
      onPlacePendingDevice={placePendingDevice}
      onFocusDevice={focusDevice}
      onFocusNetworkLine={focusNetworkLine}
      onClearFocus={clearFocus}
      onResetViewportToOrigin={resetViewportToOrigin}
    />
  )
}
