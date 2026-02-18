use platlab_core::{Buttons, Events, Params, Rect, State};

#[no_mangle]
pub extern "C" fn core_default_params(out: *mut Params) {
    unsafe { *out = Params::default(); }
}

#[no_mangle]
pub extern "C" fn core_init_state(out: *mut State, x: f32, y: f32, w: f32, h: f32) {
    let mut s = State::default();
    s.x = x;
    s.y = y;
    s.w = w;
    s.h = h;
    s.grounded = 0;
    s.jump_was_down = 0;
    unsafe { *out = s; }
}

#[no_mangle]
pub extern "C" fn core_step(
    params: *const Params,
    world_rects: *const Rect,
    world_len: usize,
    state: *mut State,
    input_bits: u8,
) -> Events {
    let p = unsafe { &*params };
    let s = unsafe { &mut *state };
    let world = unsafe { std::slice::from_raw_parts(world_rects, world_len) };
    let buttons = Buttons::from_bits_truncate(input_bits);

    platlab_core::step(p, world, s, buttons)
}
