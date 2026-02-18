#!/usr/bin/env python3
"""
Single-window Platformer Physics Tuning Sandbox (pygame only)

Controls (game):
  A/D : left/right
  W   : (unused for jump in this test)
  S   : down (fast-fall if enabled)
  K   : run (speed multiplier)
  L   : jump

Controls (UI panel on right):
  - Click + drag sliders to tweak parameters live
  - Mouse wheel over panel to scroll the parameter list
  - Buttons: Reset, Save params.json, Load params.json, Pause, Step, Respawn

Dependencies:
  pip install pygame
Run:
  python tuner.py
"""

import json
import math
import os
import sys
from dataclasses import dataclass
from typing import Dict, List, Tuple

import pygame

# -----------------------------
# Defaults
# -----------------------------
DEFAULT_PARAMS: Dict[str, float] = {
    # Simulation
    "sim_hz": 60.0,               # fixed sim rate; slider adjusts this (determinism depends on fixed step)
    "render_fps_cap": 120.0,       # render cap only

    # World
    "world_w": 960.0,
    "world_h": 540.0,

    # Player body
    "player_w": 28.0,
    "player_h": 44.0,

    # Ground movement
    "ground_max_speed": 260.0,
    "ground_accel": 1800.0,
    "ground_decel": 2200.0,
    "ground_friction": 2600.0,     # applied when no input
    "run_multiplier": 1.35,

    # Air movement
    "air_max_speed": 220.0,
    "air_accel": 1200.0,
    "air_decel": 900.0,
    "air_drag": 0.0,              # linear damping on vx each second (0 = off)

    # Gravity / vertical
    "gravity_up": 1500.0,
    "gravity_down": 2300.0,
    "terminal_velocity": 1200.0,
    "fast_fall_multiplier": 1.35,  # when holding S

    # Jump
    "jump_velocity": 520.0,        # initial vy impulse (upwards)
    "jump_cut_multiplier": 0.45,   # on early release: vy = max(vy, -jump_velocity * jump_cut_multiplier) while rising
    "coyote_time": 0.085,          # seconds after leaving ground where jump still allowed
    "jump_buffer": 0.100,          # seconds to buffer jump input before landing

    # Ground snap
    "snap_to_ground": 6.0,         # pixels

    # Collision stepping
    "max_step_px": 6.0,            # max movement per substep to reduce tunneling

    # Debug
    "show_debug": 1.0,
}

PARAMS_PATH = "params.json"

# name, min, max, step, format
PARAM_SPECS: List[Tuple[str, float, float, float, str]] = [
    ("sim_hz", 30, 240, 1, "{:.0f}"),
    ("render_fps_cap", 30, 240, 1, "{:.0f}"),
    ("player_w", 10, 60, 1, "{:.0f}"),
    ("player_h", 20, 80, 1, "{:.0f}"),

    ("ground_max_speed", 50, 600, 5, "{:.0f}"),
    ("ground_accel", 0, 8000, 50, "{:.0f}"),
    ("ground_decel", 0, 8000, 50, "{:.0f}"),
    ("ground_friction", 0, 12000, 50, "{:.0f}"),
    ("run_multiplier", 1.0, 2.5, 0.01, "{:.2f}"),

    ("air_max_speed", 0, 600, 5, "{:.0f}"),
    ("air_accel", 0, 8000, 50, "{:.0f}"),
    ("air_decel", 0, 8000, 50, "{:.0f}"),
    ("air_drag", 0, 4000, 25, "{:.0f}"),

    ("gravity_up", 0, 6000, 50, "{:.0f}"),
    ("gravity_down", 0, 9000, 50, "{:.0f}"),
    ("terminal_velocity", 0, 5000, 25, "{:.0f}"),
    ("fast_fall_multiplier", 1.0, 3.0, 0.01, "{:.2f}"),

    ("jump_velocity", 0, 1400, 10, "{:.0f}"),
    ("jump_cut_multiplier", 0.05, 1.0, 0.01, "{:.2f}"),
    ("coyote_time", 0.0, 0.25, 0.005, "{:.3f}"),
    ("jump_buffer", 0.0, 0.25, 0.005, "{:.3f}"),

    ("snap_to_ground", 0.0, 20.0, 0.5, "{:.1f}"),
    ("max_step_px", 1.0, 20.0, 0.5, "{:.1f}"),

    ("show_debug", 0.0, 1.0, 1.0, "{:.0f}"),
]


# -----------------------------
# Utility
# -----------------------------
def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x

def sign(x: float) -> float:
    return -1.0 if x < 0 else (1.0 if x > 0 else 0.0)


# -----------------------------
# UI Widgets
# -----------------------------
@dataclass
class Button:
    label: str
    rect: pygame.Rect
    action: str
    enabled: bool = True

    def draw(self, surf: pygame.Surface, font: pygame.font.Font, is_hover: bool):
        bg = (60, 65, 78) if self.enabled else (45, 48, 56)
        if is_hover and self.enabled:
            bg = (78, 85, 102)
        pygame.draw.rect(surf, bg, self.rect, border_radius=10)
        pygame.draw.rect(surf, (30, 32, 38), self.rect, width=1, border_radius=10)
        txt = font.render(self.label, True, (235, 235, 240) if self.enabled else (160, 160, 170))
        surf.blit(txt, txt.get_rect(center=self.rect.center))


@dataclass
class Slider:
    name: str
    lo: float
    hi: float
    step: float
    fmt: str
    rect: pygame.Rect
    knob_w: int = 12
    dragging: bool = False

    def _quantize(self, v: float) -> float:
        if self.step <= 0:
            return v
        q = round((v - self.lo) / self.step) * self.step + self.lo
        return clamp(q, self.lo, self.hi)

    def value_to_x(self, v: float) -> int:
        t = 0.0 if self.hi == self.lo else (v - self.lo) / (self.hi - self.lo)
        t = clamp(t, 0.0, 1.0)
        return int(self.rect.x + t * self.rect.w)

    def x_to_value(self, x: int) -> float:
        t = 0.0 if self.rect.w == 0 else (x - self.rect.x) / self.rect.w
        t = clamp(t, 0.0, 1.0)
        v = self.lo + t * (self.hi - self.lo)
        return self._quantize(v)

    def handle_event(self, e: pygame.event.Event, params: Dict[str, float], mouse_pos: Tuple[int, int]) -> bool:
        changed = False
        if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
            if self.rect.collidepoint(mouse_pos):
                self.dragging = True
                params[self.name] = self.x_to_value(mouse_pos[0])
                changed = True
        elif e.type == pygame.MOUSEBUTTONUP and e.button == 1:
            self.dragging = False
        elif e.type == pygame.MOUSEMOTION:
            if self.dragging:
                params[self.name] = self.x_to_value(mouse_pos[0])
                changed = True
        return changed

    def draw(self, surf: pygame.Surface, font: pygame.font.Font, small_font: pygame.font.Font,
             params: Dict[str, float], y_label: int):
        v = float(params.get(self.name, DEFAULT_PARAMS.get(self.name, 0.0)))

        # Label + value
        label = f"{self.name}"
        val_txt = self.fmt.format(v)
        surf.blit(font.render(label, True, (235, 235, 240)), (self.rect.x, y_label))
        surf.blit(font.render(val_txt, True, (200, 205, 220)), (self.rect.right - 90, y_label))

        # Track
        track_rect = self.rect.copy()
        pygame.draw.rect(surf, (48, 52, 62), track_rect, border_radius=8)
        pygame.draw.rect(surf, (30, 32, 38), track_rect, width=1, border_radius=8)

        # Fill to knob
        knob_x = self.value_to_x(v)
        fill_rect = pygame.Rect(track_rect.x, track_rect.y, max(0, knob_x - track_rect.x), track_rect.h)
        pygame.draw.rect(surf, (72, 110, 180), fill_rect, border_radius=8)

        # Knob
        knob_rect = pygame.Rect(0, 0, self.knob_w, track_rect.h + 8)
        knob_rect.center = (knob_x, track_rect.centery)
        pygame.draw.rect(surf, (230, 230, 235), knob_rect, border_radius=8)
        pygame.draw.rect(surf, (30, 32, 38), knob_rect, width=1, border_radius=8)

        # Min/max (tiny)
        surf.blit(small_font.render(self.fmt.format(self.lo), True, (140, 145, 160)), (track_rect.x, track_rect.bottom + 2))
        max_surf = small_font.render(self.fmt.format(self.hi), True, (140, 145, 160))
        surf.blit(max_surf, (track_rect.right - max_surf.get_width(), track_rect.bottom + 2))


# -----------------------------
# Physics / World
# -----------------------------
@dataclass
class Player:
    x: float
    y: float
    vx: float = 0.0
    vy: float = 0.0
    grounded: bool = False
    coyote: float = 0.0
    jump_buffer: float = 0.0
    jump_was_down: bool = False

def build_world(world_w: int, world_h: int) -> Tuple[int, List[pygame.Rect]]:
    ground_y = world_h - 60
    plats = [
        pygame.Rect(0, ground_y, world_w, 60),
        pygame.Rect(world_w // 2 - 140, ground_y - 140, 280, 18),
        pygame.Rect(120, ground_y - 240, 240, 18),
    ]
    return ground_y, plats

def resolve_axis_separated(rect: pygame.Rect, dx: float, dy: float, platforms: List[pygame.Rect]) -> Tuple[pygame.Rect, bool, bool]:
    """Returns (rect, hit_ground, hit_head)."""
    hit_ground = False
    hit_head = False

    # X
    rect.x += int(round(dx))
    for p in platforms:
        if rect.colliderect(p):
            if dx > 0:
                rect.right = p.left
            elif dx < 0:
                rect.left = p.right

    # Y
    rect.y += int(round(dy))
    for p in platforms:
        if rect.colliderect(p):
            if dy > 0:
                rect.bottom = p.top
                hit_ground = True
            elif dy < 0:
                rect.top = p.bottom
                hit_head = True
    return rect, hit_ground, hit_head

def do_sim_step(player: Player, platforms: List[pygame.Rect], params: Dict[str, float], keys: pygame.key.ScancodeWrapper, dt: float):
    # Inputs
    left = keys[pygame.K_a]
    right = keys[pygame.K_d]
    down = keys[pygame.K_s]
    run_key = keys[pygame.K_k]
    jump_key = keys[pygame.K_l]

    move = (1 if right else 0) - (1 if left else 0)

    # Timers
    if player.grounded:
        player.coyote = params["coyote_time"]
    else:
        player.coyote = max(0.0, player.coyote - dt)

    # Jump buffer
    jump_pressed = jump_key and not player.jump_was_down
    jump_released = (not jump_key) and player.jump_was_down
    player.jump_was_down = jump_key

    if jump_pressed:
        player.jump_buffer = params["jump_buffer"]
    else:
        player.jump_buffer = max(0.0, player.jump_buffer - dt)

    # Horizontal movement
    run_mul = params["run_multiplier"] if run_key else 1.0

    if player.grounded:
        max_speed = params["ground_max_speed"] * run_mul
        accel = params["ground_accel"]
        decel = params["ground_decel"]
        friction = params["ground_friction"]
    else:
        max_speed = params["air_max_speed"] * run_mul
        accel = params["air_accel"]
        decel = params["air_decel"]
        friction = 0.0

    if move != 0:
        desired_dir = float(move)
        if player.vx != 0 and sign(player.vx) != desired_dir:
            dv = decel * dt * desired_dir
        else:
            dv = accel * dt * desired_dir
        player.vx += dv
    else:
        if player.grounded:
            if abs(player.vx) <= friction * dt:
                player.vx = 0.0
            else:
                player.vx -= sign(player.vx) * friction * dt

    # Air drag
    if (not player.grounded) and params["air_drag"] > 0:
        drag = params["air_drag"]
        if abs(player.vx) <= drag * dt:
            player.vx = 0.0
        else:
            player.vx -= sign(player.vx) * drag * dt

    player.vx = clamp(player.vx, -max_speed, max_speed)

    # Gravity
    g = params["gravity_up"] if player.vy < 0 else params["gravity_down"]
    if down and player.vy > 0:
        g *= params["fast_fall_multiplier"]

    player.vy += g * dt
    player.vy = clamp(player.vy, -5000.0, params["terminal_velocity"])

    # Jump execution
    can_jump = player.grounded or (player.coyote > 0.0)
    wants_jump = (player.jump_buffer > 0.0)

    if wants_jump and can_jump:
        player.vy = -params["jump_velocity"]
        player.grounded = False
        player.coyote = 0.0
        player.jump_buffer = 0.0

    # Jump cut (short hop) on release
    if jump_released and player.vy < 0:
        cut_vy = -params["jump_velocity"] * params["jump_cut_multiplier"]
        if player.vy < cut_vy:
            player.vy = cut_vy

    # Collision move with substeps
    w = int(round(params["player_w"]))
    h = int(round(params["player_h"]))
    rect = pygame.Rect(int(round(player.x)), int(round(player.y)), w, h)

    max_step = max(1.0, params["max_step_px"])
    total_dx = player.vx * dt
    total_dy = player.vy * dt
    steps = max(1, int(math.ceil(max(abs(total_dx), abs(total_dy)) / max_step)))
    dx = total_dx / steps
    dy = total_dy / steps

    hit_ground_any = False
    hit_head_any = False

    for _ in range(steps):
        rect, hit_ground, hit_head = resolve_axis_separated(rect, dx, dy, platforms)
        if hit_head and player.vy < 0:
            player.vy = 0.0
        if hit_ground and player.vy > 0:
            player.vy = 0.0
        hit_ground_any |= hit_ground
        hit_head_any |= hit_head

    world_w = int(round(params.get("world_w", DEFAULT_PARAMS["world_w"])))
    if rect.left < 0:
        rect.right = world_w
    elif rect.right > world_w:
        rect.left = 0

    player.x = float(rect.x)
    player.y = float(rect.y)

    # Ground snap test
    snap = params["snap_to_ground"]
    grounded = False
    if snap > 0:
        test = rect.copy()
        test.y += int(round(snap))
        for p in platforms:
            if test.colliderect(p):
                grounded = True
                if rect.bottom <= p.top + int(round(snap)):
                    rect.bottom = p.top
                    player.y = float(rect.y)
                break
    else:
        grounded = hit_ground_any

    player.grounded = grounded


# -----------------------------
# Persistence
# -----------------------------
def save_params(params: Dict[str, float], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(params, f, indent=2, sort_keys=True)

def load_params(path: str) -> Dict[str, float]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    out = dict(DEFAULT_PARAMS)
    for k, v in data.items():
        if k in out:
            try:
                out[k] = float(v)
            except Exception:
                pass
    return out


# -----------------------------
# Main
# -----------------------------
def main():
    pygame.init()
    pygame.display.set_caption("Platformer Physics Tuning Sandbox (Single Window)")

    # Panel sizing
    panel_w = 420
    world_w = int(round(DEFAULT_PARAMS["world_w"]))
    world_h = int(round(DEFAULT_PARAMS["world_h"]))
    win_w = world_w + panel_w
    win_h = world_h

    screen = pygame.display.set_mode((win_w, win_h))
    clock = pygame.time.Clock()

    font = pygame.font.SysFont("Menlo", 16)
    small = pygame.font.SysFont("Menlo", 12)
    big = pygame.font.SysFont("Menlo", 18, bold=True)

    params = dict(DEFAULT_PARAMS)

    ground_y, platforms = build_world(world_w, world_h)

    def respawn():
        w = params["player_w"]
        h = params["player_h"]
        p = Player(x=80.0, y=float(ground_y - h))
        p.vx = 0.0
        p.vy = 0.0
        return p

    player = respawn()


    # Build UI: sliders in a scrollable list
    panel_x = world_w
    panel_rect = pygame.Rect(panel_x, 0, panel_w, win_h)

    # Buttons
    btn_h = 34
    btn_pad = 10
    btn_y = 10
    buttons = []
    btn_w = (panel_w - btn_pad * 3) // 2
    buttons.append(Button("Reset", pygame.Rect(panel_x + btn_pad, btn_y, btn_w, btn_h), "reset"))
    buttons.append(Button("Respawn", pygame.Rect(panel_x + btn_pad*2 + btn_w, btn_y, btn_w, btn_h), "respawn"))
    btn_y += btn_h + 8
    buttons.append(Button("Save params.json", pygame.Rect(panel_x + btn_pad, btn_y, btn_w, btn_h), "save"))
    buttons.append(Button("Load params.json", pygame.Rect(panel_x + btn_pad*2 + btn_w, btn_y, btn_w, btn_h), "load"))
    btn_y += btn_h + 8
    buttons.append(Button("Pause", pygame.Rect(panel_x + btn_pad, btn_y, btn_w, btn_h), "pause"))
    buttons.append(Button("Step", pygame.Rect(panel_x + btn_pad*2 + btn_w, btn_y, btn_w, btn_h), "step"))
    btn_y += btn_h + 12

    # Sliders area layout
    slider_track_h = 14
    slider_row_h = 52
    slider_left = panel_x + 14
    slider_right_pad = 18
    slider_track_w = panel_w - 14 - slider_right_pad
    slider_track_x = slider_left
    slider_track_y0 = btn_y + 6

    sliders: List[Slider] = []
    for i, (name, lo, hi, step, fmt) in enumerate(PARAM_SPECS):
        y = slider_track_y0 + i * slider_row_h + 22
        track = pygame.Rect(slider_track_x, y, slider_track_w, slider_track_h)
        sliders.append(Slider(name, lo, hi, step, fmt, track))

    scroll = 0
    scroll_min = 0
    content_h = len(sliders) * slider_row_h + 90
    scroll_max = max(0, content_h - (win_h - slider_track_y0) + 20)

    paused = False
    step_once = False
    status = ""
    status_t = 0.0

    # Fixed-step simulation accumulator for stability
    accumulator = 0.0

    running = True
    while running:
        # Time
        render_cap = int(clamp(params["render_fps_cap"], 30, 240))
        dt_real = clock.tick(render_cap) / 1000.0
        dt_real = min(dt_real, 0.05)  # avoid spiral of death on stalls

        # Events
        mouse_pos = pygame.mouse.get_pos()
        over_panel = panel_rect.collidepoint(mouse_pos)

        for e in pygame.event.get():
            if e.type == pygame.QUIT:
                running = False
                break

            if e.type == pygame.KEYDOWN:
                if e.key == pygame.K_ESCAPE:
                    running = False
                    break
                if e.key == pygame.K_F1:
                    params["show_debug"] = 0.0 if params["show_debug"] >= 0.5 else 1.0

            # Scroll wheel over panel
            if e.type == pygame.MOUSEWHEEL and over_panel:
                scroll -= int(e.y * 30)
                scroll = int(clamp(scroll, scroll_min, scroll_max))

            # Buttons
            if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1 and over_panel:
                for b in buttons:
                    if b.enabled and b.rect.collidepoint(mouse_pos):
                        if b.action == "reset":
                            params = dict(DEFAULT_PARAMS)
                            respawn()
                            status, status_t = "Reset to defaults", 1.2
                        elif b.action == "respawn":
                            respawn()
                            status, status_t = "Respawned", 1.0
                        elif b.action == "save":
                            try:
                                save_params(params, PARAMS_PATH)
                                status, status_t = f"Saved {PARAMS_PATH}", 1.2
                            except Exception as ex:
                                status, status_t = f"Save failed: {ex}", 2.0
                        elif b.action == "load":
                            try:
                                if os.path.exists(PARAMS_PATH):
                                    params = load_params(PARAMS_PATH)
                                    respawn()
                                    status, status_t = f"Loaded {PARAMS_PATH}", 1.2
                                else:
                                    status, status_t = f"No {PARAMS_PATH} found", 1.2
                            except Exception as ex:
                                status, status_t = f"Load failed: {ex}", 2.0
                        elif b.action == "pause":
                            paused = not paused
                            b.label = "Resume" if paused else "Pause"
                            status, status_t = ("Paused" if paused else "Running"), 0.8
                        elif b.action == "step":
                            if paused:
                                step_once = True
                                status, status_t = "Step", 0.6

            # Sliders (with scrolling)
            # We translate mouse Y to "content space" by adding scroll to compare against slider rects.
            if over_panel:
                mp = mouse_pos
                mp_content = (mp[0], mp[1] + scroll)
                # shift slider rects for hit-testing by scroll (no allocation by using a temp rect)
                for s in sliders:
                    r = s.rect
                    r_test = pygame.Rect(r.x, r.y - scroll, r.w, r.h)
                    # Only handle if visible-ish (small optimization)
                    if r_test.bottom < slider_track_y0 - 80 or r_test.top > win_h + 80:
                        continue
                    # For event handling we want the "unscrolled" rect, so just pass content coords.
                    # But Slider uses rect for x range; that's fine. We just need y hit detection.
                    # Easiest: temporarily compare using r_test then call handler with same mouse_pos.
                    if e.type in (pygame.MOUSEBUTTONDOWN, pygame.MOUSEBUTTONUP, pygame.MOUSEMOTION):
                        # Gate start of dragging to the visible (scrolled) rect
                        if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
                            if not r_test.collidepoint(mp):
                                continue
                            # Start dragging but compute based on actual x in the slider rect
                            s.dragging = True
                            params[s.name] = s.x_to_value(mp[0])
                        elif e.type == pygame.MOUSEBUTTONUP and e.button == 1:
                            s.dragging = False
                        elif e.type == pygame.MOUSEMOTION:
                            if s.dragging:
                                params[s.name] = s.x_to_value(mp[0])

        if not running:
            break

        # Simulation (fixed step)
        sim_hz = clamp(params["sim_hz"], 30.0, 240.0)
        sim_dt = 1.0 / sim_hz

        keys = pygame.key.get_pressed()

        if not paused:
            accumulator += dt_real
            # cap accumulator to avoid long catch-up bursts
            accumulator = min(accumulator, 0.25)
            while accumulator >= sim_dt:
                do_sim_step(player, platforms, params, keys, sim_dt)
                accumulator -= sim_dt
        else:
            if step_once:
                do_sim_step(player, platforms, params, keys, sim_dt)
                step_once = False

        # Render
        screen.fill((18, 18, 22))

        # World background
        pygame.draw.rect(screen, (16, 17, 20), pygame.Rect(0, 0, world_w, world_h))

        # Platforms
        for p in platforms:
            pygame.draw.rect(screen, (80, 85, 95), p)

        # Player
        pw = int(round(params["player_w"]))
        ph = int(round(params["player_h"]))
        player_rect = pygame.Rect(int(round(player.x)), int(round(player.y)), pw, ph)
        player_color = (70, 200, 140) if player.grounded else (70, 140, 220)
        pygame.draw.rect(screen, player_color, player_rect, border_radius=6)

        # Debug HUD (left)
        if params["show_debug"] >= 0.5:
            lines = [
                f"vx: {player.vx:8.2f}   vy: {player.vy:8.2f}",
                f"grounded: {player.grounded}   coyote: {player.coyote:0.3f}   buffer: {player.jump_buffer:0.3f}",
                "A/D move, K run, L jump, S fast-fall | F1 toggle HUD | Esc quit",
            ]
            y0 = 10
            for ln in lines:
                screen.blit(font.render(ln, True, (230, 230, 235)), (10, y0))
                y0 += 18

        # Panel
        pygame.draw.rect(screen, (24, 26, 32), panel_rect)
        pygame.draw.line(screen, (35, 38, 48), (panel_x, 0), (panel_x, win_h), 2)

        title = big.render("Parameters", True, (235, 235, 240))
        screen.blit(title, (panel_x + 14, 10 + btn_h * 3 + 20))

        # Buttons
        for b in buttons:
            is_hover = b.rect.collidepoint(mouse_pos)
            b.draw(screen, font, is_hover)

        # Status toast
        if status_t > 0:
            status_t = max(0.0, status_t - dt_real)
            st = font.render(status, True, (235, 235, 240))
            bg = pygame.Rect(panel_x + 14, btn_y - 6, panel_w - 28, 22)
            pygame.draw.rect(screen, (40, 44, 54), bg, border_radius=10)
            screen.blit(st, (bg.x + 10, bg.y + 2))

        # Sliders (scrolled)
        clip = pygame.Rect(panel_x, slider_track_y0 - 10, panel_w, win_h - (slider_track_y0 - 10))
        prev_clip = screen.get_clip()
        screen.set_clip(clip)

        for i, s in enumerate(sliders):
            # compute displayed rect by applying scroll (only affects y)
            base_rect = s.rect
            draw_rect = pygame.Rect(base_rect.x, base_rect.y - scroll, base_rect.w, base_rect.h)
            if draw_rect.bottom < clip.top - 40 or draw_rect.top > clip.bottom + 40:
                continue

            # Draw label above track
            y_label = draw_rect.y - 18
            # Temporarily swap rect for drawing (x logic stays same; we only need y changed)
            old_rect = s.rect
            s.rect = draw_rect
            s.draw(screen, font, small, params, y_label)
            s.rect = old_rect

        screen.set_clip(prev_clip)

        # Scroll bar (simple)
        if scroll_max > 0:
            bar_x = panel_x + panel_w - 10
            bar_h = clip.h
            thumb_h = max(30, int(bar_h * (bar_h / max(bar_h, content_h))))
            thumb_y = clip.y + int((bar_h - thumb_h) * (scroll / scroll_max))
            pygame.draw.rect(screen, (38, 40, 48), pygame.Rect(bar_x, clip.y, 6, bar_h), border_radius=6)
            pygame.draw.rect(screen, (90, 95, 110), pygame.Rect(bar_x, thumb_y, 6, thumb_h), border_radius=6)

        pygame.display.flip()

    pygame.quit()


if __name__ == "__main__":
    main()
