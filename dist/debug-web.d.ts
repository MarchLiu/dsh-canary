/**
 * Debug web mode — a MANUAL, containerized dsh web for iterating on a plugin
 * that the canary suspects breaks the web UI.
 *
 * The dsh CLI refuses `--host 0.0.0.0` (RCE concern), so the webserver's bind
 * address is set through a `--patch` config overlay instead. The container
 * binds `0.0.0.0:3080`, mapped 1:1 to `-p 3080:3080`, keeping the printed
 * `http://127.0.0.1:3080?token=…` directly usable from the HOST browser. The
 * listen is deliberately confined to loopback/private interfaces by the
 * mapping, never exposed to the network.
 */
import type { CanarySpec, Verdict } from './types.js';
export declare const DEBUG_WEB_IMAGE = "node:24-slim";
/** A bind patch that pins the webserver to 0.0.0.0 inside the container. */
export declare function webserverBindPatch(host: string, port: number): string;
export interface DebugWebPlan {
    image: string;
    host: string;
    port: number;
    patchPath: string;
    command: string[];
    note: string;
}
/**
 * Build a debug-web plan (and write the bind patch + probe candidate) for a
 * candidate. The caller runs `command` and then opens the printed URL.
 */
export declare function planDebugWeb(spec: CanarySpec, dir: string): DebugWebPlan;
/** debug mode verdict: it does not run a boot, it hands back the container plan. */
export declare function debugWebVerdict(spec: CanarySpec, plan: DebugWebPlan): Verdict;
