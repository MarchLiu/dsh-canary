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
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDeps, readBundleStack } from './paths.js';
import { hasDshManifest, readBundlePatchRows } from './patch-scan.js';
export const PROBE_PACKAGE = '@mars.liu/dsh-canary-probe';
/** The probe package directory shipped inside dsh-canary. */
export function probePackageDir() {
    return fileURLToPath(new URL('../probe', import.meta.url));
}
/**
 * Build a throwaway profile composing `sourceProfileDir`'s bundle stack with
 * `candidate`. `home` is where the temp profile lives; pass the source's own
 * home for production (sibling profile), or an isolated home for tests.
 */
export function buildTempProfile(sourceProfileDir, candidate, home, opts = {}) {
    if (!existsSync(sourceProfileDir) || !existsSync(join(sourceProfileDir, 'package.json'))) {
        throw new Error(`dsh-canary: source profile missing at ${sourceProfileDir}`);
    }
    const name = `canary-${randomUUID().slice(0, 8)}`;
    const dir = join(home, 'profiles', name);
    const srcNm = join(sourceProfileDir, 'node_modules');
    const nm = join(dir, 'node_modules');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, '@scope.placeholder'), { recursive: true });
    const bundles = readBundleStack(sourceProfileDir);
    const deps = readDeps(sourceProfileDir);
    // Post-install verification: the candidate may already be in the source
    // bundle stack (the market installed it). Don't append it twice — the temp
    // composition then tests the profile exactly as a restart would see it.
    const candidateInBundles = bundles.includes(candidate.name);
    const tempBundles = candidateInBundles ? [...bundles] : [...bundles, candidate.name];
    const keep = opts.keep === true;
    const cleanup = () => {
        if (keep)
            return;
        try {
            rmSync(dir, { recursive: true, force: true });
        }
        catch { /* best-effort */ }
    };
    // --- manifest: source bundles + candidate, source deps + candidate ---
    const candidateSpec = candidate.spec.startsWith('file:') || candidate.spec.startsWith('link:')
        ? candidate.spec
        : /^\.{0,2}\//.test(candidate.spec) || candidate.spec.startsWith('/')
            ? `file:${candidate.spec}`
            : candidate.spec;
    const manifest = {
        name: `dsh-profile-${name}`,
        private: true,
        dependencies: { ...deps, [candidate.name]: candidateSpec },
        dsh: { profile: { bundles: tempBundles } },
    };
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    // --- copy the source user patch layer + pnpm-workspace.yaml ---
    copyIfExists(join(sourceProfileDir, 'cordis.patch.yml'), join(dir, 'cordis.patch.yml'));
    copyIfExists(join(sourceProfileDir, 'pnpm-workspace.yaml'), join(dir, 'pnpm-workspace.yaml'));
    copyIfExists(join(sourceProfileDir, '.npmrc'), join(dir, '.npmrc'));
    // --- reuse the source node_modules via absolute symlinks (path-independent) ---
    mkdirSync(nm, { recursive: true });
    if (existsSync(srcNm))
        mirrorNodeModules(srcNm, nm);
    // --- candidate package dir ---
    const candidateDir = ensureCandidateInProfile(sourceProfileDir, candidate, nm);
    // --- probe package: copy into temp node_modules so the loader can resolve it ---
    if (opts.probe !== false) {
        const probeDir = join(nm, PROBE_PACKAGE);
        const probeSrc = probePackageDir();
        if (existsSync(probeSrc)) {
            // Copy rather than symlink: the probe is self-contained and must resolve
            // from this profile regardless of where dsh-canary lives.
            cpSync(probeSrc, probeDir, { recursive: true, force: true, dereference: true });
        }
    }
    const services = candidateServicesOf(candidateDir);
    return {
        dir,
        name,
        home,
        candidateDir,
        candidateServices: services,
        probeOverlayPath: writeProbeOverlay(dir, candidate.name, services),
        cleanup,
    };
}
function candidateServicesOf(candidateDir) {
    try {
        const rows = readBundlePatchRows(candidateDir);
        const list = [];
        for (const n of rows.names)
            if (!list.includes(n))
                list.push(n);
        for (const id of rows.insertedIds)
            if (!list.includes(id))
                list.push(id);
        return list;
    }
    catch {
        return [];
    }
}
/**
 * Make the candidate resolvable from the temp profile:
 *  - if it is already in the (mirrored) node_modules, use it,
 *  - else if it is a local dir, copy/symlink it in,
 *  - else (bare npm spec, not installed) we ERROR with a clear hint to use a
 *    local dir or pre-install — the canary does NOT run `pnpm add` implicitly
 *    because that can hit the network; callers that want it pass `local` or a
 *    dir. (L1/install path can layer `pnpm add` on top.)
 */
function ensureCandidateInProfile(sourceProfileDir, candidate, nm) {
    const candidateDir = join(nm, candidate.name);
    if (existsSync(join(candidateDir, 'package.json')))
        return candidateDir;
    // Local candidate: the spec (or the path it names) points at a real dir.
    const localPath = localPathOf(candidate.spec);
    if (candidate.local && localPath !== null && existsSync(join(localPath, 'package.json'))) {
        ensureParent(candidateDir);
        // Symlink the whole candidate into the temp node_modules (no copy).
        try {
            symlinkSync(localPath, candidateDir);
        }
        catch {
            cpSync(localPath, candidateDir, { recursive: true, force: true, dereference: true });
        }
        return candidateDir;
    }
    // It may live in the source profile's node_modules (post-install verify).
    if (existsSync(join(sourceProfileDir, 'node_modules', candidate.name, 'package.json'))) {
        const srcDir = join(sourceProfileDir, 'node_modules', candidate.name);
        ensureParent(candidateDir);
        try {
            symlinkSync(realpathSync(srcDir), candidateDir);
        }
        catch {
            cpSync(srcDir, candidateDir, { recursive: true, force: true, dereference: true });
        }
        return candidateDir;
    }
    throw new Error(`dsh-canary: candidate ${JSON.stringify(candidate.name)} (spec ${JSON.stringify(candidate.spec)}) ` +
        'is not installed in the source profile and is not a local directory. ' +
        'Provide a local dir (file:/link:) or pre-install it, so the canary does not hit the network.');
}
function localPathOf(spec) {
    const m = /^(?:link|file):(.+)$/i.exec(spec);
    if (m !== null)
        return m[1] ?? null;
    if (spec.startsWith('/') || spec.startsWith('.') || spec.startsWith('~'))
        return spec;
    return null;
}
/** Mirror `src` node_modules into `dest` as absolute symlinks of each entry. */
function mirrorNodeModules(src, dest) {
    let entries;
    try {
        entries = readdirSync(src, { withFileTypes: true }).filter((d) => d.name !== '.package-lock.json' && d.name !== '.modules.yaml' && d.name !== '.cache').map((d) => d.name);
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const srcPath = join(src, entry);
        const destPath = join(dest, entry);
        if (entry.startsWith('@')) {
            // Scoped dir: mirror its packages individually.
            const pkgNames = safeReaddir(srcPath);
            mkdirSync(destPath, { recursive: true });
            for (const pkg of pkgNames) {
                const target = realpathOrNull(join(srcPath, pkg));
                if (target !== null)
                    safeSymlink(target, join(destPath, pkg));
            }
            continue;
        }
        const target = realpathOrNull(srcPath);
        if (target !== null)
            safeSymlink(target, destPath);
    }
}
function safeReaddir(dir) {
    try {
        return readdirSync(dir);
    }
    catch {
        return [];
    }
}
function realpathOrNull(p) {
    try {
        return realpathSync(p);
    }
    catch {
        return null;
    }
}
function safeSymlink(target, dest) {
    try {
        rmSync(dest, { recursive: true, force: true });
    }
    catch { /* ignore */ }
    try {
        symlinkSync(target, dest);
    }
    catch { /* ignore */ }
}
function ensureParent(p) {
    try {
        mkdirSync(dirname(p), { recursive: true });
    }
    catch { /* ignore */ }
}
function copyIfExists(src, dest) {
    if (!existsSync(src))
        return;
    try {
        cpSync(src, dest, { recursive: true, force: true, dereference: false });
    }
    catch { /* best-effort */ }
}
/**
 * Write the probe `--patch` overlay: an insert that mounts
 * `@mars.liu/dsh-canary-probe` with the candidate + its service candidates so
 * the probe knows what to observe. Emits a YAML entry list.
 */
function writeProbeOverlay(dir, candidate, services) {
    const overlayPath = join(dir, 'dsh-canary-probe.overlay.yml');
    const lines = [
        '# dsh-canary probe overlay (auto-generated; do not edit)',
        '- insert:',
        '    - id: dsh-canary-probe',
        `      name: '${PROBE_PACKAGE}'`,
        '      config:',
        `        candidate: '${yamlQuote(candidate)}'`,
        '        timeoutMs: 8000',
        '        pollEvery: 300',
    ];
    if (services.length > 0) {
        lines.push('        candidateServices:');
        for (const s of services)
            lines.push(`          - '${yamlQuote(s)}'`);
    }
    lines.push('');
    writeFileSync(overlayPath, lines.join('\n'));
    return overlayPath;
}
function yamlQuote(s) {
    return s.replace(/'/g, "''");
}
export { basename };
