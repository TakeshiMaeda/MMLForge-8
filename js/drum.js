// ─────────────────────────────────────────
//  リズムパッド（drumbit風ステップシーケンサ）
//  行 = トラック（4CH固定）で各トラックに楽器（波形+音程+音量+ゲート+エンベロープ）を割り当てる。
//  同時打鍵はトラックを分けて表現し、打点のないトラックはMML出力から除外して詰める
// ─────────────────────────────────────────
const DRUM_PRESETS = {
  kick:  { label: T('drum.kick'),      w: 4, o: 3, v: 9, q: 8, env: '1,90,0,50' },
  snare: { label: T('drum.snare'),     w: 4, o: 5, v: 8, q: 8, env: '1,120,0,60' },
  hatc:  { label: T('drum.hatClosed'), w: 4, o: 7, v: 6, q: 8, env: '1,30,0,25' },
  hato:  { label: T('drum.hatOpen'),   w: 4, o: 7, v: 6, q: 8, env: '1,150,0,90' },
  tom:   { label: T('drum.tom'),       w: 4, o: 4, v: 8, q: 8, env: '1,100,0,60' },
  clap:  { label: T('drum.clap'),      w: 4, o: 6, v: 8, q: 8, env: '1,80,0,50' },
};
const DR_CH = 4, DR_MAX_STEPS = 64;   // 16分 × 最大4小節

let drum = {
  bpm: 120, bars: 4,
  tracks: ['kick', 'snare', 'hatc', 'hato'].map(p => ({
    preset: p, w: DRUM_PRESETS[p].w, o: DRUM_PRESETS[p].o, v: DRUM_PRESETS[p].v,
    q: DRUM_PRESETS[p].q, env: DRUM_PRESETS[p].env,
  })),
  grid: Array.from({ length: DR_CH }, () => Array(DR_MAX_STEPS).fill(false)),
  insts: [],   // ユーザー定義楽器 [{name, o, v, env}]
};
try {
  const s = JSON.parse(localStorage.getItem('mmlforge8-drum'));
  if (s && Array.isArray(s.tracks) && s.tracks.length === DR_CH &&
      Array.isArray(s.grid) && s.grid.length === DR_CH) drum = s;
} catch (e) { /* 保存なし・破損時は既定値 */ }
if (!Array.isArray(drum.insts)) drum.insts = [];   // 旧保存データとの互換
// q / w / n（音名）を持たない旧保存データは q8 / @4 / c（従来の固定値）扱い
drum.tracks.forEach(tr => {
  if (!(+tr.q >= 1 && +tr.q <= 8)) tr.q = 8;
  if (!(+tr.w >= 0 && +tr.w <= 4)) tr.w = 4;
  if (!(+tr.n >= 0 && +tr.n <= 11)) tr.n = 0;
});
drum.insts.forEach(inst => {
  if (!(+inst.q >= 1 && +inst.q <= 8)) inst.q = 8;
  if (!(+inst.w >= 0 && +inst.w <= 4)) inst.w = 4;
  if (!(+inst.n >= 0 && +inst.n <= 11)) inst.n = 0;
});

// 音程入力 'c5' 'f#4' 'b-3' → { n: 音名0-11, o: オクターブ }。不正なら null
function parseDrumPitch(s) {
  const m = String(s).trim().toLowerCase().match(/^([a-g])([#+\-]*)(\d)$/);
  if (!m) return null;
  const BASE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let semi = BASE[m[1]];
  for (const ch of m[2]) semi += (ch === '-') ? -1 : 1;
  const o = +m[3] + Math.floor(semi / 12);   // b#4 → c5 のような繰り上げ
  if (o < 1 || o > 8) return null;
  return { n: ((semi % 12) + 12) % 12, o };
}
const drumPitchStr = (tr) => NOTE_NAMES[tr.n ?? 0] + tr.o;

// tr.preset の値: プリセットid | 'u:ユーザー楽器名' | ''(手動調整済み)
function drumInstOf(presetVal) {
  if (DRUM_PRESETS[presetVal]) return DRUM_PRESETS[presetVal];
  if (presetVal && presetVal.startsWith('u:')) return drum.insts.find(i => i.name === presetVal.slice(2)) || null;
  return null;
}

const drOut = document.getElementById('drOut');
const drStatus = document.getElementById('drStatus');
const drSave = () => localStorage.setItem('mmlforge8-drum', JSON.stringify(drum));

// グリッド → MMLトラック配列。打点のない行は無視し、打点が重ならない行同士は
// 1チャンネルにまとめる（first-fit。音符ごとに独立発音するエンジンなので余韻の重なりも
// 分割出力と同一に鳴る）。同一ステップの同時打鍵だけはMMLで表現できないためチャンネルを分ける
function drumToTracks() {
  const steps = drum.bars * 16;
  const act = [];
  drum.tracks.forEach((tr, ti) => {
    const cells = drum.grid[ti].slice(0, steps);
    if (cells.some(x => x)) act.push({ tr, cells });
  });
  const groups = [];
  act.forEach(row => {
    const g = groups.find(g => !g.rows.some(r => r.cells.some((c, i) => c && row.cells[i])));
    if (g) g.rows.push(row); else groups.push({ rows: [row] });
  });
  return groups.map(g => {
    const toks = [`t${drum.bpm}`];
    let curEnv = null, curO = null, curV = null, curQ = null, curW = null;
    for (let b = 0; b < drum.bars; b++) {
      if (b > 0) toks.push('|');
      let i = b * 16;
      while (i < (b + 1) * 16) {
        const hit = g.rows.find(r => r.cells[i]);
        if (hit) {
          const tr = hit.tr;   // 楽器が切り替わるときだけ @/v/q/@e/o を出す
          if (tr.w !== curW) { toks.push('@' + tr.w); curW = tr.w; }
          if (tr.v !== curV) { toks.push('v' + tr.v); curV = tr.v; }
          if (tr.q !== curQ) { toks.push('q' + tr.q); curQ = tr.q; }
          if (tr.env !== curEnv) { toks.push('@e' + tr.env); curEnv = tr.env; }
          if (tr.o !== curO) { toks.push('o' + tr.o); curO = tr.o; }
          toks.push(NOTE_NAMES[tr.n ?? 0] + '16');
          i++;
          continue;
        }
        let run = 0;
        while (i + run < (b + 1) * 16 && !g.rows.some(r => r.cells[i + run])) run++;
        while (run > 0) {   // 休符は 4分/8分/16分 に併合
          if (run >= 4) { toks.push('r4'); run -= 4; i += 4; }
          else if (run >= 2) { toks.push('r8'); run -= 2; i += 2; }
          else { toks.push('r16'); run--; i++; }
        }
      }
    }
    return toks.join(' ');
  });
}

function updateDrumOut() {
  drOut.value = drumToTracks().join('\n');
}
function drChanged() {
  drSave();
  updateDrumOut();
}

// セルON時の単発試聴（音声→MML用の AudioContext を流用。mml.js と同じノイズ+バンドパス+音量補償）
let _drNoise = null;
function drNoiseBuf(c) {
  if (!_drNoise) {
    const len = c.sampleRate * 2;
    _drNoise = c.createBuffer(1, len, c.sampleRate);
    const data = _drNoise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return _drNoise;
}
function drumHit(tr) {
  const c = actx();
  const t = c.currentTime;
  const freq = 440 * Math.pow(2, (12 * (tr.o + 1) + (tr.n ?? 0) - 69) / 12);   // 楽器の音程
  const [a0, d0, s0, r0] = String(tr.env).split(',').map(n => +n || 0);
  const isNoise = (tr.w ?? 4) === 4;
  const comp = isNoise ? Math.min(8, Math.sqrt(c.sampleRate / (2 * freq))) : 1;
  const vol = Math.max((tr.v / 15) * 0.3, 0.001) * comp;
  // 実際の出力（16分音符）と同じ聞こえ方になるよう、mml.js と同じゲート・クランプで鳴らす
  const gate = Math.max((60 / drum.bpm / 4) * (tr.q ?? 8) / 8, 0.02);
  const a = Math.min(a0 / 1000, gate * 0.5);
  const d = Math.min(d0 / 1000, Math.max(gate - a, 0));
  const sus = Math.max(vol * Math.min(Math.max(s0, 0), 100) / 100, 0.0001);
  const r = Math.max(r0 / 1000, 0.005);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  if (d > 0) g.gain.linearRampToValueAtTime(sus, t + a + d);
  g.gain.setValueAtTime(d > 0 ? sus : vol, t + gate);
  g.gain.exponentialRampToValueAtTime(0.0001, t + gate + r);
  let src;
  if (isNoise) {
    src = c.createBufferSource();
    src.buffer = drNoiseBuf(c);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    src.connect(f); f.connect(g);
  } else {
    src = c.createOscillator();
    src.type = KB_WAVES[tr.w];
    src.frequency.value = freq;
    src.connect(g);
  }
  g.connect(c.destination);
  src.start(t);
  src.stop(t + gate + r + 0.05);
}

function renderDrumPad() {
  document.getElementById('drBpm').value = drum.bpm;
  document.getElementById('drBars').value = drum.bars;
  const steps = drum.bars * 16;
  const pad = document.getElementById('drPad');
  pad.innerHTML = '';
  drum.tracks.forEach((tr, ti) => {
    const row = document.createElement('div');
    row.className = 'drow';
    const head = document.createElement('div');
    head.className = 'dhead';
    const sel = document.createElement('select');
    const manOp = document.createElement('option');
    manOp.value = '';
    manOp.textContent = T('drum.manual');
    manOp.hidden = true;   // 手動調整状態の表示専用（一覧には出さない）
    sel.appendChild(manOp);
    Object.entries(DRUM_PRESETS).forEach(([id, p]) => {
      const op = document.createElement('option');
      op.value = id;
      op.textContent = p.label;
      sel.appendChild(op);
    });
    if (drum.insts.length) {
      const og = document.createElement('optgroup');
      og.label = T('drum.userGroup');
      drum.insts.forEach(inst => {
        const op = document.createElement('option');
        op.value = 'u:' + inst.name;
        op.textContent = inst.name;
        og.appendChild(op);
      });
      sel.appendChild(og);
    }
    sel.value = drumInstOf(tr.preset) ? tr.preset : '';   // 参照切れ（削除済み等）は手動扱い
    const wSel = document.createElement('select');
    KB_WAVES.forEach((name, wi) => {
      const op = document.createElement('option');
      op.value = wi;
      op.textContent = '@' + wi + ' ' + name;
      wSel.appendChild(op);
    });
    wSel.value = tr.w;
    wSel.title = T('drum.tipWave');
    const oIn = document.createElement('input');
    oIn.value = drumPitchStr(tr); oIn.style.width = '48px';
    oIn.title = T('drum.tipPitch');
    const vIn = document.createElement('input');
    vIn.type = 'number'; vIn.min = 0; vIn.max = 15; vIn.value = tr.v; vIn.style.width = '42px'; vIn.title = T('drum.tipVol');
    const qIn = document.createElement('input');
    qIn.type = 'number'; qIn.min = 1; qIn.max = 8; qIn.value = tr.q; qIn.style.width = '42px'; qIn.title = T('drum.tipGate');
    const eIn = document.createElement('input');
    eIn.value = tr.env; eIn.style.width = '92px'; eIn.title = T('drum.tipEnv');
    sel.addEventListener('change', () => {
      const p = drumInstOf(sel.value);
      if (!p) return;
      tr.preset = sel.value;
      tr.w = p.w ?? 4; tr.n = p.n ?? 0; tr.o = p.o; tr.v = p.v; tr.q = p.q ?? 8; tr.env = p.env;
      wSel.value = tr.w; oIn.value = drumPitchStr(tr); vIn.value = tr.v; qIn.value = tr.q; eIn.value = tr.env;
      drChanged();
      drumHit(tr);
    });
    // 手動調整したら (手動) 表示に切り替え（プリセットの選び直しによる上書き事故を防ぐ）
    const manual = () => { tr.preset = ''; sel.value = ''; };
    wSel.addEventListener('change', () => { tr.w = Math.max(0, Math.min(4, +wSel.value || 0)); manual(); drChanged(); drumHit(tr); });
    oIn.addEventListener('input', () => {
      const p = parseDrumPitch(oIn.value);
      if (!p) return;   // 入力途中の不正値は無視（blurで表示を正規化）
      tr.n = p.n; tr.o = p.o; manual(); drChanged();
    });
    oIn.addEventListener('blur', () => { oIn.value = drumPitchStr(tr); });
    vIn.addEventListener('input', () => { tr.v = Math.max(0, Math.min(15, +vIn.value || 0)); manual(); drChanged(); });
    qIn.addEventListener('input', () => { tr.q = Math.max(1, Math.min(8, +qIn.value || 8)); manual(); drChanged(); });
    eIn.addEventListener('input', () => { tr.env = eIn.value.trim(); manual(); drChanged(); });
    const regBtn = document.createElement('button');
    regBtn.textContent = T('drum.register');
    regBtn.title = T('drum.tipRegister');
    regBtn.addEventListener('click', () => {
      const name = (window.prompt(T('drum.promptName'), '') || '').trim();
      if (!name) return;
      const inst = { name, w: tr.w, n: tr.n, o: tr.o, v: tr.v, q: tr.q, env: tr.env };
      const idx = drum.insts.findIndex(i => i.name === name);
      if (idx >= 0) drum.insts[idx] = inst; else drum.insts.push(inst);
      tr.preset = 'u:' + name;
      drSave();
      renderDrumPad();
      drStatus.textContent = T('drum.registered', { name });
    });
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = T('drum.tipDelete');
    delBtn.addEventListener('click', () => {
      if (!tr.preset.startsWith('u:')) {
        drStatus.textContent = T('drum.deleteOnlyUser');
        return;
      }
      const name = tr.preset.slice(2);
      if (!window.confirm(T('drum.confirmDelete', { name }))) return;
      drum.insts = drum.insts.filter(i => i.name !== name);
      drum.tracks.forEach(t2 => { if (t2.preset === 'u:' + name) t2.preset = ''; });
      drSave();
      renderDrumPad();
      drStatus.textContent = T('drum.deleted', { name });
    });
    head.appendChild(sel); head.appendChild(wSel); head.appendChild(oIn); head.appendChild(vIn); head.appendChild(qIn); head.appendChild(eIn);
    head.appendChild(regBtn); head.appendChild(delBtn);
    const cells = document.createElement('div');
    cells.style.display = 'flex';
    for (let i = 0; i < steps; i++) {
      const cell = document.createElement('div');
      cell.className = 'dcell' + (i % 4 === 0 ? ' beat' : '');
      if (i > 0 && i % 16 === 0) cell.style.marginLeft = '10px';
      else if (i > 0 && i % 4 === 0) cell.style.marginLeft = '4px';
      else if (i > 0) cell.style.marginLeft = '2px';
      if (drum.grid[ti][i]) cell.classList.add('on');
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const on = !drum.grid[ti][i];
        drum.grid[ti][i] = on;
        cell.classList.toggle('on', on);
        if (on) drumHit(tr);
        drChanged();
      });
      cells.appendChild(cell);
    }
    row.appendChild(head);
    row.appendChild(cells);
    pad.appendChild(row);
  });
  updateDrumOut();
}
renderDrumPad();

document.getElementById('drBpm').addEventListener('input', () => {
  drum.bpm = Math.max(40, Math.min(300, +document.getElementById('drBpm').value || 120));
  drChanged();
});
document.getElementById('drBars').addEventListener('change', () => {
  drum.bars = +document.getElementById('drBars').value;
  drSave();
  renderDrumPad();
});
document.getElementById('drPlay').addEventListener('click', () => {
  const trks = drumToTracks();
  if (!trks.length) { drStatus.textContent = T('drum.noHits'); return; }
  try {
    MMLPlayer.play(trks, { loop: true });
    drStatus.textContent = T('drum.playing');
  } catch (e) {
    drStatus.textContent = e.code ? mmlMessage(e) : e.message;   // パッドのMMLは本編と別なので位置は出さない
  }
});
document.getElementById('drStop').addEventListener('click', () => {
  MMLPlayer.stop();
  drStatus.textContent = T('common.stopped');
});
document.getElementById('drClear').addEventListener('click', () => {
  drum.grid = Array.from({ length: DR_CH }, () => Array(DR_MAX_STEPS).fill(false));
  drSave();
  renderDrumPad();
  drStatus.textContent = T('drum.cleared');
});
document.getElementById('drCopy').addEventListener('click', () => {
  if (!drOut.value) return;
  drOut.select();
  document.execCommand('copy');
  drStatus.textContent = T('common.copied');
});
document.getElementById('drInsert').addEventListener('click', () => {
  const trks = drumToTracks();
  if (!trks.length) { drStatus.textContent = T('drum.noHits'); return; }
  applyText(ta.value.trimEnd() + '\n\n' + trks.join('\n') + '\n');
  drStatus.textContent = T('drum.inserted');
});

