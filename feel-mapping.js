/**
 * Feel control definitions and derived parameter mapping.
 *
 * Maps player-perceived "feel" controls to raw physics engine parameters.
 * Some controls are 1:1 with raw params, while others (like jump height
 * and time to apex) are derived from multiple raw params.
 *
 * Key relationships:
 *   jump_height  = jump_velocity^2 / (2 * gravity_up)
 *   time_to_apex = jump_velocity / gravity_up
 *   fall_ratio   = gravity_down / gravity_up
 */

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

// --- Derived metric getters ---

/** Jump height in pixels: h = v0^2 / (2 * g_up) */
export function getJumpHeight(params) {
  const v0 = params.jump_velocity;
  const g = params.gravity_up;
  if (g <= 0) return 0;
  return (v0 * v0) / (2 * g);
}

/** Time to reach jump apex in seconds: t = v0 / g_up */
export function getTimeToApex(params) {
  const v0 = params.jump_velocity;
  const g = params.gravity_up;
  if (g <= 0) return 0;
  return v0 / g;
}

/** Ratio of fall gravity to rise gravity */
export function getFallRatio(params) {
  if (params.gravity_up <= 0) return 1;
  return params.gravity_down / params.gravity_up;
}

// --- Derived metric setters ---

/** Set jump height by adjusting jump_velocity (gravity_up held constant). */
export function setJumpHeight(params, h) {
  const g = params.gravity_up;
  if (g <= 0) return;
  params.jump_velocity = clamp(Math.sqrt(2 * g * Math.max(0, h)), 0, 2000);
}

/**
 * Set time to apex by adjusting both gravity_up and jump_velocity.
 * Preserves current jump height: g = 2h/t^2, v = 2h/t.
 */
export function setTimeToApex(params, t) {
  if (t <= 0.001) return;
  const h = getJumpHeight(params);
  if (h <= 0) return;
  params.gravity_up = clamp((2 * h) / (t * t), 1, 10000);
  params.jump_velocity = clamp((2 * h) / t, 0, 2000);
  // Keep fall ratio stable by scaling gravity_down proportionally
  const prevRatio = getFallRatio(params);
  params.gravity_down = clamp(params.gravity_up * prevRatio, 0, 12000);
}

/** Set fall ratio by adjusting gravity_down (gravity_up held constant). */
export function setFallRatio(params, ratio) {
  params.gravity_down = clamp(params.gravity_up * Math.max(0, ratio), 0, 12000);
}

// --- Feel control group definitions ---

export const FEEL_GROUPS = [
  {
    id: "jump",
    label: "Jump Feel",
    controls: [
      {
        id: "jump_height",
        label: "Jump Height",
        help: "How high the player jumps",
        unit: "px",
        min: 0,
        max: 400,
        step: 1,
        fmt: (v) => v.toFixed(0),
        get: getJumpHeight,
        set: setJumpHeight,
      },
      {
        id: "time_to_apex",
        label: "Time to Apex",
        help: "Time to reach peak height",
        unit: "s",
        min: 0.05,
        max: 1.0,
        step: 0.005,
        fmt: (v) => v.toFixed(3),
        get: getTimeToApex,
        set: setTimeToApex,
      },
      {
        id: "fall_ratio",
        label: "Fall Speed",
        help: "Fall vs rise speed \u2014 higher = snappier landing",
        unit: "\u00d7",
        min: 0.5,
        max: 4.0,
        step: 0.05,
        fmt: (v) => v.toFixed(2),
        get: getFallRatio,
        set: setFallRatio,
      },
      {
        id: "jump_cut_multiplier",
        label: "Jump Cut",
        help: "Early release reduction \u2014 lower = more height control",
        min: 0.05,
        max: 1.0,
        step: 0.01,
        fmt: (v) => v.toFixed(2),
        param: "jump_cut_multiplier",
      },
    ],
  },
  {
    id: "air",
    label: "Air Control",
    controls: [
      {
        id: "air_accel",
        label: "Acceleration",
        help: "How quickly the player accelerates mid-air",
        min: 0,
        max: 12000,
        step: 50,
        fmt: (v) => v.toFixed(0),
        param: "air_accel",
      },
      {
        id: "air_max_speed",
        label: "Max Speed",
        help: "Maximum horizontal speed while airborne",
        min: 0,
        max: 2000,
        step: 5,
        fmt: (v) => v.toFixed(0),
        param: "air_max_speed",
      },
      {
        id: "air_decel",
        label: "Direction Change",
        help: "Deceleration when reversing direction in air",
        min: 0,
        max: 12000,
        step: 50,
        fmt: (v) => v.toFixed(0),
        param: "air_decel",
      },
      {
        id: "air_drag",
        label: "Air Drag",
        help: "Passive slowdown while airborne",
        min: 0,
        max: 8000,
        step: 25,
        fmt: (v) => v.toFixed(0),
        param: "air_drag",
      },
    ],
  },
  {
    id: "ground",
    label: "Ground Feel",
    controls: [
      {
        id: "ground_max_speed",
        label: "Max Speed",
        help: "Maximum running speed on the ground",
        min: 50,
        max: 2000,
        step: 5,
        fmt: (v) => v.toFixed(0),
        param: "ground_max_speed",
      },
      {
        id: "ground_accel",
        label: "Acceleration",
        help: "How quickly the player reaches full speed",
        min: 0,
        max: 12000,
        step: 50,
        fmt: (v) => v.toFixed(0),
        param: "ground_accel",
      },
      {
        id: "ground_decel",
        label: "Deceleration",
        help: "How quickly the player slows when changing direction",
        min: 0,
        max: 12000,
        step: 50,
        fmt: (v) => v.toFixed(0),
        param: "ground_decel",
      },
      {
        id: "ground_friction",
        label: "Friction",
        help: "Passive slowdown when not pressing a direction",
        min: 0,
        max: 20000,
        step: 50,
        fmt: (v) => v.toFixed(0),
        param: "ground_friction",
      },
      {
        id: "run_multiplier",
        label: "Run Boost",
        help: "Speed multiplier when holding run button",
        unit: "\u00d7",
        min: 1.0,
        max: 2.5,
        step: 0.01,
        fmt: (v) => v.toFixed(2),
        param: "run_multiplier",
      },
    ],
  },
  {
    id: "forgiveness",
    label: "Forgiveness",
    controls: [
      {
        id: "coyote_time",
        label: "Coyote Time",
        help: "Grace period to jump after leaving a ledge",
        unit: "s",
        min: 0.0,
        max: 0.25,
        step: 0.005,
        fmt: (v) => v.toFixed(3),
        param: "coyote_time",
      },
      {
        id: "jump_buffer",
        label: "Jump Buffer",
        help: "How early you can press jump before landing",
        unit: "s",
        min: 0.0,
        max: 0.25,
        step: 0.005,
        fmt: (v) => v.toFixed(3),
        param: "jump_buffer",
      },
      {
        id: "snap_to_ground",
        label: "Ground Snap",
        help: "Snap range for ground detection",
        unit: "px",
        min: 0.0,
        max: 20.0,
        step: 0.5,
        fmt: (v) => v.toFixed(1),
        param: "snap_to_ground",
      },
    ],
  },
];

/** Read a feel control's current value from the params object. */
export function readFeelControl(control, params) {
  if (control.get) return control.get(params);
  if (control.param) return params[control.param];
  return 0;
}

/** Write a feel control's value to the params object. */
export function writeFeelControl(control, params, value) {
  if (control.set) {
    control.set(params, value);
  } else if (control.param) {
    params[control.param] = value;
  }
}
