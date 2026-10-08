// Checks the package manifests that npm shows on each package page: a dependency npm cannot see is not installed for users.
//   node scripts/check-manifests.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => JSON.parse(readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), 'utf8'))
const core = read('core')

assert.ok(core.dependencies?.['ata-validator'], 'core must list ata-validator in dependencies: npm installs it and shows it on the page')
assert.match(core.dependencies['ata-validator'], /^\^1\.\d+\.\d+$/, 'core must pin ata-validator to a caret range of major 1 (">=" would let a future major install)')
assert.equal(core.peerDependencies?.['ata-validator'], undefined, 'core must not also list ata-validator as a peer dependency')

for (const name of ['express', 'hono', 'middy']) {
  const pkg = read(name)
  assert.equal(pkg.version, core.version, `${pkg.name} must have the same version as core (${core.version})`)
  assert.equal(pkg.dependencies?.['@ata-mw/core'], `^${core.version}`, `${pkg.name} must depend on @ata-mw/core ^${core.version}`)
  assert.equal(pkg.peerDependencies?.['ata-validator'], undefined, `${pkg.name} gets ata-validator through core, not as a peer`)
}

console.log('manifests ok')
