/**
 * Candidate resolution: parse a `plugin` spec into an installable package
 * name/spec, and gather the candidate's primary-service candidates (the patch
 * `name:`/`id:` rows) for the probe.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hasDshManifest } from './patch-scan.js';
/** The npm package name a spec refers to. Handles bare and scoped names. */
export declare const PACKAGE_NAME_RE: RegExp;
export interface CandidateRef {
    /** Bare package name (e.g. `dsh-ppt` or `@scope/pkg`). */
    name: string;
    /** The full spec to install (name with version / file: / link:). */
    spec: string;
    /** True when the spec points at a local directory (file:/link: or a path). */
    local: boolean;
}
/**
 * Parse a candidate spec into name + spec. Accepts bare names, `name@version`,
 * `file:`/`link:` specs, and absolute paths to a package directory.
 */
export declare function parseCandidate(spec: string): CandidateRef;
/**
 * Candidate service names for the probe, in priority order: the patch `name:`
 * targets the plugin mounts, then the `inserted` `id:`s. The probe polls
 * `ctx.get(each)` and passes if ANY resolves non-null.
 */
export declare function candidateServices(packageDir: string): string[];
export { hasDshManifest, existsSync, join };
