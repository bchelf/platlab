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

## Determinism Notes

- Core tick rate is fixed at 60Hz (`DT = 1/60`).
- Hosts may render at variable FPS but must step simulation exactly at 60Hz.
- Input bit layout and struct layouts must remain aligned across Rust, FFI, Python, and WASM bindings.
