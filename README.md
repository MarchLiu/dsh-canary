<p align="center">
  <img src="canary-logo.svg" width="120" alt="dsh-canary logo" />
</p>

# dsh-canary

**Boot-verify a dsh plugin against the real profile, for real.** dsh-canary
closes the gap where dshmarket's offline `trialValidate` says "composition
looks fine" but a **restart crashes**. It actually **boots** a throwaway
composition of your profile's bundles + the candidate plugin, and classifies
the outcome: crash / hang / fail-loud / boot-ok — then runs a **bounded
functional probe** to confirm the plugin's primary service resolves.

It is a standalone npm package (`@mars.liu/dsh-canary`) with two entry points:

- **Library** `verifyPluginBoot(spec, opts) → Promise<Verdict>` (feeds a
  market's block/warn policy).
- **CLI** `dsh-canary <plugin> [flags]`.

No Docker required for the default **L0** path; L1 (a pinned dsh version) and
the manual container **debug-web** mode are opt-in.

---

## Why

dshmarket's `trialValidate` (src/trial.ts) replays the composition *statically*:
reordering/duplicates/parse problems, but **no process, no network, no writes,
nothing actually runs**. `validateAddedPlugins` / `verifyActivation` observe
*after* an install. Neither executes a boot. dsh-canary supplies exactly that
missing half: run the real dsh CLI on a composition that is your profile's
bundle stack **plus the candidate**, under a hard timeout, and report whether
the boot survives.

### Case study: the silent-failure blind spot

A real-world troubleshooting session
([docs/case-studies/2026-09-08-dsh-context-troubleshooting.md](docs/case-studies/2026-09-08-dsh-context-troubleshooting.md),
issue [dsh-market/dsh-market#554](https://github.com/dsh-market/dsh-market/issues/554))
isolated a case where `dshmarket@1.45.0` boot-ok'd cleanly while silently
breaking the client-plugin registration chain for every plugin after it
(`dsh-context`'s `/context` command never registered — zero errors anywhere).
Six rounds of `--patch` bisect in an isolated `DSH_HOME` manual-canary found it.
That case exposes a gap in the current L0 verdicts: **boot-ok + own-probe-pass
says nothing about collateral damage to co-installed client plugins** — a
"probe-collateral" / registration-level probe dimension is tracked in §5 of
the case study.

---

## Install

```sh
npm install @mars.liu/dsh-canary   # or: npm i -D dsh-canary
```

Requires Node >= 22.6 (native ESM).

---

## CLI

```sh
# Boot-verify a plugin against the default (web) profile.
dsh-canary dsh-ppt

# Against a specific profile / directory, JSON out for a market policy.
dsh-canary @scope/pkg --profile web --json
dsh-canary ./my-plugin --profile-dir ~/.dsh/profiles/web

# Human summary (default):
#   OK [l0] probe-pass  (dsh 0.1.2-rc.1, 982ms)
#     - boot-ok; probe pass for @mars.liu/dsh-canary-good
#     ...
#   note: 安装可接受 / install acceptable
```

Flags: `--profile`, `--profile-dir`, `--mode <l0|l1|debug>`, `--versioned`,
`--dsh`, `--home`, `--boot-timeout`, `--probe-timeout`, `--keep`, `--debug-web`,
`--docker`, `--json`, `-h/--help`, `-V/--version`.

---

## Library

```ts
import { verifyPluginBoot } from '@mars.liu/dsh-canary'

const verdict = await verifyPluginBoot({
  plugin: 'dsh-ppt',                 // bare name, name@version, file:, link:, or dir
  profile: 'web',                    // profile name, or set profileDir
  profileDir: '/home/u/.dsh/profiles/web',
  mode: 'l0',                        // l0 (default) | l1 | probe | debug
  bootTimeoutMs: 60000,
  probeTimeoutMs: 20000,
  dshPath: '/usr/local/bin/dsh',     // market passes the exact host CLI
})
```

### Verdict (JSON)

```jsonc
{
  "ok": true,                        // false only for boot-fail / probe-fail
  "mode": "l0",                      // l0 | l1 | probe | debug
  "testedVersion": "0.1.2-rc.1",     // the dsh actually boot-tested
  "phase": "probe",                  // boot | probe
  "state": "probe-pass",             // boot-ok | probe-pass | probe-fail | probe-timeout | probe-inert | boot-fail
  "diagnostics": ["..."],            // bilingual
  "durationMs": 901
}
```

`ok` maps to a market's block/warn policy: `boot-fail` and `probe-fail` block;
`boot-ok`, `probe-pass`, `probe-inert`, `probe-timeout` do **not** block
(`probe-inert` / `probe-timeout` are "couldn't tell", never a reason to refuse).

---

## Modes

### L0 — host temp profile (default, zero Docker)
1. Read the source profile's `dsh.profile.bundles` + `dependencies`.
2. Build a throwaway profile `$DSH_HOME/profiles/canary-<rand>` — same bundle
   stack + the candidate appended — reusing the source `node_modules` via
   location-independent **absolute symlinks** (it never writes to your profile).
3. Spawn the user's dsh CLI (`--patch <probe-overlay> --port 0 --no-open`) with
   a hard timeout.
4. Detect **boot-ok** by the web ready URL (`dsh web: http://…?token=` — emitted
   only after the whole tree mounted and bound), vs **crash** (non-zero exit +
   fail-loud on stderr) vs **hang** (no ready before timeout).
5. A **probe overlay** mounts a tiny bounded plugin that, in-process, checks
   the candidate's primary service resolves non-null in `ctx` and makes one
   harmless call — `probe-pass`, `probe-inert` (couldn't tell), never a block.
6. Clean up the temp profile.

### L1 — pinned / versioned dsh (opt-in)
Verify against `@deepseek-ai/dsh@<version>` (e.g. `latest`). The build ships
`dockerBootCommand()` (container boot, never touches the host) and
`verifyVersionedBoot()`. A pinned `dshPath` also works by just running L0.

### debug — manual container web mode
`dsh-canary <plugin> --debug-web` prints a `docker run` command that boots the
web profile inside a container, binds the webserver to `0.0.0.0` **via a
`--patch` config override** (the CLI refuses `--host 0.0.0.0`, RCE concern), and
maps `-p 3080:3080` so the printed `http://127.0.0.1:3080?token=…` is directly
usable from the host browser. The listen stays confined to the mapping, never
exposed to the network.

---

## Limitations

- The candidate must be **local** (`file:`/`link:`/dir) or **already installed**
  in the source profile's `node_modules`. dsh-canary never runs `pnpm add`
  implicitly (that can hit the network). This matches the market's install-then-
  verify flow: after the market installs a plugin, the canary boots the
  composition exactly as a restart will.
- The boot is a **real** web-app boot, so it needs the matching host dsh and a
  writable `$DSH_HOME` (for the throwaway profile). It spawns the **user's** dsh
  CLI — the same one dshmarket spawns.
- The functional probe is **presence-level** (service resolves non-null + a safe
  no-arg call) and offline; it never calls a model. Deep behavioral probing
  belongs to L1/container (headless/SDK), not the web GUI.

---

## Integration (dshmarket, optional)

dshmarket can call the canary as one subprocess/import after the market writes
the plugin into the real profile:

```ts
import { verifyPluginBoot } from '@mars.liu/dsh-canary'
const v = await verifyPluginBoot({ plugin, profileDir, dshPath: <host dsh> })
if (!v.ok) /* block: this install would kill the boot */
```

No change to dshmarket's bundle-check path is required; this is additive and
does not raise a PR.

---

## Development

```sh
npm i            # typescript devDep
npm run build    # tsc → dist/ + shebang/executable dist/cli.js
npm test         # node --test (builds a synthetic profile; no network)
npm run typecheck
```
