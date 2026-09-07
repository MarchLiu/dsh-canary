#!/usr/bin/env node
/**
 * Post-build: ensure dist/cli.js is a shebang'ed, executable entry point.
 * The probe/ directory ships as-is (plain ESM JS that runs inside the boot),
 * so it is not compiled — only validated here.
 */
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = join(root, 'dist', 'cli.js')

if (!existsSync(cli)) {
  console.error('[postbuild] dist/cli.js missing — run tsc first?')
  process.exit(1)
}

let text = readFileSync(cli, 'utf8')
if (!text.startsWith('#!')) text = `#!/usr/bin/env node\n${text}`
writeFileSync(cli, text)
chmodSync(cli, 0o755)

console.log('[postbuild] dist/cli.js shebang + executable (ok)')
