import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyPluginBoot } from '../dist/index.js'

// A synthetic, self-contained dsh profile whose bundle stack is the in-box
// bundles (resolved from the dsh installation) plus one candidate plugin. No
// network, no pnpm: the candidate is placed directly in node_modules.

let root
let srcProfile
let home

function writePlugin(pkg, { provide = false, throwApply = false } = {}) {
  const dir = join(srcProfile, 'node_modules', '@mars.liu', pkg)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name: `@mars.liu/${pkg}`,
    version: '0.1.0',
    type: 'module',
    main: './lib/index.js',
    exports: { '.': './lib/index.js' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2)}\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'),
    `- insert:\n    - id: ${pkg.replace('dsh-canary-', 'canary-')}\n      name: '@mars.liu/${pkg}'\n`)
  const body = throwApply
    ? `export const name = '@mars.liu/${pkg}'\nexport function apply(ctx, config = {}) { throw new Error('canary-bad: synthetic boot failure') }\n`
    : provide
      ? `export const name = '@mars.liu/${pkg}'\nexport function apply(ctx, config = {}) { ctx.provide(name, { ok: true, data: [1, 2, 3] }) }\n`
      : `export const name = '@mars.liu/${pkg}'\nexport function apply(ctx, config = {}) { /* no-op */ }\n`
  writeFileSync(join(dir, 'lib', 'index.js'), body)
  return dir
}

function writeSourceProfile(bundles) {
  mkdirSync(join(srcProfile, 'node_modules', '@mars.liu'), { recursive: true })
  writeFileSync(join(srcProfile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-synthe',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
  }, null, 2)}\n`)
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-canary-test-'))
  srcProfile = join(root, 'src-profile')
  home = join(root, 'home')
  mkdirSync(srcProfile, { recursive: true })
  mkdirSync(home, { recursive: true })

  writePlugin('dsh-canary-good', { provide: true })
  writePlugin('dsh-canary-bad', { throwApply: true })
  // Source profile = base in-box bundles ONLY; the canary APPENDS the
  // candidate to a throwaway composition. Candidates live in node_modules so
  // they can be mirrored, but they are not in the source bundle stack.
  writeSourceProfile([
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
  ])
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

const baseSpec = (plugin) => ({
  plugin,
  profileDir: srcProfile,
  dshHome: home,
  bootTimeoutMs: 40_000,
  probeTimeoutMs: 12_000,
  mode: 'l0',
  disableTelemetry: true,
})

test('good candidate: boots and its primary service resolves (probe-pass or boot-ok)', async () => {
  const v = await verifyPluginBoot(baseSpec('@mars.liu/dsh-canary-good'))
  // The synthetic profile's good plugin provides a service under its own name,
  // so the probe should report pass.
  assert.equal(v.phase, 'probe')
  assert.equal(v.state, 'probe-pass')
  assert.equal(v.ok, true)
  assert.equal(v.mode, 'l0')
  assert.ok(v.testedVersion.length > 0)
  assert.ok(v.durationMs >= 0)
})

test('bad candidate: the boot fail-louds (boot-fail, ok=false)', async () => {
  const v = await verifyPluginBoot(baseSpec('@mars.liu/dsh-canary-bad'))
  assert.equal(v.phase, 'boot')
  assert.equal(v.state, 'boot-fail')
  assert.equal(v.ok, false)
  assert.ok(v.diagnostics.some((d) => /fail/i.test(d) || /failed/i.test(d)))
})
