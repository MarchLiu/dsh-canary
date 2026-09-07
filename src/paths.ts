/**
 * Path / environment resolution: the dsh CLI, the Harness home, profile
 * directories, and the profile manifest. Mirrors the semantics of
 * `@deepseek-ai/dsh-app-boot` / dshmarket's `home-paths.ts` so the canary
 * composes the SAME profile a real boot would, without depending on them.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const DSH_PACKAGE = '@deepseek-ai/dsh'

/** The default single-root Harness home. */
export function defaultDshHome(): string {
  return join(homedir(), '.dsh')
}

/** Expand `~` and `~/…` forms. */
export function expandHomePath(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

/**
 * Resolve the Harness home: explicit > `DSH_HOME` env > default.
 * (The child boot is passed this same value, so the temp profile it boots
 * lives at the location the caller asked for.)
 */
export function resolveDshHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.DSH_HOME
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : defaultDshHome())
  return resolve(expandHomePath(selected))
}

/** Profile-name contract (same refusal set as dsh-app-boot's resolveProfileDir). */
export function isDshProfileName(profile: string): boolean {
  return profile !== ''
    && profile !== '.'
    && profile !== '..'
    && profile !== 'node_modules'
    && !profile.includes('/')
    && !profile.includes('\\')
    && !profile.includes('\0')
}

/**
 * Resolve a profile: a NAME under `$DSH_HOME/profiles`, or an explicit
 * absolute profile directory (host-authoritative, used by Desktop).
 */
export function resolveProfileDir(profile: string | undefined, explicitDir?: string, home?: string): string {
  if (explicitDir !== undefined) return resolve(explicitDir)
  const name = profile ?? 'web'
  if (!isDshProfileName(name)) {
    throw new Error(`dsh-canary: invalid profile name ${JSON.stringify(name)}`)
  }
  return join(resolveDshHome(home), 'profiles', name)
}

/** A profile's package.json manifest, or null when missing/malformed. */
export function readProfileManifest(profileDir: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as unknown
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** The `dsh.profile.bundles` list (empty when absent/not-an-array). */
export function readBundleStack(profileDir: string): string[] {
  const manifest = readProfileManifest(profileDir)
  const dsh = manifest?.dsh as Record<string, unknown> | undefined
  const profile = dsh?.profile as Record<string, unknown> | undefined
  const list = profile?.bundles
  return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string') : []
}

/** The plain `dependencies` map (empty when absent). */
export function readDeps(profileDir: string): Record<string, string> {
  const manifest = readProfileManifest(profileDir)
  const deps = manifest?.dependencies
  return typeof deps === 'object' && deps !== null
    ? Object.fromEntries(Object.entries(deps as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    : {}
}

/** The dsh CLI executable to spawn, from opts/env/PATH. */
export function resolveDshPath(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit
  const env = process.env.DSH_CANARY_DSH
  if (env && env.trim().length > 0) return env
  return 'dsh'
}

/** Cache of dsh version per CLI path. */
const versionCache = new Map<string, string>()

/** Query the dsh version via `<dsh> --version`. */
export async function dshVersion(dshPath: string): Promise<string> {
  const cached = versionCache.get(dshPath)
  if (cached !== undefined) return cached
  const { spawn } = await import('node:child_process')
  const version = await new Promise<string>((resolvePromise) => {
    const child = spawn(dshPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout?.on('data', (c: Buffer) => { out += c.toString() })
    child.stderr?.on('data', (c: Buffer) => { err += c.toString() })
    child.on('error', () => resolvePromise('unknown'))
    child.on('close', () => resolvePromise(out.trim() || err.trim() || 'unknown'))
  })
  versionCache.set(dshPath, version)
  return version
}

/** Locate the dsh install anchor (the dsh package.json) — the first bundle-resolution anchor. */
export function findDshInstallDir(entry = process.argv[1]): string | null {
  const realpathOf = (p: string): string => { try { return realpathSync(p) } catch { return p } }
  if (entry !== undefined) {
    let directory = resolve(dirname(realpathOf(entry)))
    for (let depth = 0; depth < 10; depth += 1) {
      if (isDshPackageDir(directory)) return directory
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  return null
}

function isDshPackageDir(directory: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: unknown }
    return manifest.name === DSH_PACKAGE
  } catch {
    return false
  }
}

export { existsSync, join, resolve }
