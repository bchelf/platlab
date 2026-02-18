#!/usr/bin/env python3
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def run(cmd: list[str], cwd: Path | None = None) -> str:
    proc = subprocess.run(
        cmd,
        cwd=cwd or ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    return proc.stdout.strip()


def quantize(v: float) -> int:
    return int(round(v * 1000.0))


def state_hash(state: dict) -> str:
    # FNV-1a 64-bit over fixed integer fields.
    h = 0xCBF29CE484222325
    mask = 0xFFFFFFFFFFFFFFFF
    fields = [
        quantize(float(state["x"])),
        quantize(float(state["y"])),
        quantize(float(state["vx"])),
        quantize(float(state["vy"])),
        int(state["grounded"]),
        int(state["jumped"]),
        int(state["landed"]),
        int(state["bonked"]),
    ]
    for n in fields:
        b = int(n).to_bytes(8, "little", signed=True)
        for byte in b:
            h ^= byte
            h = (h * 0x100000001B3) & mask
    return f"{h:016x}"


def rust_state() -> dict:
    out = run(["cargo", "run", "-p", "platlab_core", "--example", "parity_trace", "--quiet"])
    return json.loads(out)


def python_state() -> dict:
    sys.path.insert(0, str(ROOT / "apps" / "python"))
    from core import JUMP, RIGHT, Rect, default_params, init_state, step  # noqa: E402

    p = default_params()
    p.world_w = 960.0
    world = [Rect(0, 480, 960, 60)]
    s = init_state(80, 480 - 44, 28, 44)

    jumped = landed = bonked = 0
    for frame in range(180):
        bits = 0
        if frame < 120:
            bits |= RIGHT
        if frame == 10:
            bits |= JUMP
        ev = step(p, world, s, bits)
        jumped += int(ev.jumped)
        landed += int(ev.landed)
        bonked += int(ev.bonked)

    return {
        "x": s.x,
        "y": s.y,
        "vx": s.vx,
        "vy": s.vy,
        "grounded": int(s.grounded),
        "jumped": jumped,
        "landed": landed,
        "bonked": bonked,
    }


def wasm_state() -> dict:
    run(
        [
            "wasm-pack",
            "build",
            "crates/wasm",
            "--target",
            "nodejs",
            "--release",
            "--out-dir",
            "../../apps/web/pkg_node",
        ]
    )
    out = run(["node", "scripts/wasm_parity_runner.mjs"])
    return json.loads(out)


def main() -> int:
    rust = rust_state()
    py = python_state()
    wasm = wasm_state()

    hashes = {
        "rust": state_hash(rust),
        "python_ffi": state_hash(py),
        "wasm": state_hash(wasm),
    }

    print("Parity states:")
    print(json.dumps({"rust": rust, "python_ffi": py, "wasm": wasm}, indent=2))
    print("Parity hashes:")
    print(json.dumps(hashes, indent=2))

    if len(set(hashes.values())) != 1:
        print("ERROR: cross-target parity mismatch", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
