import init, { Core } from "./pkg/platlab_wasm.js";

const LEFT=1<<0, RIGHT=1<<1, DOWN=1<<2, RUN=1<<3, JUMP=1<<4;

const keys = {a:false,d:false,l:false};
window.addEventListener("keydown", e=>{
  if(e.code==="KeyA") keys.a=true;
  if(e.code==="KeyD") keys.d=true;
  if(e.code==="KeyL") keys.l=true;
});
window.addEventListener("keyup", e=>{
  if(e.code==="KeyA") keys.a=false;
  if(e.code==="KeyD") keys.d=false;
  if(e.code==="KeyL") keys.l=false;
});

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");

let dpr = Math.min(2, window.devicePixelRatio||1);

function resize(){
  dpr = Math.min(2, window.devicePixelRatio||1);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.floor(r.width*dpr);
  canvas.height = Math.floor(r.height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener("resize", resize);

function draw(state){
  const WORLD_W=960, WORLD_H=540;
  const r = canvas.getBoundingClientRect();
  const vw=r.width, vh=r.height;
  const s=Math.min(vw/WORLD_W, vh/WORLD_H);
  const ox=(vw-WORLD_W*s)/2, oy=(vh-WORLD_H*s)/2;

  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,vw,vh);
  ctx.fillStyle="#0f1114"; ctx.fillRect(0,0,vw,vh);

  ctx.save();
  ctx.translate(ox,oy);
  ctx.scale(s,s);

  // world
  ctx.fillStyle="#161a22"; ctx.fillRect(0,0,WORLD_W,WORLD_H);

  // ground
  ctx.fillStyle="#50555f"; ctx.fillRect(0,480,960,60);

  // player (and seam copy so wrap looks clean)
  const pw=28, ph=44;
  const px=Math.round(state.x), py=Math.round(state.y);
  ctx.fillStyle = state.grounded ? "#46d18c" : "#468cda";
  ctx.fillRect(px, py, pw, ph);
  if (px < 0) ctx.fillRect(px + WORLD_W, py, pw, ph);
  if (px + pw > WORLD_W) ctx.fillRect(px - WORLD_W, py, pw, ph);

  ctx.restore();

  hud.textContent =
    `x:${state.x.toFixed(2)} y:${state.y.toFixed(2)}\n` +
    `vx:${state.vx.toFixed(2)} vy:${state.vy.toFixed(2)} grounded:${state.grounded}\n` +
    `A/D move, L jump`;
}

(async function main(){
  await init();
  resize();

  const core = new Core();

  let acc=0;
  let last=performance.now();
  const stepDt = 1/60;

  function frame(now){
    const dt=Math.min(0.05,(now-last)/1000);
    last=now;
    acc += dt;

    let bits=0;
    if(keys.a) bits|=LEFT;
    if(keys.d) bits|=RIGHT;
    if(keys.l) bits|=JUMP;

    let st=null;
    while(acc >= stepDt){
      st = core.step(bits);
      acc -= stepDt;
    }
    if (!st) st = core.step(0);

    draw(st);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
