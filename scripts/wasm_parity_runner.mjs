import wasmPkg from "../apps/web/pkg_node/platlab_wasm.js";

const RIGHT = 1 << 1;
const JUMP = 1 << 4;

const { Core } = wasmPkg;

const core = new Core();
core.reset(80.0, 480.0 - 44.0, 28.0, 44.0);
core.set_world(new Float32Array([0.0, 480.0, 960.0, 60.0]));
core.set_params_json(JSON.stringify({ world_w: 960.0 }));

let jumped = 0;
let landed = 0;
let bonked = 0;
let st = null;

for (let frame = 0; frame < 180; frame++) {
  let bits = 0;
  if (frame < 120) bits |= RIGHT;
  if (frame === 10) bits |= JUMP;
  st = core.step(bits);
  if (st.jumped) jumped += 1;
  if (st.landed) landed += 1;
  if (st.bonked) bonked += 1;
}

console.log(
  JSON.stringify({
    x: st.x,
    y: st.y,
    vx: st.vx,
    vy: st.vy,
    grounded: st.grounded ? 1 : 0,
    jumped,
    landed,
    bonked,
  })
);
