import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setVersion } from './set-version.mjs'

const NAMES = ['core', 'express', 'hono', 'middy']

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'ata-mw-version-'))
  for (const name of NAMES) {
    mkdirSync(join(root, 'packages', name), { recursive: true })
    const dependencies = name === 'core' ? { 'ata-validator': '^1.42.0' } : { '@ata-mw/core': '^0.1.1' }
    const pkg = { name: `@ata-mw/${name}`, version: '0.1.1', description: `the ${name} package`, dependencies }
    writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  }
  return root
}

const read = (root, name) => JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'))

describe('setVersion', () => {
  it('sets every package and aligns the adapters core range with it', () => {
    const root = workspace()
    setVersion(root, '0.2.0')
    for (const name of NAMES) expect(read(root, name).version).toBe('0.2.0')
    for (const name of ['express', 'hono', 'middy']) expect(read(root, name).dependencies['@ata-mw/core']).toBe('^0.2.0')
  })

  it('leaves everything else alone, including the ata-validator range and the file layout', () => {
    const root = workspace()
    setVersion(root, '0.2.0')
    expect(read(root, 'core').dependencies).toEqual({ 'ata-validator': '^1.42.0' })
    expect(read(root, 'hono').description).toBe('the hono package')
    expect(readFileSync(join(root, 'packages', 'hono', 'package.json'), 'utf8')).toMatch(/^\{\n  "name": "@ata-mw\/hono",\n.*\}\n$/s)
  })

  it.each(['v0.2.0', '0.2', '0.2.0-rc.1', '', 'latest'])('rejects "%s" and writes nothing', (version) => {
    const root = workspace()
    expect(() => setVersion(root, version)).toThrow(/expected X\.Y\.Z/)
    for (const name of NAMES) expect(read(root, name).version).toBe('0.1.1')
  })
})
