// Uprząż testowa: emulator Questa 2 (IWER) sterowany ręcznie. Strona musi być otwarta z ?emu.
// Klatki XR pompujemy sami, więc test nie zależy od tego, czy panel przeglądarki jest widoczny.
const G = window.__game, dev = window.__xr;
const ctrl = { L: dev.controllers.left, R: dev.controllers.right };
const OFF = { L: [-0.004, -0.0159, 0.0496], R: [0.004, -0.0159, 0.0496] }; // uchwyt względem kontrolera
const q = [];
let T = 20000;
window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
window.cancelAnimationFrame = () => {};

export function pump(n = 1) {
  for (let i = 0; i < n; i++) {
    T += 1 / 72; G.setVirtual(T, false);
    const cbs = q.splice(0);
    for (const cb of cbs) cb(T * 1000);
  }
}
export async function enterVR() {
  const btn = [...document.querySelectorAll('button')].find(b => /VR/.test(b.textContent));
  btn.click();
  await new Promise(r => setTimeout(r, 500));
  pump(10);
  return G.presenting;
}
export function trigger(side = 'R') {
  ctrl[side].updateButtonValue('trigger', 1); pump(3);
  ctrl[side].updateButtonValue('trigger', 0); pump(2);
}
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
export const PAD_OFF = {
  jabL: [-0.17, -0.12, -0.55], jabR: [0.17, -0.12, -0.55],
  hookL: [-0.40, -0.10, -0.42], hookR: [0.40, -0.10, -0.42],
  upperL: [-0.15, -0.42, -0.45], upperR: [0.15, -0.42, -0.45],
};
const DIR = {
  jabL: [0, 0, -1], jabR: [0, 0, -1], hookL: norm([1, 0, -0.3]), hookR: norm([-1, 0, -0.3]),
  upperL: norm([0, 1, -0.2]), upperR: norm([0, 1, -0.2]),
};
const glove = { L: [-0.22, 1.45, -0.3], R: [0.22, 1.45, -0.3] };
const head = [0, 1.6, 0];

// Gracz jak ciało: głowa robi uniki, ręce są przyczepione do głowy.
// aim = 'body' celuje w naturalne miejsce ciosu względem GŁOWY (tak bije człowiek),
// aim = 'pad' celuje w rzeczywiste położenie tarczy.
let hold = { hx: 0, hy: 1.6, until: 0 };
// hold: ile sekund głowa zostaje w uniku po przejściu przeszkody (kontra z pozycji uniku)
export function bodyStep({ aim = 'body', dodge = true, maxSpeed = 6, holdS = 0 } = {}) {
  let hx = 0, hy = 1.6, any = false;
  if (dodge) for (const a of G.list) {
    if (a.state !== 'fly' || a.e.kind === 'pad' || a.e.kind === 'punch') continue;
    if (a.z > a.zHit - 3.5) { any = true; if (a.e.kind === 'duck') hy = 1.3; else hx = a.e.kind === 'wallL' ? 0.3 : -0.3; }
  }
  if (any) hold = { hx, hy, until: T + holdS };
  else if (T < hold.until) { hx = hold.hx; hy = hold.hy; }
  // głowa przesuwa się płynnie, nie skokiem (ok. 3 m/s)
  const dh = [hx - head[0], hy - head[1]], lh = Math.hypot(...dh), mh = 3 / 72;
  const kh = lh > mh ? mh / lh : 1; head[0] += dh[0] * kh; head[1] += dh[1] * kh;
  dev.position.set(head[0], head[1], 0);
  for (const s of ['L', 'R']) {
    let best = null, bt = 9;
    for (const a of G.list) {
      if (a.state !== 'fly' || a.e.kind !== 'pad' || a.e.hand !== s) continue;
      const tt = (a.zHit - a.z) / 6;
      if (tt > -0.03 && tt < 0.35 && tt < bt) { bt = tt; best = a; }
    }
    let t;
    if (best) {
      const d = DIR[best.e.key];
      const o = PAD_OFF[best.e.key];
      const hit = aim === 'pad' ? [best.x, best.y, best.zHit] : [head[0] + o[0], head[1] + o[1], o[2]];
      t = bt > 0.08 ? hit.map((v, i) => v - d[i] * 0.35) : hit.map((v, i) => v - d[i] * 5 * bt);
    } else t = [head[0] + (s === 'L' ? -0.22 : 0.22), head[1] - 0.15, -0.3];
    const g = glove[s], dd = t.map((v, i) => v - g[i]), l = Math.hypot(...dd), m = maxSpeed / 72;
    const k = l > m ? m / l : 1;
    for (let i = 0; i < 3; i++) g[i] += dd[i] * k;
    ctrl[s].position.set(g[0] - OFF[s][0], g[1] - OFF[s][1], g[2] - OFF[s][2]);
  }
}
export function runRound(frames, opts) {
  for (let i = 0; i < frames; i++) { bodyStep(opts); pump(1); if (G.state === 'end') break; }
  return G.stats();
}
// Pierwsza tarcza po każdej ścianie (uniku w bok): trafiona czy nie
export function afterSlip() {
  const ch = G.chart, out = { hit: 0, wrong: 0, miss: 0, pending: 0 };
  ch.forEach((e, i) => {
    if (e.kind !== 'wallL' && e.kind !== 'wallR') return;
    const next = ch.slice(i + 1).find(x => x.kind === 'pad');
    if (!next) return;
    out[next.res || 'pending']++;
  });
  return out;
}

// ---------- tryb obrony i menu ----------
function setGlove(s, p) { glove[s] = p.slice(); ctrl[s].position.set(p[0] - OFF[s][0], p[1] - OFF[s][1], p[2] - OFF[s][2]); }
function setHead(x, y) { head[0] = x; head[1] = y; dev.position.set(x, y, 0); }
// style: 'guard' ręce przed twarzą, 'duck' schyla się przy każdym ciosie, 'idle' stoi z opuszczonymi rękami
export function defenseStep(style) {
  if (style === 'guard') {
    setHead(0, 1.6);
    setGlove('L', [-0.07, 1.57, -0.22]); setGlove('R', [0.07, 1.57, -0.22]);
    return;
  }
  const ty = style === 'duck' && G.punches.some(p => p.phase === 'fly') ? 1.25 : 1.6;
  const dy = ty - head[1], m = 3 / 72;
  setHead(0, head[1] + Math.max(-m, Math.min(m, dy)));
  setGlove('L', [-0.3, head[1] - 0.55, -0.05]); setGlove('R', [0.3, head[1] - 0.55, -0.05]);
}
export function runDefense(frames, style) {
  for (let i = 0; i < frames; i++) { defenseStep(style); pump(1); if (G.state === 'end') break; }
  return G.stats();
}
// uderz tarczę menu: 0 = COMBOS, 1 = DON'T GET HIT
export function punchMenu(i, side = 'R') {
  pump(100); // tarcze dojeżdżają do gracza, menu się uzbraja
  const pad = G.menuPads[i].position;
  for (let f = 0; f <= 12; f++) {
    const z = pad.z + 0.36 - f * (4 / 72);
    setGlove(side, [pad.x, pad.y, z]); pump(1);
    if (G.state === 'countdown') return G.stats().mode;
  }
  return G.state;
}

// ---------- Ball Machine ----------
// style: 'dodge' czyta lot piłki jak człowiek (reaguje po `react` s od strzału), 'wrong' robi unik w stronę piłki,
// 'idle' stoi z opuszczonymi rękami, 'guard' trzyma rękawice przed twarzą. punch = czy zbija czerwone piłki.
let lastSide = 1;
export function ballsStep(style = 'dodge', { react = 0.25, punch = true, headSpeed = 3 } = {}) {
  let tx = 0, ty = 1.6;
  const fly = G.balls.filter(b => b.state === 'fly');
  if (style === 'dodge' || style === 'wrong') {
    const ys = fly.filter(b => b.k === 'y' && b.t > react);
    if (ys.length) {
      const b = ys.reduce((m, x) => (x.pos.z > m.pos.z ? x : m));
      if (ys.some(x => x.spread)) ty = 1.33;
      else {
        const side = Math.abs(b.dx) < 0.01 ? lastSide : -Math.sign(b.dx);
        lastSide = side;
        tx = (style === 'wrong' ? -side : side) * 0.22;
      }
    }
  }
  const dh = [tx - head[0], ty - head[1]], lh = Math.hypot(...dh), mh = headSpeed / 72;
  const kh = lh > mh ? mh / lh : 1; setHead(head[0] + dh[0] * kh, head[1] + dh[1] * kh);
  for (const s of ['L', 'R']) {
    let t = style === 'guard' ? [head[0] + (s === 'L' ? -0.07 : 0.07), head[1] - 0.03, -0.22]
      : style === 'idle' ? [head[0] + (s === 'L' ? -0.3 : 0.3), head[1] - 0.55, -0.05]
      : [head[0] + (s === 'L' ? -0.22 : 0.22), head[1] - 0.25, -0.3];
    if (punch && style !== 'idle') {
      const red = fly.filter(b => b.k === 'r' && b.pos.z > -1.0 && (b.pos.x < head[0] ? 'L' : 'R') === s);
      if (red.length) { const b = red[0]; t = [b.pos.x, b.pos.y, b.pos.z]; }
    }
    const g = glove[s], dd = t.map((v, i) => v - g[i]), l = Math.hypot(...dd), m = 6 / 72;
    const k = l > m ? m / l : 1;
    setGlove(s, g.map((v, i) => v + dd[i] * k));
  }
}
export function runBalls(frames, style, opts) {
  for (let i = 0; i < frames; i++) { ballsStep(style, opts); pump(1); if (G.state === 'end') break; }
  return G.stats();
}

// zrzut z płótna gry do test/zrzuty przez odbior.py (klatka rysowana tuż przed odczytem)
export async function shot(name) {
  const was = window.__noDraw; window.__noDraw = false; pump(1); window.__noDraw = was;
  const c = document.querySelector('canvas');
  await fetch(`http://127.0.0.1:8147/${name}.jpg`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.85) });
  return name;
}
// gra botem, aż warunek na piłkach będzie spełniony (albo minie limit klatek)
export function ballsUntil(cond, style = 'dodge', max = 72 * 30, opts) {
  for (let i = 0; i < max; i++) { ballsStep(style, opts); pump(1); if (cond(G)) return true; if (G.state === 'end') return false; }
  return false;
}

// ---------- Power Bag ----------
// Bot bije jak bokser: zamach do punktu przed strefą, cios wzdłuż kierunku ciosu, powrót do gardy.
// speed = prędkość pięści w ciosie (m/s); wrongHand = bije zawsze tą samą ręką (test, czy zła ręka nie zalicza strefy)
const bagBot = { L: { ph: 'guard' }, R: { ph: 'guard' } };
const wpos = o => [o.matrixWorld.elements[12], o.matrixWorld.elements[13], o.matrixWorld.elements[14]];
export function bagStep({ speed = 6, wrongHand = false } = {}) {
  setHead(0, 1.6);
  const key = G.bagKey;
  for (const s of ['L', 'R']) {
    const st = bagBot[s], other = bagBot[s === 'L' ? 'R' : 'L'];
    const guard = [head[0] + (s === 'L' ? -0.15 : 0.15), head[1] - 0.12, -0.25];
    const k = G.flurry ? (s === 'L' ? 'jabL' : 'jabR') : key;
    const mine = k && (wrongHand ? s === 'R' : k.endsWith(s));
    if (st.ph === 'guard' && mine && other.ph === 'guard') { st.ph = 'wind'; st.key = wrongHand ? k.replace(/[LR]$/, 'R') : k; st.p0 = G.stats().bag.punches; }
    let t = guard, sp = 3;
    if (st.ph !== 'guard') {
      const zk = G.zoneMarks[st.key] ? st.key : k;
      const zp = wpos(G.zoneMarks[zk].g), d = DIR[zk];
      if (st.ph === 'wind') { t = zp.map((v, i) => v - d[i] * 0.3); sp = 4; if (Math.hypot(...t.map((v, i) => v - glove[s][i])) < 0.03) st.ph = 'strike'; }
      else if (st.ph === 'strike') { t = zp.map((v, i) => v + d[i] * 0.1); sp = speed; if (G.stats().bag.punches > st.p0 || Math.hypot(...t.map((v, i) => v - glove[s][i])) < 0.02) st.ph = 'back'; }
      else { t = guard; sp = 4; if (Math.hypot(...t.map((v, i) => v - glove[s][i])) < 0.03) st.ph = 'guard'; }
    }
    const g = glove[s], dd = t.map((v, i) => v - g[i]), l = Math.hypot(...dd), m = sp / 72;
    const kk = l > m ? m / l : 1;
    setGlove(s, g.map((v, i) => v + dd[i] * kk));
  }
}
export function runBag(frames, opts) {
  for (let i = 0; i < frames; i++) { bagStep(opts); pump(1); if (G.state === 'end') break; }
  return G.stats();
}
