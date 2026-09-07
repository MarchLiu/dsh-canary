/**
 * L0 boot runner: spawn the user's dsh CLI against the throwaway temp
 * profile, enforce a hard wall-clock cap, and classify the outcome into the
 * brief's taxonomy (hang vs crash vs fail-loud vs boot-ok).
 *
 * The RELIABLE boot-ok signal is the web-app ready URL (`dsh web:
 * http://…?token=`) — it is emitted only after the whole tree mounted and the
 * server bound, so a plugin that fail-louds AFTER the probe's (useful but
 * premature) `boot-ok` line still reads as a crash, never as boot-ok. The
 * probe's verdict line refines the result once the boot is up.
 */

import { spawn } from 'node:child_process'
import type { BootOutcome, ProbeOutcome } from './types.js'

const MAX_STDOUT = 512 * 1024
const MAX_STDERR = 128 * 1024

const READY_URL_RE = /dsh web:\s*http:\/\/127\.0\.0\.1:\d+\/?\?token=/i
const PROBE_RE = /DSH_CANARY_PROBE\s+(\{.*\})/g
// Fail-loud markers observed on the dsh boot path.
const FAIL_LOUD_RE = /plugin tree failed to load|failed to apply loader|failed to load plugins|cannot resolve profile bundle|ERR_MODULE_NOT_FOUND|cannot find module|invalid plugin/i

export interface Invocation {
  dshPath: string
  profileName: string
  home: string
  probeOverlayPath: string | null
  bootTimeoutMs: number
  probeTimeoutMs: number
  disableTelemetry: boolean
}

export type BootVerdict = 'boot-ok' | 'crash' | 'hang' | 'inconclusive'

export interface BootResult {
  verdict: BootVerdict
  outcome: BootOutcome
  probe: ProbeOutcome | null
}

/**
 * Run one booted invocation to its conclusion. Resolves when the web-app ready
 * URL is seen, the probe verdict arrives, the process exits, or the hard boot
 * timeout kills the tree — whichever comes first (probe verdicts are awaited
 * up to `probeTimeoutMs` after the boot is ready).
 */
export function runBoot(inv: Invocation): Promise<BootResult> {
  const args: string[] = ['--profile', inv.profileName]
  if (inv.probeOverlayPath !== null) args.push('--patch', inv.probeOverlayPath)
  // `--port 0` lets the OS pick a free port (no collision with a real web
  // instance); `--no-open` stops the boot from opening a browser.
  args.push('--port', '0', '--no-open')

  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: inv.home }
  if (inv.disableTelemetry) env.DSH_TELEMETRY_DISABLED = '1'

  const child = spawn(inv.dshPath, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })

  let stdout = ''
  let stderr = ''
  let readyUrl: string | null = null
  let readyUrlSeen = false
  let probe: ProbeOutcome | null = null
  let exited = false
  let exitCode: number | null = null
  let timedOut = false
  let finished = false

  const startedAt = Date.now()
  const hardDeadline = startedAt + inv.bootTimeoutMs
  const probeDeadline = startedAt + inv.bootTimeoutMs + inv.probeTimeoutMs

  const feed = (chunk: string, isErr: boolean): void => {
    if (isErr) {
      stderr = (stderr + chunk).slice(-MAX_STDERR)
      return
    }
    stdout = (stdout + chunk).slice(-MAX_STDOUT)
    if (!readyUrlSeen) {
      const urlMatch = /http:\/\/127\.0\.0\.1:\d+\/?\?token=[^\s]+/i.exec(stdout)
      if (READY_URL_RE.test(stdout) && urlMatch !== null) {
        readyUrlSeen = true
        readyUrl = urlMatch[0]
      }
    }
    let m: RegExpExecArray | null
    PROBE_RE.lastIndex = 0
    while ((m = PROBE_RE.exec(stdout)) !== null) {
      try {
        const obj = JSON.parse(m[1] ?? '') as Record<string, unknown>
        if (obj.event === 'probe' && probe === null) {
          const services = Array.isArray(obj.services) ? obj.services.map((s) => String(s)) : []
          probe = {
            state: (obj.state as ProbeOutcome['state']) ?? 'inert',
            candidate: String(obj.candidate ?? ''),
            service: services[0] ?? null,
            detail: obj.detail,
          }
        }
      } catch { /* non-JSON — ignore */ }
    }
  }

  const ready = (): boolean => readyUrlSeen || probe !== null

  return new Promise<BootResult>((resolvePromise) => {
    child.stdout?.on('data', (c: Buffer) => feed(c.toString(), false))
    child.stderr?.on('data', (c: Buffer) => feed(c.toString(), true))

    const killTree = (): void => {
      try {
        if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
      } catch { /* gone */ }
      try { child.kill('SIGTERM') } catch { /* ignore */ }
    }

    const finish = (outcome: BootOutcome): void => {
      if (finished) return
      finished = true
      clearInterval(timer)
      const verdict: BootVerdict = outcome.ready
        ? 'boot-ok'
        : outcome.timedOut
          ? 'hang'
          : outcome.exitCode === 0
            ? 'inconclusive'
            : 'crash'
      // The boot (a long-lived web server) must not leak: terminate its tree.
      killTree()
      resolvePromise({ verdict, outcome, probe })
    }

    const maybeFinish = (): void => {
      if (finished) return
      const now = Date.now()
      const isReady = ready()

      // Process exited.
      if (exited) {
        if (!isReady) {
          finish({
            ready: false,
            exitCode,
            timedOut: false,
            stdout,
            stderr,
            readyUrl,
          })
          return
        }
        // Ready was confirmed (web up) even if it later exited.
        finish({
          ready: true,
          exitCode,
          timedOut: false,
          stdout,
          stderr,
          readyUrl,
        })
        return
      }

      // Hard timeout without readiness → hang.
      if (now >= hardDeadline && !isReady) {
        timedOut = true
        killTree()
        finish({ ready: false, exitCode, timedOut: true, stdout, stderr, readyUrl })
        return
      }

      // Ready: keep watching for the probe verdict until its deadline.
      if (isReady) {
        if (probe !== null || now >= probeDeadline) {
          finish({ ready: true, exitCode, timedOut: false, stdout, stderr, readyUrl })
        }
      }
      // else: not ready, not exited, not timed out — keep waiting.
    }

    const timer = setInterval(maybeFinish, 80)

    child.on('error', (error) => {
      stderr = `${stderr}\n${error.message}`
      exitCode = 127
      exited = true
      maybeFinish()
    })
    child.on('close', (code) => {
      exitCode = code
      exited = true
      maybeFinish()
    })
  })
}

export { MAX_STDOUT, MAX_STDERR, FAIL_LOUD_RE }
