// @vitest-environment jsdom
import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModalShell } from './ModalShell'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderShell(element: ReactElement) {
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(element)
  })
  return container
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  container?.remove()
  root = null
  container = null
})

describe('ModalShell', () => {
  it('closes from the backdrop but not from panel clicks and keeps non-portal rendering', async () => {
    const onClose = vi.fn()
    const host = await renderShell(
      <ModalShell rootClassName="test-modal" panelClassName="test-modal__panel" ariaLabel="Demo modal" onClose={onClose}>
        <button type="button">Inside</button>
      </ModalShell>,
    )

    const rootElement = host.querySelector('.test-modal') as HTMLElement
    const panel = host.querySelector('.test-modal__panel') as HTMLElement
    expect(host.querySelector('[role="dialog"]')).toBe(panel)
    expect(panel.getAttribute('aria-label')).toBe('Demo modal')

    await act(async () => {
      panel.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      rootElement.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('supports a decorative backdrop element and labelledby wiring', async () => {
    const onClose = vi.fn()
    const host = await renderShell(
      <ModalShell
        rootClassName="test-modal"
        backdropClassName="test-modal__backdrop"
        panelClassName="test-modal__panel"
        ariaLabelledBy="modal-title"
        onClose={onClose}
      >
        <h2 id="modal-title">Title</h2>
      </ModalShell>,
    )

    const panel = host.querySelector('.test-modal__panel') as HTMLElement
    expect(panel.getAttribute('aria-labelledby')).toBe('modal-title')
    await act(async () => {
      host.querySelector('.test-modal__backdrop')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('handles Escape only when configured and respects closeDisabled', async () => {
    const onClose = vi.fn()
    const documentKeydown = vi.fn()
    window.document.addEventListener('keydown', documentKeydown)
    const host = await renderShell(
      <ModalShell
        rootClassName="test-modal"
        panelClassName="test-modal__panel"
        ariaLabel="Esc modal"
        onClose={onClose}
        closeOnEscape
      >
        <button type="button">Inside</button>
      </ModalShell>,
    )
    const panel = host.querySelector('.test-modal__panel') as HTMLElement

    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(documentKeydown).not.toHaveBeenCalled()
    window.document.removeEventListener('keydown', documentKeydown)

    act(() => root?.unmount())
    host.remove()
    root = null
    container = null

    const disabledClose = vi.fn()
    const disabledHost = await renderShell(
      <ModalShell
        rootClassName="test-modal"
        panelClassName="test-modal__panel"
        ariaLabel="Disabled close modal"
        onClose={disabledClose}
        closeOnEscape
        closeDisabled
      >
        <button type="button">Inside</button>
      </ModalShell>,
    )
    await act(async () => {
      disabledHost.querySelector('.test-modal__panel')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      disabledHost.querySelector('.test-modal')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(disabledClose).not.toHaveBeenCalled()
  })

  it('supports initial focus and loops focus with Tab', async () => {
    const host = await renderShell(
      <ModalShell
        rootClassName="test-modal"
        panelClassName="test-modal__panel"
        ariaLabel="Focus modal"
        initialFocusSelector="[data-initial]"
        trapFocus
      >
        <button type="button">First</button>
        <button type="button" data-initial>
          Last
        </button>
      </ModalShell>,
    )
    const buttons = Array.from(host.querySelectorAll('button'))
    const first = buttons[0]
    const last = buttons[1]
    expect(window.document.activeElement).toBe(last)

    await act(async () => {
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(window.document.activeElement).toBe(first)

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    })
    expect(window.document.activeElement).toBe(last)
  })

  it('focuses the dialog panel when trapping focus without focusable children', async () => {
    const host = await renderShell(
      <ModalShell rootClassName="test-modal" panelClassName="test-modal__panel" ariaLabel="Empty modal" trapFocus>
        <p>No controls</p>
      </ModalShell>,
    )
    const panel = host.querySelector('.test-modal__panel') as HTMLElement

    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(window.document.activeElement).toBe(panel)
  })
})
