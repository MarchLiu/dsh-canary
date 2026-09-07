/**
 * Public verification entry: {@link verifyPluginBoot}. Ties the pieces
 * together — resolve profile + candidate → build throwaway profile → boot →
 * probe → assemble a structured {@link Verdict}.
 */

import { resolveProfileDir, resolveDshPath, dshVersion, resolveDshHome } from './paths.js'
import { parseCandidate } from './candidate.js'
import { buildTempProfile } from './temp-profile.js'
import { runBoot } from './boot.js'
import type { CanarySpec, Verdict, VerdictState } from './types.js'

const MAX_BOOT_MS = 60_000
const MAX_PROBE_MS = 20_000

/** Run the canary for one candidate plugin / profile / mode. */
export async function verifyPluginBoot(spec: CanarySpec): Promise<Verdict> {
  const start = Date.now()
  const mode = spec.mode ?? 'l0'
  const bootTimeoutMs = spec.bootTimeoutMs ?? MAX_BOOT_MS
  const probeTimeoutMs = spec.probeTimeoutMs ?? MAX_PROBE_MS

  const diagnostics: string[] = []
  const fail = (state: VerdictState, phase: 'boot' | 'probe', notes: string[]): Verdict => ({
    ok: state === 'boot-ok' || state === 'probe-pass' || state === 'probe-inert' || state === 'probe-timeout',
    mode,
    testedVersion: '', // patched below after version is known
    phase,
    state,
    diagnostics: [...diagnostics, ...notes],
    durationMs: Date.now() - start,
  })

  const sourceProfileDir = resolveProfileDir(spec.profile, spec.profileDir, spec.dshHome)
  const dshPath = resolveDshPath(spec.dshPath)
  const home = spec.dshHome ?? resolveDshHome()

  let candidate
  try {
    candidate = parseCandidate(spec.plugin)
  } catch (error) {
    const v = fail('boot-fail', 'boot', [`dsh-canary: ${String(error)}`])
    v.testedVersion = await dshVersion(dshPath).catch(() => 'unknown')
    return v
  }

  let version = 'unknown'
  try { version = await dshVersion(dshPath) } catch { /* unknown */ }

  let temp
  try {
    temp = buildTempProfile(sourceProfileDir, candidate, home, { keep: spec.keep })
  } catch (error) {
    const v = fail('boot-fail', 'boot', [`dsh-canary: ${String(error)}`])
    v.testedVersion = version
    return v
  }

  try {
    // Boot the throwaway composition (source bundles + candidate + probe).
    const result = await runBoot({
      dshPath,
      profileName: temp.name,
      home: temp.home,
      probeOverlayPath: temp.probeOverlayPath,
      bootTimeoutMs,
      probeTimeoutMs,
      disableTelemetry: spec.disableTelemetry !== false,
    })

    const { outcome, probe } = result
    diagnosticFromOutcome(outcome, diagnostics, temp.candidateDir, temp.candidateServices, dshPath)

    // --- boot phase ---
    if (result.verdict !== 'boot-ok') {
      const notes: string[] = []
      if (result.verdict === 'hang') {
        notes.push('boot did not reach ready before the hard timeout — interpreted as a HANG', '启动在硬超时内未就绪——判定为挂起')
      } else if (result.verdict === 'inconclusive') {
        notes.push('boot exited cleanly without a ready marker — inconclusive', '启动干净退出但无就绪标记——结论不定')
      } else {
        notes.push('boot did not reach ready and exited non-zero — CRASH / fail-loud', '启动未就绪且退出码非零——崩溃/fail-loud')
      }
      if (outcome.exitCode !== null && outcome.exitCode !== 0) {
        notes.push(`boot exited non-zero (${outcome.exitCode})`, `启动退出码非零（${outcome.exitCode}）`)
      }
      const v = fail('boot-fail', 'boot', notes)
      v.testedVersion = version
      return v
    }

    // Boot-ok. Without a probe verdict the boot is the only fact.
    if (probe === null) {
      const v = fail('boot-ok', 'boot', [
        'boot reached ready with no fail-loud', '启动就绪，无 fail-loud',
        ...(outcome.readyUrl !== null ? [`ready: ${outcome.readyUrl}`] : []),
      ])
      v.testedVersion = version
      return v
    }

    // Probe verdict present → probe phase.
    const verdictState: VerdictState = probeStateToVerdict[probe.state] ?? 'probe-inert'
    const v: Verdict = {
      ok: verdictState !== 'probe-fail',
      mode,
      testedVersion: version,
      phase: 'probe',
      state: verdictState,
      diagnostics: [
        ...diagnostics,
        `boot-ok; probe ${probe.state} for ${probe.candidate || candidate.name}`,
        ...probeDiag(probe.state),
      ],
      durationMs: Date.now() - start,
    }
    return v
  } finally {
    temp.cleanup()
  }
}

function diagnosticFromOutcome(
  outcome: { stdout: string; stderr: string; exitCode: number | null },
  diagnostics: string[],
  _candidateDir: string,
  _services: string[],
  _dshPath: string,
): void {
  const stderrTrim = outcome.stderr.trim()
  if (stderrTrim !== '') diagnostics.push(`stderr: ${stderrTrim.slice(0, 1600)}`)
  if (outcome.exitCode !== null) diagnostics.push(`exit code: ${outcome.exitCode}`)
}

function probeDiag(state: string): string[] {
  switch (state) {
    case 'pass': return ['候选插件主声明 service 在 ctx 可解析且非空', 'candidate primary service resolves non-null in ctx']
    case 'fail': return ['候选插件主声明 service 显式解析失败', 'candidate primary service explicitly failed to resolve']
    case 'timeout': return ['探针超时（非阻断）', 'probe timed out (non-blocking)']
    case 'inert': return ['未声明可探的服务（probe-inert，不阻断）', 'no declarable service to probe (non-blocking)']
    default: return []
  }
}

const probeStateToVerdict: Record<string, VerdictState> = {
  pass: 'probe-pass',
  fail: 'probe-fail',
  timeout: 'probe-timeout',
  inert: 'probe-inert',
}

/** Convenience: run L0 and return the concise state. */
export async function canaryState(spec: CanarySpec): Promise<VerdictState> {
  return (await verifyPluginBoot(spec)).state
}

export { resolveProfileDir, resolveDshPath, dshVersion, resolveDshHome }
