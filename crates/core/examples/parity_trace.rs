use platlab_core::{step, Buttons, Params, Rect, State};

fn main() {
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

    let mut jumped: u32 = 0;
    let mut landed: u32 = 0;
    let mut bonked: u32 = 0;

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
    }

    println!(
        "{{\"x\":{},\"y\":{},\"vx\":{},\"vy\":{},\"grounded\":{},\"jumped\":{},\"landed\":{},\"bonked\":{}}}",
        state.x, state.y, state.vx, state.vy, state.grounded, jumped, landed, bonked
    );
}
