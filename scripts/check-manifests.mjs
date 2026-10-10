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

// The READMEs are what npm and GitHub show: every package page must link to its own npm page, version badge and source.
const readme = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
for (const name of ['core', 'express', 'hono', 'middy']) {
  const { name: full } = read(name)
  const text = readme(`packages/${name}/README.md`)
  for (const needle of [
    `https://www.npmjs.com/package/${full}`,
    `https://img.shields.io/npm/v/${full}`,
    `https://github.com/ayhansipahi/ata-mw/tree/main/packages/${name}`,
    'https://github.com/ayhansipahi/ata-mw/releases',
  ]) {
    assert.ok(text.includes(needle), `packages/${name}/README.md must contain ${needle}`)
  }
  assert.ok(readme('README.md').includes(`https://www.npmjs.com/package/${full}`), `README.md must link to the npm page of ${full}`)
}

console.log('manifests ok')
