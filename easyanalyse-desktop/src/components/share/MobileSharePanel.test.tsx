// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileShareSession } from '../../types/document'
import { MobileSharePanel } from './MobileSharePanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session: MobileShareSession = {
  url: 'http://127.0.0.1:4317/share/demo',
  appUrl: 'http://127.0.0.1:4317',
  snapshotUrl: 'http://127.0.0.1:4317/share/demo/snapshot',
  host: '127.0.0.1',
  port: 4317,
  alternateUrls: ['http://localhost:4317/share/demo'],
  expiresAt: '2026-05-22T12:30:00.000Z',
  createdAt: '2026-05-22T12:00:00.000Z',
  title: 'Shared circuit',
  issueCount: 0,
  schemaValid: true,
  semanticValid: true,
  qrSvg: '<svg viewBox="0 0 1 1"></svg>',
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderPanel(props: Partial<Parameters<typeof MobileSharePanel>[0]> = {}) {
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
  const onClose = props.onClose ?? vi.fn()
  const onStop = props.onStop ?? vi.fn()
  await act(async () => {
    root?.render(
      <MobileSharePanel
        open={props.open ?? true}
        locale={props.locale ?? 'en-US'}
        loading={props.loading ?? false}
        error={props.error ?? null}
        session={props.session === undefined ? session : props.session}
        onRefresh={props.onRefresh ?? vi.fn()}
        onStop={onStop}
        onClose={onClose}
      />,
    )
  })
  return { host: container, onClose, onStop }
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  container?.remove()
  root = null
  container = null
})

describe('MobileSharePanel', () => {
  it('does not render while closed', async () => {
    const { host } = await renderPanel({ open: false })

    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('closes from the overlay and close button but not from panel clicks', async () => {
    const { host, onClose, onStop } = await renderPanel()
    const overlay = host.querySelector('.share-overlay') as HTMLElement
    const panel = host.querySelector('.share-panel') as HTMLElement
    const closeButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Close') as HTMLButtonElement

    await act(async () => {
      panel.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onStop).not.toHaveBeenCalled()
  })

  it('keeps the mobile share dialog labelled by its title', async () => {
    const { host } = await renderPanel()
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement

    expect(dialog.getAttribute('aria-labelledby')).toBe('mobile-share-title')
    expect(host.querySelector('#mobile-share-title')?.textContent).toBe('Mobile Viewer')
  })
})
