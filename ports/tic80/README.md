# TIC-80 Port (`ports/tic80`)

This directory contains TIC-80 Lua text carts for platlab experiments.
Rust (`crates/core`) remains authoritative for shipped physics behavior.

## Current Files

- `ports/tic80/platlab_harness.lua`: main playable harness cart
- `ports/tic80/platlab.lua`: earlier reference cart with trace mode

## Run

1. Open TIC-80 (PRO text cart workflow).
2. Load:
   - `load ports/tic80/platlab_harness.lua`
3. Run:
   - `run`

## Controls (Harness)

- Left/Right: D-pad left/right
- Jump: A (and Up is also accepted)
- Down: D-pad down
- Run modifier: B

## Critical Cart Format Rules (For AI Generation)

These rules are mandatory for any new TIC-80 text cart generated in this repo:

1. Text carts must use `.lua` (not `.tic`).
2. Do not wrap code in `-- <CODE>` tags.
3. Lua code lives at top of file.
4. The file must include all four asset sections:
   - `-- <TILES>` ... `-- </TILES>`
   - `-- <SPRITES>` ... `-- </SPRITES>`
   - `-- <MAP>` ... `-- </MAP>`
   - `-- <PALETTE>` ... `-- </PALETTE>`
5. If a section is missing, add a valid default empty section.
6. Preserve existing section payload lines exactly when editing unrelated logic.

## Validation Checklist (Before Saving)

Run this mental checklist before writing/updating a cart:

1. Filename ends with `.lua`.
2. Exactly one open/close pair exists for each of:
   - `TILES`, `SPRITES`, `MAP`, `PALETTE`
3. Section tags are spelled/cased exactly and on their own lines.
4. Cart does not require `dofile()` runtime filesystem dependencies unless explicitly intended.

## Physics Boundary

- Host/cart code should only do: input, call physics step, render.
- Avoid re-implementing alternate physics logic in host rendering code.
- Keep fixed 60Hz stepping (`TIC()` once per frame, no variable-dt path).
