use wasm_bindgen::prelude::*;
use platlab_core::{Buttons, Params, Rect, State};

#[wasm_bindgen]
pub struct Core {
    params: Params,
    state: State,
    world: Vec<Rect>,
}

#[wasm_bindgen]
impl Core {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Core {
        let mut params = Params::default();
        params.world_w = 960.0;
        params.world_wrap_mode = 2.0;

        let mut state = State::default();
        state.x = 80.0;
        state.y = 480.0 - 44.0;
        state.w = 28.0;
        state.h = 44.0;

        let world = vec![Rect { x: 0.0, y: 480.0, w: 960.0, h: 60.0 }];

        Core { params, state, world }
    }

    pub fn reset(&mut self, x: f32, y: f32, w: f32, h: f32) {
        self.state = State::default();
        self.state.x = x;
        self.state.y = y;
        self.state.w = w;
        self.state.h = h;
    }

    /// Packed rects: [x,y,w,h, x,y,w,h, ...]
    pub fn set_world(&mut self, rects: Box<[f32]>) {
        let a = rects.into_vec();
        self.world.clear();
        for c in a.chunks_exact(4) {
            self.world.push(Rect { x: c[0], y: c[1], w: c[2], h: c[3] });
        }
    }

    /// Minimal params update: expects JSON with matching field names.
    /// (You’ll likely replace this with serde_json later.)
    pub fn set_params_json(&mut self, json: &str) {
        if let Ok(v) = js_sys::JSON::parse(json) {
            let o = v.unchecked_into::<js_sys::Object>();
            macro_rules! setf {
                ($k:literal, $field:ident) => {
                    if let Ok(val) = js_sys::Reflect::get(&o, &JsValue::from_str($k)) {
                        if let Some(f) = val.as_f64() {
                            self.params.$field = f as f32;
                        }
                    }
                };
            }
            setf!("ground_max_speed", ground_max_speed);
            setf!("ground_accel", ground_accel);
            setf!("ground_decel", ground_decel);
            setf!("ground_friction", ground_friction);
            setf!("run_multiplier", run_multiplier);
            setf!("air_max_speed", air_max_speed);
            setf!("air_accel", air_accel);
            setf!("air_decel", air_decel);
            setf!("air_drag", air_drag);
            setf!("gravity_up", gravity_up);
            setf!("gravity_down", gravity_down);
            setf!("terminal_velocity", terminal_velocity);
            setf!("fast_fall_multiplier", fast_fall_multiplier);
            setf!("jump_velocity", jump_velocity);
            setf!("jump_cut_multiplier", jump_cut_multiplier);
            setf!("coyote_time", coyote_time);
            setf!("jump_buffer", jump_buffer);
            setf!("snap_to_ground", snap_to_ground);
            setf!("max_step_px", max_step_px);
            setf!("world_w", world_w);
            setf!("world_wrap_mode", world_wrap_mode);
        }
    }

    /// Step once (60Hz) and return state+events as a JS object.
    pub fn step(&mut self, input_bits: u8) -> JsValue {
        let buttons = Buttons::from_bits_truncate(input_bits);
        let ev = platlab_core::step(&self.params, &self.world, &mut self.state, buttons);

        let obj = js_sys::Object::new();
        js_sys::Reflect::set(&obj, &"x".into(), &JsValue::from_f64(self.state.x as f64)).unwrap();
        js_sys::Reflect::set(&obj, &"y".into(), &JsValue::from_f64(self.state.y as f64)).unwrap();
        js_sys::Reflect::set(&obj, &"vx".into(), &JsValue::from_f64(self.state.vx as f64)).unwrap();
        js_sys::Reflect::set(&obj, &"vy".into(), &JsValue::from_f64(self.state.vy as f64)).unwrap();
        js_sys::Reflect::set(&obj, &"grounded".into(), &JsValue::from_bool(self.state.grounded != 0)).unwrap();
        js_sys::Reflect::set(&obj, &"coyote".into(), &JsValue::from_f64(self.state.coyote as f64)).unwrap();
        js_sys::Reflect::set(&obj, &"jump_buffer".into(), &JsValue::from_f64(self.state.jump_buffer as f64)).unwrap();
        js_sys::Reflect::set(&obj, &"jumped".into(), &JsValue::from_bool(ev.jumped != 0)).unwrap();
        js_sys::Reflect::set(&obj, &"landed".into(), &JsValue::from_bool(ev.landed != 0)).unwrap();
        js_sys::Reflect::set(&obj, &"bonked".into(), &JsValue::from_bool(ev.bonked != 0)).unwrap();

        JsValue::from(obj)
    }
}
