// Sets one version on every package and points the adapters at the same @ata-mw/core.
//   node scripts/set-version.mjs 0.1.2
// Then `node scripts/check-manifests.mjs` verifies the result (npm run test:dist runs it too).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGES = ['core', 'express', 'hono', 'middy']

export function setVersion(root, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`expected X.Y.Z (no "v", no prerelease), got "${version}"`)
  const files = PACKAGES.map((name) => join(root, 'packages', name, 'package.json'))
  // Read everything first so a bad manifest cannot leave the packages half updated.
  const manifests = files.map((file) => JSON.parse(readFileSync(file, 'utf8')))
  manifests.forEach((pkg) => {
    pkg.version = version
    if (pkg.dependencies?.['@ata-mw/core']) pkg.dependencies['@ata-mw/core'] = `^${version}`
  })
  files.forEach((file, i) => writeFileSync(file, JSON.stringify(manifests[i], null, 2) + '\n'))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] ?? ''
  try {
    setVersion(fileURLToPath(new URL('..', import.meta.url)), version)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  console.log(`all packages set to ${version}`)
}
