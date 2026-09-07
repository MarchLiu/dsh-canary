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
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const DEBUG_WEB_IMAGE = 'node:24-slim';
/** A bind patch that pins the webserver to 0.0.0.0 inside the container. */
export function webserverBindPatch(host, port) {
    return [
        '# dsh-canary debug-web overlay: bind the webserver for the container.',
        `- id: webserver`,
        '  config:',
        `    host: ${host}`,
        `    port: ${port}`,
        '',
    ].join('\n');
}
/**
 * Build a debug-web plan (and write the bind patch + probe candidate) for a
 * candidate. The caller runs `command` and then opens the printed URL.
 */
export function planDebugWeb(spec, dir) {
    const host = '0.0.0.0';
    const port = 3080;
    const patchPath = join(dir, 'dsh-canary-debugweb.yml');
    writeFileSync(patchPath, webserverBindPatch(host, port));
    const args = [
        'docker', 'run', '--rm', '-it',
        `-p ${port}:${port}`,
        '--hostname', 'dsh-canary-debug',
        '-v', `${patchPath}:/canary-debug.yml:ro`,
        DEBUG_WEB_IMAGE,
        'dsh', '--profile', spec.profile ?? 'web',
        '--patch', '/canary-debug.yml',
        '--port', String(port), '--no-open',
    ];
    return {
        image: DEBUG_WEB_IMAGE,
        host,
        port,
        patchPath,
        command: args,
        note: `dsh web runs in the container, bound to ${host}:${port} (mapped 1:1 to the host). Open the printed http://127.0.0.1:${port}?token=… in your host browser. The listen is confined by the mapping; it is not exposed to the network.`,
    };
}
/** debug mode verdict: it does not run a boot, it hands back the container plan. */
export function debugWebVerdict(spec, plan) {
    return {
        ok: true,
        mode: 'debug',
        testedVersion: 'container',
        phase: 'boot',
        state: 'boot-ok', // debug mode is a plan, not a judgment
        diagnostics: [
            plan.note,
            `container command: ${plan.command.join(' ')}`,
            `bind patch: ${plan.patchPath}`,
        ],
        durationMs: 0,
    };
}
