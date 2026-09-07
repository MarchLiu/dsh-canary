/**
 * Path / environment resolution: the dsh CLI, the Harness home, profile
 * directories, and the profile manifest. Mirrors the semantics of
 * `@deepseek-ai/dsh-app-boot` / dshmarket's `home-paths.ts` so the canary
 * composes the SAME profile a real boot would, without depending on them.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
export declare const DSH_PACKAGE = "@deepseek-ai/dsh";
/** The default single-root Harness home. */
export declare function defaultDshHome(): string;
/** Expand `~` and `~/…` forms. */
export declare function expandHomePath(p: string): string;
/**
 * Resolve the Harness home: explicit > `DSH_HOME` env > default.
 * (The child boot is passed this same value, so the temp profile it boots
 * lives at the location the caller asked for.)
 */
export declare function resolveDshHome(configured?: string, env?: Record<string, string | undefined>): string;
/** Profile-name contract (same refusal set as dsh-app-boot's resolveProfileDir). */
export declare function isDshProfileName(profile: string): boolean;
/**
 * Resolve a profile: a NAME under `$DSH_HOME/profiles`, or an explicit
 * absolute profile directory (host-authoritative, used by Desktop).
 */
export declare function resolveProfileDir(profile: string | undefined, explicitDir?: string, home?: string): string;
/** A profile's package.json manifest, or null when missing/malformed. */
export declare function readProfileManifest(profileDir: string): Record<string, unknown> | null;
/** The `dsh.profile.bundles` list (empty when absent/not-an-array). */
export declare function readBundleStack(profileDir: string): string[];
/** The plain `dependencies` map (empty when absent). */
export declare function readDeps(profileDir: string): Record<string, string>;
/** The dsh CLI executable to spawn, from opts/env/PATH. */
export declare function resolveDshPath(explicit?: string): string;
/** Query the dsh version via `<dsh> --version`. */
export declare function dshVersion(dshPath: string): Promise<string>;
/** Locate the dsh install anchor (the dsh package.json) — the first bundle-resolution anchor. */
export declare function findDshInstallDir(entry?: string | undefined): string | null;
export { existsSync, join, resolve };
