// @vitest-environment jsdom
import { act, useState } from 'react'
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

vi.mock('../agent/AgentPanel', async () => {
  const React = await import('react')
  return {
    AgentPanel: () => {
      const [value, setValue] = useState('')
      return React.createElement(
        'section',
        { 'data-testid': 'mock-agent-panel' },
        React.createElement('label', { htmlFor: 'mock-agent-input' }, 'Agent workspace'),
        React.createElement('input', {
          id: 'mock-agent-input',
          value,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setValue(event.currentTarget.value),
        }),
      )
    },
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
  it('keeps Inspector, Blueprints, and Agent panels mounted while switching tabs', async () => {
    const host = await renderSidebar()

    expect(host.querySelector('.right-sidebar')).toBeInstanceOf(HTMLElement)
    expect(host.querySelectorAll('.right-sidebar')).toHaveLength(1)
    expect(host.querySelector('[data-testid="mock-inspector"]')).toBeInstanceOf(HTMLElement)
    expect(host.querySelector('[data-testid="mock-blueprints-panel"]')).toBeInstanceOf(HTMLElement)
    expect(host.querySelector('[data-testid="mock-agent-panel"]')).toBeInstanceOf(HTMLElement)

    const inspectorTab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-controls="right-sidebar-inspector"]')
    const blueprintsTab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-controls="right-sidebar-blueprints"]')
    const agentTab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-controls="right-sidebar-agent"]')
    const inspectorPanel = host.querySelector<HTMLElement>('#right-sidebar-inspector')
    const blueprintsPanel = host.querySelector<HTMLElement>('#right-sidebar-blueprints')
    const agentPanel = host.querySelector<HTMLElement>('#right-sidebar-agent')

    expect(inspectorTab?.getAttribute('aria-selected')).toBe('true')
    expect(blueprintsTab?.getAttribute('aria-selected')).toBe('false')
    expect(agentTab?.getAttribute('aria-selected')).toBe('false')
    expect(inspectorPanel?.hidden).toBe(false)
    expect(blueprintsPanel?.hidden).toBe(true)
    expect(agentPanel?.hidden).toBe(true)

    await act(async () => {
      blueprintsTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(inspectorTab?.getAttribute('aria-selected')).toBe('false')
    expect(blueprintsTab?.getAttribute('aria-selected')).toBe('true')
    expect(agentTab?.getAttribute('aria-selected')).toBe('false')
    expect(inspectorPanel?.hidden).toBe(true)
    expect(blueprintsPanel?.hidden).toBe(false)
    expect(agentPanel?.hidden).toBe(true)

    await act(async () => {
      agentTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(inspectorTab?.getAttribute('aria-selected')).toBe('false')
    expect(blueprintsTab?.getAttribute('aria-selected')).toBe('false')
    expect(agentTab?.getAttribute('aria-selected')).toBe('true')
    expect(inspectorPanel?.hidden).toBe(true)
    expect(blueprintsPanel?.hidden).toBe(true)
    expect(agentPanel?.hidden).toBe(false)
  })

  it('preserves Agent panel local input state when switching tabs', async () => {
    const host = await renderSidebar()
    const inspectorTab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-controls="right-sidebar-inspector"]')
    const agentTab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-controls="right-sidebar-agent"]')

    await act(async () => {
      agentTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const input = host.querySelector<HTMLInputElement>('#mock-agent-input')
    expect(input).toBeInstanceOf(HTMLInputElement)
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'keep me')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => {
      inspectorTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      agentTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(host.querySelector<HTMLInputElement>('#mock-agent-input')?.value).toBe('keep me')
  })
})
