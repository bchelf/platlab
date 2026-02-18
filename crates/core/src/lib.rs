#![allow(clippy::many_single_char_names)]

pub const HZ: f32 = 60.0;
pub const DT: f32 = 1.0 / HZ;

#[repr(C)]
#[derive(Copy, Clone, Debug, Default)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[inline]
pub fn rects_intersect(a: &Rect, b: &Rect) -> bool {
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct Params {
    // Ground movement
    pub ground_max_speed: f32,
    pub ground_accel: f32,
    pub ground_decel: f32,
    pub ground_friction: f32,
    pub run_multiplier: f32,

    // Air movement
    pub air_max_speed: f32,
    pub air_accel: f32,
    pub air_decel: f32,
    pub air_drag: f32,

    // Vertical
    pub gravity_up: f32,
    pub gravity_down: f32,
    pub terminal_velocity: f32,
    pub fast_fall_multiplier: f32,

    // Jump
    pub jump_velocity: f32,
    pub jump_cut_multiplier: f32,
    pub coyote_time: f32,
    pub jump_buffer: f32,

    // Collision stepping / grounding
    pub snap_to_ground: f32,
    pub max_step_px: f32,

    // World
    pub world_w: f32,
    // 0 = off, 1 = edge-wrap (pygame legacy), 2 = center-wrap torus (web legacy)
    pub world_wrap_mode: f32,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            ground_max_speed: 260.0,
            ground_accel: 1800.0,
            ground_decel: 2200.0,
            ground_friction: 2600.0,
            run_multiplier: 1.35,

            air_max_speed: 220.0,
            air_accel: 1200.0,
            air_decel: 900.0,
            air_drag: 0.0,

            gravity_up: 1500.0,
            gravity_down: 2300.0,
            terminal_velocity: 1200.0,
            fast_fall_multiplier: 1.35,

            jump_velocity: 520.0,
            jump_cut_multiplier: 0.45,
            coyote_time: 0.085,
            jump_buffer: 0.100,

            snap_to_ground: 6.0,
            max_step_px: 6.0,

            world_w: 960.0,
            world_wrap_mode: 1.0,
        }
    }
}

bitflags::bitflags! {
    #[repr(transparent)]
    pub struct Buttons: u8 {
        const LEFT  = 1 << 0;
        const RIGHT = 1 << 1;
        const DOWN  = 1 << 2; // reserved
        const RUN   = 1 << 3; // reserved
        const JUMP  = 1 << 4;
    }
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Default)]
pub struct State {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub w: f32,
    pub h: f32,

    pub grounded: u8,
    pub coyote: f32,
    pub jump_buffer: f32,
    pub jump_was_down: u8,
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Default)]
pub struct Events {
    pub jumped: u8,
    pub landed: u8,
    pub bonked: u8,
}

#[inline]
fn sign(x: f32) -> f32 {
    if x < 0.0 { -1.0 } else if x > 0.0 { 1.0 } else { 0.0 }
}

#[inline]
fn clamp(x: f32, lo: f32, hi: f32) -> f32 {
    x.max(lo).min(hi)
}

fn resolve_axis_separated(mut r: Rect, dx: f32, dy: f32, world: &[Rect]) -> (Rect, bool, bool) {
    let mut hit_ground = false;
    let mut hit_head = false;

    // X
    r.x += dx.round();
    for p in world {
        if rects_intersect(&r, p) {
            if dx > 0.0 { r.x = p.x - r.w; }
            else if dx < 0.0 { r.x = p.x + p.w; }
        }
    }

    // Y
    r.y += dy.round();
    for p in world {
        if rects_intersect(&r, p) {
            if dy > 0.0 {
                r.y = p.y - r.h;
                hit_ground = true;
            } else if dy < 0.0 {
                r.y = p.y + p.h;
                hit_head = true;
            }
        }
    }

    (r, hit_ground, hit_head)
}

/// One fixed 60Hz step. Host calls this exactly once per frame.
/// Deterministic at the math/rounding points used here.
pub fn step(params: &Params, world: &[Rect], s: &mut State, buttons: Buttons) -> Events {
    let mut ev = Events::default();

    let left = buttons.contains(Buttons::LEFT);
    let right = buttons.contains(Buttons::RIGHT);
    let down = buttons.contains(Buttons::DOWN);
    let run = buttons.contains(Buttons::RUN);
    let jump = buttons.contains(Buttons::JUMP);

    let move_dir = (right as i32) - (left as i32);

    // Jump edge detection
    let jump_was_down = s.jump_was_down != 0;
    let jump_pressed = jump && !jump_was_down;
    let jump_released = !jump && jump_was_down;
    s.jump_was_down = if jump { 1 } else { 0 };

    let was_grounded = s.grounded != 0;

    // Coyote timer
    if was_grounded {
        s.coyote = params.coyote_time;
    } else {
        s.coyote = (s.coyote - DT).max(0.0);
    }

    // Jump buffer timer
    if jump_pressed {
        s.jump_buffer = params.jump_buffer;
    } else {
        s.jump_buffer = (s.jump_buffer - DT).max(0.0);
    }

    // Horizontal movement
    let run_mul = if run { params.run_multiplier } else { 1.0 };
    let (max_speed, accel, decel, friction) = if was_grounded {
        (
            params.ground_max_speed * run_mul,
            params.ground_accel,
            params.ground_decel,
            params.ground_friction,
        )
    } else {
        (
            params.air_max_speed * run_mul,
            params.air_accel,
            params.air_decel,
            0.0,
        )
    };

    if move_dir != 0 {
        let desired_dir = move_dir as f32;
        let turning = s.vx != 0.0 && sign(s.vx) != desired_dir;
        let dv = if turning { decel } else { accel } * DT * desired_dir;
        s.vx += dv;
    } else if was_grounded {
        let fr = friction * DT;
        if s.vx.abs() <= fr { s.vx = 0.0; }
        else { s.vx -= sign(s.vx) * fr; }
    }

    // Air drag
    if !was_grounded && params.air_drag > 0.0 {
        let drag = params.air_drag * DT;
        if s.vx.abs() <= drag { s.vx = 0.0; }
        else { s.vx -= sign(s.vx) * drag; }
    }

    s.vx = clamp(s.vx, -max_speed, max_speed);

    // Gravity
    let g = if s.vy < 0.0 { params.gravity_up } else { params.gravity_down };
    let mut g_apply = g;
    if down && s.vy > 0.0 {
        g_apply *= params.fast_fall_multiplier;
    }
    s.vy += g_apply * DT;
    s.vy = clamp(s.vy, -5000.0, params.terminal_velocity);

    // Jump execution
    let can_jump = was_grounded || s.coyote > 0.0;
    let wants_jump = s.jump_buffer > 0.0;
    if can_jump && wants_jump {
        s.vy = -params.jump_velocity;
        s.grounded = 0;
        s.coyote = 0.0;
        s.jump_buffer = 0.0;
        ev.jumped = 1;
    }

    // Jump cut
    if jump_released && s.vy < 0.0 {
        let cut_vy = -params.jump_velocity * params.jump_cut_multiplier;
        if s.vy < cut_vy { s.vy = cut_vy; }
    }

    // Integrate with substeps + collisions
    let mut rect = Rect {
        x: s.x.round(),
        y: s.y.round(),
        w: s.w.round(),
        h: s.h.round(),
    };

    let max_step = params.max_step_px.max(1.0);
    let total_dx = s.vx * DT;
    let total_dy = s.vy * DT;

    let steps = ((total_dx.abs().max(total_dy.abs())) / max_step).ceil().max(1.0) as i32;
    let dx = total_dx / (steps as f32);
    let dy = total_dy / (steps as f32);

    let mut hit_ground_any = false;

    for _ in 0..steps {
        let (r2, hit_ground, hit_head) = resolve_axis_separated(rect, dx, dy, world);
        rect = r2;

        if hit_head && s.vy < 0.0 { s.vy = 0.0; ev.bonked = 1; }
        if hit_ground && s.vy > 0.0 { s.vy = 0.0; }

        hit_ground_any |= hit_ground;
    }

    s.x = rect.x;
    s.y = rect.y;

    // Ground snap
    let mut now_grounded = false;
    if params.snap_to_ground > 0.0 {
        let test = Rect {
            x: rect.x,
            y: rect.y + params.snap_to_ground.round(),
            w: rect.w,
            h: rect.h,
        };
        for p in world {
            if rects_intersect(&test, p) {
                now_grounded = true;
                if rect.y + rect.h <= p.y + params.snap_to_ground.round() {
                    rect.y = p.y - rect.h;
                    s.y = rect.y;
                }
                break;
            }
        }
    } else {
        now_grounded = hit_ground_any;
    }

    if now_grounded && !was_grounded {
        ev.landed = 1;
    }

    s.grounded = if now_grounded { 1 } else { 0 };

    // Optional world wrap (torus), based on center
    let wrap_mode = params.world_wrap_mode.round() as i32;
    if wrap_mode == 1 {
        let w = params.world_w.max(1.0).round();
        let mut left = s.x.round();
        let right = left + s.w.round();
        if left < 0.0 {
            left = w - s.w.round();
        } else if right > w {
            left = 0.0;
        }
        s.x = left;
    } else if wrap_mode == 2 {
        let w = params.world_w.max(1.0);
        let center_x = s.x + 0.5 * s.w;
        let wrapped = ((center_x % w) + w) % w;
        s.x = (wrapped - 0.5 * s.w).round();
    }

    ev
}

#[cfg(test)]
mod tests {
    use super::{step, Buttons, Params, Rect, State};

    fn approx_eq(a: f32, b: f32) {
        let eps = 1e-4;
        assert!(
            (a - b).abs() <= eps,
            "expected {b}, got {a} (diff {})",
            (a - b).abs()
        );
    }

    #[test]
    fn deterministic_fixed_input_sequence_180_frames() {
        let mut params = Params::default();
        params.world_w = 960.0;

        let world = [Rect {
            x: 0.0,
            y: 480.0,
            w: 960.0,
            h: 60.0,
        }];

        let mut state = State {
            x: 80.0,
            y: 480.0 - 44.0,
            w: 28.0,
            h: 44.0,
            ..State::default()
        };

        let mut jumped = 0u32;
        let mut landed = 0u32;
        let mut bonked = 0u32;
        let mut trace_hash = 0xcbf29ce484222325u64;

        for frame in 0..180 {
            let mut buttons = Buttons::empty();
            if frame < 120 {
                buttons |= Buttons::RIGHT;
            }
            if frame == 10 {
                buttons |= Buttons::JUMP;
            }

            let ev = step(&params, &world, &mut state, buttons);
            jumped += ev.jumped as u32;
            landed += ev.landed as u32;
            bonked += ev.bonked as u32;

            for value in [
                state.x.round() as i64,
                state.y.round() as i64,
                state.vx.round() as i64,
                state.vy.round() as i64,
                state.grounded as i64,
            ] {
                for b in value.to_le_bytes() {
                    trace_hash ^= b as u64;
                    trace_hash = trace_hash.wrapping_mul(0x100000001b3);
                }
            }
        }

        approx_eq(state.x, 555.0);
        approx_eq(state.y, 436.0);
        approx_eq(state.vx, 0.0);
        approx_eq(state.vy, 0.0);
        assert_eq!(state.grounded, 1);
        assert_eq!(state.jump_was_down, 0);
        approx_eq(state.coyote, params.coyote_time);
        approx_eq(state.jump_buffer, 0.0);
        assert_eq!(jumped, 1);
        assert_eq!(landed, 2);
        assert_eq!(bonked, 0);
        assert_eq!(trace_hash, 0x94db7b2925cfad14);
    }
}
