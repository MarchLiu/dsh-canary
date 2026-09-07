/**
 * Public types for dsh-canary.
 *
 * The Verdict shape is designed to feed dshmarket's install block/warn policy
 * directly: a structured `ok` plus a machine `state` in the vocabulary the
 * brief specifies (`boot-ok / probe-pass / probe-fail / probe-timeout /
 * probe-inert / boot-fail`), with a `mode` so the caller knows which path
 * produced it.
 */
/** The four canary modes. */
export type CanaryMode = 'l0' | 'l1' | 'probe' | 'debug';
/** The machine state of a single verdict. */
export type VerdictState = 'boot-ok' | 'probe-pass' | 'probe-fail' | 'probe-timeout' | 'probe-inert' | 'boot-fail';
/** The phase a verdict is about. */
export type VerdictPhase = 'boot' | 'probe';
/**
 * Input to {@link verifyPluginBoot}. Everything is optional except `plugin`.
 */
export interface CanarySpec {
    /**
     * The candidate plugin to verify. Accepts a bare package name
     * (`dsh-ppt`), a scoped name (`@scope/pkg`), or already-resolved npm
     * `name@version` / `file:` / `link:` spec.
     */
    plugin: string;
    /**
     * Optional pin for L1 (versioned DSH) verification, e.g. `latest` or a
     * concrete `0.1.2-rc.1`.
     */
    version?: string;
    /** The dsh version (`@deepseek-ai/dsh@<version>` or `latest`) to verify against when `mode` is 'l1'. */
    versioned?: string;
    /**
     * The target profile to compose the candidate into.
     *
     * - `profileDir`: an existing profile directory (preferred over `profile`).
     * - `profile`: a profile NAME under `$DSH_HOME/profiles` (default 'web').
     *
     * The canary never writes to this source profile: it builds a THROWAWAY
     * temp profile from the source's manifest + node_modules, and boots that.
     */
    profileDir?: string;
    profile?: string;
    /** Which mode to run. Default 'l0'. */
    mode?: CanaryMode;
    /** Hard wall-clock cap for the boot in ms. Default 60_000. */
    bootTimeoutMs?: number;
    /** Wall-clock cap for the functional probe in ms. Default 20_000. */
    probeTimeoutMs?: number;
    /**
     * The dsh executable to spawn. Default: `$DSH_CANARY_DSH` or `dsh` from
     * PATH. dshmarket can pass the exact host CLI here.
     */
    dshPath?: string;
    /** Explicit `$DSH_HOME` for the child boot. Default: resolved DSH home. */
    dshHome?: string;
    /** Keep the throwaway temp profile after the run (for debugging). Default false. */
    keep?: boolean;
    /** Suppress env-var telemetry in the child boot. Default true. */
    disableTelemetry?: boolean;
}
/** A single boot/probe result, structured for a market's block/warn policy. */
export interface Verdict {
    /** True when the market should treat the install as acceptable. */
    ok: boolean;
    mode: CanaryMode;
    /** The dsh version actually boot-tested (from `dsh --version`). */
    testedVersion: string;
    /** The phase that produced this verdict. */
    phase: VerdictPhase;
    state: VerdictState;
    /** Human + machine-readable notes (bilingual where helpful). */
    diagnostics: string[];
    /** Total wall-clock time for the run, in ms. */
    durationMs: number;
}
/** Low-level classification of one booted process. */
export interface BootOutcome {
    /** True when the boot reached its ready marker without fail-loud. */
    ready: boolean;
    /** The exit code, or null when the process was killed by timeout. */
    exitCode: number | null;
    /** True when the hard boot timeout killed the process before ready. */
    timedOut: boolean;
    /** Captured stdout (bounded). */
    stdout: string;
    /** Captured stderr (bounded). */
    stderr: string;
    /** The web/token URL extracted from stdout, when the profile boots a web app. */
    readyUrl: string | null;
}
export interface ProbeOutcome {
    state: 'pass' | 'fail' | 'timeout' | 'inert';
    candidate: string;
    service: string | null;
    /** Raw JSON payload the probe emitted, when it did. */
    detail: unknown;
}
