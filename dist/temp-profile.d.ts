/**
 * L0 temp-profile builder.
 *
 * The canary never writes to the source profile. It builds a THROWAWAY
 * profile (`<home>/profiles/canary-<rand>`) whose composition is exactly the
 * source profile's bundle stack PLUS the candidate plugin, reusing the source
 * profile's installed packages (absolute symlinks, so it is location-
 * independent and never mutates the source), and boots that.
 *
 * The boot then either reaches its ready marker (source bundles + candidate
 * compose fine) or fail-louds (the candidate breaks the boot) — the exact
 * "static check passed, restart died" gap the canary closes.
 */
import { basename } from 'node:path';
import type { CandidateRef } from './candidate.js';
export declare const PROBE_PACKAGE = "@mars.liu/dsh-canary-probe";
/** The probe package directory shipped inside dsh-canary. */
export declare function probePackageDir(): string;
export interface TempProfile {
    /** The temp profile directory (must NOT be the source profile). */
    dir: string;
    /** The profile NAME `dsh --profile <name>` will boot. */
    name: string;
    /** The `$DSH_HOME` that owns this profile (the child boot uses it). */
    home: string;
    /** The candidate package directory inside the temp profile. */
    candidateDir: string;
    /** Candidate primary-service candidates for the probe. */
    candidateServices: string[];
    /** The generated probe `--patch` overlay path. */
    probeOverlayPath: string;
    /** Remove the temp profile (and its overlay). */
    cleanup: () => void;
}
/**
 * Build a throwaway profile composing `sourceProfileDir`'s bundle stack with
 * `candidate`. `home` is where the temp profile lives; pass the source's own
 * home for production (sibling profile), or an isolated home for tests.
 */
export declare function buildTempProfile(sourceProfileDir: string, candidate: CandidateRef, home: string, opts?: {
    keep?: boolean;
    probe?: boolean;
}): TempProfile;
export { basename };
