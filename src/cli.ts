#!/usr/bin/env node
/**
 * `dsh-canary <plugin> [flags]` — command-line interface.
 *
 * Boots a throwaway composition of the active profile + the candidate plugin
 * and prints a Verdict. `--json` emits the raw Verdict for the market's
 * block/warn policy; the default is a concise human summary.
 */

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyPluginBoot } from './verify.js'
import { planDebugWeb, debugWebVerdict } from './debug-web.js'
import { resolveDshHome } from './paths.js'
import type { CanarySpec, Verdict } from './types.js'

const PKG_VERSION = readPackageVersion()

function readPackageVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url)
    const manifest = JSON.parse(readFileSync(url, 'utf8')) as { version?: string }
    return manifest.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

interface CliOpts {
  plugin?: string
  profile?: string
  profileDir?: string
  mode?: string
  version?: string
  versioned?: string
  dsh?: string
  home?: string
  bootTimeout?: number
  probeTimeout?: number
  keep?: boolean
  debugWeb?: boolean
  docker?: boolean
  json?: boolean
  help?: boolean
  versionFlag?: boolean
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {}
  const err = (msg: string): never => { throw new Error(`dsh-canary: ${msg}`) }

  const takeValue = (name: string, i: number): [string, number] => {
    const val = argv[i + 1]
    if (val === undefined || val.startsWith('--')) err(`--${name} needs a value`)
    return [val as string, i + 2]
  }

  let i = 0
  while (i < argv.length) {
    const arg = argv[i] ?? ''
    const [flag, inline] = arg.split('=', 2) as [string, string | undefined]
    // `needVal` returns [value, nextIndex]: nextIndex is the first token AFTER
    // the flag and its value (--flag=val → i+1; --flag val → i+2).
    const needVal = (): [string, number] => inline !== undefined ? [inline, i + 1] : takeValue(`--${flag}`, i)
    const setStr = (key: keyof CliOpts): void => {
      const [val, next] = needVal()
      ;(opts as Record<string, unknown>)[key] = val
      i = next
    }
    const setNum = (key: keyof CliOpts): void => {
      const [val, next] = needVal()
      const n = Number(val)
      if (!Number.isFinite(n) || n <= 0) err(`--${flag} must be a positive number`)
      ;(opts as Record<string, unknown>)[key] = n
      i = next
    }

    switch (flag) {
      case '--profile': setStr('profile'); break
      case '--profile-dir': case '--profileDir': setStr('profileDir'); break
      case '--mode': setStr('mode'); break
      case '--versioned': setStr('versioned'); break
      case '--dsh': setStr('dsh'); break
      case '--home': setStr('home'); break
      case '--boot-timeout': setNum('bootTimeout'); break
      case '--probe-timeout': setNum('probeTimeout'); break
      case '--keep': opts.keep = true; i++; break
      case '--debug-web': opts.debugWeb = true; i++; break
      case '--docker': opts.docker = true; i++; break
      case '--json': opts.json = true; i++; break
      case '-h': case '--help': opts.help = true; i++; break
      case '-V': case '--version': opts.versionFlag = true; i++; break
      default:
        if (arg.startsWith('-')) err(`unknown option ${JSON.stringify(arg)}`)
        if (opts.plugin === undefined) opts.plugin = arg
        else err(`unexpected positional ${JSON.stringify(arg)}`)
        i++
    }
  }
  return opts
}

function help(): string {
  return `dsh-canary — boot-verify a dsh plugin against the real profile.

USAGE
  dsh-canary <plugin> [flags]

  Boots a throwaway composition of the active profile's bundles + <plugin> and
  reports whether the boot survives (the "static check passed, restart died"
  gap). It never writes to your real profile.

FLAGS
  --profile <name>        target profile name (default: web)
  --profile-dir <dir>     explicit profile directory (overrides --profile)
  --mode <l0|l1|debug>    canary mode (default: l0)
  --versioned <spec>      L1: dsh version to verify (e.g. latest / 0.1.2-rc.1)
  --dsh <path>            dsh CLI to spawn (default: \$DSH_CANARY_DSH or 'dsh')
  --home <dir>            \$DSH_HOME for the throwaway profile (default: resolved)
  --boot-timeout <ms>     hard boot cap (default: 60000)
  --probe-timeout <ms>    functional-probe cap (default: 20000)
  --debug-web             print a dockerized dsh web plan for manual debugging
  --docker                L1: allow a container
  --keep                  keep the throwaway profile after the run
  --json                  emit the raw Verdict JSON
  -h, --help              this help
  -V, --version           dsh-canary version

EXAMPLES
  dsh-canary dsh-ppt
  dsh-canary @scope/pkg --profile web --json
  dsh-canary ./my-plugin --profile-dir ~/.dsh/profiles/web
  dsh-canary dsh-ppt --debug-web
  NOTE: L1/docker and the versioned install path are opt-in; L0 (this host's
  dsh) needs no container and no network.
`
}

function debugScratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-canary-debug-'))
}

async function run(opts: CliOpts): Promise<{ verdict: Verdict; json: boolean }> {
  if (opts.versionFlag) {
    process.stdout.write(`${PKG_VERSION}\n`)
    process.exit(0)
  }
  if (opts.help || opts.plugin === undefined) {
    process.stdout.write(help())
    process.exit(opts.help ? 0 : 1)
  }

  const spec: CanarySpec = {
    plugin: opts.plugin,
    profile: opts.profile,
    profileDir: opts.profileDir,
    mode: (opts.mode as CanarySpec['mode']) ?? (opts.debugWeb ? 'debug' : 'l0'),
    versioned: opts.versioned,
    dshPath: opts.dsh,
    dshHome: opts.home,
    bootTimeoutMs: opts.bootTimeout,
    probeTimeoutMs: opts.probeTimeout,
    keep: opts.keep,
  }

  if (opts.debugWeb) {
    const plan = planDebugWeb(spec, debugScratchDir())
    return { verdict: debugWebVerdict(spec, plan), json: opts.json ?? false }
  }
  return { verdict: await verifyPluginBoot(spec), json: opts.json ?? false }
}

function summary(v: Verdict): string {
  const lines: string[] = []
  lines.push(`${v.ok ? 'OK' : 'FAIL'} [${v.mode}] ${v.state}  (dsh ${v.testedVersion}, ${v.durationMs}ms)`)
  for (const d of v.diagnostics) lines.push(`  - ${d}`)
  lines.push(`note: ${v.ok ? '安装可接受 / install acceptable' : '安装建议阻断 / install should be blocked'}`)
  return `${lines.join('\n')}\n`
}

run(parseArgs(process.argv.slice(2)))
  .then(({ verdict, json }) => {
    if (verdict.mode === 'debug') {
      for (const line of verdict.diagnostics) process.stdout.write(`${line}\n`)
      return
    }
    if (json) {
      process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`)
    } else {
      process.stdout.write(summary(verdict))
    }
    process.exit(verdict.ok ? 0 : 1)
  })
  .catch((error) => {
    process.stderr.write(`${String(error)}\n`)
    process.exit(1)
  })
