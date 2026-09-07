/**
 * dsh-canary public API.
 *
 * `verifyPluginBoot(spec, opts)` REALLY boots a profile composition (the real
 * profile's bundles + a candidate plugin) in a throwaway profile and reports
 * whether the boot survives — catching the "static check passed, restart
 * died" gap that dshmarket's offline `trialValidate` cannot.
 */
export type { CanarySpec, Verdict, VerdictState, VerdictPhase, CanaryMode } from './types.js';
export { verifyPluginBoot, canaryState, resolveProfileDir, resolveDshPath, dshVersion } from './verify.js';
export { parseCandidate, candidateServices, PACKAGE_NAME_RE } from './candidate.js';
export { buildTempProfile, probePackageDir, PROBE_PACKAGE } from './temp-profile.js';
export { runBoot } from './boot.js';
/** Internal (deep) helpers for advanced/CLI use. */
export * as paths from './paths.js';
