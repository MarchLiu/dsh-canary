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
import type { BootOutcome, ProbeOutcome } from './types.js';
declare const MAX_STDOUT: number;
declare const MAX_STDERR: number;
declare const FAIL_LOUD_RE: RegExp;
export interface Invocation {
    dshPath: string;
    profileName: string;
    home: string;
    probeOverlayPath: string | null;
    bootTimeoutMs: number;
    probeTimeoutMs: number;
    disableTelemetry: boolean;
}
export type BootVerdict = 'boot-ok' | 'crash' | 'hang' | 'inconclusive';
export interface BootResult {
    verdict: BootVerdict;
    outcome: BootOutcome;
    probe: ProbeOutcome | null;
}
/**
 * Run one booted invocation to its conclusion. Resolves when the web-app ready
 * URL is seen, the probe verdict arrives, the process exits, or the hard boot
 * timeout kills the tree — whichever comes first (probe verdicts are awaited
 * up to `probeTimeoutMs` after the boot is ready).
 */
export declare function runBoot(inv: Invocation): Promise<BootResult>;
export { MAX_STDOUT, MAX_STDERR, FAIL_LOUD_RE };
