import init, { Core } from "./pkg/platlab_wasm.js";
import { PRESETS } from "./presets.js";
import { FEEL_GROUPS, readFeelControl, writeFeelControl } from "./feel-mapping.js";
import { MotionGraph } from "./motion-graph.js";

const LEFT = 1 << 0, RIGHT = 1 << 1, DOWN = 1 << 2, RUN = 1 << 3, JUMP = 1 << 4;
const FIXED_DT = 1 / 60;

let DEFAULT_PARAMS = {
  sim_hz: 60, render_fps_cap: 120,
  world_w: 960, world_h: 540,
  player_w: 28, player_h: 44,
  ground_max_speed: 260, ground_accel: 1800, ground_decel: 2200,
  ground_friction: 2600, run_multiplier: 1.35,
  air_max_speed: 220, air_accel: 1200, air_decel: 900, air_drag: 0,
  gravity_up: 1500, gravity_down: 2300, terminal_velocity: 1200,
  fast_fall_multiplier: 1.35,
  jump_velocity: 520, jump_cut_multiplier: 0.45,
  coyote_time: 0.085, jump_buffer: 0.1,
  snap_to_ground: 6, max_step_px: 6,
  show_debug: 1, world_wrap_mode: 2,

  gravity_well_enabled: 1, well_x: 560, well_y: 260,
  well_influence_radius: 150, well_core_radius: 30,
  well_accel: 4200, well_max_speed: 900, well_radial_damping: 0,
};

const RAW_PARAM_SPECS = [
  ["sim_hz",             60, 60, 1,     v => v.toFixed(0)],
  ["render_fps_cap",     30, 240, 1,    v => v.toFixed(0)],
  ["player_w",           10, 60, 1,     v => v.toFixed(0)],
  ["player_h",           20, 80, 1,     v => v.toFixed(0)],
  ["ground_max_speed",   50, 2000, 5,   v => v.toFixed(0)],
  ["ground_accel",       0, 12000, 50,  v => v.toFixed(0)],
  ["ground_decel",       0, 12000, 50,  v => v.toFixed(0)],
  ["ground_friction",    0, 20000, 50,  v => v.toFixed(0)],
  ["run_multiplier",     1.0, 2.5, 0.01, v => v.toFixed(2)],
  ["air_max_speed",      0, 2000, 5,    v => v.toFixed(0)],
  ["air_accel",          0, 12000, 50,  v => v.toFixed(0)],
  ["air_decel",          0, 12000, 50,  v => v.toFixed(0)],
  ["air_drag",           0, 8000, 25,   v => v.toFixed(0)],
  ["gravity_up",         0, 10000, 50,  v => v.toFixed(0)],
  ["gravity_down",       0, 12000, 50,  v => v.toFixed(0)],
  ["terminal_velocity",  0, 8000, 25,   v => v.toFixed(0)],
  ["fast_fall_multiplier", 1.0, 3.0, 0.01, v => v.toFixed(2)],
  ["jump_velocity",      0, 2000, 10,   v => v.toFixed(0)],
  ["jump_cut_multiplier", 0.05, 1.0, 0.01, v => v.toFixed(2)],
  ["coyote_time",        0.0, 0.25, 0.005, v => v.toFixed(3)],
  ["jump_buffer",        0.0, 0.25, 0.005, v => v.toFixed(3)],
  ["snap_to_ground",     0.0, 20.0, 0.5, v => v.toFixed(1)],
  ["max_step_px",        1.0, 20.0, 0.5, v => v.toFixed(1)],
  ["show_debug",         0.0, 1.0, 1.0, v => v.toFixed(0)],
  ["world_wrap_mode",    1.0, 2.0, 1.0, v => v.toFixed(0)],
  ["gravity_well_enabled", 0.0, 1.0, 1.0, v => v.toFixed(0)],
  ["well_x",             0, 960, 5,   v => v.toFixed(0)],
  ["well_y",             0, 540, 5,   v => v.toFixed(0)],
  ["well_influence_radius", 20, 400, 5, v => v.toFixed(0)],
  ["well_core_radius",   5, 100, 1,   v => v.toFixed(0)],
  ["well_accel",         0, 12000, 50, v => v.toFixed(0)],
  ["well_max_speed",     0, 2500, 25,  v => v.toFixed(0)],
  ["well_radial_damping", 0, 10, 0.05, v => v.toFixed(2)],
];

const CORE_PARAM_KEYS = [
  "ground_max_speed", "ground_accel", "ground_decel", "ground_friction",
  "run_multiplier", "air_max_speed", "air_accel", "air_decel", "air_drag",
  "gravity_up", "gravity_down", "terminal_velocity", "fast_fall_multiplier",
  "jump_velocity", "jump_cut_multiplier", "coyote_time", "jump_buffer",
  "snap_to_ground", "max_step_px", "world_w", "world_wrap_mode",
  "gravity_well_enabled", "well_x", "well_y", "well_influence_radius",
  "well_core_radius", "well_accel", "well_max_speed", "well_radial_damping",
];

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

async function loadDefaultParams() {
  for (const url of ["/configs/default_params.json", "../../configs/default_params.json",
                      "../configs/default_params.json", "configs/default_params.json"]) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      return await res.json();
    } catch { /* next */ }
  }
  return null;
}

function encodeParamsToHash(p) {
  const diff = {};
  for (const k in DEFAULT_PARAMS) {
    const pv = p[k];
    if (typeof pv === "number" && Math.abs(pv - DEFAULT_PARAMS[k]) > 1e-9) diff[k] = pv;
  }
  return "#p=" + btoa(unescape(encodeURIComponent(JSON.stringify(diff))));
}

function decodeParamsFromHash() {
  const m = (location.hash || "").match(/#p=([A-Za-z0-9+/=]+)/);
  if (!m) return null;
  try {
    const diff = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    const out = { ...DEFAULT_PARAMS };
    for (const k in diff) if (k in out) out[k] = Number(diff[k]);
    return out;
  } catch { return null; }
}

// Compact gravity-well test arrangement: a safe ground/start platform, open air to
// swing through, and a destination platform placed well beyond normal jump
// height/reach so it can only be reached by curving around the well and releasing
// RUN at the right moment.
function buildWorldRects(worldW, worldH) {
  const groundY = worldH - 60;
  const destW = Math.floor(worldW * 0.156);
  const destX = Math.floor(worldW * 0.792);
  const destY = Math.floor(worldH * 0.278);
  return {
    groundY,
    platforms: [
      { x: 0, y: groundY, w: worldW, h: 60 },
      { x: destX, y: destY, w: destW, h: 18 },
    ],
  };
}

(async function main() {
  await init();
  const core = new Core();

  const loadedDefaults = await loadDefaultParams();
  if (loadedDefaults && typeof loadedDefaults === "object")
    DEFAULT_PARAMS = { ...DEFAULT_PARAMS, ...loadedDefaults };
  if (DEFAULT_PARAMS.world_wrap_mode === undefined) DEFAULT_PARAMS.world_wrap_mode = 2.0;

  let params = decodeParamsFromHash() || { ...DEFAULT_PARAMS };

  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  const hud = document.getElementById("hud");
  const statusEl = document.getElementById("status");
  const feelControlsEl = document.getElementById("feelControls");
  const advancedBody = document.getElementById("advancedBody");
  const presetsEl = document.getElementById("presets");

  const input = { left: false, right: false, down: false, run: false, jump: false, escPressed: false };

  let worldW = Math.round(params.world_w);
  let worldH = Math.round(params.world_h);
  let { groundY, platforms } = buildWorldRects(worldW, worldH);

  let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  let paused = false, stepOnce = false, acc = 0, last = performance.now();
  let st = null;
  let jumpStartY = 0, peakY = 0, airTime = 0, lastJumpHeight = 0, lastAirTime = 0;
  let prevGrounded = false;
  let activePreset = "default";
  let gravityCoreDeaths = 0;

  // Ghost trail: recent player positions
  const ghostTrail = [];
  const GHOST_MAX = 120;

  // Auto-play state
  const auto = {
    enabled: true,
    dir: 1,
    jumpTimer: 60,
    jumpHoldLeft: 0,
    sprint: false,
    tick: 0,
  };

  function autoPlayStep() {
    if (!auto.enabled || !st) return;
    auto.tick++;
    const grounded = !!st.grounded;

    // Only change direction when grounded — commit to direction during jumps
    if (grounded) {
      if (st.x > worldW - 100 && auto.dir > 0) auto.dir = -1;
      if (st.x < 100 && auto.dir < 0) auto.dir = 1;
    }

    input.left = auto.dir < 0;
    input.right = auto.dir > 0;

    // Jump countdown (only ticks while grounded)
    if (grounded && auto.jumpTimer > 0) auto.jumpTimer--;

    // Start a new jump when grounded and timer expired
    if (auto.jumpTimer <= 0 && grounded && auto.jumpHoldLeft <= 0) {
      const durations = [6, 10, 18, 30, 30]; // vary hold for short/full jumps
      auto.jumpHoldLeft = durations[Math.floor(Math.random() * durations.length)];
      auto.jumpTimer = 40 + Math.floor(Math.random() * 80);
    }

    // Hold or release jump
    if (auto.jumpHoldLeft > 0) {
      input.jump = true;
      auto.jumpHoldLeft--;
    } else {
      input.jump = false;
    }

    // Sprint in phases (~2s on, ~2s off)
    auto.sprint = (auto.tick % 240) < 120;
    input.run = auto.sprint;

    // Occasional fast-fall when descending
    input.down = !grounded && st.vy > 100 && (auto.tick % 200) < 25;
  }

  function setAutoEnabled(on) {
    auto.enabled = on;
    const btn = document.getElementById("btnAuto");
    if (on) {
      btn.textContent = "AUTO";
      btn.classList.add("active");
    } else {
      btn.textContent = "MANUAL";
      btn.classList.remove("active");
      input.left = false; input.right = false;
      input.down = false; input.run = false; input.jump = false;
    }
    const hint = document.createElement("span");
    hint.className = "shortcut";
    hint.textContent = "Tab";
    btn.appendChild(hint);
    setStatus(on ? "Auto-play on" : "Manual control", 800);
  }

  // Motion graph
  const motionGraph = new MotionGraph(document.getElementById("graph"));
  motionGraph.setGroundY(groundY);

  // Maps for syncing UI elements
  const feelSliders = new Map();   // controlId -> { input, valueEl }
  const rawSliders = new Map();    // paramName -> { input, valueEl }

  function setStatus(msg, ms = 1200) {
    statusEl.textContent = msg;
    if (ms > 0) setTimeout(() => { if (statusEl.textContent === msg) statusEl.textContent = ""; }, ms);
  }

  function resizeCanvas() {
    const r = document.querySelector(".sim-pane").getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
    canvas.width = Math.floor(r.width * dpr);
    canvas.height = Math.floor(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function applyCoreParams() {
    const p = {};
    for (const k of CORE_PARAM_KEYS) p[k] = params[k];
    core.set_params_json(JSON.stringify(p));
  }

  function applyWorld() {
    const packed = [];
    for (const r of platforms) packed.push(r.x, r.y, r.w, r.h);
    core.set_world(new Float32Array(packed));
  }

  function respawn() {
    core.reset(80, groundY - params.player_h, params.player_w, params.player_h);
    st = core.step(0);
    jumpStartY = st.y; peakY = st.y;
    airTime = 0; lastJumpHeight = 0; lastAirTime = 0;
    prevGrounded = !!st.grounded;
    ghostTrail.length = 0;
    motionGraph.clear();
    setStatus("Respawned");
  }

  function rebuildWorld() {
    worldW = Math.round(params.world_w);
    worldH = Math.round(params.world_h);
    ({ groundY, platforms } = buildWorldRects(worldW, worldH));
    motionGraph.setGroundY(groundY);
    applyCoreParams();
    applyWorld();
    respawn();
  }

  function markPresetActive(id) {
    activePreset = id;
    for (const btn of presetsEl.children) {
      btn.classList.toggle("active", btn.dataset.preset === id);
    }
  }

  function onParamChanged() {
    activePreset = null;
    markPresetActive(null);
  }

  // ── Sync all UI from params ────────────────────────────

  function syncAllControls() {
    // Feel controls
    for (const group of FEEL_GROUPS) {
      for (const ctrl of group.controls) {
        const entry = feelSliders.get(ctrl.id);
        if (!entry) continue;
        const val = readFeelControl(ctrl, params);
        entry.input.value = String(val);
        const unit = ctrl.unit ? " " + ctrl.unit : "";
        entry.valueEl.textContent = ctrl.fmt(val) + unit;
      }
    }
    // Raw sliders
    for (const [name, , , , fmt] of RAW_PARAM_SPECS) {
      const entry = rawSliders.get(name);
      if (!entry) continue;
      entry.input.value = String(params[name]);
      entry.valueEl.textContent = fmt(params[name]);
    }
  }

  // ── Build presets ──────────────────────────────────────

  function buildPresets() {
    presetsEl.innerHTML = "";
    for (const preset of PRESETS) {
      const btn = document.createElement("div");
      btn.className = "preset-btn" + (preset.id === activePreset ? " active" : "");
      btn.dataset.preset = preset.id;
      btn.innerHTML = `<div class="preset-name">${preset.name}</div><div class="preset-desc">${preset.desc}</div>`;
      btn.addEventListener("click", () => {
        params = { ...DEFAULT_PARAMS, ...preset.params };
        syncAllControls();
        rebuildWorld();
        markPresetActive(preset.id);
        setStatus("Preset: " + preset.name);
      });
      presetsEl.appendChild(btn);
    }
  }

  // ── Build feel controls ────────────────────────────────

  function buildFeelControls() {
    feelControlsEl.innerHTML = "";
    feelSliders.clear();

    for (const group of FEEL_GROUPS) {
      const card = document.createElement("div");
      card.className = "feel-group";

      const header = document.createElement("div");
      header.className = "feel-group-header";
      header.innerHTML = `<span>${group.label}</span><span class="feel-group-chevron">&#x25be;</span>`;
      header.addEventListener("click", () => card.classList.toggle("collapsed"));
      card.appendChild(header);

      const body = document.createElement("div");
      body.className = "feel-group-body";

      for (const ctrl of group.controls) {
        const el = document.createElement("div");
        el.className = "feel-control";

        const curVal = readFeelControl(ctrl, params);
        const unit = ctrl.unit ? " " + ctrl.unit : "";

        const head = document.createElement("div");
        head.className = "feel-control-head";
        const label = document.createElement("span");
        label.className = "feel-control-label";
        label.textContent = ctrl.label;
        const valueEl = document.createElement("span");
        valueEl.className = "feel-control-value";
        valueEl.textContent = ctrl.fmt(curVal) + unit;
        head.appendChild(label);
        head.appendChild(valueEl);

        const help = document.createElement("div");
        help.className = "feel-control-help";
        help.textContent = ctrl.help;

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = ctrl.min;
        slider.max = ctrl.max;
        slider.step = ctrl.step;
        slider.value = curVal;

        slider.addEventListener("input", () => {
          writeFeelControl(ctrl, params, Number(slider.value));
          onParamChanged();
          syncAllControls();
        });

        el.appendChild(head);
        el.appendChild(help);
        el.appendChild(slider);
        body.appendChild(el);

        feelSliders.set(ctrl.id, { input: slider, valueEl });
      }

      card.appendChild(body);
      feelControlsEl.appendChild(card);
    }
  }

  // ── Build advanced/raw controls ────────────────────────

  function buildAdvancedControls() {
    advancedBody.innerHTML = "";
    rawSliders.clear();

    for (const [name, lo, hi, step, fmt] of RAW_PARAM_SPECS) {
      const el = document.createElement("div");
      el.className = "raw-slider";

      const head = document.createElement("div");
      head.className = "raw-slider-head";
      const nm = document.createElement("span");
      nm.className = "raw-slider-name";
      nm.textContent = name;
      const val = document.createElement("span");
      val.className = "raw-slider-value";
      val.textContent = fmt(params[name]);
      head.appendChild(nm);
      head.appendChild(val);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = lo; slider.max = hi; slider.step = step;
      slider.value = params[name];
      slider.addEventListener("input", () => {
        params[name] = Number(slider.value);
        val.textContent = fmt(params[name]);
        onParamChanged();
        syncAllControls();
      });

      const meta = document.createElement("div");
      meta.className = "range-meta";
      meta.innerHTML = `<span>${fmt(lo)}</span><span>${fmt(hi)}</span>`;

      el.appendChild(head);
      el.appendChild(slider);
      el.appendChild(meta);
      advancedBody.appendChild(el);
      rawSliders.set(name, { input: slider, valueEl: val });
    }
  }

  // ── Input helpers ──────────────────────────────────────

  function getBits() {
    let bits = 0;
    if (input.left)  bits |= LEFT;
    if (input.right) bits |= RIGHT;
    if (input.down)  bits |= DOWN;
    if (input.run)   bits |= RUN;
    if (input.jump)  bits |= JUMP;
    return bits;
  }

  function updateJumpMetrics() {
    if (!st) return;
    const grounded = !!st.grounded;
    if (!grounded) {
      airTime += FIXED_DT;
      if (st.y < peakY) peakY = st.y;
    } else if (!prevGrounded) {
      lastAirTime = airTime;
      airTime = 0;
      lastJumpHeight = Math.max(0, jumpStartY - peakY);
    }
    if (!prevGrounded && grounded)  { jumpStartY = st.y; peakY = st.y; }
    if (prevGrounded && !grounded)  { jumpStartY = st.y; peakY = st.y; airTime = 0; }
    prevGrounded = grounded;
  }

  // ── Draw ───────────────────────────────────────────────

  function draw() {
    const pane = document.querySelector(".sim-pane");
    const r = pane.getBoundingClientRect();
    const vw = r.width, vh = r.height;
    if (vw < 1 || vh < 1 || !st) return;

    const s = Math.min(vw / worldW, vh / worldH);
    const ox = (vw - worldW * s) * 0.5;
    const oy = (vh - worldH * s) * 0.5;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.fillStyle = "#0f1114";
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);

    // World background
    ctx.fillStyle = "#10131a";
    ctx.fillRect(0, 0, worldW, worldH);

    // Platforms
    ctx.fillStyle = "#50555f";
    for (const p of platforms) ctx.fillRect(p.x, p.y, p.w, p.h);

    const px = Math.round(st.x), py = Math.round(st.y);
    const pw = Math.round(params.player_w), ph = Math.round(params.player_h);
    const showDebug = params.show_debug >= 0.5;

    const wellOn = params.gravity_well_enabled >= 0.5;
    const pcx0 = st.x + pw * 0.5, pcy0 = st.y + ph * 0.5;
    const distToWell = wellOn ? Math.hypot(params.well_x - pcx0, params.well_y - pcy0) : Infinity;

    // Gravity well: influence radius, lethal core, active highlight
    if (wellOn) {
      const active = !!st.gravity_active;
      ctx.beginPath();
      ctx.arc(params.well_x, params.well_y, params.well_influence_radius, 0, Math.PI * 2);
      ctx.fillStyle = active ? "rgba(90, 160, 230, 0.16)" : "rgba(90, 120, 160, 0.08)";
      ctx.fill();
      ctx.strokeStyle = active ? "rgba(140, 190, 240, 0.65)" : "rgba(90, 120, 160, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(params.well_x, params.well_y, params.well_core_radius, 0, Math.PI * 2);
      ctx.fillStyle = active ? "#e65a5a" : "#c84646";
      ctx.fill();

      // Predicted trajectory (approximate, host visualization only): the wasm
      // Core.predict() clones state internally and steps the authoritative core
      // forward — this never mutates live gameplay state.
      if (distToWell < params.well_influence_radius && !st.grounded) {
        const pts = core.predict(getBits(), 45);
        if (pts.length >= 4) {
          ctx.strokeStyle = "rgba(255, 230, 140, 0.6)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pts[0] + pw * 0.5, pts[1] + ph * 0.5);
          for (let i = 2; i < pts.length; i += 2) {
            ctx.lineTo(pts[i] + pw * 0.5, pts[i + 1] + ph * 0.5);
          }
          ctx.stroke();
        }
      }
    }

    // Ghost trail
    if (showDebug && ghostTrail.length > 1) {
      for (let i = 0; i < ghostTrail.length; i++) {
        const t = ghostTrail[i];
        const alpha = ((i + 1) / ghostTrail.length) * 0.35;
        ctx.fillStyle = t.grounded
          ? `rgba(70, 209, 140, ${alpha})`
          : `rgba(70, 140, 218, ${alpha})`;
        ctx.fillRect(t.x + pw * 0.3, t.y + ph * 0.3, pw * 0.4, ph * 0.4);
      }
    }

    // Player body
    ctx.fillStyle = st.grounded ? "#46d18c" : "#468cda";
    const rad = 6;
    ctx.beginPath();
    ctx.moveTo(px + rad, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, rad);
    ctx.arcTo(px + pw, py + ph, px, py + ph, rad);
    ctx.arcTo(px, py + ph, px, py, rad);
    ctx.arcTo(px, py, px + pw, py, rad);
    ctx.closePath();
    ctx.fill();

    if (showDebug) {
      // Collision box outline
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(st.x, st.y, pw, ph);

      // Grounded contact indicator
      if (st.grounded) {
        ctx.fillStyle = "rgba(70, 209, 140, 0.6)";
        ctx.fillRect(st.x + 2, st.y + ph, pw - 4, 2);
      }

      // Velocity vector
      const vcx = st.x + pw / 2, vcy = st.y + ph / 2;
      const vScale = 0.08;
      const vex = vcx + st.vx * vScale, vey = vcy + st.vy * vScale;
      ctx.strokeStyle = "rgba(255, 220, 100, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(vcx, vcy);
      ctx.lineTo(vex, vey);
      ctx.stroke();
      // Arrowhead
      const mag = Math.sqrt(st.vx * st.vx + st.vy * st.vy);
      if (mag > 10) {
        const nx = st.vx / mag, ny = st.vy / mag;
        const arrowSize = 5;
        ctx.beginPath();
        ctx.moveTo(vex, vey);
        ctx.lineTo(vex - arrowSize * (nx - ny * 0.5), vey - arrowSize * (ny + nx * 0.5));
        ctx.moveTo(vex, vey);
        ctx.lineTo(vex - arrowSize * (nx + ny * 0.5), vey - arrowSize * (ny - nx * 0.5));
        ctx.stroke();
      }
    }

    ctx.restore();

    // HUD text
    if (showDebug) {
      const speed = Math.hypot(st.vx, st.vy);
      hud.style.display = "block";
      hud.textContent =
        `x:${st.x.toFixed(1).padStart(7)} y:${st.y.toFixed(1).padStart(7)}\n` +
        `vx:${st.vx.toFixed(1).padStart(7)} vy:${st.vy.toFixed(1).padStart(7)}  speed:${speed.toFixed(1)}\n` +
        `jump_h: ${lastJumpHeight.toFixed(1)} px  air_t: ${airTime.toFixed(3)} s\n` +
        `grounded: ${!!st.grounded}  coyote: ${(st.coyote||0).toFixed(3)}  buffer: ${(st.jump_buffer||0).toFixed(3)}\n` +
        `RUN: gravity  active: ${!!st.gravity_active}  dist_to_well: ${wellOn ? distToWell.toFixed(1) : "n/a"}  core deaths: ${gravityCoreDeaths}`;
    } else {
      hud.style.display = "none";
    }

    // Input indicator (screen-space, bottom-right)
    drawInputIndicator(vw, vh);
  }

  function drawInputIndicator(vw, vh) {
    const btnW = 28, btnH = 22, gap = 4, pad = 12;
    const labels = [
      { key: "left",  txt: "\u25c0", active: input.left },
      { key: "down",  txt: "\u25bc", active: input.down },
      { key: "right", txt: "\u25b6", active: input.right },
    ];
    const actions = [
      { key: "run",  txt: "RUN",  active: input.run },
      { key: "jump", txt: "JMP",  active: input.jump },
    ];

    const totalW = labels.length * (btnW + gap) + gap * 2 + actions.length * (36 + gap);
    const bx = vw - totalW - pad;
    const by = vh - btnH - pad;

    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    let x = bx;
    for (const b of labels) {
      ctx.fillStyle = b.active ? "rgba(74, 140, 255, 0.85)" : "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.roundRect(x, by, btnW, btnH, 4);
      ctx.fill();
      ctx.fillStyle = b.active ? "#fff" : "rgba(255,255,255,0.25)";
      ctx.fillText(b.txt, x + btnW / 2, by + btnH / 2);
      x += btnW + gap;
    }

    x += gap * 2;
    for (const b of actions) {
      const w = 36;
      const color = b.key === "jump"
        ? (b.active ? "rgba(70, 209, 140, 0.85)" : "rgba(255,255,255,0.08)")
        : (b.active ? "rgba(255, 200, 60, 0.85)" : "rgba(255,255,255,0.08)");
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, by, w, btnH, 4);
      ctx.fill();
      ctx.fillStyle = b.active ? "#fff" : "rgba(255,255,255,0.25)";
      ctx.fillText(b.txt, x + w / 2, by + btnH / 2);
      x += w + gap;
    }
  }

  // ── Frame loop ─────────────────────────────────────────

  function frame(now) {
    if (input.escPressed) {
      input.escPressed = false;
      paused = !paused;
      document.getElementById("btnPause").textContent = paused ? "Resume" : "Pause";
      document.getElementById("btnStep").disabled = !paused;
      setStatus(paused ? "Paused" : "Running", 800);
    }

    const dtReal = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (Math.round(params.world_w) !== worldW || Math.round(params.world_h) !== worldH)
      rebuildWorld();

    applyCoreParams();
    if (auto.enabled) autoPlayStep();

    if (!paused) {
      acc += dtReal;
      acc = Math.min(acc, 0.25);
      while (acc >= FIXED_DT) {
        st = core.step(getBits());
        if (st.gravity_core_death) {
          gravityCoreDeaths++;
          applyCoreParams(); applyWorld(); respawn();
          setStatus("Gravity well core: reset");
          break;
        }
        updateJumpMetrics();
        // Ghost trail
        ghostTrail.push({ x: st.x, y: st.y, grounded: !!st.grounded });
        if (ghostTrail.length > GHOST_MAX) ghostTrail.shift();
        // Motion graph
        motionGraph.record(st);
        acc -= FIXED_DT;
      }
    } else if (stepOnce) {
      st = core.step(getBits());
      if (st.gravity_core_death) {
        gravityCoreDeaths++;
        applyCoreParams(); applyWorld(); respawn();
        setStatus("Gravity well core: reset");
      } else {
        updateJumpMetrics();
        ghostTrail.push({ x: st.x, y: st.y, grounded: !!st.grounded });
        if (ghostTrail.length > GHOST_MAX) ghostTrail.shift();
        motionGraph.record(st);
      }
      stepOnce = false;
    }

    if (!st) st = core.step(0);
    draw();
    motionGraph.draw();
    requestAnimationFrame(frame);
  }

  // ── Event handlers ─────────────────────────────────────

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "Tab") { e.preventDefault(); setAutoEnabled(!auto.enabled); return; }
    if (e.code === "Escape") { input.escPressed = true; return; }
    if (auto.enabled) return; // movement keys only in manual mode
    if (e.code === "KeyA") input.left = true;
    if (e.code === "KeyD") input.right = true;
    if (e.code === "KeyS") input.down = true;
    if (e.code === "KeyK") input.run = true;
    if (e.code === "KeyL") input.jump = true;
  });

  window.addEventListener("keyup", (e) => {
    if (auto.enabled) return;
    if (e.code === "KeyA") input.left = false;
    if (e.code === "KeyD") input.right = false;
    if (e.code === "KeyS") input.down = false;
    if (e.code === "KeyK") input.run = false;
    if (e.code === "KeyL") input.jump = false;
  });

  window.addEventListener("resize", () => {
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    resizeCanvas();
    draw();
  });

  document.getElementById("btnReset").addEventListener("click", () => {
    params = { ...DEFAULT_PARAMS };
    syncAllControls();
    rebuildWorld();
    markPresetActive("default");
    setStatus("Reset to defaults");
  });

  document.getElementById("btnRespawn").addEventListener("click", () => {
    applyCoreParams(); applyWorld(); respawn();
  });

  document.getElementById("btnPause").addEventListener("click", () => {
    paused = !paused;
    document.getElementById("btnPause").textContent = paused ? "Resume" : "Pause";
    document.getElementById("btnStep").disabled = !paused;
    setStatus(paused ? "Paused" : "Running", 800);
  });

  document.getElementById("btnStep").addEventListener("click", () => {
    if (paused) { stepOnce = true; setStatus("Step", 500); }
  });

  document.getElementById("btnSave").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(params, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "params.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("Downloaded params.json");
  });

  document.getElementById("btnLoad").addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          const next = { ...DEFAULT_PARAMS };
          for (const k in data) if (k in next) next[k] = Number(data[k]);
          params = next;
          syncAllControls();
          rebuildWorld();
          onParamChanged();
          setStatus("Loaded params.json");
        } catch (err) { setStatus("Load failed: " + err, 2000); }
      };
      reader.readAsText(file);
    };
    inp.click();
  });

  document.getElementById("btnShare").addEventListener("click", async () => {
    const hash = encodeParamsToHash(params);
    const url = location.origin + location.pathname + hash;
    try { await navigator.clipboard.writeText(url); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    history.replaceState(null, "", hash);
    setStatus("Copied share link");
  });

  // Advanced section toggle
  document.getElementById("advancedToggle").addEventListener("click", () => {
    const body = document.getElementById("advancedBody");
    const chevron = document.querySelector(".advanced-toggle .chevron");
    const collapsed = body.classList.toggle("collapsed");
    chevron.textContent = collapsed ? "\u25b8" : "\u25be";
  });

  // Auto-play toggle
  document.getElementById("btnAuto").addEventListener("click", () => setAutoEnabled(!auto.enabled));

  // Graph mode toggle
  document.getElementById("graphModes").addEventListener("click", (e) => {
    const btn = e.target.closest(".graph-mode");
    if (!btn) return;
    for (const b of document.querySelectorAll(".graph-mode")) b.classList.remove("active");
    btn.classList.add("active");
    motionGraph.mode = btn.dataset.mode;
  });

  // ── Initialization ─────────────────────────────────────

  buildPresets();
  buildFeelControls();
  buildAdvancedControls();
  resizeCanvas();
  rebuildWorld();
  setStatus(decodeParamsFromHash() ? "Loaded params from share link" : "Ready", 1200);
  requestAnimationFrame(frame);
})();
