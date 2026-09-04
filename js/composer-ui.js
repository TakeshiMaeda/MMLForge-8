// ─────────────────────────────────────────
//  自動作曲（ガチャ）
// ─────────────────────────────────────────
const genMood = document.getElementById('genMood');
const genBars = document.getElementById('genBars');
const genSeed = document.getElementById('genSeed');
let genUndoBuf = null;

[genMood, document.getElementById('harmMood')].forEach((sel) => {
  MMLComposer.MOOD_LIST.forEach(({ id, label }) => {
    const op = document.createElement('option');
    op.value = id;
    op.textContent = label;
    sel.appendChild(op);
  });
});

// キー選択肢（12音）
const genKey = document.getElementById('genKey');
NOTE_NAMES.forEach((name) => {
  const op = document.createElement('option');
  op.value = name;
  op.textContent = name.toUpperCase();
  genKey.appendChild(op);
});

// 雰囲気プリセット + 個別上書きパラメータを集める（空欄・「雰囲気まかせ」は渡さない）
function genParams() {
  const v = (id) => document.getElementById(id).value;
  const p = { mood: genMood.value };
  if (v('genScale')) p.scale = v('genScale');
  if (v('genKey')) p.key = v('genKey');
  if (v('genDensity') !== '') p.density = +v('genDensity');
  if (+v('genTempo') > 0) p.tempo = +v('genTempo');
  const dr = v('genDrums');
  if (dr === 'off') p.drums = false;
  else if (dr) { p.drums = true; p.drumStyle = dr; }
  if (v('genHarm')) p.harm = v('genHarm') === 'on';
  return p;
}

function doGenerate(seed) {
  genSeed.value = seed;
  const res = MMLComposer.generate({ ...genParams(), bars: +genBars.value, seed });
  genUndoBuf = ta.value;
  applyText(res.comment + '\n' + res.tracks.join('\n\n'));
  error.textContent = '';
  try {
    const info = playTracks(res.tracks);
    status.textContent = playStatusText(info);
  } catch (e) {
    status.textContent = '';
    showError(e);
  }
}

document.getElementById('genRnd').addEventListener('click', () => doGenerate(1 + Math.floor(Math.random() * 999999)));
document.getElementById('genGo').addEventListener('click', () => doGenerate(Math.max(1, +genSeed.value || 1)));
document.getElementById('genUndo').addEventListener('click', () => {
  if (genUndoBuf === null) return;
  const cur = ta.value;
  applyText(genUndoBuf);
  genUndoBuf = cur;
  status.textContent = '入れ替えました';
});

// メロディ伴奏付け
function doHarmonize(seed) {
  document.getElementById('harmSeed').value = seed;
  const block = parseTrackBlocks(ta.value)[0];
  if (!block) {
    error.textContent = 'メロディが見つかりません（コメント以外のMML行が必要です）';
    return;
  }
  const melody = block.mml;
  error.textContent = '';
  // 伴奏付け専用コントロールのみ参照（生成系の上書き設定は使わない）
  const v = (id) => document.getElementById(id).value;
  const opts = { mood: v('harmMood'), seed };
  if (v('harmDrums') === 'off') opts.drums = false;
  else if (v('harmDrums')) { opts.drums = true; opts.drumStyle = v('harmDrums'); }
  if (v('harmHarm')) opts.harm = v('harmHarm') === 'on';
  try {
    const res = MMLComposer.harmonize(melody, opts);
    genUndoBuf = ta.value;
    // メロディ部分はユーザーの改行・整形を保ったまま原文で残す
    const melodyText = ta.value.split('\n').slice(block.start, block.end + 1).join('\n');
    applyText(res.comment + '\n' + melodyText + '\n\n' + res.tracks.join('\n\n'));
    const info = playTracks([melody, ...res.tracks]);
    status.textContent = playStatusText(info) + (res.warning ? ' ※' + res.warning : '');
  } catch (e) {
    status.textContent = '';
    showError(e);   // メロディ(先頭トラック)の記法エラーは原文の行・文字位置で示す
  }
}
document.getElementById('harmGo').addEventListener('click',
  () => doHarmonize(Math.max(1, +document.getElementById('harmSeed').value || 1)));
document.getElementById('harmRnd').addEventListener('click',
  () => doHarmonize(1 + Math.floor(Math.random() * 999999)));

// メロディ追い足し
function doExtend(seed) {
  document.getElementById('extSeed').value = seed;
  const block = parseTrackBlocks(ta.value)[0];
  if (!block) {
    error.textContent = 'メロディが見つかりません（コメント以外のMML行が必要です）';
    return;
  }
  error.textContent = '';
  // 追い足し専用コントロールのみ参照
  const v = (id) => document.getElementById(id).value;
  const densitySel = v('extDensity');
  const bars = Math.max(1, Math.min(8, +v('extBars') || 1));
  try {
    const res = MMLComposer.extendMelody(block.mml, {
      seed,
      bars,
      density: densitySel === '' ? undefined : +densitySel,
      scale: v('extScale') || undefined,
      octave: +v('extOct') || 0,
      build: document.getElementById('extBuild').checked,
      cadence: document.getElementById('extCadence').checked,
    });
    genUndoBuf = ta.value;
    // 追加部分を継続行としてブロック末尾の次行に挿入（元の行の整形は保持）
    const lines = ta.value.split('\n');
    lines.splice(block.end + 1, 0, '  | ' + res.added);
    applyText(lines.join('\n'));
    status.textContent = `メロディに${bars}小節追い足しました（「元に戻す」で取り消し可）` + (res.warning ? ' ※' + res.warning : '');
  } catch (e) {
    status.textContent = '';
    showError(e);
  }
}
document.getElementById('melExtend').addEventListener('click',
  () => doExtend(Math.max(1, +document.getElementById('extSeed').value || 1)));
document.getElementById('extRnd').addEventListener('click',
  () => doExtend(1 + Math.floor(Math.random() * 999999)));

