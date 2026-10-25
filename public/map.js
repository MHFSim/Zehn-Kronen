// Zehn Kronen – Weltkarte (PixiJS).
// Das Gelände ist EIN Netz aus Dreiecken mit eigenem Shader: Farben, Licht und Schatten sind vorgerechnet,
// das Wasser wird im Shader animiert, der Nebel kommt als Textur dazu. Bäume, Burgen und Lager sind Sprites aus dem
// Atlas (art.js). Netz und Sprites werden in waagerechten Streifen abwechselnd gezeichnet, damit Berge Dinge dahinter
// richtig verdecken.
import { N, G, SUB, SEA, MOUNT, vnoise, fbm, smooth, generateMap, findPath, cellOf, SANCT_R } from '/shared/mapgen.js';
import { PLAYER_COLORS, marchPos, cellXY } from '/shared/world.js';
import { buildAtlas, proj } from '/public/art.js';

export const ELEV = 96;                    // Pixel Höhe pro Höheneinheit über dem Meer
const BW = 4, NB = Math.ceil(2 * N / BW);  // Streifen aus je 4 Diagonalen
const hex = h => [h >> 16 & 255, h >> 8 & 255, h & 255];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hash = (x, y, s = 0) => { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const VERT = `
attribute vec2 aVertexPosition; attribute vec2 aTile; attribute vec3 aCol; attribute float aWater;
uniform mat3 projectionMatrix; uniform mat3 translationMatrix;
varying vec2 vTile; varying vec3 vCol; varying float vWater;
void main(){ vTile=aTile; vCol=aCol; vWater=aWater;
  gl_Position=vec4((projectionMatrix*translationMatrix*vec3(aVertexPosition,1.0)).xy,0.0,1.0); }`;
const FRAG = `
precision mediump float;
varying vec2 vTile; varying vec3 vCol; varying float vWater;
uniform sampler2D uFog; uniform float uTime;
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x), mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x), f.y); }
void main(){
  vec3 col=vCol;
  float t=uTime;
  if(vWater>0.0){
    float d=clamp(vWater,0.0,1.0);
    vec3 shallow=vec3(.30,.66,.68), deep=vec3(.035,.17,.31);
    col=mix(shallow,deep,pow(d,.62));
    vec2 p=vTile*3.2;
    float n=vn(p+vec2(t*.22,t*.13))*.55+vn(p*2.1-vec2(t*.17,-t*.2))*.45;
    col+=(n-.5)*.16*(1.0-d*.55);
    float w=sin(vTile.x*9.0+t*1.4+n*5.0)*sin(vTile.y*8.0-t*1.1+n*4.0);
    col+=vec3(.05,.07,.08)*w*(1.0-d*.6);
    float sp=pow(max(0.0,sin((vTile.x+vTile.y)*23.0+t*2.6+n*9.0)),38.0)*vn(p*3.0+t*.4);
    col+=vec3(.55,.62,.62)*sp*(1.0-d);
    float foam=smoothstep(.055,.0,vWater)*(.55+.45*sin(t*1.5+n*8.0+vTile.x*4.0));
    col=mix(col,vec3(.93,.96,.94),foam*.75);
    float edge=min(min(vTile.x,vTile.y),min(96.0-vTile.x,96.0-vTile.y));
    col=mix(vec3(.02,.10,.19),col,smoothstep(-2.0,5.0,edge));
  } else {
    float shore=smoothstep(.0,.05,-vWater);
    col*=0.9+0.2*vn(vTile*7.0);
    col=mix(col*.82+vec3(.04,.05,.04),col,shore);
  }
  float cl=vn(vTile*.075+vec2(t*.012,t*.005));
  col*=1.0-smoothstep(.5,.78,cl)*.2;
  float f=texture2D(uFog,vTile/96.0).r;
  float lum=dot(vCol,vec3(.3,.55,.15));
  float mist=vn(vTile*.9+vec2(t*.05,-t*.03));
  vec3 fogc=vec3(.075,.095,.125)+vec3(lum-.35)*.22+vec3(.02,.03,.04)*mist;
  float rim=smoothstep(.0,.45,f)*smoothstep(.95,.5,f);
  vec3 outc=mix(fogc,col,smoothstep(.3,.75,f));
  outc+=vec3(.26,.19,.08)*rim*.34;
  gl_FragColor=vec4(outc,1.0);
}`;

export class WorldMap {
  constructor(PIXI, app) {
    this.PIXI = PIXI; this.app = app;
    this.root = new PIXI.Container();
    this.atlas = buildAtlas(PIXI);
    this.time = 0; this.obj = {}; this.sel = null; this.expKey = '';
    this.zoom = 1;
  }
  worldPos(tx, ty, lift = 0) { const [x, y] = proj(tx, ty, this.zAt(tx, ty) + lift); return { x, y }; }
  hAt(tx, ty) {
    const H = this.map.H, gx = clamp(tx * SUB, 0, G - 1.001), gy = clamp(ty * SUB, 0, G - 1.001), x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    const a = H[y0 * G + x0], b = H[y0 * G + x0 + 1], c = H[(y0 + 1) * G + x0], d = H[(y0 + 1) * G + x0 + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  zAt(tx, ty) { const h = this.hAt(tx, ty); return h > SEA ? (h - SEA) * ELEV : 0; }

  /* ---------- Aufbau ---------- */
  load(data) {
    const PIXI = this.PIXI, map = generateMap(data.seed); this.map = map; this.seed = data.seed;
    this.roads = this.makeRoads(map);
    this.buildTerrain(map);
    this.buildSprites(map);
    this.ui = new PIXI.Container(); this.armies = new PIXI.Container(); this.lines = new PIXI.Graphics(); this.ring = new PIXI.Graphics();
    this.armies.sortableChildren = true;
    this.root.addChild(this.lines, this.ring, this.armies, this.ui);
    this.marchSprites = {}; this.labels = {};
  }
  makeRoads(map) {
    const mask = new Float32Array(G * G), C = Math.floor(N / 2);
    const splat = (x, y) => {
      const gx = x * SUB, gy = y * SUB, r = 1.5;
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
        const ix = Math.round(gx) + ox, iy = Math.round(gy) + oy; if (ix < 0 || iy < 0 || ix >= G || iy >= G) continue;
        const d = Math.hypot(ix - gx, iy - gy) / r, w = 1 - smooth(.35, 1, d);
        if (w > mask[iy * G + ix]) mask[iy * G + ix] = w;
      }
    };
    const road = (ax, ay, bx, by) => {
      const p = findPath(map, ax, ay, bx, by, 1.2); if (!p) return;
      let px = null, py = null;
      for (const c of p) {
        const [x, y] = cellXY(c), cx = x + .5, cy = y + .5;
        if (px !== null) for (let k = 0; k < 4; k++) splat(px + (cx - px) * k / 4, py + (cy - py) * k / 4);
        splat(cx, cy); px = cx; py = cy;
      }
    };
    for (const s of map.starts) road(s.x, s.y, C, C);
    for (const o of map.objects) if (o.k === 'sanct') road(o.x, o.y, C, C);
    const cells = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (mask[(y * SUB + 1) * G + x * SUB + 1] > .5) cells[y * N + x] = 1;
    this.roadCells = cells;
    return mask;
  }
  buildTerrain(map) {
    const PIXI = this.PIXI, H = map.H, F = map.F, seed = map.seed, n = G * G;
    const pos = new Float32Array(n * 2), tile = new Float32Array(n * 2), col = new Float32Array(n * 3), wat = new Float32Array(n);
    const at = (x, y) => H[clamp(y, 0, G - 1) * G + clamp(x, 0, G - 1)];
    const C = {
      sand: [220, 202, 148], g1: [104, 152, 64], g2: [78, 126, 52], olive: [136, 142, 72], rock: [132, 122, 106], rock2: [98, 92, 86], snow: [240, 244, 250],
      forest: [44, 86, 44], dirt: [156, 128, 90]
    };
    const pads = { start: [[118, 104, 78], 2.3, .6], camp: [[112, 94, 68], 2.2, .7], ruin: [[112, 106, 90], 1.9, .55], sanct: [[205, 200, 184], 2.4, .8], throne: [[190, 180, 150], 3.4, .8],
      farm: [[150, 126, 70], 1.9, .5], wood: [[98, 82, 52], 1.7, .55], stone: [[150, 144, 130], 1.9, .6], ore: [[100, 92, 82], 2.1, .6] };
    const L = [-.55, -.25, .8], ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      const i = gy * G + gx, x = gx / SUB, y = gy / SUB, h = H[i];
      const z = h > SEA ? (h - SEA) * ELEV : 0, p = proj(x, y, z);
      pos[i * 2] = p[0]; pos[i * 2 + 1] = p[1]; tile[i * 2] = x; tile[i * 2 + 1] = y;
      wat[i] = (SEA - h) / .2;
      const hx = at(gx + 1, gy) - at(gx - 1, gy), hy = at(gx, gy + 1) - at(gx, gy - 1);
      let nx = -hx * 3.0, ny = -hy * 3.0, nz = 1; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const slope = Math.hypot(hx, hy);
      const diff = nx * L[0] + ny * L[1] + nz * L[2];
      let shade = clamp(.8 + (diff - .8) * 1.9, .42, 1.34);
      const avg = (at(gx - 2, gy) + at(gx + 2, gy) + at(gx, gy - 2) + at(gx, gy + 2)) / 4;
      shade *= 1 - clamp((avg - h) * 5, 0, .22);
      const n1 = fbm(x * .33, y * .33, seed + 7, 3), n2 = vnoise(x * 1.7, y * 1.7, seed + 9), n3 = vnoise(x * 5, y * 5, seed + 21);
      const t = h - SEA;
      let c = mixc(C.g1, C.g2, n1);
      c = mixc(c, C.olive, smooth(.38, .75, n2) * .38);
      c = mixc(c, C.sand, 1 - smooth(0, .05 + n2 * .018, t));
      const rockW = Math.max(smooth(.5, .66, h + (n2 - .5) * .06), smooth(.38, 1.0, slope) * .85);
      c = mixc(c, mixc(C.rock, C.rock2, n3), rockW);
      const snowW = smooth(.8, .9, h + (n2 - .5) * .07) * (1 - smooth(.9, 1.5, slope) * .55);
      c = mixc(c, C.snow, snowW);
      const fw = smooth(.5, .6, F[i]) * (h < .62 ? 1 : 0) * (1 - smooth(.4, .9, slope) * .4);
      c = mixc(c, mixc(C.forest, [58, 100, 48], n2), fw * .86);
      // Wege und Plätze
      const rw = this.roads[i];
      if (rw > 0) c = mixc(c, mixc(C.dirt, [132, 104, 70], n3), rw * .78);
      for (const o of map.objects) {
        const pd = pads[o.k]; if (!pd) continue;
        const d = Math.hypot(x - o.x - .5, y - o.y - .5); if (d > pd[1]) continue;
        c = mixc(c, mixc(pd[0], [pd[0][0] * .9, pd[0][1] * .9, pd[0][2] * .9], n3), (1 - smooth(pd[1] * .5, pd[1], d)) * pd[2]);
      }
      col[i * 3] = clamp(c[0] * shade / 255, 0, 1.2); col[i * 3 + 1] = clamp(c[1] * shade / 255, 0, 1.2); col[i * 3 + 2] = clamp(c[2] * shade / 255, 0, 1.2);
    }
    // Indizes nach Diagonalen (hinten zuerst) – Streifen sind zusammenhängende Bereiche
    const idx = new Uint16Array((G - 1) * (G - 1) * 6), starts = new Array(NB + 1).fill(0); let k = 0;
    for (let b = 0; b < NB; b++) {
      starts[b] = k;
      for (let d = b * BW * SUB; d < Math.min((b + 1) * BW * SUB, 2 * (G - 1) - 1); d++) {
        for (let gy = Math.max(0, d - (G - 2)); gy <= Math.min(d, G - 2); gy++) {
          const gx = d - gy; if (gx > G - 2) continue;
          const a = gy * G + gx, bb = a + 1, c = a + G, dd = c + 1;
          if ((gx + gy) & 1) { idx[k++] = a; idx[k++] = bb; idx[k++] = c; idx[k++] = bb; idx[k++] = dd; idx[k++] = c; }
          else { idx[k++] = a; idx[k++] = bb; idx[k++] = dd; idx[k++] = a; idx[k++] = dd; idx[k++] = c; }
        }
      }
    }
    starts[NB] = k;
    const geo = new PIXI.Geometry();
    geo.addAttribute('aVertexPosition', pos, 2).addAttribute('aTile', tile, 2).addAttribute('aCol', col, 3).addAttribute('aWater', wat, 1).addIndex(idx);
    // Nebeltextur 96 x 96 (R-Kanal)
    this.fogData = new Uint8Array(N * N * 4); for (let q = 3; q < this.fogData.length; q += 4) this.fogData[q] = 255;
    this.fogTex = PIXI.Texture.fromBuffer(this.fogData, N, N, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    this.shader = PIXI.Shader.from(VERT, FRAG, { uFog: this.fogTex, uTime: 0 });
    this.bands = [];
    for (let b = 0; b < NB; b++) {
      const m = new PIXI.Mesh(geo, this.shader); m.start = starts[b]; m.size = starts[b + 1] - starts[b];
      const sp = new PIXI.Container();
      this.root.addChild(m, sp);
      // Streifen reichen in der Höhe von (b*BW) * 32 - Berghöhe bis (b+1)*BW*32 + etwas
      this.bands.push({ mesh: m, sprites: sp, y0: b * BW * THH2 - 230, y1: (b + 1) * BW * THH2 + 70 });
    }
    const bg = new PIXI.Graphics(); bg.beginFill(0x05182d).drawRect(-N * 40, -N * 6, N * 80, N * 36 + N * 6).endFill(); this.root.addChildAt(bg, 0);
  }
  buildSprites(map) {
    const PIXI = this.PIXI, A = this.atlas, seed = map.seed;
    const items = [], blocked = new Uint8Array(N * N);
    for (const o of map.objects) {
      const r = o.k === 'throne' ? 3 : o.k === 'start' || o.k === 'sanct' ? 2.2 : 1.7;
      for (let y = Math.floor(o.y - r); y <= o.y + r; y++) for (let x = Math.floor(o.x - r); x <= o.x + r; x++) {
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        if (Math.hypot(x - o.x, y - o.y) <= r) blocked[y * N + x] = 1;
      }
    }
    const mk = (name, tx, ty, scale = 1) => {
      const s = new PIXI.Sprite(A.tex[name]); const an = A.anchor[name]; s.anchor.set(an[0], an[1]);
      const p = this.worldPos(tx, ty); s.position.set(p.x, p.y); s.scale.set(scale / A.SC);
      s.tx = tx; s.ty = ty; s.cell = Math.floor(ty) * N + Math.floor(tx); s.depth = tx + ty;
      return s;
    };
    this.mk = mk;
    let nTree = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = y * N + x; if (blocked[c] || this.roadCells[c]) continue;
      const h = this.hAt(x + .5, y + .5); if (h < SEA + .03) continue;
      const pass = map.pass[c], f = map.F[(y * SUB + 1) * G + x * SUB + 1], r = hash(x, y, seed);
      let list = [];
      if (pass === 2 && h < .64) {
        const cnt = 2 + (r > .55 ? 1 : 0) + (r > .9 ? 1 : 0);
        for (let i = 0; i < cnt; i++) {
          const a = hash(x * 7 + i, y * 3, seed + 5), b = hash(x * 5, y * 11 + i, seed + 6), kind = hash(x + i, y - i, seed + 8);
          const hh = h > .5 || kind > .55 ? 'pine' : 'oak';
          list.push([hh + Math.floor(hash(x + i * 3, y, seed + 9) * 3), x + .1 + a * .8, y + .1 + b * .8, .9 + hash(x, y + i, seed + 12) * .35]);
        }
      } else if (pass === 1 && h < .6) {
        if (r < (f > .45 ? .22 : .055)) list.push([(hash(x, y, seed + 3) > .5 ? 'oak' : 'pine') + Math.floor(hash(x, y, seed + 4) * 3), x + .2 + hash(x, y, seed + 5) * .6, y + .2 + hash(x, y, seed + 6) * .6, .85 + hash(x, y, seed + 7) * .3]);
        else if (r > .975) list.push(['bush' + (r > .988 ? 1 : 0), x + .5, y + .5, 1]);
        else if (r > .955) list.push(['rock' + Math.floor(hash(x, y, seed + 1) * 3), x + .5, y + .5, .8]);
      } else if (pass === 0 && h > .56) {
        if (r < .4) list.push([(h > .64 ? 'pineS' : 'pine') + Math.floor(hash(x, y, seed + 2) * 3), x + .2 + hash(x, y, seed + 5) * .6, y + .2 + hash(x, y, seed + 6) * .6, .9]);
        else if (r < .62) list.push(['rock' + Math.floor(hash(x, y, seed + 1) * 3), x + .3 + hash(x, y, seed + 5) * .4, y + .3 + hash(x, y, seed + 6) * .4, h > .74 ? 1.5 : 1.1]);
      }
      for (const [nm, tx, ty, sc] of list) { const s = mk(nm, tx, ty, sc); items.push(s); nTree++; }
    }
    this.nTrees = nTree;
    // Objekte (Burgen, Felder, Lager …)
    const ob = this.obj;
    for (const o of map.objects) {
      const holder = { o, spr: [], vis: true }; ob[o.id] = holder;
      const tx = o.x + .5, ty = o.y + .5;
      const nameFor = { throne: 'throne', sanct: 'sanct', farm: 'farm', wood: 'wood', stone: 'stone', ore: 'ore', camp: 'camp', ruin: 'ruin', start: 'slot' }[o.k];
      const s = mk(nameFor, tx, ty, o.k === 'farm' || o.k === 'wood' || o.k === 'stone' || o.k === 'ore' ? .78 + .045 * o.lv : 1);
      s.depth = tx + ty; s.own = holder; holder.main = s; items.push(s); holder.spr.push(s);
      if (o.k === 'camp') {
        const dead = mk('campDead', tx, ty, 1); dead.depth = tx + ty; dead.own = holder; dead.visible = false; holder.dead = dead; items.push(dead); holder.spr.push(dead);
        const fire = mk('fire0', tx, ty, .8); fire.x += -3; fire.y += 6; fire.depth = tx + ty + .05; fire.own = holder; holder.fire = fire; items.push(fire); holder.spr.push(fire);
      }
      if (o.k === 'start') {
        const flag = mk('flag', tx, ty, 1); flag.depth = tx + ty + .1; flag.own = holder; flag.visible = false; holder.flag = flag; items.push(flag); holder.spr.push(flag);
        const flag2 = mk('flag', tx, ty, .8); flag2.depth = tx + ty + .1; flag2.own = holder; flag2.visible = false; holder.flag2 = flag2; items.push(flag2); holder.spr.push(flag2);
      }
    }
    // in die Streifen einsortieren
    items.sort((a, b) => a.depth - b.depth);
    for (const s of items) {
      const b = Math.min(NB - 1, Math.floor(s.depth / BW)); this.bands[b].sprites.addChild(s);
    }
    this.cellSprites = items;
  }

  /* ---------- Zustand vom Server ---------- */
  sync(view, myId, offset) {
    this.view = view; this.myId = myId; this.offset = offset || 0;
    this.speed = view.match.speed;
    // Nebel
    const key = view.state.explored; if (key !== this.expKey) { this.expKey = key; this.updateFog(key); }
    // Spieler an Startplätzen
    const bySlot = {}; for (const p of view.match.players) bySlot[p.slot] = p;
    for (const id in this.obj) {
      const h = this.obj[id], o = h.o;
      if (o.k !== 'start') continue;
      const p = bySlot[o.slot], tier = p ? (p.rathaus >= 14 ? 3 : p.rathaus >= 7 ? 2 : 1) : 0;
      h.player = p || null; h.tier = tier;
      const nm = p ? 'castle' + tier : 'slot', s = h.main;
      if (h.nm !== nm) {
        h.nm = nm; s.texture = this.atlas.tex[nm]; const an = this.atlas.anchor[nm]; s.anchor.set(an[0], an[1]);
        const meta = this.atlas.meta[nm];
        if (meta) { for (const [k, f] of [['flag', meta.flag], ['flag2', meta.flag2]]) { const sp = h[k]; const q = f; sp.position.set(s.x + q[0], s.y + q[1]); sp.visible = true; } }
        else { h.flag.visible = false; h.flag2.visible = false; }
      }
      if (p) { const col = PLAYER_COLORS[p.slot % 10]; h.flag.tint = parseInt(col.slice(1), 16); h.flag2.tint = h.flag.tint; }
    }
    // Lager (tot/lebendig), Felder (Vorrat)
    const gt = this.gtNow();
    for (const id in this.obj) {
      const h = this.obj[id], o = h.o;
      if (o.k === 'camp') { const dead = (view.world.camps[id] || 0) > gt; h.isDead = dead; h.main.visible = !dead; h.dead.visible = dead; h.fire.visible = !dead; }
      if (o.k === 'ruin') { const done = !!view.world.ruins[id]; h.isDead = done; h.main.alpha = done ? .55 : 1; }
      if (['farm', 'wood', 'stone', 'ore'].includes(o.k)) { const max = 3000 * o.lv, left = view.world.nodes[id] == null ? max : view.world.nodes[id]; h.frac = left / max; h.main.alpha = .5 + .5 * Math.min(1, h.frac * 2); }
    }
    this.applyFogVisibility();
    this.rebuildLabels(view);
    this.syncMarches(view);
    this.dirtyLabels = true;
  }
  gtNow() { const w = this.view.world; return w.gt + (Date.now() + this.offset - w.at) / 1000 * this.speed; }
  exploredBit(x, y) { return this.bits ? (this.bits[(y * N + x) >> 3] >> ((y * N + x) & 7)) & 1 : 0; }
  updateFog(str) {
    const b = new Uint8Array(Math.ceil(N * N / 8));
    try { const raw = atob(str || ''); for (let i = 0; i < raw.length && i < b.length; i++) b[i] = raw.charCodeAt(i); } catch {}
    this.bits = b;
    const f = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) f[y * N + x] = this.exploredBit(x, y);
    for (let pass = 0; pass < 2; pass++) {   // weichzeichnen: sanfter Nebelrand
      const g = new Float32Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let s = 0, w = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const xx = x + ox, yy = y + oy; const ww = (ox && oy) ? 1 : (ox || oy) ? 2 : 4; s += (xx < 0 || yy < 0 || xx >= N || yy >= N ? 0 : f[yy * N + xx]) * ww; w += ww; }
        g[y * N + x] = s / w;
      }
      f.set(g);
    }
    for (let i = 0; i < N * N; i++) { const v = Math.round(clamp(f[i] * 1.15, 0, 1) * 255); this.fogData[i * 4] = v; this.fogData[i * 4 + 1] = v; this.fogData[i * 4 + 2] = v; }
    this.fogTex.baseTexture.resource.data = this.fogData; this.fogTex.baseTexture.update();
    this.fogChanged = true;
  }
  applyFogVisibility() {
    if (!this.bits) return;
    for (const s of this.cellSprites) {
      let v = this.exploredBit(s.cell % N, Math.floor(s.cell / N)) === 1; const own = s.own;
      if (own && v) {
        if (s === own.dead) v = !!own.isDead;
        else if (s === own.fire || (own.o.k === 'camp' && s === own.main)) v = !own.isDead;
        else if (s === own.flag || s === own.flag2) v = !!own.player;
      }
      s.visible = v;
    }
  }

  /* ---------- Beschriftungen ---------- */
  label(key, make) { if (!this.labels[key]) { this.labels[key] = make(); this.ui.addChild(this.labels[key]); } return this.labels[key]; }
  badge(text, color, w = 0) {
    const PIXI = this.PIXI, c = new PIXI.Container(), g = new PIXI.Graphics();
    const t = new PIXI.Text(text, { fontFamily: 'Alegreya Sans, sans-serif', fontSize: 15, fontWeight: '700', fill: 0xf4efe0, stroke: 0x15110c, strokeThickness: 3, lineJoin: 'round' }); t.resolution = 2; t.anchor.set(.5);
    const ww = Math.max(w, t.width + 14); g.lineStyle(2, 0xe9d9a8, .95).beginFill(color, .96).drawRoundedRect(-ww / 2, -11, ww, 22, 11).endFill();
    c.addChild(g, t); c.g = g; c.t = t; c.col = color; return c;
  }
  setBadge(c, text, color) { if (c.t.text !== text) { c.t.text = text; } if (color !== c.col) { c.col = color; c.g.tint = 0xffffff; } }
  rebuildLabels(view) {
    const RES_COL = { farm: 0xb58a22, wood: 0x7b5630, stone: 0x6b6f75, ore: 0x3f6b94 }, T = { farm: 'Feld', wood: 'Wald', stone: 'Bruch', ore: 'Mine' };
    for (const id in this.obj) {
      const h = this.obj[id], o = h.o; let txt = null, col = 0x333333, y = -46;
      if (o.k === 'start' && h.player) { txt = h.player.name; col = parseInt(PLAYER_COLORS[h.player.slot % 10].slice(1), 16); y = -[100, 135, 170][(h.tier || 1) - 1]; if (h.player.id === this.myId) txt = '★ ' + txt; }
      else if (['farm', 'wood', 'stone', 'ore'].includes(o.k)) { txt = T[o.k] + ' ' + o.lv; col = RES_COL[o.k]; y = -54; }
      else if (o.k === 'camp') { txt = h.isDead ? 'Lager zerstört' : 'Banditen ' + o.lv; col = h.isDead ? 0x4a4036 : 0x8a2b24; y = h.isDead ? -26 : -58; }
      else if (o.k === 'ruin') { txt = h.isDead ? 'Ruine (geplündert)' : 'Ruine ' + o.lv; col = 0x5a4a6e; y = -58; }
      else if (o.k === 'sanct') { txt = 'Heiligtum'; col = 0x2f6f8f; y = -86; }
      else if (o.k === 'throne') { txt = 'Der Thron'; col = 0x9c7420; y = -130; }
      if (txt === null) { if (h.lab) h.lab.visible = false; continue; }
      let lab = h.lab;
      if (!lab || h.labTxt !== txt || h.labCol !== col) {
        if (lab) { this.ui.removeChild(lab); lab.destroy({ children: true }); }
        lab = this.badge(txt, col); h.lab = lab; h.labTxt = txt; h.labCol = col; this.ui.addChild(lab);
      }
      const p = this.worldPos(o.x + .5, o.y + .5); lab.position.set(p.x, p.y + y); lab.baseY = p.y + y; lab.visible = true;
    }
  }
  applyLabelVisibility(zoom) {
    for (const id in this.obj) {
      const h = this.obj[id]; if (!h.lab) continue;
      const seen = this.bits && this.exploredBit(h.o.x, h.o.y);
      h.lab.visible = !!seen && (zoom > .22 || h.o.k === 'start' || h.o.k === 'throne');
      h.lab.scale.set(clamp(.8 / zoom, .6, 2.2));
    }
  }

  /* ---------- Heere ---------- */
  syncMarches(view) {
    const keep = new Set();
    for (const m of view.world.marches) {
      keep.add(m.id); let s = this.marchSprites[m.id];
      if (!s) {
        const PIXI = this.PIXI, c = new PIXI.Container(), A = this.atlas;
        const body = new PIXI.Sprite(A.tex.sold0), tint = new PIXI.Sprite(A.tex.soldT0), flag = new PIXI.Sprite(A.tex.flag);
        for (const sp of [body, tint]) { sp.anchor.set(A.anchor.sold0[0], A.anchor.sold0[1]); sp.scale.set(1.15 / A.SC); }
        flag.scale.set(.7); flag.position.set(5.6, -35); flag.anchor.set(0, 0);
        const lab = this.badge('', 0x2a2f38); lab.scale.set(.8);
        c.addChild(body, tint, flag); c.body = body; c.tint = tint; c.flag = flag; c.lab = lab;
        this.armies.addChild(c); this.ui.addChild(lab); s = c; this.marchSprites[m.id] = s;
      }
      s.m = m; const col = parseInt(PLAYER_COLORS[(m.slot < 0 ? 0 : m.slot) % 10].slice(1), 16);
      s.tint.tint = col; s.flag.tint = col;
      const n = m.own ? Object.values(m.troops).reduce((a, b) => a + b, 0) : (m.troops.n || 0);
      s.lab.t.text = (m.own ? '' : m.name + ' · ') + n; s.lab.g.clear(); const w = s.lab.t.width + 14; s.lab.g.lineStyle(2, col, 1).beginFill(0x15110c, .88).drawRoundedRect(-w / 2, -10, w, 20, 10).endFill();
    }
    for (const id in this.marchSprites) if (!keep.has(Number(id))) { const s = this.marchSprites[id]; s.lab.destroy({ children: true }); s.destroy({ children: true }); delete this.marchSprites[id]; }
  }

  /* ---------- Bild für Bild ---------- */
  frame(dt, zoom, camRect) {
    this.time += dt; this.zoom = zoom; this.shader.uniforms.uTime = this.time;
    // Streifen außerhalb des Bildes weglassen
    for (const b of this.bands) { const vis = b.y1 >= camRect.y0 && b.y0 <= camRect.y1; b.mesh.visible = vis; b.sprites.visible = vis; }
    const t = this.time;
    for (const id in this.obj) {
      const h = this.obj[id];
      if (h.fire && h.fire.visible) { const k = Math.floor(t * 8 + h.o.x) % 3; h.fire.texture = this.atlas.tex['fire' + k]; h.fire.alpha = .85 + Math.sin(t * 17 + h.o.y) * .15; }
      if (h.flag && h.flag.visible) { h.flag.skew.y = Math.sin(t * 3.6 + h.o.x) * .22; h.flag2.skew.y = Math.sin(t * 3.9 + h.o.y + 1) * .22; }
    }
    // Heere bewegen
    const gt = this.gtNow(), w = this.view.world, frame = Math.floor(t * 4) % 2, A = this.atlas;
    this.lines.clear();
    let bestSel = null;
    for (const id in this.marchSprites) {
      const s = this.marchSprites[id], m = s.m, p = marchPos({ ...m, t0: m.t0 }, gt);
      const wp = this.worldPos(p.x, p.y); s.position.set(wp.x, wp.y - (p.still ? 0 : Math.abs(Math.sin(t * 9 + Number(id))) * 1.6));
      s.zIndex = wp.y;
      const ahead = m.path[Math.min(m.path.length - 1, p.i + 1)], [ax, ay] = cellXY(ahead), dxs = (ax + .5 - ay - .5) - (p.x - p.y);
      if (!p.still && Math.abs(dxs) > .01) s.scale.x = dxs < 0 ? -1 : 1;
      s.body.texture = A.tex['sold' + (p.still ? 0 : frame)]; s.tint.texture = A.tex['soldT' + (p.still ? 0 : frame)];
      s.lab.position.set(wp.x, wp.y - 52); s.lab.scale.set(clamp(.7 / zoom, .55, 2));
      s.lab.visible = !this.bits || this.exploredBit(Math.floor(p.x), Math.floor(p.y)) === 1 || m.own;
      s.visible = s.lab.visible;
      if (m.own || this.sel && this.sel.type === 'march' && this.sel.id === m.id) {
        // gestrichelte Route ab aktueller Position
        const col = parseInt(PLAYER_COLORS[(m.slot < 0 ? 0 : m.slot) % 10].slice(1), 16);
        const pts = [wp]; for (let i = p.i + 1; i < m.path.length; i++) { const [x, y] = cellXY(m.path[i]); pts.push(this.worldPos(x + .5, y + .5)); }
        this.dashed(pts, col, t);
        if (m.phase === 'gather') { // Fortschritt
          const f = clamp((gt - m.tStart) / (m.tEnd - m.tStart || 1), 0, 1);
          this.lines.beginFill(0x15110c, .85).drawRoundedRect(wp.x - 22, wp.y + 8, 44, 7, 3).endFill().beginFill(0xd2a94e).drawRoundedRect(wp.x - 21, wp.y + 9, 42 * f, 5, 2).endFill();
        }
      }
    }
    // Auswahlring
    this.ring.clear();
    if (this.sel && this.sel.type === 'obj') {
      const h = this.obj[this.sel.id]; if (h) {
        const p = this.worldPos(h.o.x + .5, h.o.y + .5), r = (h.o.k === 'throne' ? 150 : h.o.k === 'start' || h.o.k === 'sanct' ? 100 : 72) + Math.sin(t * 3) * 3;
        this.ring.lineStyle(3, 0xf0d98a, .95).drawEllipse(p.x, p.y, r, r / 2).lineStyle(1.5, 0x15110c, .6).drawEllipse(p.x, p.y, r + 3, (r + 3) / 2);
      }
    }
    if (this.dirtyLabels || this.fogChanged) { this.applyFogVisibility(); this.dirtyLabels = false; this.fogChanged = false; }
    this.applyLabelVisibility(zoom);
    void w; void bestSel;
  }
  dashed(pts, col, t) {
    const g = this.lines; let off = (t * 22) % 16;
    g.lineStyle(0); g.beginFill(col, .95);
    let carry = -off;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y); if (!len) continue;
      for (let d = carry < 0 ? -carry : 0; d < len; d += 16) { const k = d / len; g.drawCircle(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 2.6); carry = d + 16 - len; }
    }
    g.endFill();
  }

  /* ---------- Antippen ---------- */
  pickAt(wx, wy) {
    let best = null, bd = 1e9;
    for (const id in this.marchSprites) {
      const s = this.marchSprites[id]; if (!s.visible) continue;
      const d = Math.hypot(wx - s.x, wy - (s.y - 16)); if (d < 34 && d < bd) { bd = d; best = { type: 'march', id: Number(id) }; }
    }
    if (best) return best;
    for (const id in this.obj) {
      const h = this.obj[id], o = h.o; if (!this.bits || !this.exploredBit(o.x, o.y)) continue;
      const p = this.worldPos(o.x + .5, o.y + .5), rad = o.k === 'throne' ? 90 : o.k === 'start' || o.k === 'sanct' ? 62 : 46;
      const d = Math.hypot(wx - p.x, (wy - (p.y - rad * .35)) * 1.25); if (d < rad && d < bd) { bd = d; best = { type: 'obj', id }; }
    }
    return best;
  }
  select(sel) { this.sel = sel; }
}
const THH2 = 16;   // Höhe einer Diagonale in Pixeln
