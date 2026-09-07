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
import type { CanarySpec, Verdict } from './types.js';
/** True when Docker is available on the host. */
export declare function hasDocker(): Promise<boolean>;
/**
 * The canonical Docker command to boot a versioned dsh with the canary probe
 * bound to the loopback/private interface. Returns the argv (no shell), and
 * prints the host-facing URL.
 */
export declare function dockerBootCommand(opts: {
    image: string;
    profileName: string;
    probeOverlayPath: string;
    hostPort?: number;
}): string[];
/**
 * L1 verifier. With `versioned` set and neither an installed pinned dsh nor a
 * resolvable image, returns an honest boot-fail. Callers wanting the versioned
 * path should either point `dshPath` at a pinned dsh, or call
 * {@link dockerBootCommand} and run it (the container boot then emits the same
 * canary verdict through the probe).
 */
export declare function verifyVersionedBoot(spec: CanarySpec, _opts?: {
    image?: string;
}): Promise<Verdict>;
