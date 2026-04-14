/**
 * Motion graph for visualizing jump and movement behavior over time.
 * Records position and velocity history and renders it as a live-updating
 * canvas graph with hover inspection.
 */

const COLORS = {
  bg: "#0d1017",
  grid: "#1a1f2a",
  text: "#7f8797",
  textLight: "#eceef2",
  position: "#46d18c",
  velocity: "#e8964a",
  groundBg: "rgba(70, 209, 140, 0.06)",
  crosshair: "rgba(255, 255, 255, 0.3)",
  tooltipBg: "rgba(13, 16, 23, 0.92)",
  tooltipBorder: "rgba(255, 255, 255, 0.1)",
};

export class MotionGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.history = [];
    this.maxFrames = 300; // 5 seconds at 60fps
    this.mode = "both"; // 'position' | 'velocity' | 'both'
    this.hoverIndex = -1;
    this.groundY = 480;

    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pad = this._pad();
      const gw = rect.width - pad.left - pad.right;
      const ratio = (x - pad.left) / gw;
      if (this.history.length < 2 || ratio < 0 || ratio > 1) {
        this.hoverIndex = -1;
        return;
      }
      this.hoverIndex = Math.round(ratio * (this.history.length - 1));
      this.hoverIndex = Math.max(
        0,
        Math.min(this.history.length - 1, this.hoverIndex),
      );
    });

    this.canvas.addEventListener("mouseleave", () => {
      this.hoverIndex = -1;
    });
  }

  _pad() {
    return { left: 50, right: 16, top: 14, bottom: 24 };
  }

  setGroundY(y) {
    this.groundY = y;
  }

  record(state) {
    this.history.push({
      y: state.y,
      vy: state.vy,
      grounded: !!state.grounded,
    });
    if (this.history.length > this.maxFrames) {
      this.history.shift();
      if (this.hoverIndex >= 0)
        this.hoverIndex = Math.max(0, this.hoverIndex - 1);
    }
  }

  clear() {
    this.history = [];
    this.hoverIndex = -1;
  }

  draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    if (w < 10 || h < 10) return;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    const pad = this._pad();
    const gw = w - pad.left - pad.right;
    const gh = h - pad.top - pad.bottom;

    if (this.history.length < 2 || gw < 10 || gh < 10) {
      ctx.fillStyle = COLORS.text;
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Move the character to start recording", w / 2, h / 2);
      return;
    }

    const data = this.history;
    const n = data.length;
    const showPos = this.mode === "position" || this.mode === "both";
    const showVel = this.mode === "velocity" || this.mode === "both";

    // Compute display values
    const heights = data.map((d) => this.groundY - d.y);
    const vels = data.map((d) => -d.vy); // positive = upward

    // Y-axis ranges with padding
    let posMin = Infinity,
      posMax = -Infinity;
    for (const v of heights) {
      posMin = Math.min(posMin, v);
      posMax = Math.max(posMax, v);
    }
    let posPad = Math.max(10, (posMax - posMin) * 0.12);
    posMin -= posPad;
    posMax += posPad;
    if (posMax - posMin < 20) {
      posMin -= 10;
      posMax += 10;
    }

    let velMin = Infinity,
      velMax = -Infinity;
    for (const v of vels) {
      velMin = Math.min(velMin, v);
      velMax = Math.max(velMax, v);
    }
    let velPad = Math.max(50, (velMax - velMin) * 0.12);
    velMin -= velPad;
    velMax += velPad;
    if (velMax - velMin < 100) {
      velMin -= 50;
      velMax += 50;
    }

    const xOf = (i) => pad.left + (i / (n - 1)) * gw;
    const yOfPos = (v) =>
      pad.top + gh - ((v - posMin) / (posMax - posMin)) * gh;
    const yOfVel = (v) =>
      pad.top + gh - ((v - velMin) / (velMax - velMin)) * gh;

    // Grounded region shading
    ctx.fillStyle = COLORS.groundBg;
    const colW = gw / n;
    for (let i = 0; i < n; i++) {
      if (data[i].grounded) {
        ctx.fillRect(xOf(i) - colW * 0.5, pad.top, colW, gh);
      }
    }

    // Grid lines
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = pad.top + (i / gridLines) * gh;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + gw, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Y-axis labels
    ctx.fillStyle = COLORS.text;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";

    if (showPos && !showVel) {
      for (let i = 0; i <= gridLines; i++) {
        const v = posMin + (1 - i / gridLines) * (posMax - posMin);
        ctx.fillText(v.toFixed(0), pad.left - 6, pad.top + (i / gridLines) * gh + 3);
      }
    } else if (showVel && !showPos) {
      for (let i = 0; i <= gridLines; i++) {
        const v = velMin + (1 - i / gridLines) * (velMax - velMin);
        ctx.fillText(v.toFixed(0), pad.left - 6, pad.top + (i / gridLines) * gh + 3);
      }
    }

    // X-axis labels (time)
    ctx.textAlign = "center";
    const totalTime = (n - 1) / 60;
    const timeSteps = Math.min(5, Math.max(1, Math.floor(totalTime)));
    for (let i = 0; i <= timeSteps; i++) {
      const t = (i / timeSteps) * totalTime;
      const x = pad.left + (i / timeSteps) * gw;
      ctx.fillText(t.toFixed(1) + "s", x, h - 4);
    }

    // Position trace
    if (showPos) {
      ctx.strokeStyle = COLORS.position;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xOf(i);
        const y = yOfPos(heights[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Velocity trace
    if (showVel) {
      ctx.strokeStyle = COLORS.velocity;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xOf(i);
        const y = yOfVel(vels[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Zero line for velocity
      if (velMin < 0 && velMax > 0) {
        ctx.strokeStyle = "rgba(232, 150, 74, 0.25)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        const zeroY = yOfVel(0);
        ctx.beginPath();
        ctx.moveTo(pad.left, zeroY);
        ctx.lineTo(pad.left + gw, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Hover crosshair and tooltip
    if (this.hoverIndex >= 0 && this.hoverIndex < n) {
      const i = this.hoverIndex;
      const x = xOf(i);

      ctx.strokeStyle = COLORS.crosshair;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + gh);
      ctx.stroke();

      if (showPos) {
        ctx.fillStyle = COLORS.position;
        ctx.beginPath();
        ctx.arc(x, yOfPos(heights[i]), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (showVel) {
        ctx.fillStyle = COLORS.velocity;
        ctx.beginPath();
        ctx.arc(x, yOfVel(vels[i]), 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Tooltip text
      const time = (i / 60).toFixed(2);
      const lines = [`t: ${time}s`];
      if (showPos) lines.push(`height: ${heights[i].toFixed(1)} px`);
      if (showVel) lines.push(`vel: ${vels[i].toFixed(1)} px/s`);
      lines.push(data[i].grounded ? "grounded" : "airborne");

      ctx.font = "11px system-ui, sans-serif";
      const lineH = 16;
      const tooltipW =
        Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
      const tooltipH = lines.length * lineH + 10;
      let tx = x + 10;
      let ty = pad.top + 8;
      if (tx + tooltipW > w - pad.right) tx = x - tooltipW - 10;

      ctx.fillStyle = COLORS.tooltipBg;
      ctx.strokeStyle = COLORS.tooltipBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tooltipW, tooltipH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = COLORS.textLight;
      ctx.textAlign = "left";
      for (let j = 0; j < lines.length; j++) {
        ctx.fillText(lines[j], tx + 7, ty + 14 + j * lineH);
      }
    }

    // Legend
    ctx.textAlign = "left";
    ctx.font = "10px system-ui, sans-serif";
    let lx = pad.left + 4;
    const ly = pad.top + 12;
    if (showPos) {
      ctx.fillStyle = COLORS.position;
      ctx.fillRect(lx, ly - 5, 10, 2);
      ctx.fillStyle = COLORS.text;
      ctx.fillText("Height", lx + 14, ly);
      lx += 60;
    }
    if (showVel) {
      ctx.fillStyle = COLORS.velocity;
      ctx.fillRect(lx, ly - 5, 10, 2);
      ctx.fillStyle = COLORS.text;
      ctx.fillText("Velocity", lx + 14, ly);
    }
  }
}
