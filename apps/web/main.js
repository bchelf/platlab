import init, { Core } from "./pkg/platlab_wasm.js";

const LEFT = 1 << 0;
const RIGHT = 1 << 1;
const DOWN = 1 << 2;
const RUN = 1 << 3;
const JUMP = 1 << 4;

const FIXED_DT = 1 / 60;

let DEFAULT_PARAMS = {
  sim_hz: 60.0,
  render_fps_cap: 120.0,

  world_w: 960.0,
  world_h: 540.0,

  player_w: 28.0,
  player_h: 44.0,

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
  jump_buffer: 0.1,

  snap_to_ground: 6.0,
  max_step_px: 6.0,

  show_debug: 1.0,
  world_wrap_mode: 2.0,
};

async function loadDefaultParams() {
  const candidates = [
    "/configs/default_params.json",
    "../../configs/default_params.json",
    "../configs/default_params.json",
    "configs/default_params.json",
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      return data;
    } catch {
      // try next candidate
    }
  }
  return null;
}

const PRESET_SMB1ISH = {
  sim_hz: 60,
  render_fps_cap: 120,
  player_w: 28,
  player_h: 44,

  ground_max_speed: 1020,
  run_multiplier: 1.47,
  ground_accel: 3200,
  ground_decel: 3200,
  ground_friction: 3200,

  air_max_speed: 1020,
  air_accel: 3200,
  air_decel: 3200,
  air_drag: 0,

  gravity_up: 560,
  gravity_down: 560,
  terminal_velocity: 360,

  jump_velocity: 240,
  jump_cut_multiplier: 0.25,
  coyote_time: 0,
  jump_buffer: 0,

  snap_to_ground: 1.0,
  max_step_px: 8.0,
  show_debug: 1,
  world_wrap_mode: 2,
};

const PARAM_SPECS = [
  ["sim_hz", 60, 60, 1, (v) => v.toFixed(0)],
  ["render_fps_cap", 30, 240, 1, (v) => v.toFixed(0)],
  ["player_w", 10, 60, 1, (v) => v.toFixed(0)],
  ["player_h", 20, 80, 1, (v) => v.toFixed(0)],

  ["ground_max_speed", 50, 2000, 5, (v) => v.toFixed(0)],
  ["ground_accel", 0, 12000, 50, (v) => v.toFixed(0)],
  ["ground_decel", 0, 12000, 50, (v) => v.toFixed(0)],
  ["ground_friction", 0, 20000, 50, (v) => v.toFixed(0)],
  ["run_multiplier", 1.0, 2.5, 0.01, (v) => v.toFixed(2)],

  ["air_max_speed", 0, 2000, 5, (v) => v.toFixed(0)],
  ["air_accel", 0, 12000, 50, (v) => v.toFixed(0)],
  ["air_decel", 0, 12000, 50, (v) => v.toFixed(0)],
  ["air_drag", 0, 8000, 25, (v) => v.toFixed(0)],

  ["gravity_up", 0, 10000, 50, (v) => v.toFixed(0)],
  ["gravity_down", 0, 12000, 50, (v) => v.toFixed(0)],
  ["terminal_velocity", 0, 8000, 25, (v) => v.toFixed(0)],
  ["fast_fall_multiplier", 1.0, 3.0, 0.01, (v) => v.toFixed(2)],

  ["jump_velocity", 0, 2000, 10, (v) => v.toFixed(0)],
  ["jump_cut_multiplier", 0.05, 1.0, 0.01, (v) => v.toFixed(2)],
  ["coyote_time", 0.0, 0.25, 0.005, (v) => v.toFixed(3)],
  ["jump_buffer", 0.0, 0.25, 0.005, (v) => v.toFixed(3)],

  ["snap_to_ground", 0.0, 20.0, 0.5, (v) => v.toFixed(1)],
  ["max_step_px", 1.0, 20.0, 0.5, (v) => v.toFixed(1)],

  ["show_debug", 0.0, 1.0, 1.0, (v) => v.toFixed(0)],
  ["world_wrap_mode", 1.0, 2.0, 1.0, (v) => v.toFixed(0)],
];

const CORE_PARAM_KEYS = [
  "ground_max_speed",
  "ground_accel",
  "ground_decel",
  "ground_friction",
  "run_multiplier",
  "air_max_speed",
  "air_accel",
  "air_decel",
  "air_drag",
  "gravity_up",
  "gravity_down",
  "terminal_velocity",
  "fast_fall_multiplier",
  "jump_velocity",
  "jump_cut_multiplier",
  "coyote_time",
  "jump_buffer",
  "snap_to_ground",
  "max_step_px",
  "world_w",
  "world_wrap_mode",
];

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function encodeParamsToHash(p) {
  const diff = {};
  for (const k in DEFAULT_PARAMS) {
    const dv = DEFAULT_PARAMS[k];
    const pv = p[k];
    if (typeof pv === "number" && Math.abs(pv - dv) > 1e-9) diff[k] = pv;
  }
  const json = JSON.stringify(diff);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return "#p=" + b64;
}

function decodeParamsFromHash() {
  const h = location.hash || "";
  const m = h.match(/#p=([A-Za-z0-9+/=]+)/);
  if (!m) return null;
  try {
    const json = decodeURIComponent(escape(atob(m[1])));
    const diff = JSON.parse(json);
    const out = { ...DEFAULT_PARAMS };
    for (const k in diff) {
      if (k in out) out[k] = Number(diff[k]);
    }
    return out;
  } catch {
    return null;
  }
}

function buildWorldRects(worldW, worldH) {
  const groundY = worldH - 60;
  return {
    groundY,
    platforms: [
      { x: 0, y: groundY, w: worldW, h: 60 },
      { x: Math.floor(worldW / 2) - 140, y: groundY - 140, w: 280, h: 18 },
      { x: 120, y: groundY - 240, w: 240, h: 18 },
    ],
  };
}

(async function main() {
  await init();
  const core = new Core();

  const loadedDefaults = await loadDefaultParams();
  if (loadedDefaults && typeof loadedDefaults === "object") {
    DEFAULT_PARAMS = { ...DEFAULT_PARAMS, ...loadedDefaults };
  }
  if (DEFAULT_PARAMS.world_wrap_mode === undefined) {
    DEFAULT_PARAMS.world_wrap_mode = 2.0;
  }

  let params = decodeParamsFromHash() || { ...DEFAULT_PARAMS };

  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  const hud = document.getElementById("hud");
  const statusEl = document.getElementById("status");
  const slidersEl = document.getElementById("sliders");

  const input = {
    left: false,
    right: false,
    down: false,
    run: false,
    jump: false,
    escPressed: false,
  };

  let worldW = Math.round(params.world_w);
  let worldH = Math.round(params.world_h);
  let { groundY, platforms } = buildWorldRects(worldW, worldH);

  let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  let paused = false;
  let stepOnce = false;
  let acc = 0;
  let last = performance.now();

  let st = null;
  let jumpStartY = 0;
  let peakY = 0;
  let airTime = 0;
  let lastJumpHeight = 0;
  let lastAirTime = 0;
  let prevGrounded = false;

  const sliderInputs = new Map();
  const valueSpans = new Map();

  function setStatus(msg, ms = 1200) {
    statusEl.textContent = msg;
    if (ms > 0) {
      setTimeout(() => {
        if (statusEl.textContent === msg) statusEl.textContent = "";
      }, ms);
    }
  }

  function resizeCanvas() {
    const left = document.querySelector(".left");
    const r = left.getBoundingClientRect();
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
    jumpStartY = st.y;
    peakY = st.y;
    airTime = 0;
    lastJumpHeight = 0;
    lastAirTime = 0;
    prevGrounded = !!st.grounded;
    setStatus("Respawned");
  }

  function rebuildWorld() {
    worldW = Math.round(params.world_w);
    worldH = Math.round(params.world_h);
    ({ groundY, platforms } = buildWorldRects(worldW, worldH));
    applyCoreParams();
    applyWorld();
    respawn();
  }

  function buildSliders() {
    slidersEl.innerHTML = "";
    sliderInputs.clear();
    valueSpans.clear();

    for (const [name, lo, hi, step, fmt] of PARAM_SPECS) {
      const card = document.createElement("div");
      card.className = "slider";

      const head = document.createElement("div");
      head.className = "slider-head";

      const nm = document.createElement("div");
      nm.className = "slider-name";
      nm.textContent = name;

      const val = document.createElement("div");
      val.className = "slider-value";
      val.textContent = fmt(params[name]);

      head.appendChild(nm);
      head.appendChild(val);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = lo;
      slider.max = hi;
      slider.step = step;
      slider.value = params[name];

      slider.addEventListener("input", () => {
        params[name] = Number(slider.value);
        val.textContent = fmt(params[name]);
      });

      const meta = document.createElement("div");
      meta.className = "range-meta";
      meta.innerHTML = `<span>${fmt(lo)}</span><span>${fmt(hi)}</span>`;

      card.appendChild(head);
      card.appendChild(slider);
      card.appendChild(meta);

      slidersEl.appendChild(card);
      sliderInputs.set(name, slider);
      valueSpans.set(name, val);
    }
  }

  function syncSlidersFromParams() {
    for (const [name, , , , fmt] of PARAM_SPECS) {
      const slider = sliderInputs.get(name);
      const val = valueSpans.get(name);
      if (!slider || !val) continue;
      slider.value = String(params[name]);
      val.textContent = fmt(params[name]);
    }
  }

  function getBits() {
    let bits = 0;
    if (input.left) bits |= LEFT;
    if (input.right) bits |= RIGHT;
    if (input.down) bits |= DOWN;
    if (input.run) bits |= RUN;
    if (input.jump) bits |= JUMP;
    return bits;
  }

  function updateJumpMetrics() {
    if (!st) return;
    const grounded = !!st.grounded;

    if (!grounded) {
      airTime += FIXED_DT;
      if (st.y < peakY) peakY = st.y;
    } else {
      if (!prevGrounded) {
        lastAirTime = airTime;
        airTime = 0;
        lastJumpHeight = Math.max(0, jumpStartY - peakY);
      }
      jumpStartY = st.y;
      peakY = st.y;
    }

    if (!prevGrounded && grounded) {
      jumpStartY = st.y;
      peakY = st.y;
    }

    if (prevGrounded && !grounded) {
      jumpStartY = st.y;
      peakY = st.y;
      airTime = 0;
    }

    prevGrounded = grounded;
  }

  function draw() {
    const left = document.querySelector(".left");
    const r = left.getBoundingClientRect();
    const vw = r.width;
    const vh = r.height;
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

    ctx.fillStyle = "#10131a";
    ctx.fillRect(0, 0, worldW, worldH);

    ctx.fillStyle = "#50555f";
    for (const p of platforms) ctx.fillRect(p.x, p.y, p.w, p.h);

    const px = Math.round(st.x);
    const py = Math.round(st.y);
    const pw = Math.round(params.player_w);
    const ph = Math.round(params.player_h);

    ctx.fillStyle = st.grounded ? "#46d18c" : "#468cda";
    const radius = 6;
    ctx.beginPath();
    ctx.moveTo(px + radius, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, radius);
    ctx.arcTo(px + pw, py + ph, px, py + ph, radius);
    ctx.arcTo(px, py + ph, px, py, radius);
    ctx.arcTo(px, py, px + pw, py, radius);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    if (params.show_debug >= 0.5) {
      hud.style.display = "block";
      hud.textContent =
        `x:${st.x.toFixed(2).padStart(8)} y:${st.y.toFixed(2).padStart(8)}\n` +
        `vx:${st.vx.toFixed(2).padStart(8)} vy:${st.vy.toFixed(2).padStart(8)}\n` +
        `jump_h(last): ${lastJumpHeight.toFixed(1).padStart(6)} px   air_t(now): ${airTime.toFixed(3)} s   air_t(last): ${lastAirTime.toFixed(3)} s\n` +
        `grounded: ${!!st.grounded}   coyote: ${(st.coyote || 0).toFixed(3)}   buffer: ${(st.jump_buffer || 0).toFixed(3)}\n` +
        `A/D move, K run, L jump, S fast-fall | Esc pause`;
    } else {
      hud.style.display = "none";
    }
  }

  buildSliders();

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "KeyA") input.left = true;
    if (e.code === "KeyD") input.right = true;
    if (e.code === "KeyS") input.down = true;
    if (e.code === "KeyK") input.run = true;
    if (e.code === "KeyL") input.jump = true;
    if (e.code === "Escape") input.escPressed = true;
  });

  window.addEventListener("keyup", (e) => {
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
    syncSlidersFromParams();
    rebuildWorld();
    setStatus("Reset to defaults");
  });

  document.getElementById("btnRespawn").addEventListener("click", () => {
    applyCoreParams();
    applyWorld();
    respawn();
  });

  document.getElementById("btnPause").addEventListener("click", () => {
    paused = !paused;
    document.getElementById("btnPause").textContent = paused ? "Resume" : "Pause";
    document.getElementById("btnStep").disabled = !paused;
    setStatus(paused ? "Paused" : "Running", 800);
  });

  document.getElementById("btnStep").addEventListener("click", () => {
    if (paused) {
      stepOnce = true;
      setStatus("Step", 500);
    }
  });

  document.getElementById("preset").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v === "default") params = { ...DEFAULT_PARAMS };
    if (v === "smb1ish") params = { ...DEFAULT_PARAMS, ...PRESET_SMB1ISH };
    syncSlidersFromParams();
    rebuildWorld();
    setStatus(v === "default" ? "Preset: Default" : "Preset: SMB1-ish starter");
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
          for (const k in data) {
            if (k in next) next[k] = Number(data[k]);
          }
          params = next;
          syncSlidersFromParams();
          rebuildWorld();
          setStatus("Loaded params.json");
        } catch (err) {
          setStatus("Load failed: " + err, 2000);
        }
      };
      reader.readAsText(file);
    };
    inp.click();
  });

  document.getElementById("btnShare").addEventListener("click", async () => {
    const hash = encodeParamsToHash(params);
    const url = location.origin + location.pathname + hash;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Copied share link");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setStatus("Copied share link");
    }
    history.replaceState(null, "", hash);
  });

  resizeCanvas();
  rebuildWorld();
  setStatus(decodeParamsFromHash() ? "Loaded params from share link" : "Ready", 1200);

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

    if (Math.round(params.world_w) !== worldW || Math.round(params.world_h) !== worldH) {
      rebuildWorld();
    }

    applyCoreParams();

    if (!paused) {
      acc += dtReal;
      acc = Math.min(acc, 0.25);
      while (acc >= FIXED_DT) {
        st = core.step(getBits());
        updateJumpMetrics();
        acc -= FIXED_DT;
      }
    } else if (stepOnce) {
      st = core.step(getBits());
      updateJumpMetrics();
      stepOnce = false;
    }

    if (!st) st = core.step(0);
    draw();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
