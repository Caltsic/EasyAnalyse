import { describe, expect, it } from 'vitest'

declare function require(moduleName: string): unknown

const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string }
const { dirname, resolve } = require('path') as { dirname: (path: string) => string; resolve: (...paths: string[]) => string }
const { fileURLToPath } = require('url') as { fileURLToPath: (url: string) => string }
const baseDir = dirname(fileURLToPath(import.meta.url))
const appCss = readFileSync(resolve(baseDir, '../../App.css'), 'utf8')
const rightSidebarCss = readFileSync(resolve(baseDir, '../../styles/features/right-sidebar.css'), 'utf8')
const agentCss = readFileSync(resolve(baseDir, '../../styles/features/agent.css'), 'utf8')

function cssRule(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('RightSidebar layout CSS', () => {
  it('keeps right sidebar styles in the feature stylesheet imported by App.css', () => {
    expect(appCss).toContain("@import './styles/features/right-sidebar.css';")
    expect(appCss).not.toMatch(/\.right-sidebar\s*\{/)
    expect(rightSidebarCss).toContain('.right-sidebar {')
    expect(rightSidebarCss).toContain('.right-sidebar__brand-icon {')
    expect(rightSidebarCss).not.toContain('.agent-message__avatar')
  })

  it('keeps avatar base visuals owned by each feature stylesheet', () => {
    const sidebarIcon = cssRule(rightSidebarCss, '.right-sidebar__brand-icon')
    const agentAvatar = cssRule(agentCss, '.agent-message__avatar')

    expect(sidebarIcon).toContain('display: grid')
    expect(sidebarIcon).toContain('place-items: center')
    expect(sidebarIcon).toContain('background: var(--accent-soft)')

    expect(agentAvatar).toContain('display: grid')
    expect(agentAvatar).toContain('place-items: center')
    expect(agentAvatar).toContain('background: var(--accent-soft)')
  })
})
