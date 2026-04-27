import { CircuitCanvasRenderer } from '../canvas/CircuitCanvasRenderer'
import type { KeyboardEvent } from 'react'
import type { DocumentFile, Locale } from '../../types/document'
import type { ThemeMode } from '../../lib/theme'

export interface BlueprintPreviewCanvasProps {
  document: DocumentFile
  locale?: Locale
  theme?: ThemeMode
  className?: string
}

const isolatedPlainKeys = new Set(['Delete', 'Home', 'Escape'])
const isolatedShortcutKeys = new Set(['s', 'o', 'n', 'z', 'y', '0'])

function shouldIsolatePreviewKey(event: KeyboardEvent<HTMLDivElement>) {
  const key = event.key.toLowerCase()
  const modifier = event.ctrlKey || event.metaKey

  return isolatedPlainKeys.has(event.key) || event.code === 'Space' || (modifier && isolatedShortcutKeys.has(key))
}

export function BlueprintPreviewCanvas({
  document,
  locale = 'zh-CN',
  theme = 'light',
  className,
}: BlueprintPreviewCanvasProps) {
  const handlePreviewKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!shouldIsolatePreviewKey(event)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      className={className}
      aria-label="Blueprint preview canvas"
      role="region"
      tabIndex={0}
      onKeyDownCapture={handlePreviewKeyDownCapture}
    >
      <CircuitCanvasRenderer
        document={document}
        locale={locale}
        theme={theme}
        interactive={false}
        selection={{ entityType: 'document' }}
        pendingDeviceShape={null}
        pendingDeviceTemplateKey={null}
        focusedDeviceId={null}
        focusedLabelKey={null}
        focusedNetworkLineId={null}
        viewportAnimationTarget={null}
      />
    </div>
  )
}
