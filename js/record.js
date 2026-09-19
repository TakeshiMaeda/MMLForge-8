// ─────────────────────────────────────────
//  録音 → MML化
// ─────────────────────────────────────────
const recBtn    = document.getElementById('rec');
const recStatus = document.getElementById('recStatus');
const recOut    = document.getElementById('recOut');
let recording = false;
let recEvents = [];

recBtn.addEventListener('click', () => {
  if (!recording) {
    recording = true;
    recEvents = [];
    recBtn.textContent = T('rec.stop');
    recBtn.classList.add('rec-on');
    recStatus.textContent = T('rec.recording');
    recOut.value = '';
  } else {
    recording = false;
    recBtn.textContent = T('rec.start');
    recBtn.classList.remove('rec-on');
    const now = performance.now() / 1000;
    recEvents.forEach(ev => { if (ev.tOff === null) ev.tOff = now; });
    try {
      recOut.value = eventsToMML(recEvents, +document.getElementById('recBpm').value,
                                 +document.getElementById('recQuant').value);
      recStatus.textContent = recEvents.length ? T('rec.converted', { n: recEvents.length }) : '';
    } catch (e) {
      recStatus.textContent = e.message;
    }
  }
});

// グリッド量子化して単音MMLに変換
function eventsToMML(events, bpm, minDiv) {
  if (!events.length) throw new Error(T('rec.empty'));
  // グリッド1単位 = 最小音符の秒数
  const grid = (60 / bpm) * (4 / minDiv);
  // グリッド単位数 → MML音長トークン（付点含む。表現できない長さは floor 分割し残りを休符に）
  const LEN_TABLE = minDiv === 16
    ? [[16, '1'], [12, '2.'], [8, '2'], [6, '4.'], [4, '4'], [3, '8.'], [2, '8'], [1, '16']]
    : [[8, '1'], [6, '2.'], [4, '2'], [3, '4.'], [2, '4'], [1, '8']];

  const t0 = events[0].tOn;
  let evs = events.map(ev => ({
    semi: ev.semi,
    start: Math.round((ev.tOn - t0) / grid),
    end:   Math.round((ev.tOff - t0) / grid),
  })).sort((a, b) => a.start - b.start);

  // 単音化: 重なりは前の音を切る。同時打鍵は直列に押し出す
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    if (i > 0) ev.start = Math.max(ev.start, evs[i - 1].end);
    ev.end = Math.max(ev.end, ev.start + 1);
    if (i + 1 < evs.length) ev.end = Math.min(ev.end, Math.max(evs[i + 1].start, ev.start + 1));
  }

  const restTokens = (units) => {
    const out = [];
    let rest = units;
    while (rest > 0) {
      const hit = LEN_TABLE.find(([u]) => u <= rest);
      out.push('r' + hit[1]);
      rest -= hit[0];
    }
    return out;
  };

  const tokens = [`t${bpm}`];
  let curOct = null;
  let cursor = 0;
  for (const ev of evs) {
    if (ev.start > cursor) tokens.push(...restTokens(ev.start - cursor));
    cursor = ev.start;
    const oct = KB_BASE_OCT + Math.floor(ev.semi / 12);
    if (oct !== curOct) { tokens.push('o' + oct); curOct = oct; }
    const units = ev.end - ev.start;
    // 音は分割できない（タイ未対応）ので、表現できる最大長を採用し残りを休符化
    const hit = LEN_TABLE.find(([u]) => u <= units);
    tokens.push(NOTE_NAMES[((ev.semi % 12) + 12) % 12] + hit[1]);
    cursor += hit[0];
    if (units - hit[0] > 0) { tokens.push(...restTokens(units - hit[0])); cursor += units - hit[0]; }
  }
  return tokens.join(' ');
}

document.getElementById('copyOut').addEventListener('click', () => {
  if (!recOut.value) return;
  recOut.select();
  document.execCommand('copy');
  recStatus.textContent = T('common.copied');
});
document.getElementById('insertOut').addEventListener('click', () => {
  if (!recOut.value) return;
  const pos = ta.selectionStart ?? ta.value.length;
  applyText(ta.value.slice(0, pos) + recOut.value + ta.value.slice(pos));
  recStatus.textContent = T('common.inserted');
});

