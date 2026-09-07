/**
 * Candidate resolution: parse a `plugin` spec into an installable package
 * name/spec, and gather the candidate's primary-service candidates (the patch
 * `name:`/`id:` rows) for the probe.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readBundlePatchRows, hasDshManifest } from './patch-scan.js';
/** The npm package name a spec refers to. Handles bare and scoped names. */
export const PACKAGE_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
/**
 * Parse a candidate spec into name + spec. Accepts bare names, `name@version`,
 * `file:`/`link:` specs, and absolute paths to a package directory.
 */
export function parseCandidate(spec) {
    const trimmed = spec.trim();
    if (trimmed === '')
        throw new Error('dsh-canary: plugin spec is empty');
    // Local directory / file: / link: forms.
    const localMatch = /^(?:link|file):(.+)$/i.exec(trimmed);
    if (localMatch !== null) {
        const pathPart = localMatch[1] ?? trimmed;
        const name = nameOfDirectory(pathPart);
        return { name: name ?? lastPathSegment(pathPart), spec: trimmed, local: true };
    }
    // A bare path to a directory (absolute or relative).
    if (existsSync(trimmed) && statSync(trimmed).isDirectory()) {
        const name = nameOfDirectory(trimmed);
        return { name: name ?? lastPathSegment(trimmed), spec: trimmed, local: true };
    }
    // name@spec — split at the last @ that is not part of a scope.
    const at = trimmed.lastIndexOf('@');
    if (at > 0 && !trimmed.startsWith('@')) {
        const name = trimmed.slice(0, at);
        if (PACKAGE_NAME_RE.test(name))
            return { name, spec: trimmed, local: false };
    }
    // Bare name (possibly scoped).
    if (PACKAGE_NAME_RE.test(trimmed))
        return { name: trimmed, spec: trimmed, local: false };
    throw new Error(`dsh-canary: cannot parse plugin spec ${JSON.stringify(trimmed)}`);
}
function isDir(p) {
    try {
        return statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
function lastPathSegment(p) {
    const clean = p.replace(/[\\/]+$/, '');
    const parts = clean.split(/[\\/]/);
    return parts[parts.length - 1] ?? p;
}
function nameOfDirectory(p) {
    let dir = p;
    try {
        if (statSync(p).isFile())
            dir = dirnameOf(p);
    }
    catch { /* fall through */ }
    try {
        const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        return typeof manifest.name === 'string' && manifest.name.length > 0 ? manifest.name : null;
    }
    catch {
        return null;
    }
}
function dirnameOf(p) {
    const seg = p.split(/[\\/]/);
    seg.pop();
    return seg.join('/') || p;
}
/**
 * Candidate service names for the probe, in priority order: the patch `name:`
 * targets the plugin mounts, then the `inserted` `id:`s. The probe polls
 * `ctx.get(each)` and passes if ANY resolves non-null.
 */
export function candidateServices(packageDir) {
    const rows = readBundlePatchRows(packageDir);
    const list = [];
    for (const name of rows.names)
        if (!list.includes(name))
            list.push(name);
    for (const id of rows.insertedIds)
        if (!list.includes(id))
            list.push(id);
    return list;
}
export { hasDshManifest, existsSync, join };
