// ============================================================
//  SUPERSONIC LEAGUE — 2D Rocket-League-style car soccer
//  One engine, three roles:
//    mode 'local'  — full sim + render in the browser
//    mode 'server' — headless sim in Node (LAN matches)
//    mode 'client' — render-only, fed by network snapshots
// ============================================================
import { touchState } from './touch.js';

// ---- Field geometry (world units = pixels) ----
export const W = 1600;
export const H = 900;
const GOAL_MOUTH = 320;
const GOAL_DEPTH = 78;
const GOAL_TOP = (H - GOAL_MOUTH) / 2;
const GOAL_BOT = GOAL_TOP + GOAL_MOUTH;
const CORNER = 140;
const MARGIN_X = 90;
const MARGIN_Y = 34;
export const CANVAS_W = W + MARGIN_X * 2;
export const CANVAS_H = H + MARGIN_Y * 2;

const BALL_R = 30;
const CAR_R = 31;

// ---- Car handling ----
const ACCEL = 980;
const REV_ACCEL = 720;
const BRAKE = 1500;
const BOOST_ACCEL = 1150;
const MAX_SPEED = 530;
const MAX_BOOST_SPEED = 990;
const SUPERSONIC = 820;
const TURN_RATE = 3.5;
const GRIP = 6.0;
const DRAG = 0.85;
const BOOST_BURN = 42;
const BALL_DRAG = 0.42;
const BALL_MAX = 1400;
const REST = 0.74;

const DIFFICULTY = {
  rookie:  { speed: 0.78, boostUse: 0.35, err: 85, think: 0.34 },
  pro:     { speed: 0.90, boostUse: 0.70, err: 35, think: 0.20 },
  allstar: { speed: 1.00, boostUse: 1.00, err: 10, think: 0.11 },
};

const TEAM_COLORS = {
  blue:   { body: ['#2e9fe6', '#6fc4f2'], dark: '#175a8a', glow: '#39c0ff' },
  orange: { body: ['#f0932e', '#f7b866'], dark: '#8a5217', glow: '#ffb03a' },
};

const NEUTRAL = { throttle: 0, steer: 0, boost: false };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapAngle = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

// ============================================================
//  Sound — tiny WebAudio synth, unlocked on first interaction
// ============================================================
class Sfx {
  constructor() { this.ac = null; this.boostGain = null; }
  unlock() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    this.ac = new AC();
    const len = this.ac.sampleRate;
    const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ac.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = this.ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 750; bp.Q.value = 0.6;
    this.boostGain = this.ac.createGain();
    this.boostGain.gain.value = 0;
    src.connect(bp).connect(this.boostGain).connect(this.ac.destination);
    src.start();
  }
  setBoost(on) {
    if (!this.boostGain) return;
    const t = this.ac.currentTime;
    this.boostGain.gain.cancelScheduledValues(t);
    this.boostGain.gain.linearRampToValueAtTime(on ? 0.05 : 0, t + 0.08);
  }
  tone(freq, dur, type = 'square', gain = 0.06, slide = 0) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, gain, freq) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const len = Math.max(1, Math.floor(this.ac.sampleRate * dur));
    const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    const f = this.ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ac.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.ac.destination);
    src.start(t);
  }
  hit(power) { this.noise(0.09, clamp(power / 2600, 0.03, 0.3), 700 + power * 0.6); }
  bounce() { this.noise(0.05, 0.05, 500); }
  pad(big) { this.tone(big ? 660 : 880, 0.09, 'sine', 0.05, big ? 220 : 120); }
  count() { this.tone(440, 0.11, 'square', 0.05); }
  go() { this.tone(880, 0.3, 'square', 0.06); }
  goal() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this.tone(f, 0.22, 'square', 0.06), i * 95));
    this.noise(1.4, 0.09, 300);
  }
  demo() { this.noise(0.3, 0.22, 900); this.tone(120, 0.35, 'sawtooth', 0.09, -60); }
  whistle() { this.tone(2300, 0.5, 'sine', 0.06, 300); }
}

// ============================================================
//  Game
// ============================================================
export class Game {
  // opts: { mode:'local'|'server'|'client', slots:[{team,ctrl,name,netId}],
  //         difficulty, minutes, myId }
  constructor(canvas, opts, onEnd) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.opts = opts;
    this.mode = opts.mode;
    this.isClient = this.mode === 'client';
    this.onEnd = onEnd;
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.pro;
    this.sfx = new Sfx();
    this.keys = new Set();
    this.running = true;              // server never calls start(); keep timers alive
    this.paused = false;
    this.ended = false;
    this.endTimer = null;
    this.netInputs = {};              // netId -> { th, st, b }
    this.events = [];                 // drained into snapshots (server mode)

    this.score = { blue: 0, orange: 0 };
    this.time = (opts.minutes || 2) * 60;
    this.overtime = false;
    this.phase = 'countdown';         // countdown | play | goal | over_pending | over
    this.phaseT = 3;
    this.lastCount = 4;
    this.kickoffT = 0;
    this.goalTeam = null;
    this.message = '';
    this.shake = 0;
    this.flash = 0;
    this.particles = [];
    this.rings = [];
    this.ballTrail = [];
    this.snapPrev = null;
    this.snapCur = null;

    this.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    this.pads = this.makePads();
    this.cars = [];
    if (!this.isClient) {
      for (const s of opts.slots) this.addCar(s);
      this.resetKickoff();
    }
    this.k1Both = !opts.slots || !opts.slots.some((s) => s.ctrl === 'k2');
  }

  addCar(slot) {
    const idx = this.cars.filter((c) => c.team === slot.team).length;
    const car = {
      team: slot.team, idx, ctrl: slot.ctrl, netId: slot.netId ?? null,
      name: slot.name || '', x: 0, y: 0, angle: 0, vx: 0, vy: 0,
      boost: 34, boosting: false, demoT: 0,
      bot: slot.ctrl === 'bot'
        ? { target: { x: W / 2, y: H / 2 }, thinkT: rand(0, 0.15), wantBoost: false, role: 'attack' }
        : null,
    };
    this.cars.push(car);
    return car;
  }

  makeBot(car) {
    car.ctrl = 'bot';
    car.bot = { target: { x: W / 2, y: H / 2 }, thinkT: 0, wantBoost: false, role: 'attack' };
  }

  myCar() { return this.cars.find((c) => c.netId === this.opts.myId) || null; }

  makePads() {
    const big = [[170, 170], [1430, 170], [170, 730], [1430, 730], [800, 100], [800, 800]];
    const small = [[450, 450], [1150, 450], [640, 240], [960, 240],
                   [640, 660], [960, 660], [280, 450], [1320, 450]];
    return [
      ...big.map(([x, y]) => ({ x, y, big: true, t: 0 })),
      ...small.map(([x, y]) => ({ x, y, big: false, t: 0 })),
    ];
  }

  kickoffSpots(team, count) {
    const spots = count === 1 ? [[330, H / 2]] : [[380, 280], [380, 620]];
    return spots.map(([x, y]) => ({
      x: team === 'blue' ? x : W - x,
      y,
      angle: team === 'blue' ? 0 : Math.PI,
    }));
  }

  resetKickoff() {
    Object.assign(this.ball, { x: W / 2, y: H / 2, vx: 0, vy: 0 });
    for (const team of ['blue', 'orange']) {
      const cars = this.cars.filter((c) => c.team === team);
      const spots = this.kickoffSpots(team, cars.length);
      cars.forEach((car, i) => {
        const s = spots[i] || spots[0];
        Object.assign(car, {
          x: s.x, y: s.y, angle: s.angle, vx: 0, vy: 0,
          boost: Math.max(34, car.boost), demoT: 0, boosting: false,
        });
      });
    }
    for (const p of this.pads) p.t = 0;
    this.ballTrail.length = 0;
    this.sfx.setBoost(false);
  }

  emit(type, data) { this.events.push({ e: type, ...data }); }

  // ---------------- lifecycle ----------------
  start() {
    this.onKeyDown = (e) => {
      if (e.repeat) return;
      this.sfx.unlock();
      if ((e.code === 'Escape' || e.code === 'KeyP') && !this.isClient) {
        if (this.phase !== 'over') this.paused = !this.paused;
        return;
      }
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => { if (!this.isClient && this.phase !== 'over') this.paused = true; };
    this.onTouchUnlock = () => this.sfx.unlock();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointerdown', this.onTouchUnlock);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    clearTimeout(this.endTimer);
    if (this.onKeyDown) {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('pointerdown', this.onTouchUnlock);
    }
    this.sfx.setBoost(false);
    if (this.sfx.ac) this.sfx.ac.close().catch(() => {});
  }

  frame = (now) => {
    if (!this.running) return;
    const dt = clamp((now - this.last) / 1000, 0, 1 / 30);
    this.last = now;
    if (this.isClient) this.clientTick(dt);
    else if (!this.paused) this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  // ---------------- input ----------------
  keysControls(player, car) {
    const k = this.keys;
    let up, down, left, right, boost;
    if (player === 1) {
      const both = this.k1Both;
      up = k.has('KeyW') || (both && k.has('ArrowUp'));
      down = k.has('KeyS') || (both && k.has('ArrowDown'));
      left = k.has('KeyA') || (both && k.has('ArrowLeft'));
      right = k.has('KeyD') || (both && k.has('ArrowRight'));
      boost = k.has('ShiftLeft') || (both && (k.has('Space') || k.has('ShiftRight')));
      if (touchState.active) {
        const desired = Math.atan2(touchState.dy, touchState.dx);
        const dA = wrapAngle(desired - car.angle);
        return {
          throttle: touchState.mag > 0.2 ? 1 : 0,
          steer: clamp(dA * 2.8, -1, 1),
          boost: touchState.boost,
        };
      }
      if (touchState.boost) boost = true;
    } else {
      up = k.has('ArrowUp'); down = k.has('ArrowDown');
      left = k.has('ArrowLeft'); right = k.has('ArrowRight');
      boost = k.has('ShiftRight');
    }
    return {
      throttle: (up ? 1 : 0) - (down ? 1 : 0),
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      boost,
    };
  }

  controlsFor(car, dt) {
    switch (car.ctrl) {
      case 'k1': return this.keysControls(1, car);
      case 'k2': return this.keysControls(2, car);
      case 'bot': return this.aiControls(car, dt);
      case 'net': {
        const i = this.netInputs[car.netId];
        return i ? { throttle: clamp(i.th, -1, 1), steer: clamp(i.st, -1, 1), boost: !!i.b } : NEUTRAL;
      }
      default: return NEUTRAL;
    }
  }

  // what a network client sends to the server for its own car
  clientControls() {
    const car = this.myCar();
    if (!car) return { th: 0, st: 0, b: 0 };
    const c = this.keysControls(1, car);
    return { th: c.throttle, st: c.steer, b: c.boost ? 1 : 0 };
  }

  // ---------------- bots ----------------
  aiControls(car, dt) {
    const bot = car.bot;
    bot.thinkT -= dt;
    if (bot.thinkT <= 0) {
      bot.thinkT = this.diff.think;
      this.botThink(car, bot);
    }
    const dx = bot.target.x - car.x, dy = bot.target.y - car.y;
    const dist = Math.hypot(dx, dy);
    const desired = Math.atan2(dy, dx);
    const dA = wrapAngle(desired - car.angle);
    let throttle = 1, steer = clamp(dA * 3.2, -1, 1);
    if (Math.abs(dA) > 2.5 && dist < 340) {   // target right behind us: back out
      throttle = -1; steer = -Math.sign(dA);
    }
    const boost = bot.wantBoost && Math.abs(dA) < 0.25 && dist > 240 && car.boost > 4;
    return { throttle, steer, boost };
  }

  botThink(car, bot) {
    const b = this.ball;
    const dir = car.team === 'blue' ? 1 : -1;              // attack direction on x
    const goal = { x: dir > 0 ? W : 0, y: H / 2 };         // goal we score in
    const ownX = dir > 0 ? 0 : W;
    const err = this.diff.err;

    // lead the ball: aim where it is going, not where it is
    const distBall = Math.hypot(b.x - car.x, b.y - car.y);
    const lead = clamp(distBall / 620, 0, 0.85);
    const bx = clamp(b.x + b.vx * lead * 0.7, -20, W + 20);
    const by = clamp(b.y + b.vy * lead * 0.7, 30, H - 30);

    // role: the teammate closest to the ball attacks, the other supports
    let attacker = true;
    for (const m of this.cars) {
      if (m.team !== car.team || m === car || m.demoT > 0) continue;
      const md = Math.hypot(b.x - m.x, b.y - m.y);
      const sticky = m.bot && m.bot.role === 'attack' ? -70 : -30;  // hysteresis
      if (md + sticky < distBall - 10) attacker = false;
    }
    bot.role = attacker ? 'attack' : 'support';
    bot.wantBoost = Math.random() < this.diff.boostUse;

    let tx, ty;
    if (!attacker) {
      if (car.boost < 55) {
        const p = this.nearestPad(car, true);
        if (p) { tx = p.x; ty = p.y; }
      }
      if (tx === undefined) {
        // hold a defensive position between own goal and the ball
        tx = ownX + dir * 300;
        ty = H / 2 + (by - H / 2) * 0.5;
      }
    } else {
      const wrongSide = dir * (bx - car.x) < 34;           // not behind the ball
      const ballNearOwn = dir > 0 ? bx < 330 : bx > W - 330;
      if (wrongSide && ballNearOwn) {
        // emergency: park in front of own goal
        tx = ownX + dir * 95;
        ty = clamp(by, GOAL_TOP + 45, GOAL_BOT - 45);
      } else if (wrongSide) {
        // loop around the ball to get a shooting angle
        tx = bx - dir * 235;
        ty = by + (car.y > by ? 170 : -170);
      } else {
        // attack point behind the ball, aimed at the goal
        const gx = bx - goal.x, gy = by - goal.y;
        const gd = Math.hypot(gx, gy) || 1;
        tx = bx + (gx / gd) * 58;
        ty = by + (gy / gd) * 58;
        if (this.kickoffT > 0) bot.wantBoost = true;       // rush kickoffs
      }
      // out of fuel and ball far away: top up first
      if (car.boost < 15 && distBall > 560) {
        const p = this.nearestPad(car, false);
        if (p && Math.hypot(p.x - car.x, p.y - car.y) < 620) { tx = p.x; ty = p.y; }
      }
    }
    bot.target.x = clamp(tx + rand(-err, err), 40, W - 40);
    bot.target.y = clamp(ty + rand(-err, err), 40, H - 40);
  }

  nearestPad(car, bigOnly) {
    let best = null, bd = Infinity;
    for (const p of this.pads) {
      if (p.t > 0 || (bigOnly && !p.big)) continue;
      const d = Math.hypot(p.x - car.x, p.y - car.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---------------- physics ----------------
  updateCar(car, c, dt) {
    if (car.demoT > 0) {
      car.demoT -= dt;
      if (car.demoT <= 0) {
        const spots = this.kickoffSpots(car.team, 2);
        const s = spots[this.ball.y > H / 2 ? 0 : 1];
        Object.assign(car, { x: s.x, y: s.y, angle: s.angle, vx: 0, vy: 0 });
      }
      return;
    }
    const speedMul = car.ctrl === 'bot' ? this.diff.speed : 1;
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    const fwd = car.vx * fx + car.vy * fy;

    // low-speed steering floor: a car pinned against a wall (e.g. goal corner)
    // can still rotate itself free while holding throttle or reverse
    const steerRef = Math.abs(fwd) < 130 && c.throttle !== 0
      ? 130 * (c.throttle < 0 ? -1 : 1)
      : fwd;
    const steerScale = clamp(Math.abs(steerRef) / 210, 0, 1) * (steerRef < 0 ? -1 : 1);
    car.angle = wrapAngle(car.angle + c.steer * TURN_RATE * steerScale * dt);

    let accel = 0;
    if (c.throttle > 0) accel = ACCEL;
    else if (c.throttle < 0) accel = fwd > 60 ? -BRAKE : -REV_ACCEL;

    car.boosting = c.boost && car.boost > 0;
    if (car.boosting) {
      accel += BOOST_ACCEL;
      car.boost = Math.max(0, car.boost - BOOST_BURN * dt);
    }
    accel *= speedMul;

    const nfx = Math.cos(car.angle), nfy = Math.sin(car.angle);
    car.vx += nfx * accel * dt;
    car.vy += nfy * accel * dt;

    const lx = -nfy, ly = nfx;
    const lat = car.vx * lx + car.vy * ly;
    const gripAmt = Math.min(1, GRIP * dt);
    car.vx -= lx * lat * gripAmt;
    car.vy -= ly * lat * gripAmt;

    const damp = 1 / (1 + DRAG * dt);
    car.vx *= damp; car.vy *= damp;
    const max = (car.boosting ? MAX_BOOST_SPEED : MAX_SPEED) * speedMul;
    const sp = Math.hypot(car.vx, car.vy);
    if (sp > max) { car.vx *= max / sp; car.vy *= max / sp; }

    car.x += car.vx * dt;
    car.y += car.vy * dt;
    this.collideArena(car, CAR_R, 0.3);

    if (car.boosting && this.phase !== 'countdown') this.spawnFlame(car, nfx, nfy);
  }

  spawnFlame(car, nfx, nfy) {
    nfx = nfx ?? Math.cos(car.angle);
    nfy = nfy ?? Math.sin(car.angle);
    for (let i = 0; i < 2; i++) {
      this.particles.push({
        x: car.x - nfx * 30 + rand(-6, 6), y: car.y - nfy * 30 + rand(-6, 6),
        vx: -nfx * rand(120, 260) + car.vx * 0.4, vy: -nfy * rand(120, 260) + car.vy * 0.4,
        life: rand(0.15, 0.3), max: 0.3, size: rand(4, 9),
        color: TEAM_COLORS[car.team].glow,
      });
    }
  }

  collideArena(o, r, e) {
    let bounced = false;
    for (const [px, py] of [[0, GOAL_TOP], [0, GOAL_BOT], [W, GOAL_TOP], [W, GOAL_BOT]]) {
      const dx = o.x - px, dy = o.y - py;
      const d = Math.hypot(dx, dy), min = r + 10;
      if (d > 0 && d < min) {
        const nx = dx / d, ny = dy / d;
        o.x = px + nx * min; o.y = py + ny * min;
        const vn = o.vx * nx + o.vy * ny;
        if (vn < 0) { o.vx -= (1 + e) * vn * nx; o.vy -= (1 + e) * vn * ny; bounced = true; }
      }
    }
    const cuts = [
      [1, 1, o.x + o.y],
      [-1, 1, (W - o.x) + o.y],
      [1, -1, o.x + (H - o.y)],
      [-1, -1, (W - o.x) + (H - o.y)],
    ];
    const S = Math.SQRT1_2;
    for (const [sx, sy, sum] of cuts) {
      const need = CORNER + r * Math.SQRT2;
      if (sum < need) {
        const nx = sx * S, ny = sy * S;
        const push = (need - sum) * S;
        o.x += nx * push; o.y += ny * push;
        const vn = o.vx * nx + o.vy * ny;
        if (vn < 0) { o.vx -= (1 + e) * vn * nx; o.vy -= (1 + e) * vn * ny; bounced = true; }
      }
    }
    for (const side of [-1, 1]) {
      const over = side < 0 ? r - o.x : o.x - (W - r);
      if (over > 0) {
        const inMouth = o.y > GOAL_TOP + 8 && o.y < GOAL_BOT - 8;
        if (!inMouth) {
          o.x = side < 0 ? r : W - r;
          if (o.vx * side > 0) { o.vx = -o.vx * e; bounced = true; }
        } else {
          const backX = side < 0 ? -GOAL_DEPTH + 8 + r : W + GOAL_DEPTH - 8 - r;
          if ((side < 0 && o.x < backX) || (side > 0 && o.x > backX)) {
            o.x = backX;
            if (o.vx * side > 0) { o.vx = -o.vx * e; bounced = true; }
          }
          if (o.y - r < GOAL_TOP) { o.y = GOAL_TOP + r; if (o.vy < 0) o.vy = -o.vy * e; }
          if (o.y + r > GOAL_BOT) { o.y = GOAL_BOT - r; if (o.vy > 0) o.vy = -o.vy * e; }
        }
      }
    }
    if (o.y - r < 0) { o.y = r; if (o.vy < 0) { o.vy = -o.vy * e; bounced = true; } }
    if (o.y + r > H) { o.y = H - r; if (o.vy > 0) { o.vy = -o.vy * e; bounced = true; } }
    return bounced;
  }

  hitBall(car) {
    const b = this.ball;
    const dx = b.x - car.x, dy = b.y - car.y;
    const d = Math.hypot(dx, dy), min = BALL_R + CAR_R;
    if (d <= 0 || d >= min) return;
    const nx = dx / d, ny = dy / d;
    b.x = car.x + nx * min;
    b.y = car.y + ny * min;
    const rel = (car.vx - b.vx) * nx + (car.vy - b.vy) * ny;
    if (rel > 0) {
      const power = rel * 1.35 + 80;
      b.vx += nx * power; b.vy += ny * power;
      car.vx -= nx * rel * 0.3; car.vy -= ny * rel * 0.3;
      if (rel > 140) {
        this.sfx.hit(rel);
        this.emit('hit', { p: Math.round(rel), x: Math.round(b.x), y: Math.round(b.y) });
        this.shake = Math.min(14, this.shake + rel / 120);
        this.spawnSparks(b.x - nx * BALL_R, b.y - ny * BALL_R, nx, ny, rel);
      }
    }
  }

  spawnSparks(x, y, nx, ny, rel) {
    for (let i = 0; i < Math.min(14, rel / 60); i++) {
      this.particles.push({
        x, y,
        vx: nx * rand(50, 300) + rand(-120, 120), vy: ny * rand(50, 300) + rand(-120, 120),
        life: rand(0.2, 0.45), max: 0.45, size: rand(2, 5), color: '#ffffff',
      });
    }
  }

  carVsCar(a, b) {
    if (a.demoT > 0 || b.demoT > 0) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy), min = CAR_R * 2;
    if (d <= 0 || d >= min) return;
    const nx = dx / d, ny = dy / d;
    const push = (min - d) / 2;
    a.x -= nx * push; a.y -= ny * push;
    b.x += nx * push; b.y += ny * push;
    const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (rel > 0) {
      const aSp = Math.hypot(a.vx, a.vy), bSp = Math.hypot(b.vx, b.vy);
      if (a.team !== b.team) {
        if (rel > 520 && a.boosting && aSp > SUPERSONIC && aSp > bSp) return this.demolish(b);
        if (rel > 520 && b.boosting && bSp > SUPERSONIC && bSp > aSp) return this.demolish(a);
      }
      a.vx -= nx * rel * 0.55; a.vy -= ny * rel * 0.55;
      b.vx += nx * rel * 0.55; b.vy += ny * rel * 0.55;
      if (rel > 200) { this.sfx.bounce(); this.emit('bounce', {}); this.shake = Math.min(10, this.shake + 3); }
    }
  }

  demolish(car) {
    car.demoT = 2.5;
    this.sfx.demo();
    this.emit('demo', { x: Math.round(car.x), y: Math.round(car.y), team: car.team });
    this.shake = 16;
    this.spawnExplosion(car.x, car.y, TEAM_COLORS[car.team].glow, false);
  }

  spawnBurst(x, y, color, count, maxSp) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(80, maxSp);
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.3, 1.1), max: 1.1, size: rand(3, 9),
        color: Math.random() < 0.75 ? color : '#ffffff',
      });
    }
  }

  // full explosion: debris burst + expanding shockwave rings + screen flash
  spawnExplosion(x, y, color, big) {
    this.spawnBurst(x, y, color, big ? 90 : 55, big ? 700 : 580);
    this.rings.push({ x, y, r: 18, vr: big ? 950 : 750, life: 0.5, max: 0.5, color });
    this.rings.push({ x, y, r: 8, vr: big ? 550 : 430, life: 0.7, max: 0.7, color: '#ffffff' });
    this.flash = Math.min(0.5, this.flash + (big ? 0.42 : 0.3));
  }

  // ---------------- main update (local + server) ----------------
  update(dt) {
    const ph = this.phase;

    if (ph === 'countdown') {
      this.phaseT -= dt;
      const c = Math.ceil(this.phaseT);
      if (c < this.lastCount && c > 0) { this.sfx.count(); this.emit('count', {}); this.lastCount = c; }
      if (this.phaseT <= 0) {
        this.phase = 'play'; this.kickoffT = 1.3;
        this.sfx.go(); this.emit('go', {});
        this.lastCount = 4;
      }
      // keep leftover celebration particles fading during the countdown
      this.updateParticles(dt);
      this.decayShake(dt);
      return;
    }
    if (ph === 'over') { this.updateParticles(dt); this.decayShake(dt); return; }

    if (ph === 'play') {
      this.kickoffT -= dt;
      if (this.overtime) this.time += dt;
      else {
        this.time -= dt;
        if (this.time <= 0) {
          this.time = 0;
          if (this.score.blue === this.score.orange) {
            this.overtime = true;
            this.message = 'OVERTIME!';
            this.sfx.whistle(); this.emit('whistle', {});
            this.phase = 'countdown'; this.phaseT = 3;
            this.resetKickoff();
            this.updateParticles(dt);
            return;
          }
          return this.finish();
        }
      }
    }

    // cars
    for (const car of this.cars) this.updateCar(car, this.controlsFor(car, dt), dt);
    if (!this.isClient && this.mode === 'local') {
      this.sfx.setBoost(this.cars.some(
        (c) => c.boosting && c.demoT <= 0 && (c.ctrl === 'k1' || c.ctrl === 'k2')));
    }

    // ball
    const b = this.ball;
    const damp = 1 / (1 + BALL_DRAG * dt);
    b.vx *= damp; b.vy *= damp;
    const bs = Math.hypot(b.vx, b.vy);
    if (bs > BALL_MAX) { b.vx *= BALL_MAX / bs; b.vy *= BALL_MAX / bs; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (this.collideArena(b, BALL_R, REST) && bs > 220) { this.sfx.bounce(); this.emit('bounce', {}); }

    this.updateTrail(bs);

    // collisions
    for (const car of this.cars) if (car.demoT <= 0) this.hitBall(car);
    for (let i = 0; i < this.cars.length; i++)
      for (let j = i + 1; j < this.cars.length; j++)
        this.carVsCar(this.cars[i], this.cars[j]);

    // boost pads
    for (const p of this.pads) {
      if (p.t > 0) { p.t -= dt; continue; }
      for (const car of this.cars) {
        if (car.demoT > 0 || car.boost >= 100) continue;
        const d = Math.hypot(car.x - p.x, car.y - p.y);
        if (d < (p.big ? 64 : 46)) {
          car.boost = clamp(car.boost + (p.big ? 100 : 12), 0, 100);
          p.t = p.big ? 10 : 4;
          if (car.ctrl === 'k1' || car.ctrl === 'k2') this.sfx.pad(p.big);
          if (car.ctrl === 'net') this.emit('pad', { big: p.big ? 1 : 0, id: car.netId });
          break;
        }
      }
    }

    // goals (whole ball over the line)
    if (ph === 'play') {
      if (b.x < -BALL_R) this.goalScored('orange');
      else if (b.x > W + BALL_R) this.goalScored('blue');
    }
    if (ph === 'goal') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'countdown'; this.phaseT = 3; this.message = '';
        this.resetKickoff();
      }
    }

    this.updateParticles(dt);
    this.decayShake(dt);
  }

  updateTrail(bs) {
    if (bs > 380) {
      this.ballTrail.push({ x: this.ball.x, y: this.ball.y, a: clamp(bs / BALL_MAX, 0.15, 0.55) });
      if (this.ballTrail.length > 18) this.ballTrail.shift();
    } else if (this.ballTrail.length) this.ballTrail.shift();
  }

  goalScored(team) {
    this.score[team]++;
    this.phase = 'goal';
    this.phaseT = 2.6;
    this.goalTeam = team;
    this.message = 'GOAL!';
    this.sfx.goal();
    this.emit('goal', { team, x: Math.round(this.ball.x), y: Math.round(this.ball.y) });
    this.shake = 22;
    this.spawnExplosion(this.ball.x, this.ball.y, TEAM_COLORS[team].glow, true);
    if (this.overtime) {
      // golden goal: show the celebration, then end the match
      this.phase = 'over_pending';
      this.endTimer = setTimeout(() => this.finish(), 2200);
    }
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'over';
    this.sfx.whistle();
    this.emit('whistle', {});
    this.sfx.setBoost(false);
    for (const car of this.cars) car.boosting = false;
    const { blue, orange } = this.score;
    this.message = blue > orange ? 'BLUE WINS!' : 'ORANGE WINS!';
    this.endTimer = setTimeout(() => {
      if (this.running && this.onEnd) this.onEnd({ ...this.score, overtime: this.overtime });
    }, 1600);
  }

  updateParticles(dt) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 / (1 + 2.5 * dt); p.vy *= 1 / (1 + 2.5 * dt);
    }
    const rs = this.rings;
    for (let i = rs.length - 1; i >= 0; i--) {
      const r = rs[i];
      r.life -= dt;
      if (r.life <= 0) { rs.splice(i, 1); continue; }
      r.r += r.vr * dt;
      r.vr *= 1 / (1 + 1.6 * dt);
    }
  }
  decayShake(dt) {
    this.shake *= Math.max(0, 1 - 7 * dt);
    this.flash *= Math.max(0, 1 - 5 * dt);
  }

  // ---------------- network: server side ----------------
  getSnapshot() {
    const r1 = (v) => Math.round(v * 10) / 10;
    const snap = {
      ball: [r1(this.ball.x), r1(this.ball.y), r1(this.ball.vx), r1(this.ball.vy)],
      cars: this.cars.map((c) => [
        r1(c.x), r1(c.y), Math.round(c.angle * 1000) / 1000,
        Math.round(c.boost), (c.boosting ? 1 : 0) | (c.demoT > 0 ? 2 : 0),
      ]),
      score: [this.score.blue, this.score.orange],
      time: r1(this.time),
      ot: this.overtime ? 1 : 0,
      phase: this.phase,
      phaseT: r1(this.phaseT),
      gt: this.goalTeam,
      msg: this.message,
      pads: this.pads.map((p) => r1(Math.max(0, p.t))),
      ev: this.events,
    };
    this.events = [];
    return snap;
  }

  // ---------------- network: client side ----------------
  applyStart(slots) {
    this.cars = [];
    for (const s of slots) this.addCar({ ...s, ctrl: s.ctrl === 'net' ? 'net' : 'bot' });
    this.resetKickoff();
  }

  applySnap(s) {
    this.snapPrev = this.snapCur;
    this.snapCur = { rt: performance.now(), s };
    this.score.blue = s.score[0]; this.score.orange = s.score[1];
    this.time = s.time;
    this.overtime = !!s.ot;
    this.phase = s.phase === 'over_pending' ? 'goal' : s.phase;
    this.phaseT = s.phaseT;
    this.goalTeam = s.gt;
    this.message = s.msg;
    s.pads.forEach((t, i) => { if (this.pads[i]) this.pads[i].t = t; });
    for (const ev of s.ev || []) this.clientEvent(ev);
  }

  clientEvent(ev) {
    switch (ev.e) {
      case 'goal':
        this.sfx.goal();
        this.shake = 22;
        this.spawnExplosion(ev.x, ev.y, TEAM_COLORS[ev.team].glow, true);
        break;
      case 'hit':
        this.sfx.hit(ev.p);
        this.shake = Math.min(14, this.shake + ev.p / 120);
        break;
      case 'demo':
        this.sfx.demo();
        this.shake = 16;
        this.spawnExplosion(ev.x, ev.y, TEAM_COLORS[ev.team].glow, false);
        break;
      case 'bounce': this.sfx.bounce(); break;
      case 'count': this.sfx.count(); break;
      case 'go': this.sfx.go(); break;
      case 'whistle': this.sfx.whistle(); break;
      case 'pad': if (ev.id === this.opts.myId) this.sfx.pad(!!ev.big); break;
    }
  }

  clientTick(dt) {
    const sc = this.snapCur, sp = this.snapPrev;
    if (sc && sp) {
      const span = Math.max(20, sc.rt - sp.rt);
      const a = clamp((performance.now() - sc.rt) / span, 0, 1.25);
      const bp = sp.s.ball, bc = sc.s.ball;
      this.ball.x = bp[0] + (bc[0] - bp[0]) * a;
      this.ball.y = bp[1] + (bc[1] - bp[1]) * a;
      this.ball.vx = bc[2]; this.ball.vy = bc[3];
      this.cars.forEach((car, i) => {
        const p = sp.s.cars[i], c = sc.s.cars[i];
        if (!p || !c) return;
        car.x = p[0] + (c[0] - p[0]) * a;
        car.y = p[1] + (c[1] - p[1]) * a;
        car.angle = lerpAngle(p[2], c[2], a);
        car.boost = c[3];
        car.boosting = !!(c[4] & 1);
        car.demoT = (c[4] & 2) ? 1 : 0;
      });
    } else if (sc) {
      this.cars.forEach((car, i) => {
        const c = sc.s.cars[i];
        if (!c) return;
        [car.x, car.y, car.angle, car.boost] = c;
        car.boosting = !!(c[4] & 1);
        car.demoT = (c[4] & 2) ? 1 : 0;
      });
      [this.ball.x, this.ball.y, this.ball.vx, this.ball.vy] = sc.s.ball;
    }
    if (this.phase === 'play' || this.phase === 'goal') {
      for (const car of this.cars) {
        if (car.boosting && car.demoT <= 0) this.spawnFlame(car);
      }
      this.updateTrail(Math.hypot(this.ball.vx, this.ball.vy));
    }
    const mc = this.myCar();
    this.sfx.setBoost(!!(mc && mc.boosting && mc.demoT <= 0));
    this.updateParticles(dt);
    this.decayShake(dt);
  }

  // ============================================================
  //  Rendering
  // ============================================================
  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 100, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.7);
    bg.addColorStop(0, '#101820');
    bg.addColorStop(1, '#05080c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const sx = rand(-1, 1) * this.shake, sy = rand(-1, 1) * this.shake;
    ctx.translate(MARGIN_X + sx, MARGIN_Y + sy);

    this.drawField(ctx);
    this.drawPads(ctx);
    this.drawTrail(ctx);
    for (const car of this.cars) this.drawCar(ctx, car);
    this.drawBall(ctx);
    this.drawParticles(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawHud(ctx);
  }

  fieldPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(CORNER, 0);
    ctx.lineTo(W - CORNER, 0);
    ctx.lineTo(W, CORNER);
    ctx.lineTo(W, GOAL_TOP);
    ctx.lineTo(W + GOAL_DEPTH, GOAL_TOP);
    ctx.lineTo(W + GOAL_DEPTH, GOAL_BOT);
    ctx.lineTo(W, GOAL_BOT);
    ctx.lineTo(W, H - CORNER);
    ctx.lineTo(W - CORNER, H);
    ctx.lineTo(CORNER, H);
    ctx.lineTo(0, H - CORNER);
    ctx.lineTo(0, GOAL_BOT);
    ctx.lineTo(-GOAL_DEPTH, GOAL_BOT);
    ctx.lineTo(-GOAL_DEPTH, GOAL_TOP);
    ctx.lineTo(0, GOAL_TOP);
    ctx.lineTo(0, CORNER);
    ctx.closePath();
  }

  drawField(ctx) {
    ctx.save();
    this.fieldPath(ctx);
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e3a2d');
    g.addColorStop(1, '#0a2b22');
    ctx.fillStyle = g;
    ctx.fillRect(-GOAL_DEPTH, 0, W + GOAL_DEPTH * 2, H);
    ctx.fillStyle = 'rgba(255,255,255,0.028)';
    for (let i = 0; i < 8; i++) if (i % 2 === 0) ctx.fillRect(i * W / 8, 0, W / 8, H);
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? 0 : W;
      const gg = ctx.createLinearGradient(x0, 0, x0 + side * -220, 0);
      gg.addColorStop(0, side < 0 ? 'rgba(57,192,255,0.16)' : 'rgba(255,176,58,0.16)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(side < 0 ? 0 : W - 220, GOAL_TOP - 90, 220, GOAL_MOUTH + 180);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 130, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill();
    for (const side of [0, 1]) {
      const x = side === 0 ? 0 : W - 260;
      ctx.strokeRect(x, H / 2 - 250, 260, 500);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? -GOAL_DEPTH : W;
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(x0 + (GOAL_DEPTH / 5) * i, GOAL_TOP);
        ctx.lineTo(x0 + (GOAL_DEPTH / 5) * i, GOAL_BOT);
        ctx.stroke();
      }
      for (let i = 1; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(x0, GOAL_TOP + (GOAL_MOUTH / 8) * i);
        ctx.lineTo(x0 + GOAL_DEPTH, GOAL_TOP + (GOAL_MOUTH / 8) * i);
        ctx.stroke();
      }
    }
    ctx.restore();
    this.fieldPath(ctx);
    ctx.strokeStyle = 'rgba(120,220,255,0.35)';
    ctx.lineWidth = 5;
    ctx.shadowColor = 'rgba(80,200,255,0.5)';
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#39c0ff';
    ctx.beginPath(); ctx.moveTo(0, GOAL_TOP); ctx.lineTo(0, GOAL_BOT); ctx.stroke();
    ctx.strokeStyle = '#ffb03a';
    ctx.beginPath(); ctx.moveTo(W, GOAL_TOP); ctx.lineTo(W, GOAL_BOT); ctx.stroke();
  }

  drawPads(ctx) {
    const t = performance.now() / 1000;
    for (const p of this.pads) {
      const active = p.t <= 0;
      const r = p.big ? 22 : 10;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.big) ctx.rotate(t * 0.8);
      ctx.globalAlpha = active ? 1 : 0.18;
      if (active) {
        ctx.shadowColor = '#ffd94a';
        ctx.shadowBlur = p.big ? 26 : 12;
      }
      ctx.fillStyle = p.big ? '#ffd94a' : '#e8c33a';
      if (p.big) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  drawTrail(ctx) {
    for (let i = 0; i < this.ballTrail.length; i++) {
      const p = this.ballTrail[i];
      const f = i / this.ballTrail.length;
      ctx.globalAlpha = p.a * f * 0.6;
      ctx.fillStyle = '#cfefff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, BALL_R * (0.4 + f * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawBall(ctx) {
    const b = this.ball;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(4, 8, BALL_R * 0.95, BALL_R * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 600) { ctx.shadowColor = '#9fdcff'; ctx.shadowBlur = 24; }
    const g = ctx.createRadialGradient(-9, -9, 4, 0, 0, BALL_R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#d9e4ea');
    g.addColorStop(1, '#8fa3ad');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, BALL_R, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.rotate((b.x + b.y) / 140);
    ctx.strokeStyle = 'rgba(70,90,100,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      ctx.lineTo(Math.cos(a) * BALL_R * 0.55, Math.sin(a) * BALL_R * 0.55);
    }
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  drawCar(ctx, car) {
    if (car.demoT > 0) return;
    const col = TEAM_COLORS[car.team];
    const body = col.body[car.idx % col.body.length];
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(4, 9, 34, 24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.rotate(car.angle);
    const sp = Math.hypot(car.vx, car.vy);
    if (sp > SUPERSONIC || (this.isClient && car.boosting)) {
      ctx.shadowColor = col.glow; ctx.shadowBlur = 26;
    }
    ctx.fillStyle = '#101418';
    for (const [wx, wy] of [[-18, -20], [18, -20], [-18, 20], [18, 20]]) {
      ctx.beginPath(); ctx.roundRect(wx - 8, wy - 5, 16, 10, 4); ctx.fill();
    }
    const g = ctx.createLinearGradient(-30, 0, 30, 0);
    g.addColorStop(0, col.dark); g.addColorStop(0.5, body); g.addColorStop(1, col.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(30, 0); ctx.lineTo(18, -16); ctx.lineTo(-24, -16);
    ctx.quadraticCurveTo(-32, 0, -24, 16); ctx.lineTo(18, 16);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(12,20,26,0.85)';
    ctx.beginPath(); ctx.roundRect(-12, -9, 18, 18, 5); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(26, 0, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (car.name) {
      ctx.font = '600 16px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = car.netId === this.opts.myId ? '#ffffff' : 'rgba(232,244,255,0.65)';
      ctx.fillText(car.name, 0, -46);
    }
    ctx.restore();
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.life / p.max), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const r of this.rings) {
      const f = r.life / r.max;
      ctx.globalAlpha = f * 0.85;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2 + 11 * f;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawHud(ctx) {
    const cx = CANVAS_W / 2;
    ctx.save();
    if (this.flash > 0.015) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.55, this.flash)})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    ctx.font = '700 44px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const panelW = 340, panelH = 66;
    ctx.fillStyle = 'rgba(6,10,14,0.78)';
    ctx.beginPath(); ctx.roundRect(cx - panelW / 2, 10, panelW, panelH, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(140,220,255,0.25)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#39c0ff';
    ctx.fillText(String(this.score.blue), cx - 110, 45);
    ctx.fillStyle = '#ffb03a';
    ctx.fillText(String(this.score.orange), cx + 110, 45);
    ctx.font = '700 30px "Chakra Petch", sans-serif';
    ctx.fillStyle = this.overtime ? '#ffd94a' : '#e8f4ff';
    const t = Math.max(0, this.time);
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    ctx.fillText(`${this.overtime ? '+' : ''}${mm}:${String(ss).padStart(2, '0')}`, cx, 45);

    // boost gauges
    if (this.isClient) {
      const mc = this.myCar();
      if (mc) this.drawBoostGauge(ctx, 130, CANVAS_H - 64, mc, 'YOU');
    } else {
      const k1 = this.cars.find((c) => c.ctrl === 'k1');
      const k2 = this.cars.find((c) => c.ctrl === 'k2');
      if (k1) this.drawBoostGauge(ctx, 130, CANVAS_H - 64, k1, k2 ? 'P1' : 'BOOST');
      if (k2) this.drawBoostGauge(ctx, CANVAS_W - 130, CANVAS_H - 64, k2, 'P2');
    }

    const midY = CANVAS_H / 2;
    ctx.textAlign = 'center';
    if (this.phase === 'countdown') {
      const n = Math.max(1, Math.ceil(this.phaseT));
      ctx.font = '700 150px "Chakra Petch", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.shadowColor = '#39c0ff'; ctx.shadowBlur = 30;
      ctx.fillText(String(n), cx, midY - 30);
      ctx.shadowBlur = 0;
      if (this.message) {
        ctx.font = '700 54px "Chakra Petch", sans-serif';
        ctx.fillStyle = '#ffd94a';
        ctx.fillText(this.message, cx, midY - 160);
      }
    } else if (this.phase === 'goal' || this.phase === 'over_pending') {
      const col = this.goalTeam === 'blue' ? '#39c0ff' : '#ffb03a';
      ctx.font = '700 130px "Chakra Petch", sans-serif';
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = 40;
      ctx.fillText('GOAL!', cx, midY - 30);
      ctx.shadowBlur = 0;
    } else if (this.phase === 'over') {
      ctx.fillStyle = 'rgba(4,8,12,0.6)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      const col = this.score.blue > this.score.orange ? '#39c0ff' : '#ffb03a';
      ctx.font = '700 96px "Chakra Petch", sans-serif';
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = 35;
      ctx.fillText(this.message, cx, midY - 20);
      ctx.shadowBlur = 0;
    } else if (this.phase === 'play' && this.overtime) {
      ctx.font = '700 34px "Chakra Petch", sans-serif';
      ctx.fillStyle = 'rgba(255,217,74,0.85)';
      ctx.fillText('GOLDEN GOAL', cx, 108);
    }

    if (this.paused && this.phase !== 'over') {
      ctx.fillStyle = 'rgba(4,8,12,0.66)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.font = '700 80px "Chakra Petch", sans-serif';
      ctx.fillStyle = '#e8f4ff';
      ctx.fillText('PAUSED', cx, midY - 20);
      ctx.font = '600 28px "Chakra Petch", sans-serif';
      ctx.fillStyle = 'rgba(232,244,255,0.7)';
      ctx.fillText('Press ESC / P to resume', cx, midY + 44);
    }
    ctx.restore();
  }

  drawBoostGauge(ctx, x, y, car, label) {
    const pct = car.boost / 100;
    const col = TEAM_COLORS[car.team].glow;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 11;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.arc(x, y, 42, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
    ctx.strokeStyle = pct > 0.99 ? '#ffd94a' : col;
    ctx.shadowColor = col; ctx.shadowBlur = car.boosting ? 18 : 0;
    ctx.beginPath();
    ctx.arc(x, y, 42, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * pct);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = '700 30px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8f4ff';
    ctx.fillText(String(Math.round(car.boost)), x, y);
    ctx.font = '600 15px "Chakra Petch", sans-serif';
    ctx.fillStyle = 'rgba(232,244,255,0.6)';
    ctx.fillText(label, x, y + 62);
    ctx.restore();
  }
}
