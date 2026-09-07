/**
 * Public types for dsh-canary.
 *
 * The Verdict shape is designed to feed dshmarket's install block/warn policy
 * directly: a structured `ok` plus a machine `state` in the vocabulary the
 * brief specifies (`boot-ok / probe-pass / probe-fail / probe-timeout /
 * probe-inert / boot-fail`), with a `mode` so the caller knows which path
 * produced it.
 */
export {};
