// @vitest-environment jsdom
import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(element: ReactElement) {
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(element)
  })
  return container
}

function BrokenView(): ReactElement {
  throw new Error('render crashed')
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  container?.remove()
  root = null
  container = null
})

describe('AppErrorBoundary', () => {
  it('renders a fallback instead of unmounting the root when a child crashes', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const host = render(
        <AppErrorBoundary title="Local render failed" description="The rest of the UI stays mounted.">
          <BrokenView />
        </AppErrorBoundary>,
      )

      expect(host.textContent).toContain('Local render failed')
      expect(host.textContent).toContain('The rest of the UI stays mounted.')
      expect(host.textContent).toContain('render crashed')
      expect(host.querySelector('[role="alert"]')).not.toBeNull()
    } finally {
      consoleError.mockRestore()
    }
  })
})
