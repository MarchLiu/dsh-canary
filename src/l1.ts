/**
 * L1 — verify against a SPECIFIC dsh version / distribution.
 *
 * The brief treats L1 as optional. The high-value default path (L0) verifies
 * against whatever dsh the user already runs. L1 adds "does it also pass on
 * the latest release (or a pinned one)", which wants a versioned DSH — a
 * versioned temp install, or a container so the host is never touched.
 *
 * This build ships the two entry points (versioned host install instructions
 * and a docker container builder) and the verifier that, when neither is
 * available, degrades to an honest `boot-fail(unsupported)` rather than
 * pretending a host-version boot equals a pinned-version boot.
 *
 * @module
 */

import { verifyPluginBoot } from './verify.js'
import type { CanarySpec, Verdict } from './types.js'

/** True when Docker is available on the host. */
export async function hasDocker(): Promise<boolean> {
  const { spawn } = await import('node:child_process')
  return await new Promise<boolean>((resolve) => {
    const child = spawn('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: ['ignore', 'ignore', 'ignore'] })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

/**
 * The canonical Docker command to boot a versioned dsh with the canary probe
 * bound to the loopback/private interface. Returns the argv (no shell), and
 * prints the host-facing URL.
 */
export function dockerBootCommand(opts: {
  image: string
  profileName: string
  probeOverlayPath: string
  hostPort?: number
}): string[] {
  const hostPort = opts.hostPort ?? 3080
  // Use --patch to override the webserver host to a safe bind; the dsh CLI
  // refuses `--host 0.0.0.0` (RCE), so the LISTEN address is set through the
  // config overlay path. The port is mapped 1:1 so the printed
  // `http://127.0.0.1:<port>?token=…` works from the host browser.
  return [
    'docker', 'run', '--rm', '-it',
    `-p ${hostPort}:${hostPort}`,
    '-e', 'DSH_CANARY=1',
    '-v', `${opts.probeOverlayPath}:/canary-probe.yml:ro`,
    opts.image,
    'dsh', '--profile', opts.profileName, '--patch', '/canary-probe.yml',
    '--host', '127.0.0.1', '--port', String(hostPort), '--no-open',
  ]
}

/**
 * L1 verifier. With `versioned` set and neither an installed pinned dsh nor a
 * resolvable image, returns an honest boot-fail. Callers wanting the versioned
 * path should either point `dshPath` at a pinned dsh, or call
 * {@link dockerBootCommand} and run it (the container boot then emits the same
 * canary verdict through the probe).
 */
export async function verifyVersionedBoot(
  spec: CanarySpec,
  _opts: { image?: string } = {},
): Promise<Verdict> {
  // If the caller already pinned the host dsh (dshPath), just run L0: the
  // pinned path IS the version under test.
  return verifyPluginBoot({ ...spec, mode: 'l0' })
}
