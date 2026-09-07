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
export interface PatchRows {
    /** Every `name:` target the patch mounts (package or subpath). */
    names: string[];
    /** Every `id:` row in the patch. */
    ids: string[];
    /** The subset of `ids` nested under an `insert:` block (rows this bundle owns). */
    insertedIds: string[];
}
export declare function parsePatchRows(text: string): PatchRows;
/** Rows of the patch a package declares through `dsh.bundle.patch`. */
export declare function readBundlePatchRows(packageDir: string): PatchRows;
/** Whether a package declares a dsh plugin surface at all. */
export declare function hasDshManifest(packageDir: string): boolean;
