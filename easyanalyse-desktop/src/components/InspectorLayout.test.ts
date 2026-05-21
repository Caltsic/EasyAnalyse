import { describe, expect, it } from 'vitest'

declare function require(moduleName: string): unknown

const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string }
const { dirname, resolve } = require('path') as { dirname: (path: string) => string; resolve: (...paths: string[]) => string }
const { fileURLToPath } = require('url') as { fileURLToPath: (url: string) => string }
const baseDir = dirname(fileURLToPath(import.meta.url))
const appCss = readFileSync(resolve(baseDir, '../App.css'), 'utf8')
const inspectorCss = readFileSync(resolve(baseDir, '../styles/features/inspector.css'), 'utf8')
const uiCss = readFileSync(resolve(baseDir, '../styles/ui.css'), 'utf8')

describe('Inspector layout CSS', () => {
  it('keeps inspector-owned styles in the inspector feature stylesheet', () => {
    expect(appCss).toContain("@import './styles/features/inspector.css';")
    expect(appCss).not.toMatch(/\.inspector-shell\s*\{/)
    expect(inspectorCss).toContain('.inspector-shell {')
    expect(inspectorCss).toContain('.autocomplete__panel {')
    expect(inspectorCss).toContain('.entity-list__item.is-active {')
  })

  it('keeps shared field and list item styles in the shared UI stylesheet', () => {
    expect(inspectorCss).not.toMatch(/\.field\s*\{/)
    expect(inspectorCss).not.toMatch(/\.list-item\s*\{/)
    expect(uiCss).toContain('.field {')
    expect(uiCss).toContain('.entity-list__item,')
    expect(uiCss).toContain('.list-item {')
  })
})
