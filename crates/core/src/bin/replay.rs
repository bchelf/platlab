use std::fs;
use std::path::PathBuf;

use platlab_core::{step, Buttons, Params, Rect, State};

fn section<'a>(src: &'a str, key: &str, open: char, close: char) -> &'a str {
    let k = format!("\"{key}\"");
    let ki = src.find(&k).unwrap_or_else(|| panic!("missing key: {key}"));
    let rest = &src[ki + k.len()..];
    let oi_rel = rest
        .find(open)
        .unwrap_or_else(|| panic!("missing section opener for: {key}"));
    let oi = ki + k.len() + oi_rel;

    let mut depth = 0i32;
    let mut end = oi;
    for (i, ch) in src[oi..].char_indices() {
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth -= 1;
            if depth == 0 {
                end = oi + i;
                break;
            }
        }
    }
    &src[oi + 1..end]
}

fn number(src: &str, key: &str, default: Option<f32>) -> f32 {
    let k = format!("\"{key}\"");
    if let Some(ki) = src.find(&k) {
        let rest = &src[ki + k.len()..];
        let ci = rest
            .find(':')
            .unwrap_or_else(|| panic!("missing ':' for key {key}"));
        let mut token = String::new();
        for ch in rest[ci + 1..].chars() {
            if ch.is_ascii_digit() || ch == '-' || ch == '+' || ch == '.' || ch == 'e' || ch == 'E' {
                token.push(ch);
            } else if !token.is_empty() {
                break;
            }
        }
        return token
            .parse::<f32>()
            .unwrap_or_else(|_| panic!("invalid number for key {key}"));
    }
    default.unwrap_or_else(|| panic!("missing key: {key}"))
}

fn integer(src: &str, key: &str, default: Option<i32>) -> i32 {
    number(src, key, default.map(|v| v as f32)).round() as i32
}

fn parse_world(src: &str) -> Vec<Rect> {
    let arr = section(src, "world", '[', ']');
    let mut out = Vec::new();
    let mut i = 0usize;
    while let Some(rel) = arr[i..].find('{') {
        let start = i + rel;
        let mut depth = 0i32;
        let mut end = start;
        for (j, ch) in arr[start..].char_indices() {
            if ch == '{' {
                depth += 1;
            } else if ch == '}' {
                depth -= 1;
                if depth == 0 {
                    end = start + j;
                    break;
                }
            }
        }
        let obj = &arr[start + 1..end];
        out.push(Rect {
            x: number(obj, "x", None),
            y: number(obj, "y", None),
            w: number(obj, "w", None),
            h: number(obj, "h", None),
        });
        i = end + 1;
    }
    out
}

fn parse_inputs(src: &str) -> Vec<u8> {
    let arr = section(src, "inputs", '[', ']');
    arr.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.parse::<u8>().expect("invalid input bit"))
        .collect()
}

fn parse_params(src: &str) -> Params {
    let p = section(src, "params", '{', '}');
    Params {
        ground_max_speed: number(p, "ground_max_speed", Some(260.0)),
        ground_accel: number(p, "ground_accel", Some(1800.0)),
        ground_decel: number(p, "ground_decel", Some(2200.0)),
        ground_friction: number(p, "ground_friction", Some(2600.0)),
        run_multiplier: number(p, "run_multiplier", Some(1.35)),
        air_max_speed: number(p, "air_max_speed", Some(220.0)),
        air_accel: number(p, "air_accel", Some(1200.0)),
        air_decel: number(p, "air_decel", Some(900.0)),
        air_drag: number(p, "air_drag", Some(0.0)),
        gravity_up: number(p, "gravity_up", Some(1500.0)),
        gravity_down: number(p, "gravity_down", Some(2300.0)),
        terminal_velocity: number(p, "terminal_velocity", Some(1200.0)),
        fast_fall_multiplier: number(p, "fast_fall_multiplier", Some(1.35)),
        jump_velocity: number(p, "jump_velocity", Some(520.0)),
        jump_cut_multiplier: number(p, "jump_cut_multiplier", Some(0.45)),
        coyote_time: number(p, "coyote_time", Some(0.085)),
        jump_buffer: number(p, "jump_buffer", Some(0.1)),
        snap_to_ground: number(p, "snap_to_ground", Some(6.0)),
        max_step_px: number(p, "max_step_px", Some(6.0)),
        world_w: number(p, "world_w", Some(960.0)),
        world_wrap_mode: number(p, "world_wrap_mode", Some(1.0)),
    }
}

fn parse_state(src: &str) -> State {
    let s = section(src, "initial_state", '{', '}');
    State {
        x: number(s, "x", None),
        y: number(s, "y", None),
        vx: number(s, "vx", Some(0.0)),
        vy: number(s, "vy", Some(0.0)),
        w: number(s, "w", None),
        h: number(s, "h", None),
        grounded: integer(s, "grounded", Some(0)) as u8,
        coyote: number(s, "coyote", Some(0.0)),
        jump_buffer: number(s, "jump_buffer", Some(0.0)),
        jump_was_down: integer(s, "jump_was_down", Some(0)) as u8,
    }
}

fn main() {
    let path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .expect("usage: cargo run -p platlab_core --bin replay -- <replay.json>");
    let raw = fs::read_to_string(path).expect("failed to read replay json");

    let params = parse_params(&raw);
    let world = parse_world(&raw);
    let mut state = parse_state(&raw);
    let inputs = parse_inputs(&raw);

    println!("frame,x,y,vx,vy,grounded");
    for (frame, bits) in inputs.iter().enumerate() {
        let buttons = Buttons::from_bits_truncate(*bits);
        let _ = step(&params, &world, &mut state, buttons);
        println!(
            "{},{},{},{},{},{}",
            frame, state.x, state.y, state.vx, state.vy, state.grounded
        );
    }
}
