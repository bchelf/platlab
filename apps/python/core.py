import ctypes as C
import os
import sys

def _default_lib_path():
    # This file: platlab/apps/python/core.py
    here = os.path.abspath(__file__)
    repo_root = os.path.abspath(os.path.join(here, "..", "..", ".."))
    target = os.path.join(repo_root, "target", "release")

    if sys.platform == "darwin":
        return os.path.join(target, "libplatlab_ffi.dylib")
    elif sys.platform.startswith("win"):
        return os.path.join(target, "platlab_ffi.dll")
    else:
        return os.path.join(target, "libplatlab_ffi.so")


LIB_PATH = os.environ.get("PLATLAB_LIB", _default_lib_path())

class Rect(C.Structure):
    _fields_ = [("x", C.c_float), ("y", C.c_float), ("w", C.c_float), ("h", C.c_float)]

class Params(C.Structure):
    _fields_ = [
        ("ground_max_speed", C.c_float),
        ("ground_accel", C.c_float),
        ("ground_decel", C.c_float),
        ("ground_friction", C.c_float),
        ("run_multiplier", C.c_float),
        ("air_max_speed", C.c_float),
        ("air_accel", C.c_float),
        ("air_decel", C.c_float),
        ("air_drag", C.c_float),
        ("gravity_up", C.c_float),
        ("gravity_down", C.c_float),
        ("terminal_velocity", C.c_float),
        ("fast_fall_multiplier", C.c_float),
        ("jump_velocity", C.c_float),
        ("jump_cut_multiplier", C.c_float),
        ("coyote_time", C.c_float),
        ("jump_buffer", C.c_float),
        ("snap_to_ground", C.c_float),
        ("max_step_px", C.c_float),
        ("world_w", C.c_float),
        ("world_wrap_mode", C.c_float),
    ]

class State(C.Structure):
    _fields_ = [
        ("x", C.c_float), ("y", C.c_float),
        ("vx", C.c_float), ("vy", C.c_float),
        ("w", C.c_float), ("h", C.c_float),
        ("grounded", C.c_ubyte),
        ("coyote", C.c_float),
        ("jump_buffer", C.c_float),
        ("jump_was_down", C.c_ubyte),
    ]

class Events(C.Structure):
    _fields_ = [("jumped", C.c_ubyte), ("landed", C.c_ubyte), ("bonked", C.c_ubyte)]

# Input bits must match Rust Buttons
LEFT  = 1 << 0
RIGHT = 1 << 1
DOWN  = 1 << 2
RUN   = 1 << 3
JUMP  = 1 << 4

lib = C.CDLL(LIB_PATH)

lib.core_default_params.argtypes = [C.POINTER(Params)]
lib.core_default_params.restype = None

lib.core_init_state.argtypes = [C.POINTER(State), C.c_float, C.c_float, C.c_float, C.c_float]
lib.core_init_state.restype = None

lib.core_step.argtypes = [C.POINTER(Params), C.POINTER(Rect), C.c_size_t, C.POINTER(State), C.c_ubyte]
lib.core_step.restype = Events

def default_params() -> Params:
    p = Params()
    lib.core_default_params(C.byref(p))
    return p

def init_state(x: float, y: float, w: float, h: float) -> State:
    s = State()
    lib.core_init_state(C.byref(s), x, y, w, h)
    return s

def step(p: Params, world: list[Rect], s: State, input_bits: int) -> Events:
    arr = (Rect * len(world))(*world)
    return lib.core_step(C.byref(p), arr, len(world), C.byref(s), input_bits)
