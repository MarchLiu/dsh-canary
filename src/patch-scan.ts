/**
 * Dependency-free scanner for dsh bundle-patch entry rows.
 *
 * A bundle patch is a YAML entry list of `- id: …` / `- insert: …` / `- name:
 * …` rows. The canary needs the INSERTED entry ids and the `name:` targets a
 * plugin mounts, to (a) decide candidate probe service names and (b) detect a
 * package that ships no dsh surface at all. It mirrors dshmarket's
 * `parsePatchRows` line-wise (no YAML parser dependency), which is enough for
 * the boot-composition surface.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PatchRows {
  /** Every `name:` target the patch mounts (package or subpath). */
  names: string[]
  /** Every `id:` row in the patch. */
  ids: string[]
  /** The subset of `ids` nested under an `insert:` block (rows this bundle owns). */
  insertedIds: string[]
}

export function parsePatchRows(text: string): PatchRows {
  const names: string[] = []
  const ids: string[] = []
  const insertedIds: string[] = []
  let insertIndent: number | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '')
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    // A row at or above the insert indentation closes the insert block.
    if (insertIndent !== null && indent <= insertIndent && !/^\s*-?\s*(id|name|config):/u.test(line)) {
      insertIndent = null
    }
    if (/^\s*-?\s*insert:\s*$/u.test(line)) {
      insertIndent = indent
      continue
    }
    const name = /^\s*-?\s*name:\s*['"]?([^'"\s]+)/.exec(line)
    if (name !== null && name[1] !== undefined && !names.includes(name[1])) names.push(name[1])
    const id = /^\s*-?\s*id:\s*['"]?([^'"\s]+)/.exec(line)
    if (id !== null && id[1] !== undefined) {
      if (!ids.includes(id[1])) ids.push(id[1])
      if (insertIndent !== null && indent > insertIndent) {
        if (!insertedIds.includes(id[1])) insertedIds.push(id[1])
      } else if (indent <= (insertIndent ?? -1)) {
        insertIndent = null
      }
    }
  }
  return { names, ids, insertedIds }
}

/** Rows of the patch a package declares through `dsh.bundle.patch`. */
export function readBundlePatchRows(packageDir: string): PatchRows {
  const empty: PatchRows = { names: [], ids: [], insertedIds: [] }
  let manifest: { dsh?: { bundle?: { patch?: unknown } } }
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as typeof manifest
  } catch {
    return empty
  }
  const declared = manifest.dsh?.bundle?.patch
  if (typeof declared !== 'string' || declared === '') return empty
  let text: string
  try {
    text = readFileSync(join(packageDir, declared), 'utf8')
  } catch {
    return empty
  }
  return parsePatchRows(text)
}

/** Whether a package declares a dsh plugin surface at all. */
export function hasDshManifest(packageDir: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { dsh?: unknown }
    return manifest.dsh !== undefined
  } catch {
    return false
  }
}
