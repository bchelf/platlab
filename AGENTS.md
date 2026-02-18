# platlab — Agent Instructions

This file defines how AI agents (Codex, etc.) must operate inside this repository.

platlab is a cross-platform platformer physics lab with a **single authoritative simulation core** written in Rust.

---

# Reference Code

The `reference/` directory contains legacy physics implementations.

These are for comparison only.
Do not modify them.
Do not implement new features there.
All new physics work must occur in `crates/core`.

---

# High-Level Architecture

Repository structure:

```
platlab/
  crates/
    core/   → platlab_core     (authoritative physics, Rust)
    ffi/    → platlab_ffi      (C ABI shared library for native bindings)
    wasm/   → platlab_wasm     (WebAssembly bindings)
  apps/
    python/ → ctypes host demo
    web/    → browser demo using WASM
```

## Core Invariant

**All physics logic must live in `crates/core` only.**

No physics logic may be duplicated in:
- `apps/web`
- `apps/python`
- `crates/ffi`
- `crates/wasm`

Those layers are adapters only.

---

# Simulation Rules

- The simulation runs at a fixed **60Hz**.
- `platlab_core::step()` must be called exactly once per 1/60 second.
- Hosts may render at variable FPS but must accumulate time and step at 60Hz.

The Rust core defines:

- `Params`
- `State`
- `Rect`
- `Buttons`
- `Events`
- `step(params, world, state, input_bits)`

These are the single source of truth.

---

# Determinism Requirements

platlab is intended to:

- Run identically in Rust native
- Run identically in WebAssembly
- Run identically when bound via C ABI
- Be portable to other engines (Godot, TIC-80) later

Therefore:

1. Do not introduce non-deterministic behavior.
2. Avoid time-based floats outside the fixed DT.
3. Maintain consistent rounding points (especially during collision resolution).
4. If modifying physics, update deterministic tests accordingly.

---

# Build & Run Commands

## Native Shared Library

```
cargo build -p platlab_ffi --release
```

Outputs:

- macOS: `target/release/libplatlab_ffi.dylib`
- Linux: `target/release/libplatlab_ffi.so`
- Windows: `target\release\platlab_ffi.dll`

---

## Python Demo

```
python3 apps/python/run.py
```

Python loads the shared library via ctypes.
It must not reimplement physics.

---

## WebAssembly Build

```
wasm-pack build crates/wasm --target web --release --out-dir ../../apps/web/pkg
```

---

## Web Demo

```
python3 -m http.server -d apps/web 8000
```

Open:
```
http://localhost:8000
```

---

# Code Modification Rules

When modifying the repo:

### 1. Physics Changes
- Must occur only in `crates/core`.
- Update all bindings if data structures change.
- Add or update Rust tests in `crates/core`.

### 2. FFI Changes
- `crates/ffi` must expose a stable C ABI.
- Do not break ABI unless necessary.
- If breaking ABI, document it clearly.
- Keep `#[repr(C)]` layout parity with Python ctypes definitions.

### 3. WASM Changes
- WASM layer is a thin wrapper.
- Avoid adding physics logic here.
- Prefer forwarding calls to `platlab_core`.
- Keep input bit meanings identical to `Buttons` in `crates/core`.

### 4. Host Apps
- May handle:
  - Rendering
  - Input
  - UI
- Must not implement movement, gravity, collision, or wrap logic.

---

# Adding Features

When implementing a new feature:

1. Update `Params` and/or `State` in `platlab_core`.
2. Modify `step()` accordingly.
3. Update deterministic test(s).
4. Update FFI bindings if struct layout changed.
5. Update WASM binding if struct layout changed.
6. Update Python ctypes definitions if layout changed.
7. Update web UI if necessary.

---

# Deterministic Testing

`platlab_core` must contain at least one deterministic test:

- Feed a fixed input sequence
- Step N frames
- Assert final state or hash

Run:

```
cargo test -p platlab_core
```

This ensures cross-platform parity.

---

# Agent Workflow Requirements

When an agent begins work:

1. Inventory relevant files.
2. State what will change.
3. Make minimal scoped changes.
4. Explain how to verify.
5. Provide exact commands to test.

Agents must not:
- Rewrite large sections unnecessarily
- Duplicate simulation logic
- Introduce hidden coupling between host and core

---

# Smoke Test Checklist

Run from repo root:

```
cargo test -p platlab_core
cargo build -p platlab_ffi --release
python3 apps/python/run.py
wasm-pack build crates/wasm --target web --release --out-dir ../../apps/web/pkg
python3 -m http.server -d apps/web 8000
```

---

# Parity Harness

Run from repo root:

```
python3 scripts/parity_harness.py
```

This must report matching hashes for Rust core, Python ctypes (FFI), and WASM (node runner).

---

# Reference Trace Parity

Use this shared spec and compare core vs legacy pygame reference:

```
cargo run -p platlab_core --bin replay -- reference/trace_scenarios/default_trace.json > core_trace.csv
python3 reference/pygame_sandbox/tuner.py --trace-in reference/trace_scenarios/default_trace.json --trace-out py_trace.csv
python3 scripts/compare_reference_trace.py
```

Legacy web reference can export a trace from:

`reference/js_sandbox/physics-lab.html#trace=<base64-json>`

and writes CSV to `window.__TRACE_CSV__`.

---

# Long-Term Direction

platlab is intended to:

- Be portable to Godot (via C ABI)
- Be portable to TIC-80 (via spec + deterministic tests)
- Potentially migrate to fixed-point math for stronger determinism

Agents should keep this future direction in mind.

---

# Definition of Done for Changes

A change is complete when:

- All targets build successfully.
- `cargo test -p platlab_core` passes.
- Python demo runs.
- WASM demo runs.
- No physics logic exists outside `crates/core`.

---

End of instructions.
