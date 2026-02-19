-- title:   platlab harness
-- author:  platlab
-- desc:   platformer ported from Rust to Lua for TIC-80
-- script:  lua

-- Self-contained TIC-80 harness.
-- Host responsibilities only: input -> step() -> render.
-- Physics step() is copied verbatim from ports/tic80/platlab.lua.

local HZ = 60.0
local DT = 1.0 / HZ

local BTN_LEFT = 1 << 0
local BTN_RIGHT = 1 << 1
local BTN_DOWN = 1 << 2
local BTN_RUN = 1 << 3
local BTN_JUMP = 1 << 4

-- Harness tuning constants (host-side only).
local WORLD_W = 960.0
local GROUND_Y = 480.0
local PLAYER_W = 32.0 -- with scale 0.25, this renders as one 8x8 sprite footprint
local PLAYER_H = 32.0 -- with scale 0.25, this renders as one 8x8 sprite footprint

local DEFAULT_PARAMS_JSON = [[
{
  "air_accel": 3200.0,
  "air_decel": 4550,
  "air_drag": 925,
  "air_max_speed": 295.0,
  "coyote_time": 0.05,
  "fast_fall_multiplier": 1.42,
  "gravity_down": 5000,
  "gravity_up": 5000,
  "ground_accel": 3200.0,
  "ground_decel": 3200.0,
  "ground_friction": 3200.0,
  "ground_max_speed": 360.0,
  "jump_buffer": 0.02,
  "jump_cut_multiplier": 0.5,
  "jump_velocity": 1200,
  "max_step_px": 8.0,
  "player_h": 44.0,
  "player_w": 28.0,
  "render_fps_cap": 120.0,
  "run_multiplier": 1.47,
  "show_debug": 1.0,
  "sim_hz": 60.0,
  "snap_to_ground": 1.0,
  "terminal_velocity": 675,
  "world_h": 540.0,
  "world_w": 960.0
}
]]

local function parse_number_object(json_text)
  local out = {}
  for key, value in string.gmatch(json_text, '"([%a_][%w_]*)"%s*:%s*(-?[%d%.]+)') do
    out[key] = tonumber(value)
  end
  return out
end

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

-- Verbatim port of Rust step(params, world, s, buttons).
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

local params_all = parse_number_object(DEFAULT_PARAMS_JSON)
local params = {
  ground_max_speed = assert(params_all.ground_max_speed),
  ground_accel = assert(params_all.ground_accel),
  ground_decel = assert(params_all.ground_decel),
  ground_friction = assert(params_all.ground_friction),
  run_multiplier = assert(params_all.run_multiplier),

  air_max_speed = assert(params_all.air_max_speed),
  air_accel = assert(params_all.air_accel),
  air_decel = assert(params_all.air_decel),
  air_drag = assert(params_all.air_drag),

  gravity_up = assert(params_all.gravity_up),
  gravity_down = assert(params_all.gravity_down),
  terminal_velocity = assert(params_all.terminal_velocity),
  fast_fall_multiplier = assert(params_all.fast_fall_multiplier),

  jump_velocity = assert(params_all.jump_velocity),
  jump_cut_multiplier = assert(params_all.jump_cut_multiplier),
  coyote_time = assert(params_all.coyote_time),
  jump_buffer = assert(params_all.jump_buffer),

  snap_to_ground = assert(params_all.snap_to_ground),
  max_step_px = assert(params_all.max_step_px),

  world_w = assert(params_all.world_w),
  world_wrap_mode = 1.0,
}
params.world_w = WORLD_W

local world = {
  { x = 0.0, y = GROUND_Y, w = params.world_w, h = 16.0 },
  { x = 150.0, y = 360.0, w = 192.0, h = 16.0 },
  { x = 520.0, y = 290.0, w = 224.0, h = 16.0 },
}

local state = {
  x = 24.0,
  y = GROUND_Y - PLAYER_H,
  vx = 0.0,
  vy = 0.0,
  w = PLAYER_W,
  h = PLAYER_H,
  grounded = 0,
  coyote = 0.0,
  jump_buffer = 0.0,
  jump_was_down = 0,
}

local frame = 0
local scale = 0.25

local function gather_buttons()
  local bits = 0
  -- TIC-80 indices: 0=Up, 1=Down, 2=Left, 3=Right, 4=A, 5=B.
  if btn(2) then bits = bits | BTN_LEFT end
  if btn(3) then bits = bits | BTN_RIGHT end
  if btn(1) then bits = bits | BTN_DOWN end
  if btn(5) then bits = bits | BTN_RUN end
  if btn(4) or btn(0) then bits = bits | BTN_JUMP end
  return bits
end

local function world_to_screen(x, y)
  return round(x * scale), round(y * scale)
end

local function draw_world()
  for i = 1, #world do
    local r = world[i]
    local x, y = world_to_screen(r.x, r.y)
    local w = math.max(1, round(r.w * scale))
    local h = math.max(1, round(r.h * scale))
    local color = (i == 1) and 3 or 13
    rect(x, y, w, h, color)
  end
end

local function draw_player()
  local x, y = world_to_screen(state.x, state.y)
  local grounded = (state.grounded == 1) and math.abs(state.vy) < 0.001
  local sprite_index = grounded and 1 or 2
  spr(sprite_index, x, y, 0, 1, 0, 0, 1, 1)
end

local function draw_hud()
  print(string.format("frame:%d", frame), 2, 2, 12, false, 1, true)
  print(string.format("x:%7.2f y:%7.2f", state.x, state.y), 2, 10, 12, false, 1, true)
  print(string.format("vx:%7.2f vy:%7.2f", state.vx, state.vy), 2, 18, 12, false, 1, true)
  print(string.format("grounded:%d", state.grounded), 2, 26, 12, false, 1, true)
  print("Left/Right: D-pad  Jump: A or Up", 2, 128, 14, false, 1, true)
end

function TIC()
  local buttons = gather_buttons()
  step(params, world, state, buttons)

  cls(0)
  draw_world()
  draw_player()
  draw_hud()

  frame = frame + 1
end

-- <TILES>
-- 001:0033330003333330033333300333333003333330033333300333333000333300
-- 002:0022220002222220022222200222222002222220022222200222222000222200
-- </TILES>

-- <SPRITES>
-- 001:0006600000666660066666600666666006666660006666600006660000000000
-- </SPRITES>

-- <MAP>
-- 000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000a0e00000000000001a1c2c5d275db13e53ef7d57ffcd75a7f07038b76425717929366f3b5dc941a6f673eff7f4f4f494b0c2566c86333c571e1e2e000000a0e00000000000000000000000000013000000000000000505050505050505050500000005050505000000000000000000000000000000000000000000000505050000050505050505050505050000000000000000000000000000000000000500050005000005000500
-- </MAP>

-- <PALETTE>
-- 000:1a1c2c5d275db13e53ef7d57ffcd75a7f07038b76425717929366f3b5dc941a6f673eff7f4f4f494b0c2566c86333c57
-- </PALETTE>
