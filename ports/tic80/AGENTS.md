# AGENTS.md (ports/tic80)

Repository-local rules for AI agents working on TIC-80 carts in this folder.

## Scope

These rules apply to files under `ports/tic80/`.

## Authoritative Boundary

- `crates/core` is authoritative for physics.
- TIC-80 cart code is host-layer glue: input -> step -> render.
- Avoid adding new physics variants in host logic unless explicitly requested.

## TIC-80 Text Cart Rules

1. Text carts must use `.lua` extension.
2. Do not emit text carts as `.tic` files.
3. Keep Lua code plain at the top (no `-- <CODE>` block).
4. Always include all four asset sections exactly once:
   - `-- <TILES>` ... `-- </TILES>`
   - `-- <SPRITES>` ... `-- </SPRITES>`
   - `-- <MAP>` ... `-- </MAP>`
   - `-- <PALETTE>` ... `-- </PALETTE>`
5. Keep section tags on their own lines, with exact casing/spelling.
6. Preserve existing asset payload lines byte-for-byte unless intentionally editing assets.

## Runtime/Portability Rules

- Do not rely on `dofile()`/filesystem loading for required runtime modules in carts intended to run directly in TIC-80.
- Prefer self-contained carts unless a build pipeline is explicitly documented.
- Keep fixed-step behavior (`TIC()` called once per frame, no variable-dt path).

## Input Mapping (TIC-80)

- Use TIC-80 button indices:
  - `0=Up`, `1=Down`, `2=Left`, `3=Right`, `4=A`, `5=B`, `6=X`, `7=Y`
- Left/right motion must come from left/right indices (`2`/`3`), never up/down.
- Jump should map to `A` (`4`) and may also allow `Up` (`0`) if desired.

## Pre-Write Validation Checklist

Before finalizing a cart:

1. Filename ends with `.lua`.
2. Exactly one open/close pair exists for each required section.
3. Section order is stable: `TILES`, `SPRITES`, `MAP`, `PALETTE`.
4. Cart loads without requiring external Lua files.

