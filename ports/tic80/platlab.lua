-- platlab TIC-80 port of crates/core/src/lib.rs step() behavior.
-- This is a physics port for parity experiments; Rust remains authoritative.

local HZ = 60.0
local DT = 1.0 / HZ

local BTN_LEFT = 1 << 0
local BTN_RIGHT = 1 << 1
local BTN_DOWN = 1 << 2
local BTN_RUN = 1 << 3
local BTN_JUMP = 1 << 4

local params = {
  ground_max_speed = 260.0,
  ground_accel = 1800.0,
  ground_decel = 2200.0,
  ground_friction = 2600.0,
  run_multiplier = 1.35,

  air_max_speed = 220.0,
  air_accel = 1200.0,
  air_decel = 900.0,
  air_drag = 0.0,

  gravity_up = 1500.0,
  gravity_down = 2300.0,
  terminal_velocity = 1200.0,
  fast_fall_multiplier = 1.35,

  jump_velocity = 520.0,
  jump_cut_multiplier = 0.45,
  coyote_time = 0.085,
  jump_buffer = 0.100,

  snap_to_ground = 6.0,
  max_step_px = 6.0,

  world_w = 240.0,
  world_wrap_mode = 2.0, -- 0 off, 1 edge-wrap, 2 center-wrap (torus)
}

local world = {
  { x = 0.0, y = 120.0, w = 240.0, h = 16.0 },
  { x = 48.0, y = 90.0, w = 46.0, h = 8.0 },
  { x = 150.0, y = 72.0, w = 40.0, h = 8.0 },
}

local state = {
  x = 28.0, y = 120.0 - 22.0, vx = 0.0, vy = 0.0, w = 14.0, h = 22.0,
  grounded = 0, coyote = 0.0, jump_buffer = 0.0, jump_was_down = 0,
}

local frame = 0
local trace_enabled = false
local trace_limit = 300
local trace_header_emitted = false

local function round(x)
  if x >= 0.0 then
    return math.floor(x + 0.5)
  end
  return math.ceil(x - 0.5)
end

local function sign(x)
  if x < 0.0 then return -1.0 end
  if x > 0.0 then return 1.0 end
  return 0.0
end

local function clamp(x, lo, hi)
  if x < lo then return lo end
  if x > hi then return hi end
  return x
end

local function rects_intersect(a, b)
  return a.x < b.x + b.w
    and a.x + a.w > b.x
    and a.y < b.y + b.h
    and a.y + a.h > b.y
end

local function resolve_axis_separated(r, dx, dy, colliders)
  local hit_ground = false
  local hit_head = false

  -- X
  r.x = r.x + round(dx)
  for i = 1, #colliders do
    local p = colliders[i]
    if rects_intersect(r, p) then
      if dx > 0.0 then
        r.x = p.x - r.w
      elseif dx < 0.0 then
        r.x = p.x + p.w
      end
    end
  end

  -- Y
  r.y = r.y + round(dy)
  for i = 1, #colliders do
    local p = colliders[i]
    if rects_intersect(r, p) then
      if dy > 0.0 then
        r.y = p.y - r.h
        hit_ground = true
      elseif dy < 0.0 then
        r.y = p.y + p.h
        hit_head = true
      end
    end
  end

  return r, hit_ground, hit_head
end

local function gather_buttons()
  -- TIC-80 gamepad mapping:
  -- btn(0)=left, btn(1)=right, btn(3)=down, btn(4)=A, btn(5)=B
  local left = btn(0)
  local right = btn(1)
  local down = btn(3)
  local run = btn(5)
  local jump = btn(4) or btn(5)

  local bits = 0
  if left then bits = bits | BTN_LEFT end
  if right then bits = bits | BTN_RIGHT end
  if down then bits = bits | BTN_DOWN end
  if run then bits = bits | BTN_RUN end
  if jump then bits = bits | BTN_JUMP end
  return bits
end

-- Port of Rust step(params, world, s, buttons).
local function step(p, colliders, s, buttons)
  local ev = { jumped = 0, landed = 0, bonked = 0 }

  local left = (buttons & BTN_LEFT) ~= 0
  local right = (buttons & BTN_RIGHT) ~= 0
  local down = (buttons & BTN_DOWN) ~= 0
  local run = (buttons & BTN_RUN) ~= 0
  local jump = (buttons & BTN_JUMP) ~= 0

  local move_dir = (right and 1 or 0) - (left and 1 or 0)

  -- Jump edge detection
  local jump_was_down = s.jump_was_down ~= 0
  local jump_pressed = jump and (not jump_was_down)
  local jump_released = (not jump) and jump_was_down
  s.jump_was_down = jump and 1 or 0

  local was_grounded = s.grounded ~= 0

  -- Coyote timer
  if was_grounded then
    s.coyote = p.coyote_time
  else
    s.coyote = math.max(s.coyote - DT, 0.0)
  end

  -- Jump buffer timer
  if jump_pressed then
    s.jump_buffer = p.jump_buffer
  else
    s.jump_buffer = math.max(s.jump_buffer - DT, 0.0)
  end

  -- Horizontal movement
  local run_mul = run and p.run_multiplier or 1.0
  local max_speed, accel, decel, friction
  if was_grounded then
    max_speed = p.ground_max_speed * run_mul
    accel = p.ground_accel
    decel = p.ground_decel
    friction = p.ground_friction
  else
    max_speed = p.air_max_speed * run_mul
    accel = p.air_accel
    decel = p.air_decel
    friction = 0.0
  end

  if move_dir ~= 0 then
    local desired_dir = move_dir
    local turning = s.vx ~= 0.0 and sign(s.vx) ~= desired_dir
    local dv = (turning and decel or accel) * DT * desired_dir
    s.vx = s.vx + dv
  elseif was_grounded then
    local fr = friction * DT
    if math.abs(s.vx) <= fr then
      s.vx = 0.0
    else
      s.vx = s.vx - sign(s.vx) * fr
    end
  end

  -- Air drag
  if (not was_grounded) and p.air_drag > 0.0 then
    local drag = p.air_drag * DT
    if math.abs(s.vx) <= drag then
      s.vx = 0.0
    else
      s.vx = s.vx - sign(s.vx) * drag
    end
  end

  s.vx = clamp(s.vx, -max_speed, max_speed)

  -- Gravity
  local g = (s.vy < 0.0) and p.gravity_up or p.gravity_down
  local g_apply = g
  if down and s.vy > 0.0 then
    g_apply = g_apply * p.fast_fall_multiplier
  end
  s.vy = s.vy + g_apply * DT
  s.vy = clamp(s.vy, -5000.0, p.terminal_velocity)

  -- Jump execution
  local can_jump = was_grounded or s.coyote > 0.0
  local wants_jump = s.jump_buffer > 0.0
  if can_jump and wants_jump then
    s.vy = -p.jump_velocity
    s.grounded = 0
    s.coyote = 0.0
    s.jump_buffer = 0.0
    ev.jumped = 1
  end

  -- Jump cut
  if jump_released and s.vy < 0.0 then
    local cut_vy = -p.jump_velocity * p.jump_cut_multiplier
    if s.vy < cut_vy then
      s.vy = cut_vy
    end
  end

  -- Integrate with substeps + collisions
  local rect = {
    x = round(s.x),
    y = round(s.y),
    w = round(s.w),
    h = round(s.h),
  }

  local max_step = math.max(p.max_step_px, 1.0)
  local total_dx = s.vx * DT
  local total_dy = s.vy * DT
  local biggest = math.max(math.abs(total_dx), math.abs(total_dy))
  local steps = math.max(math.ceil(biggest / max_step), 1)
  local dx = total_dx / steps
  local dy = total_dy / steps

  local hit_ground_any = false
  for _ = 1, steps do
    local hit_ground, hit_head
    rect, hit_ground, hit_head = resolve_axis_separated(rect, dx, dy, colliders)
    if hit_head and s.vy < 0.0 then
      s.vy = 0.0
      ev.bonked = 1
    end
    if hit_ground and s.vy > 0.0 then
      s.vy = 0.0
    end
    hit_ground_any = hit_ground_any or hit_ground
  end

  s.x = rect.x
  s.y = rect.y

  -- Ground snap
  local now_grounded = false
  if p.snap_to_ground > 0.0 then
    local test = {
      x = rect.x,
      y = rect.y + round(p.snap_to_ground),
      w = rect.w,
      h = rect.h,
    }
    for i = 1, #colliders do
      local q = colliders[i]
      if rects_intersect(test, q) then
        now_grounded = true
        if rect.y + rect.h <= q.y + round(p.snap_to_ground) then
          rect.y = q.y - rect.h
          s.y = rect.y
        end
        break
      end
    end
  else
    now_grounded = hit_ground_any
  end

  if now_grounded and (not was_grounded) then
    ev.landed = 1
  end
  s.grounded = now_grounded and 1 or 0

  -- Optional world wrap
  local wrap_mode = round(p.world_wrap_mode)
  if wrap_mode == 1 then
    local w = round(math.max(p.world_w, 1.0))
    local left_px = round(s.x)
    local right_px = left_px + round(s.w)
    if left_px < 0.0 then
      left_px = w - round(s.w)
    elseif right_px > w then
      left_px = 0.0
    end
    s.x = left_px
  elseif wrap_mode == 2 then
    local w = math.max(p.world_w, 1.0)
    local center_x = s.x + 0.5 * s.w
    local wrapped = ((center_x % w) + w) % w
    s.x = round(wrapped - 0.5 * s.w)
  end

  return ev
end

local function reset_state()
  state.x = 28.0
  state.y = 120.0 - state.h
  state.vx = 0.0
  state.vy = 0.0
  state.grounded = 0
  state.coyote = 0.0
  state.jump_buffer = 0.0
  state.jump_was_down = 0
  frame = 0
  trace_header_emitted = false
end

local function emit_trace_line()
  if not trace_enabled then return end
  if frame >= trace_limit then return end
  if not trace_header_emitted then
    trace("frame,x,y,vx,vy,grounded")
    trace_header_emitted = true
  end
  trace(string.format(
    "%d,%.6f,%.6f,%.6f,%.6f,%d",
    frame, state.x, state.y, state.vx, state.vy, state.grounded
  ))
end

local function draw_world()
  for i = 1, #world do
    local r = world[i]
    rect(round(r.x), round(r.y), round(r.w), round(r.h), 12)
  end
end

local function draw_player()
  rect(round(state.x), round(state.y), round(state.w), round(state.h), 11)
end

local function draw_hud()
  print(string.format("frame:%d", frame), 2, 2, 15, false, 1, true)
  print(string.format("x:%7.2f y:%7.2f", state.x, state.y), 2, 10, 15, false, 1, true)
  print(string.format("vx:%7.2f vy:%7.2f", state.vx, state.vy), 2, 18, 15, false, 1, true)
  print(string.format("grounded:%d", state.grounded), 2, 26, 15, false, 1, true)
  print("Move: dpad/arrow or A,D  Jump: Z/X (A/B)", 2, 120, 14, false, 1, true)
  print("Run: B  Down: Down", 2, 127, 14, false, 1, true)
  print("Toggle trace: Y  Reset: Up", 2, 134, 14, false, 1, true)
  print(string.format("trace:%s (0..%d)", trace_enabled and "on" or "off", trace_limit - 1), 2, 141, 10, false, 1, true)
end

function TIC()
  if btnp(2) then
    reset_state()
  end
  if btnp(7) then
    trace_enabled = not trace_enabled
    trace_header_emitted = false
  end

  local buttons = gather_buttons()
  step(params, world, state, buttons)
  emit_trace_line()

  cls(0)
  draw_world()
  draw_player()
  draw_hud()

  frame = frame + 1
end
