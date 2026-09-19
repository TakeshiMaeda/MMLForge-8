// ─────────────────────────────────────────
//  ミニ鍵盤（タップ音・録音→MML化）
//  MMLPlayer とは独立の AudioContext（BGM再生を止めずに叩ける）
// ─────────────────────────────────────────
const KB_BASE_OCT = 4;        // 表示範囲: C4〜B5 の2オクターブ
const IS_BLACK    = [false, true, false, true, false, false, true, false, true, false, true, false];
// PCキー割当（FL/DAW標準）: 下段=o4, 上段=o5
const PC_KEYS = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20, y: 21, '7': 22, u: 23,
};
const SEMI_TO_PCKEY = {};
Object.entries(PC_KEYS).forEach(([k, s]) => { SEMI_TO_PCKEY[s] = k.toUpperCase(); });

let _kctx = null;
function kctx() {
  if (!_kctx) _kctx = new AudioContext();
  if (_kctx.state === 'suspended') _kctx.resume();
  return _kctx;
}
let _kbNoiseBuf = null;
function kbNoiseBuf(c) {
  if (!_kbNoiseBuf) {
    const len = c.sampleRate * 2;
    _kbNoiseBuf = c.createBuffer(1, len, c.sampleRate);
    const data = _kbNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return _kbNoiseBuf;
}

// ── 鍵盤音の設定（MMLの @音色 / v音量 / @e と同じ意味・同じ数値） ──
const KB_WAVES = ['sine', 'square', 'triangle', 'sawtooth', 'noise'];
const kbWave = document.getElementById('kbWave');
const kbVol  = document.getElementById('kbVol');
const kbA = document.getElementById('kbA'), kbD = document.getElementById('kbD');
const kbS = document.getElementById('kbS'), kbR = document.getElementById('kbR');
const kbPrefix = document.getElementById('kbPrefix');

function kbSettings() {
  return {
    wave: +kbWave.value,
    vol: Math.max(0, Math.min(15, +kbVol.value)),
    a: Math.max(0, +kbA.value || 0),
    d: Math.max(0, +kbD.value || 0),
    s: Math.max(0, Math.min(100, +kbS.value || 0)),
    r: Math.max(1, +kbR.value || 1),
  };
}
function kbUpdatePrefix() {
  const s = kbSettings();
  kbPrefix.textContent = T('kb.prefix', s);
  localStorage.setItem('mmlforge8-kbset', JSON.stringify(s));
}
(function kbLoadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('mmlforge8-kbset'));
    if (s) {
      kbWave.value = s.wave; kbVol.value = s.vol;
      kbA.value = s.a; kbD.value = s.d; kbS.value = s.s; kbR.value = s.r;
    }
  } catch (e) { /* 保存なし・破損時は既定値 */ }
  kbUpdatePrefix();
})();
[kbWave, kbVol, kbA, kbD, kbS, kbR].forEach(el => el.addEventListener('input', kbUpdatePrefix));

const kb = document.getElementById('kb');
const kbNow = document.getElementById('kbNow');
const keyEls = {};        // semi → element
const voices = {};        // semi → { osc, gain }

// 押鍵中の音名表示（録音中かどうかに関係なく、鳴っている音を低い順に並べる）
function kbShowNotes() {
  kbNow.textContent = Object.keys(voices).map(Number).sort((a, b) => a - b)
    .map(s => NOTE_NAMES[s % 12] + (KB_BASE_OCT + Math.floor(s / 12))).join(' ');
}

// 鍵盤生成（白鍵を並べ、黒鍵を境目に重ねる）
(function buildKb() {
  const WW = 34;
  let wCount = 0;
  for (let semi = 0; semi < 24; semi++) {
    const noteIdx = semi % 12;
    const oct = KB_BASE_OCT + Math.floor(semi / 12);
    const el = document.createElement('div');
    if (!IS_BLACK[noteIdx]) {
      el.className = 'wkey';
      el.style.left = (wCount * WW) + 'px';
      const nn = document.createElement('div');
      nn.className = 'nn';
      nn.textContent = noteIdx === 0 ? 'C' + oct : '';
      el.appendChild(nn);
      wCount++;
    } else {
      el.className = 'bkey';
      el.style.left = (wCount * WW - 11) + 'px';
    }
    const kc = document.createElement('div');
    kc.className = 'kc';
    kc.textContent = SEMI_TO_PCKEY[semi] || '';
    el.appendChild(kc);
    el.dataset.semi = semi;
    kb.appendChild(el);
    keyEls[semi] = el;
  }
})();

function semiToFreq(semi) {
  const midi = 12 * (KB_BASE_OCT + 1) + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteOn(semi) {
  if (voices[semi]) return;
  const st = kbSettings();
  const c = kctx();
  const t = c.currentTime;
  // ノイズはバンドパスで音量が下がるぶんメイクアップ（mml.js の _scheduleNote と同じ補償式）
  const noiseComp = (KB_WAVES[st.wave] === 'noise')
    ? Math.min(8, Math.sqrt(c.sampleRate / (2 * semiToFreq(semi)))) : 1;
  const vol = Math.max((st.vol / 15) * 0.3, 0.0005) * noiseComp;
  const gain = c.createGain();
  // アタック→ディケイ→サステイン（キーを離すまでホールド）
  const a = Math.max(st.a / 1000, 0.002);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + a);
  if (st.d > 0) gain.gain.linearRampToValueAtTime(Math.max(vol * st.s / 100, 0.0001), t + a + st.d / 1000);
  let src;
  if (KB_WAVES[st.wave] === 'noise') {
    src = c.createBufferSource();
    src.buffer = kbNoiseBuf(c);
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = semiToFreq(semi);
    filter.Q.value = 1.2;
    src.connect(filter);
    filter.connect(gain);
  } else {
    src = c.createOscillator();
    src.type = KB_WAVES[st.wave];
    src.frequency.value = semiToFreq(semi);
    src.connect(gain);
  }
  gain.connect(c.destination);
  src.start(t);
  voices[semi] = { osc: src, gain, r: st.r };
  keyEls[semi].classList.add('active');
  kbShowNotes();
  if (recording) recEvents.push({ semi, tOn: performance.now() / 1000, tOff: null });
}

function noteOff(semi) {
  const v = voices[semi];
  if (!v) return;
  const c = kctx();
  const t = c.currentTime;
  const rel = Math.max(v.r / 1000, 0.02);
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), t);
  v.gain.gain.exponentialRampToValueAtTime(0.0001, t + rel);
  v.osc.stop(t + rel + 0.05);
  delete voices[semi];
  keyEls[semi].classList.remove('active');
  kbShowNotes();
  if (recording) {
    for (let i = recEvents.length - 1; i >= 0; i--) {
      if (recEvents[i].semi === semi && recEvents[i].tOff === null) { recEvents[i].tOff = performance.now() / 1000; break; }
    }
  }
}

// マウス/タッチ
kb.addEventListener('pointerdown', (e) => {
  const semi = e.target.closest('[data-semi]')?.dataset.semi;
  if (semi !== undefined) { e.preventDefault(); noteOn(+semi); }
});
window.addEventListener('pointerup', () => {
  Object.keys(voices).forEach(s => { if (!heldPcKeys.has(+s)) noteOff(+s); });
});

// PCキー（テキスト入力中と、鍵盤セクションを畳んでいる間は無効）
const heldPcKeys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (!document.getElementById('secKb').open) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
  const semi = PC_KEYS[e.key.toLowerCase()];
  if (semi !== undefined) { e.preventDefault(); heldPcKeys.add(semi); noteOn(semi); }
});
window.addEventListener('keyup', (e) => {
  const semi = PC_KEYS[e.key.toLowerCase()];
  if (semi !== undefined) { heldPcKeys.delete(semi); noteOff(semi); }
});

