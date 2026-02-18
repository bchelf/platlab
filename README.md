# platlab

Cross-platform platformer physics lab with a single authoritative simulation core in Rust.

## Architecture

- `crates/core` (`platlab_core`): authoritative simulation (`step`) at fixed 60Hz.
- `crates/ffi` (`platlab_ffi`): C ABI adapter for native hosts.
- `crates/wasm` (`platlab_wasm`): WebAssembly adapter for browser hosts.
- `apps/python`: ctypes host demo using the FFI shared library.
- `apps/web`: browser demo using the WASM package.

Physics logic must live only in `crates/core`.

## Smoke Test

Run these from repo root:

```bash
cargo test -p platlab_core
cargo build -p platlab_ffi --release
python3 apps/python/run.py
wasm-pack build crates/wasm --target web --release --out-dir ../../apps/web/pkg
python3 -m http.server -d apps/web 8000
```

Then open `http://localhost:8000`.

## Cross-Target Parity Check

Run:

```bash
python3 scripts/parity_harness.py
```

This runs the same 180-frame fixed input sequence against:
- Rust core example (`cargo run -p platlab_core --example parity_trace`)
- Python ctypes host (`platlab_ffi`)
- WASM wrapper (`wasm-pack --target nodejs` + Node runner)

and compares a shared deterministic hash of final state/event counters.

## Reference Parity Trace Workflow

1. Use the shared replay spec:
   - `reference/trace_scenarios/default_trace.json`
2. Export core trace:
   - `cargo run -p platlab_core --bin replay -- reference/trace_scenarios/default_trace.json > core_trace.csv`
3. Export pygame reference trace (no rendering):
   - `python3 reference/pygame_sandbox/tuner.py --trace-in reference/trace_scenarios/default_trace.json --trace-out py_trace.csv`
4. Compare:
   - `python3 scripts/compare_reference_trace.py`

Legacy web reference trace export is available via hash payload:
- open `reference/js_sandbox/physics-lab.html#trace=<base64-json-spec>`
- then read CSV from `window.__TRACE_CSV__` (also printed to console).

## Determinism Notes

- Core tick rate is fixed at 60Hz (`DT = 1/60`).
- Hosts may render at variable FPS but must step simulation exactly at 60Hz.
- Input bit layout and struct layouts must remain aligned across Rust, FFI, Python, and WASM bindings.
