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

    // Gravity well (proof-of-concept mechanic; 0 = off, 1 = on)
    pub gravity_well_enabled: f32,
    pub well_x: f32,
    pub well_y: f32,
    pub well_influence_radius: f32,
    pub well_core_radius: f32,
    pub well_accel: f32,
    pub well_max_speed: f32,
    // Optional radial velocity damping applied while attracted. Default 0 (off).
    pub well_radial_damping: f32,
    // Degrees to rotate the pull vector away from straight-at-the-center and
    // toward tangential (perpendicular to the radius). 0 = pure pull toward
    // the well (old behavior); 90 = pure sideways push. The rotation direction
    // follows whichever way the player's current velocity is already curving
    // around the well, so it amplifies a natural loop instead of forcing one.
    pub well_swirl_deg: f32,
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

            // Off by default; hosts opt in and position the well for their scene.
            gravity_well_enabled: 0.0,
            well_x: 480.0,
            well_y: 300.0,
            well_influence_radius: 220.0,
            well_core_radius: 34.0,
            well_accel: 2600.0,
            well_max_speed: 900.0,
            well_radial_damping: 0.0,
            well_swirl_deg: 60.0,
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

    // 1 while the gravity well is actively pulling this frame (readback for host rendering).
    pub gravity_active: u8,
    // Internal: 1 once the well has boosted this airborne flight, until landing.
    // Exempts the ordinary air-speed cap from clamping away well-gained momentum
    // (see the horizontal-movement clamp in `step`).
    pub well_boosted: u8,
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Default)]
pub struct Events {
    pub jumped: u8,
    pub landed: u8,
    pub bonked: u8,
    pub gravity_core_death: u8,
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
    if was_grounded {
        // Landing clears the exemption; ordinary caps resume applying on the ground.
        s.well_boosted = 0;
    }

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

    // Skip the ordinary cap only while this airborne flight has been boosted by the
    // gravity well (see below); this is a no-op for all ordinary play, since input
    // alone can never push vx past max_speed. Without this, the cap would instantly
    // erase slingshot velocity the tick after the well imparts it.
    if s.well_boosted == 0 {
        s.vx = clamp(s.vx, -max_speed, max_speed);
    }

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

    // Gravity well: a deliberately game-like radial pull, active only while
    // airborne and holding RUN inside the influence ring. It only nudges
    // vx/vy (never overwrites them), so releasing RUN preserves momentum.
    // Applied after normal air control/gravity but before integration, so
    // the ordinary air_max_speed clamp (already applied above) cannot erase
    // the boosted velocity.
    s.gravity_active = 0;
    if params.gravity_well_enabled >= 0.5 {
        let pcx = s.x + s.w * 0.5;
        let pcy = s.y + s.h * 0.5;
        let wdx = params.well_x - pcx;
        let wdy = params.well_y - pcy;
        let dist = (wdx * wdx + wdy * wdy).sqrt();
        let core_r = params.well_core_radius.max(0.0);

        if dist <= core_r {
            ev.gravity_core_death = 1;
        } else {
            let influence = params.well_influence_radius.max(core_r + 1.0);
            if !was_grounded && run && dist < influence {
                // smoothstep(0,1, 1 - dist/influence): 0 at the boundary, 1 at the core,
                // no discontinuity at dist == influence.
                let t = clamp(1.0 - dist / influence, 0.0, 1.0);
                let strength = t * t * (3.0 - 2.0 * t);
                let inv_dist = 1.0 / dist; // dist > core_r >= 0 here, so this stays finite
                let nx = wdx * inv_dist;
                let ny = wdy * inv_dist;

                // Rotate the pull vector away from straight-at-the-center and toward
                // tangential, so entering the field curves you around it instead of
                // just yanking you toward it. The rotation direction follows the sign
                // of the player's current tangential velocity relative to the well
                // (i.e. which way they're already swinging), so it reinforces a
                // natural loop rather than imposing an arbitrary fixed spin.
                let tangent_vel = -s.vx * ny + s.vy * nx;
                let swirl_sign = if tangent_vel < 0.0 { -1.0 } else { 1.0 };
                let theta = swirl_sign * params.well_swirl_deg.to_radians();
                let (sin_t, cos_t) = theta.sin_cos();
                let pull_x = nx * cos_t - ny * sin_t;
                let pull_y = nx * sin_t + ny * cos_t;

                s.vx += pull_x * params.well_accel * strength * DT;
                s.vy += pull_y * params.well_accel * strength * DT;

                if params.well_radial_damping > 0.0 {
                    let radial = s.vx * nx + s.vy * ny;
                    if radial > 0.0 {
                        let damp = (radial * params.well_radial_damping * DT).min(radial);
                        s.vx -= nx * damp;
                        s.vy -= ny * damp;
                    }
                }

                // Gravity-assisted speed cap: only clamps while actively attracted,
                // so a slingshot released above this speed keeps its exit velocity.
                let cap = params.well_max_speed.max(0.0);
                if cap > 0.0 {
                    let speed = (s.vx * s.vx + s.vy * s.vy).sqrt();
                    if speed > cap {
                        let scale = cap / speed;
                        s.vx *= scale;
                        s.vy *= scale;
                    }
                }

                s.gravity_active = 1;
                s.well_boosted = 1;
            }
        }
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
    use super::{step, Buttons, Params, Rect, State, DT};

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

    // ── Gravity well ────────────────────────────────────────────────

    fn well_params() -> Params {
        let mut p = Params::default();
        p.air_drag = 0.0;
        p.gravity_well_enabled = 1.0;
        p.well_x = 500.0;
        p.well_y = 300.0;
        p.well_influence_radius = 150.0;
        p.well_core_radius = 20.0;
        p.well_accel = 3000.0;
        p.well_max_speed = 100_000.0; // effectively uncapped for these unit tests
        p.well_radial_damping = 0.0;
        p
    }

    fn airborne_state(x: f32, y: f32) -> State {
        State {
            x,
            y,
            w: 28.0,
            h: 44.0,
            grounded: 0,
            ..State::default()
        }
    }

    #[test]
    fn no_gravity_force_outside_influence_radius() {
        let params = well_params();
        let world: [Rect; 0] = [];
        // Player center is far outside the 150px influence radius.
        let mut state = airborne_state(0.0, 0.0);

        let ev = step(&params, &world, &mut state, Buttons::RUN);

        assert_eq!(state.gravity_active, 0);
        assert_eq!(ev.gravity_core_death, 0);
        approx_eq(state.vx, 0.0);
        approx_eq(state.vy, params.gravity_down * DT);
    }

    #[test]
    fn no_gravity_force_when_run_not_held() {
        let params = well_params();
        let world: [Rect; 0] = [];
        // Player center is inside the influence radius (distance ~50px) but RUN is not held.
        let mut state = airborne_state(500.0 - 14.0 - 50.0, 300.0 - 22.0);

        let ev = step(&params, &world, &mut state, Buttons::empty());

        assert_eq!(state.gravity_active, 0);
        assert_eq!(ev.gravity_core_death, 0);
        approx_eq(state.vx, 0.0);
        approx_eq(state.vy, params.gravity_down * DT);
    }

    #[test]
    fn attraction_bends_velocity_toward_well_when_active() {
        let params = well_params();
        let world: [Rect; 0] = [];
        // Player center 100px directly "left" of the well (well is at +x from player).
        let mut state = airborne_state(500.0 - 14.0 - 100.0, 300.0 - 22.0);

        let ev = step(&params, &world, &mut state, Buttons::RUN);

        assert_eq!(state.gravity_active, 1);
        assert_eq!(ev.gravity_core_death, 0);
        // Pulled toward +x (toward the well): vx increases.
        assert!(
            state.vx > 1.0,
            "expected vx pulled toward well, got {}",
            state.vx
        );
        // The pull is rotated toward tangential (see well_swirl_deg), so even a purely
        // horizontal approach picks up a vertical component instead of a straight-line
        // yank toward the center.
        assert!(
            state.vy.abs() > 1.0,
            "expected the swirl to add a tangential (vertical) component, got {}",
            state.vy
        );
    }

    #[test]
    fn releasing_run_preserves_velocity_except_normal_forces() {
        let params = well_params();
        let world: [Rect; 0] = [];
        let mut state = airborne_state(500.0 - 14.0 - 60.0, 300.0 - 22.0);

        // Hold RUN until the well pushes vx past the ordinary air cap. The swirl now
        // curves the approach (rather than a straight line to the center), so capture
        // the first qualifying frame instead of assuming a fixed frame count still has
        // the player inside the influence ring.
        let mut vx_boosted = 0.0;
        let mut vy_boosted = 0.0;
        let mut boosted = false;
        for _ in 0..60 {
            let ev = step(&params, &world, &mut state, Buttons::RUN);
            assert_eq!(ev.gravity_core_death, 0);
            if state.gravity_active == 1 && state.vx > params.air_max_speed {
                vx_boosted = state.vx;
                vy_boosted = state.vy;
                boosted = true;
                break;
            }
        }
        assert!(
            boosted,
            "expected the well to push vx past the ordinary air cap"
        );

        // Release RUN: no horizontal input at all, so vx must be untouched by the
        // ordinary air-speed clamp. vy only changes by the normal gravity term.
        let ev = step(&params, &world, &mut state, Buttons::empty());

        assert_eq!(state.gravity_active, 0);
        assert_eq!(ev.gravity_core_death, 0);
        approx_eq(state.vx, vx_boosted);
        let g = if vy_boosted < 0.0 {
            params.gravity_up
        } else {
            params.gravity_down
        };
        approx_eq(state.vy, vy_boosted + g * DT);
    }

    #[test]
    fn force_remains_finite_near_core_boundary() {
        let params = well_params();
        let world: [Rect; 0] = [];
        // Just outside the lethal core boundary.
        let mut state =
            airborne_state(500.0 - 14.0 - (params.well_core_radius + 0.5), 300.0 - 22.0);

        let ev = step(&params, &world, &mut state, Buttons::RUN);

        assert_eq!(ev.gravity_core_death, 0);
        assert!(state.vx.is_finite());
        assert!(state.vy.is_finite());
        assert!(state.vx.abs() < params.well_max_speed + 1.0);
        assert!(state.vy.abs() < params.well_max_speed + 1.0);
    }

    #[test]
    fn entering_lethal_core_triggers_death_event() {
        let params = well_params();
        let world: [Rect; 0] = [];
        // Player center exactly at the well center, well inside the core radius.
        let mut state = airborne_state(500.0 - 14.0, 300.0 - 22.0);

        let ev = step(&params, &world, &mut state, Buttons::RUN);

        assert_eq!(ev.gravity_core_death, 1);
    }

    #[test]
    fn deterministic_gravity_well_input_sequence_hash() {
        let mut params = well_params();
        params.world_w = 960.0;
        // Positioned right along this jump's natural apex/path so RUN actually
        // engages the well (verified below via `any_active`), instead of a well
        // placed somewhere the trace never reaches.
        params.well_x = 200.0;
        params.well_y = 400.0;
        params.well_influence_radius = 120.0;
        params.well_core_radius = 15.0;

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

        let mut trace_hash = 0xcbf29ce484222325u64;
        let mut deaths = 0u32;
        let mut any_active = false;

        for frame in 0..80 {
            let mut buttons = Buttons::RIGHT;
            if frame == 10 {
                buttons |= Buttons::JUMP;
            }
            // Hold RUN (gravity-well activation) while airborne and passing
            // through the well's influence ring, then release mid-arc to test
            // the slingshot exit.
            if (12..26).contains(&frame) {
                buttons |= Buttons::RUN;
            }

            let ev = step(&params, &world, &mut state, buttons);
            deaths += ev.gravity_core_death as u32;
            any_active |= state.gravity_active != 0;

            for value in [
                state.x.round() as i64,
                state.y.round() as i64,
                state.vx.round() as i64,
                state.vy.round() as i64,
                state.grounded as i64,
                state.gravity_active as i64,
            ] {
                for b in value.to_le_bytes() {
                    trace_hash ^= b as u64;
                    trace_hash = trace_hash.wrapping_mul(0x100000001b3);
                }
            }
        }

        assert_eq!(deaths, 0);
        assert!(
            any_active,
            "expected the well to actually engage during this trace"
        );
        assert_eq!(trace_hash, 0x86997869f631b459);
    }
}
