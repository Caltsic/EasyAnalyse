// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../Inspector', async () => {
  const React = await import('react')
  return {
    Inspector: () => React.createElement('section', { 'data-testid': 'mock-inspector' }, 'Inspector form'),
  }
})

vi.mock('../blueprints/BlueprintsPanel', async () => {
  const React = await import('react')
  return {
    BlueprintsPanel: () => React.createElement('section', { 'data-testid': 'mock-blueprints-panel' }, 'Blueprint workspace'),
  }
})

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderSidebar() {
  const { RightSidebar } = await import('./RightSidebar')
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<RightSidebar />)
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

describe('RightSidebar', () => {
  it('shows Inspector by default and switches to the Blueprints tab without adding another column', async () => {
    const host = await renderSidebar()

    expect(host.querySelector('.right-sidebar')).toBeInstanceOf(HTMLElement)
    expect(host.querySelectorAll('.right-sidebar')).toHaveLength(1)
    expect(host.querySelector('[data-testid="mock-inspector"]')).toBeInstanceOf(HTMLElement)
    expect(host.querySelector('[data-testid="mock-blueprints-panel"]')).toBeNull()

    const inspectorTab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-controls="right-sidebar-inspector"]')
    const blueprintsTab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-controls="right-sidebar-blueprints"]')
    expect(inspectorTab?.getAttribute('aria-selected')).toBe('true')
    expect(blueprintsTab?.getAttribute('aria-selected')).toBe('false')

    await act(async () => {
      blueprintsTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(inspectorTab?.getAttribute('aria-selected')).toBe('false')
    expect(blueprintsTab?.getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('[data-testid="mock-inspector"]')).toBeNull()
    expect(host.querySelector('[data-testid="mock-blueprints-panel"]')).toBeInstanceOf(HTMLElement)
  })
})
