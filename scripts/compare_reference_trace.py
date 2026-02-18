#!/usr/bin/env python3
import argparse
import csv
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, cwd=ROOT, check=True)


def load_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--spec",
        default="reference/trace_scenarios/default_trace.json",
        help="Path to replay/trace JSON spec",
    )
    parser.add_argument("--tol", type=float, default=1e-3, help="Numeric tolerance for x/y/vx/vy")
    args = parser.parse_args()

    spec = Path(args.spec)
    core_csv = Path("core_trace.csv")
    py_csv = Path("py_trace.csv")

    core_csv.write_text(
        subprocess.check_output(
            ["cargo", "run", "-p", "platlab_core", "--bin", "replay", "--quiet", "--", str(spec)],
            cwd=ROOT,
            text=True,
        ),
        encoding="utf-8",
    )
    run(["python3", "reference/pygame_sandbox/tuner.py", "--trace-in", str(spec), "--trace-out", str(py_csv)])

    core_rows = load_csv(core_csv)
    py_rows = load_csv(py_csv)

    if len(core_rows) != len(py_rows):
        print(f"ERROR: row count mismatch core={len(core_rows)} pygame={len(py_rows)}")
        return 1

    max_diff = {"x": 0.0, "y": 0.0, "vx": 0.0, "vy": 0.0}
    grounded_mismatches = 0

    for i, (a, b) in enumerate(zip(core_rows, py_rows)):
        if a["grounded"] != b["grounded"]:
            grounded_mismatches += 1
            print(f"grounded mismatch frame={i}: core={a['grounded']} pygame={b['grounded']}")
            return 1
        for k in max_diff:
            d = abs(float(a[k]) - float(b[k]))
            max_diff[k] = max(max_diff[k], d)
            if d > args.tol:
                print(f"ERROR frame={i} field={k}: core={a[k]} pygame={b[k]} diff={d}")
                return 1

    print("Parity OK")
    print(f"rows={len(core_rows)} max_diff={max_diff} grounded_mismatches={grounded_mismatches}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
