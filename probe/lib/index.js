/**
 * dsh-canary probe — mounted inside the booted composition via a `--patch`
 * overlay. Its only job is a BOUNDED, presence-level check: for each candidate
 * service name it is told about, does `ctx.get(name)` resolve to a non-null
 * value once the app has settled? And can it make one harmless
 * representative call?
 *
 * Design constraints (the probe must NEVER change the verdict it is asked to
 * observe):
 *   - It never throws. Every observation is wrapped; a probe bug degrades to
 *     `probe-inert`, not to a boot failure.
 *   - It never blocks the boot. It emits its verdict line and then does
 *     nothing; the canary kills the process once it has read the result.
 *   - It is offline and needs no model. Presence + a no-arg method call only.
 *
 * Output is one JSON line on stdout:
 *   DSH_CANARY_PROBE {"event":"probe","state":"pass|fail|timeout|inert","candidate":…,"services":[…],"detail":…}
 * A leading `DSH_CANARY_BOOT_OK` line is emitted when the probe's `apply`
 * runs at all (i.e. the whole tree mounted); the canary uses that as a uniform
 * "the composition came up" marker for non-web profiles.
 */

export const name = '@mars.liu/dsh-canary-probe'

export function apply(ctx, config = {}) {
  const candidate = typeof config.candidate === 'string' ? config.candidate : ''
  const services = Array.isArray(config.candidateServices)
    ? config.candidateServices.filter((s) => typeof s === 'string')
    : typeof config.candidateService === 'string' && config.candidateService !== ''
      ? [config.candidateService]
      : []
  const timeoutMs = Math.max(500, Number(config.timeoutMs) || 6000)
  const pollEvery = Math.max(150, Number(config.pollEvery) || 300)
  // The canary waits for this line to know the tree mounted (boot-ok for
  // non-web profiles). Emitted synchronously; apply succeeded = tree mounted.
  emit({ event: 'boot-ok', candidate })

  // Defer the presence check so services provided by the candidate (and its
  // neighbours) have a chance to settle. We poll rather than assume ordering.
  ;(async () => {
    const started = Date.now()
    let decided = false
    const details = []

    for (const service of services) {
      // One decisive observation is enough: presence is confirmed (pass) or
      // explicitly excluded (fail). Remaining candidates are only polled when
      // the current one was a retryable miss.
      if (decided) { details.push({ service, state: 'skipped' }); continue }
      const obs = await pollService(ctx, service, pollEvery, timeoutMs, Date.now())
      details.push({ service, state: obs.state, ...(obs.detail !== undefined ? { detail: obs.detail } : {}) })
      if (obs.state === 'pass' || obs.state === 'fail') { decided = true }
    }

    const anyPass = details.some((d) => d.state === 'pass')
    const anyFail = details.some((d) => d.state === 'fail')
    const anyTimeout = details.some((d) => d.state === 'timeout')

    let state
    if (services.length === 0) state = 'inert'
    else if (anyFail) state = 'fail'
    else if (anyPass) state = 'pass'
    else if (anyTimeout) state = 'timeout'
    else state = 'inert'

    emit({ event: 'probe', state, candidate, services, detail: { elapsedMs: Date.now() - started, observations: details } })
  })().catch((error) => {
    // Never throw out of apply. A probe crash is inert, not a boot failure.
    emit({ event: 'probe', state: 'inert', candidate, services, detail: { error: String(error?.message ?? error) } })
  })
}

async function pollService(ctx, service, pollEvery, timeoutMs, startedAt) {
  const deadline = startedAt + timeoutMs
  while (true) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { state: 'timeout', detail: { note: 'service not observed before deadline' } }
    const value = await Promise.race([
      (async () => {
        try {
          const v = await ctx.get(service)
          return v !== undefined && v !== null ? { kind: 'found', value: v } : { kind: 'missing' }
        } catch (error) {
          return { kind: 'error', error: String(error?.message ?? error) }
        }
      })(),
      sleep(remaining).then(() => ({ kind: 'expired' })),
    ])
    if (value.kind === 'found') {
      return { state: 'pass', detail: { type: typeof value.value, call: tryCall(value.value) } }
    }
    if (value.kind === 'error') return { state: 'fail', detail: { error: value.error } }
    if (value.kind === 'expired') return { state: 'timeout', detail: { note: 'service not observed before deadline' } }
    // kind === 'missing' → retry after pollEvery.
    await sleep(pollEvery)
  }
}

/** One harmless representative call: a no-arg method if a safe one exists. */
function tryCall(service) {
  if (typeof service !== 'object' && typeof service !== 'function') return null
  const methodNames = ['list', 'get', 'info', 'status', 'describe', 'keys']
  for (const method of methodNames) {
    const fn = service[method]
    if (typeof fn === 'function') {
      try {
        const result = fn.call(service)
        return { method, resultShape: typeof result === 'object' && result !== null ? 'object' : typeof result, ok: true }
      } catch {
        return { method, ok: false }
      }
    }
  }
  return null
}

function emit(payload) {
  try {
    process.stdout.write(`DSH_CANARY_PROBE ${JSON.stringify(payload)}\n`)
  } catch { /* stdout shut down — nothing to do */ }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default { name, apply }
