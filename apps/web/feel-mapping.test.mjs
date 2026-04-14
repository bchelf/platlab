/**
 * Tests for feel-mapping.js derived parameter logic.
 * Run with: node apps/web/feel-mapping.test.mjs
 */

import {
  getJumpHeight, setJumpHeight,
  getTimeToApex, setTimeToApex,
  getFallRatio, setFallRatio,
  readFeelControl, writeFeelControl,
  FEEL_GROUPS,
} from "./feel-mapping.js";

import assert from "node:assert/strict";

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  OK  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}`);
    console.error("     ", e.message);
    process.exitCode = 1;
  }
}

function approx(a, b, eps = 0.5) {
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b} (eps=${eps})`);
}

function makeParams() {
  return {
    jump_velocity: 520, gravity_up: 1500, gravity_down: 2300,
    jump_cut_multiplier: 0.45, air_accel: 1200, air_max_speed: 220,
    air_decel: 900, air_drag: 0, ground_max_speed: 260,
    ground_accel: 1800, ground_decel: 2200, ground_friction: 2600,
    run_multiplier: 1.35, coyote_time: 0.085, jump_buffer: 0.1,
    snap_to_ground: 6,
  };
}

console.log("\n--- getJumpHeight / setJumpHeight ---");

test("computes jump height correctly", () => {
  const p = makeParams();
  // h = 520^2 / (2*1500) = 270400/3000 = 90.13
  approx(getJumpHeight(p), 90.13, 0.1);
});

test("setJumpHeight round-trips", () => {
  const p = makeParams();
  setJumpHeight(p, 120);
  approx(getJumpHeight(p), 120, 0.5);
});

test("setJumpHeight preserves gravity_up", () => {
  const p = makeParams();
  const gBefore = p.gravity_up;
  setJumpHeight(p, 150);
  assert.equal(p.gravity_up, gBefore);
});

test("setJumpHeight handles zero gravity", () => {
  const p = makeParams();
  p.gravity_up = 0;
  setJumpHeight(p, 100); // should not throw
  assert.equal(p.jump_velocity, 520); // unchanged
});

console.log("\n--- getTimeToApex / setTimeToApex ---");

test("computes time to apex correctly", () => {
  const p = makeParams();
  // t = 520/1500 = 0.3467
  approx(getTimeToApex(p), 0.347, 0.001);
});

test("setTimeToApex preserves jump height", () => {
  const p = makeParams();
  const hBefore = getJumpHeight(p);
  setTimeToApex(p, 0.4);
  approx(getJumpHeight(p), hBefore, 0.5);
});

test("setTimeToApex round-trips", () => {
  const p = makeParams();
  setTimeToApex(p, 0.3);
  approx(getTimeToApex(p), 0.3, 0.002);
});

test("setTimeToApex updates both jump_velocity and gravity_up", () => {
  const p = makeParams();
  const vBefore = p.jump_velocity;
  const gBefore = p.gravity_up;
  setTimeToApex(p, 0.5);
  assert.notEqual(p.jump_velocity, vBefore);
  assert.notEqual(p.gravity_up, gBefore);
});

console.log("\n--- getFallRatio / setFallRatio ---");

test("computes fall ratio correctly", () => {
  const p = makeParams();
  // 2300/1500 = 1.533
  approx(getFallRatio(p), 1.533, 0.001);
});

test("setFallRatio round-trips", () => {
  const p = makeParams();
  setFallRatio(p, 2.0);
  approx(getFallRatio(p), 2.0, 0.001);
});

test("setFallRatio preserves gravity_up", () => {
  const p = makeParams();
  const gUp = p.gravity_up;
  setFallRatio(p, 1.5);
  assert.equal(p.gravity_up, gUp);
  approx(p.gravity_down, gUp * 1.5, 0.01);
});

console.log("\n--- readFeelControl / writeFeelControl ---");

test("reads direct param controls", () => {
  const p = makeParams();
  const ctrl = FEEL_GROUPS[0].controls[3]; // jump_cut_multiplier
  assert.equal(readFeelControl(ctrl, p), 0.45);
});

test("writes direct param controls", () => {
  const p = makeParams();
  const ctrl = FEEL_GROUPS[0].controls[3];
  writeFeelControl(ctrl, p, 0.7);
  assert.equal(p.jump_cut_multiplier, 0.7);
});

test("reads derived controls", () => {
  const p = makeParams();
  const ctrl = FEEL_GROUPS[0].controls[0]; // jump_height
  approx(readFeelControl(ctrl, p), 90.13, 0.2);
});

test("writes derived controls", () => {
  const p = makeParams();
  const ctrl = FEEL_GROUPS[0].controls[0];
  writeFeelControl(ctrl, p, 100);
  approx(getJumpHeight(p), 100, 0.5);
});

console.log("\n--- FEEL_GROUPS structure ---");

test("all groups have valid controls with required fields", () => {
  for (const group of FEEL_GROUPS) {
    assert.ok(group.id);
    assert.ok(group.label);
    for (const ctrl of group.controls) {
      assert.ok(ctrl.id);
      assert.ok(ctrl.label);
      assert.ok(ctrl.help);
      assert.ok(typeof ctrl.fmt === "function");
      assert.ok(ctrl.param || (ctrl.get && ctrl.set));
    }
  }
});

console.log(`\n${passed} tests passed.\n`);
