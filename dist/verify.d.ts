/**
 * Public verification entry: {@link verifyPluginBoot}. Ties the pieces
 * together — resolve profile + candidate → build throwaway profile → boot →
 * probe → assemble a structured {@link Verdict}.
 */
import { resolveProfileDir, resolveDshPath, dshVersion, resolveDshHome } from './paths.js';
import type { CanarySpec, Verdict, VerdictState } from './types.js';
/** Run the canary for one candidate plugin / profile / mode. */
export declare function verifyPluginBoot(spec: CanarySpec): Promise<Verdict>;
/** Convenience: run L0 and return the concise state. */
export declare function canaryState(spec: CanarySpec): Promise<VerdictState>;
export { resolveProfileDir, resolveDshPath, dshVersion, resolveDshHome };
