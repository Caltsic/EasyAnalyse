import { describe, expect, it } from 'vitest'

declare function require(moduleName: string): unknown

const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string }
const { dirname, resolve } = require('path') as { dirname: (path: string) => string; resolve: (...paths: string[]) => string }
const { fileURLToPath } = require('url') as { fileURLToPath: (url: string) => string }
const blueprintsCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/features/blueprints.css'), 'utf8')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return blueprintsCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('BlueprintsPanel layout CSS', () => {
  it('uses one panel-level vertical scroll container instead of splitting list and preview scroll', () => {
    const panel = cssRule('.blueprints-panel')
    const list = cssRule('.blueprints-panel__list')

    expect(panel).toContain('overflow-y: auto')
    expect(panel).toContain('overscroll-behavior: contain')
    expect(panel).not.toContain('overflow: hidden')
    expect(list).toContain('overflow: visible')
    expect(list).not.toContain('overflow-y: auto')
  })
})
