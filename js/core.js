// ─────────────────────────────────────────
//  MML試聴（既存機能）
// ─────────────────────────────────────────
const SAMPLE = [
  T('sample.comment'),
  't120 l8 o5 @1 v11 q7 @e3,20,70,60',
  '  cc gg aa g4 | ff ee dd c4',
  '  [gg ff ee d4]2',
  '  cc gg aa g4 | ff ee dd c4',
  '',
  't120 l4 o3 @2 v9',
  '  c e g e | f d e c',
  '  [e c g <b>]2',
  '  c e g e | f d e c',
].join('\n');

// 音名（ガチャのキー選択・ミニ鍵盤・録音MML化・音声採譜で共用）
const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

const ta     = document.getElementById('mml');
const status = document.getElementById('status');
const error  = document.getElementById('error');
const loopCk = document.getElementById('loop');
const vol    = document.getElementById('vol');

// ── チャンネルON/OFF ──
// chOn[i] = トラックiを再生するか。OFFでも再生には全トラックを渡し、トラック別ゲインでミュートする
// （再生中の切替を即反映するため）。伴奏付け・追い足しの対象はミュート状態と無関係に先頭トラック
const chBox = document.getElementById('chToggles');
let chOn = [];
try { chOn = JSON.parse(localStorage.getItem('mmlforge8-ch')) || []; } catch (e) { chOn = []; }

function renderChToggles() {
  const blocks = parseTrackBlocks(ta.value);
  chOn = blocks.map((b, i) => chOn[i] !== false);   // 新チャンネルはON
  localStorage.setItem('mmlforge8-ch', JSON.stringify(chOn));
  chBox.innerHTML = '';
  blocks.forEach((b, i) => {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = chOn[i];
    cb.addEventListener('change', () => {
      chOn[i] = cb.checked;
      localStorage.setItem('mmlforge8-ch', JSON.stringify(chOn));
      if (MMLPlayer.playing) MMLPlayer.setTrackMute(i, !cb.checked);
    });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(' ch' + (i + 1)));
    lab.title = b.mml.slice(0, 40);
    chBox.appendChild(lab);
  });
}

// テキストエリアの書き換え+保存+chトグル更新をまとめる（プログラムからの変更は必ずこれを通す）
function applyText(text) {
  ta.value = text;
  localStorage.setItem('mmlforge8', text);
  renderChToggles();
}

// 再生 + OFFチャンネルのミュート適用
function playTracks(trks) {
  const info = MMLPlayer.play(trks, { loop: loopCk.checked });
  chOn.forEach((on, i) => { if (!on) MMLPlayer.setTrackMute(i, true); });
  return info;
}

// 再生ステータス（無限ループ [ ]0 使用時はイントロとループ区間を分けて表示）
function playStatusText(info) {
  if (info.loopStart > 0) {
    return T('play.statusIntro', { intro: info.loopStart.toFixed(1), loop: (info.duration - info.loopStart).toFixed(1) });
  }
  return T('play.status', { loop: info.duration.toFixed(1) });
}

ta.value = localStorage.getItem('mmlforge8') || SAMPLE;
ta.addEventListener('input', () => {
  localStorage.setItem('mmlforge8', ta.value);
  renderChToggles();
  document.getElementById('barReport').textContent = '';   // 編集したら小節チェックの結果は古くなる
});
renderChToggles();

// 小節チェックの拍子（曲ごとに変わるので覚えておく）
document.getElementById('barBeats').value = localStorage.getItem('mmlforge8-barbeats') || '4';

// コメントを空白に置き換える（行構造は維持されるので行番号がずれない）
//   ; …… そこから行末まで（行頭でも行の途中でも可）
//   /* */ …… 行頭・行の途中・複数行またぎのどこでも。閉じ忘れは終端までコメント扱い
function stripComments(text) {
  let out = '';
  let inC = false;   // /* */ の中
  let inL = false;   // ; 〜行末 の中
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') { inL = false; out += ch; continue; }
    if (inC) {
      if (ch === '*' && text[i + 1] === '/') { inC = false; out += '  '; i++; }
      else out += ' ';
      continue;
    }
    if (inL) { out += ' '; continue; }
    if (ch === '/' && text[i + 1] === '*') { inC = true; out += '  '; i++; continue; }
    if (ch === ';') { inL = true; out += ' '; continue; }
    out += ch;
  }
  return out;
}

// テキストエリアをトラックブロックに分解する（トラック分割のルールはここだけが知っている）
// ルール: 行頭から始まる行 = 新トラック。行頭が空白の行 = 前のトラックの継続。
//         コメント（; 行末まで / ブロック /* */）は stripComments で空白化済みのため
//         コメントだけの行や空行は透過（トラックを分断しない。トラック途中に挟める）
// 戻り値: [{ mml, start, end, lines, pieces }]
//   mml    … 各行を trim して ' ' で連結した1トラック分のMML（mml.js にそのまま渡せる）
//   start/end … トラックに属する行の範囲（0始まりの行インデックス）
//   lines  … 属する行の一覧 [{ no: 1始まりの行番号, text: trim済み }]（空行・コメントのみの行は除く）
//   pieces … mml の各行ぶんが原文のどこから来たか [{ from: mml内の開始位置, line: 0始まり行, col: 0始まり桁 }]
//            （mml.js のエラー位置を原文の行・桁に戻すための対応表。trackPos が使う）
function parseTrackBlocks(text) {
  const lines = stripComments(text).split('\n');
  const blocks = [];
  let cur = null;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const col = line.length - line.trimStart().length;
    if (/^[ \t]/.test(line) && cur) {
      cur.pieces.push({ from: cur.mml.length + 1, line: i, col });
      cur.mml += ' ' + t;
      cur.end = i;
      cur.lines.push({ no: i + 1, text: t });
    } else {
      cur = { mml: t, start: i, end: i, lines: [{ no: i + 1, text: t }], pieces: [{ from: 0, line: i, col }] };
      blocks.push(cur);
    }
  });
  return blocks;
}

// mml.js が返す位置（block.mml 内の1始まりの文字位置）を原文の { line, col }（どちらも1始まり）に戻す
function trackPos(block, pos) {
  const i = pos - 1;
  let pc = block.pieces[0];
  for (const p of block.pieces) { if (p.from <= i) pc = p; else break; }
  return { line: pc.line + 1, col: pc.col + (i - pc.from) + 1 };
}

// mml.js のエラー（MMLError。文言を持たず code と位置だけ）を、エディタ上の行と文字位置つきの
// 表示言語の文にする。文言は js/mml-messages.js、位置の書式は js/i18n.js が持つ。
//   トラック2 3行目 5文字目: 解釈できない文字です: "%"
// mml.js 以外のエラー（作曲エンジン等、最初から日本語の message を持つもの）はそのまま返す
function locateError(e, blocks) {
  if (!e.code) return e.message;
  const body = mmlMessage(e);
  const b = (e.track === null || e.track === undefined) ? null : blocks[e.track];
  if (!b) return body;                                   // 曲全体のエラー（NO_NOTES）
  if (!(e.pos > 0)) return T('err.track', { track: e.track + 1, body });
  const { line, col } = trackPos(b, e.pos);
  return T('err.at', { track: e.track + 1, line, col, body });
}

// エラー欄に出す。MMLの記法エラーなら原文の行と文字位置に直す
function showError(e) {
  error.textContent = locateError(e, parseTrackBlocks(ta.value));
}

function tracks() {
  return parseTrackBlocks(ta.value).map(b => b.mml);
}

// ── 記述の最適化 ────────────────────────────
// 冗長な記述を縮める: l と同じ音長の明示指定を落とす / 絶対オクターブ指定を > < に変える。
// コメント空白化済みテキスト（原文と長さが同じ）の上でトークン化し、書き換えは原文の同じ
// オフセットへ適用する。トークンには原文での位置を持たせる

// 1トラック分（ranges = トラックに属する行の文字範囲）をトークン化する
function optTokenize(s, ranges) {
  const toks = [];
  ranges.forEach(({ from, to }) => {
    let i = from;
    const num = () => { let v = ''; while (i < to && /\d/.test(s[i])) v += s[i++]; return v; };
    const val = (v) => (v === '' ? null : parseInt(v, 10));
    // カンマ区切りの n 個の数値を読み飛ばす（mml.js の readNums と同じ形）
    const nums = (n, signed) => {
      for (let k = 0; k < n; k++) {
        while (i < to && s[i] === ' ') i++;
        if (signed && i < to && (s[i] === '-' || s[i] === '+')) i++;
        num();
        if (k < n - 1) { while (i < to && s[i] === ' ') i++; if (i < to && s[i] === ',') i++; }
      }
    };
    while (i < to) {
      const st = i;
      const ch = s[i].toLowerCase();
      if (/[\s|]/.test(ch)) { i++; continue; }
      if (/[cdefgab]/.test(ch) || ch === 'r') {
        i++;
        while (i < to && /[#+\-]/.test(s[i])) i++;
        const nSt = i;
        const n = num();
        while (i < to && s[i] === '.') i++;
        toks.push({ type: 'note', start: st, end: i, numStart: nSt, numEnd: nSt + n.length, num: val(n) });
      } else if (ch === 'o') { i++; const n = num(); toks.push({ type: 'o', start: st, end: i, num: val(n) }); }
      else if (ch === '>') { i++; toks.push({ type: 'rel', start: st, end: i, d: 1 }); }
      else if (ch === '<') { i++; toks.push({ type: 'rel', start: st, end: i, d: -1 }); }
      else if (ch === 'l') { i++; const n = num(); toks.push({ type: 'l', start: st, end: i, num: val(n) }); }
      else if (ch === '[') { i++; toks.push({ type: '[', start: st, end: i }); }
      else if (ch === ']') { i++; const n = num(); toks.push({ type: ']', start: st, end: i, count: n === '' ? 0 : parseInt(n, 10) }); }
      else if (ch === '@') {
        // @b は数値が負を取りうる。ここで読み切らないと続く b が音符と誤読される
        i++;
        const sub = i < to ? s[i].toLowerCase() : '';
        if (sub === 'e') { i++; nums(4, false); }
        else if (sub === 'b') { i++; nums(2, true); }
        else num();
        toks.push({ type: 'other', start: st, end: i });
      } else if (ch === 'm') { i++; nums(3, false); toks.push({ type: 'other', start: st, end: i }); }
      else if ('tvqp'.includes(ch)) { i++; num(); toks.push({ type: 'other', start: st, end: i }); }
      else { i++; toks.push({ type: 'other', start: st, end: i }); }
    }
  });
  return toks;
}

function optMatchBrackets(toks) {
  const pair = {};
  const stack = [];
  toks.forEach((tk, i) => {
    if (tk.type === '[') stack.push(i);
    else if (tk.type === ']') { if (!stack.length) throw new Error(T('opt.unbalanced')); pair[stack.pop()] = i; }
  });
  if (stack.length) throw new Error(T('opt.unbalanced'));
  return pair;
}

// リピートを展開しながら各トークン到達時の状態を記録する。
//   oct/len  … 現在のオクターブ・デフォルト音長
//   hasO/hasL … そのトラックで明示的な o / l が既に出ているか。まだなら暗黙の初期値（o4/l4）に
//               頼っていることになるので最適化しない（先頭の o / l は残す）
// 周回ごとに状態が変わるトークン（例: [o5 c]2 の o5 は1周目o4基準・2周目o5基準）は 'x'（矛盾）とし、
// 相対化・省略すると2周目以降が壊れるので書き換え対象から外す
// assumeL = true は「トラックの頭に l4 を足した」と仮定した状態で走らせる（足す価値の見積り用）
function optSimulate(toks, pair, assumeL) {
  const seen = new Array(toks.length).fill(null);
  const key = (s) => `${s.oct},${s.len},${s.hasO},${s.hasL}`;
  let steps = 0;
  const run = (from, to, s) => {
    for (let i = from; i < to; i++) {
      if (++steps > 200000) throw new Error(T('opt.tooLarge'));
      const tk = toks[i];
      if (tk.type === '[') {
        const end = pair[i];
        // 無限ループ []0 は mml.js のパース上1回だけ展開される（2周目以降はイベントの複製）
        const times = toks[end].count === 0 ? 1 : toks[end].count;
        for (let k = 0; k < times; k++) {
          const snap = key(s);
          run(i + 1, end, s);
          if (key(s) === snap) break;   // 状態が動かない周回なら以降も同じ
        }
        i = end;
        continue;
      }
      const prev = seen[i];
      if (prev === null) seen[i] = { oct: s.oct, len: s.len, hasO: s.hasO, hasL: s.hasL };
      else if (prev !== 'x' && key(prev) !== key(s)) seen[i] = 'x';
      if (tk.type === 'o' && tk.num !== null) { s.oct = tk.num; s.hasO = true; }
      else if (tk.type === 'rel') s.oct += tk.d;
      else if (tk.type === 'l' && tk.num !== null) { s.len = tk.num; s.hasL = true; }
    }
  };
  run(0, toks.length, { oct: 4, len: 4, hasO: false, hasL: !!assumeL });   // mml.js の初期値と揃える
  return seen;
}

// 検算用: トラックごとの音符列（時刻・長さ・音高）が完全に一致するか
function sameNotes(a, b) {
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    if (p.notes.length !== q.notes.length) return false;
    return p.notes.every((n, j) => {
      const m = q.notes[j];
      return n.midi === m.midi && Math.abs(n.time - m.time) < 1e-6 && Math.abs(n.dur - m.dur) < 1e-6;
    });
  });
}

document.getElementById('play').addEventListener('click', () => {
  error.textContent = '';
  try {
    const info = playTracks(tracks());
    status.textContent = playStatusText(info);
  } catch (e) {
    status.textContent = '';
    showError(e);
  }
});
// [selFrom, selTo) を最適化した全文を返す（縮められなければ null）。
// 状態はトラック先頭から追うので、範囲の手前にある l / o の影響もそのまま効く。
// 書き換えは局所的に等価なものだけだが、最後に音符列が変わっていないことを検算する
function optimizeMML(text, selFrom, selTo) {
  const before = parseTrackBlocks(text).map(b => MMLPlayer.parse(b.mml));
  const stripped = stripComments(text);
  const lines = stripped.split('\n');
  const off = [];
  lines.reduce((a, l) => { off.push(a); return a + l.length + 1; }, 0);
  const edits = [];
  let nLen = 0, nOct = 0, nHead = 0;
  parseTrackBlocks(text).forEach(b => {
    const ranges = [];
    for (let i = b.start; i <= b.end; i++) ranges.push({ from: off[i], to: off[i] + lines[i].length });
    const toks = optTokenize(stripped, ranges);
    const pair = optMatchBrackets(toks);
    // 各トークン到達時の状態から書き換え案を作る
    const plan = (seen) => {
      const es = [];
      let len = 0, oct = 0;
      const swap = (tk, txt) => {   // トークンを txt に差し替える（消すときは余る空白を1つ吸収）
        let end = tk.end;
        if (txt === '' && stripped[end] === ' ') end++;
        es.push({ start: tk.start, end, text: txt });
      };
      toks.forEach((tk, i) => {
        const s = seen[i];
        if (!s || s === 'x') return;                        // 未到達・周回で状態が変わるものは触らない
        if (tk.start < selFrom || tk.end > selTo) return;   // 選択範囲に丸ごと入っているものだけ
        // hasL/hasO が false = まだ明示の l/o が無く暗黙の初期値のまま。そこは触らない
        if (tk.type === 'note' && tk.num !== null && s.hasL && tk.num === s.len) {
          es.push({ start: tk.numStart, end: tk.numEnd, text: '' });   // 付点は残す（c4. → c.）
          len++;
        } else if (tk.type === 'l' && tk.num !== null && s.hasL && tk.num === s.len) {
          swap(tk, '');   // 今と同じ値の l の言い直し
          len++;
        } else if (tk.type === 'o' && tk.num !== null && s.hasO) {
          const d = tk.num - s.oct;
          if (Math.abs(d) > 2) return;   // 3オクターブ以上の跳躍は > を並べるより o のほうが読みやすい
          swap(tk, d === 0 ? '' : (d > 0 ? '>' : '<').repeat(Math.abs(d)));
          oct++;
        }
      });
      return { es, len, oct };
    };
    // 明示の l が無い区間に4分音符（明示の 4 も、数字省略の暗黙の 4 も）があれば、頭に l4 を置いて
    // 明示にする。l4 は暗黙の初期値と同じ値なので音は変わらず、以降は数字を省ける。
    // トラック先頭は必ず行頭=col 0 なので、ここへの挿入はトラック分割を壊さない
    const seen = optSimulate(toks, pair, false);
    const head = ranges[0].from;
    const wantL4 = head >= selFrom && head < selTo && toks.some((tk, i) => {
      const s = seen[i];
      return s && s !== 'x' && tk.type === 'note' && !s.hasL
        && (tk.num === 4 || tk.num === null) && tk.start >= selFrom && tk.end <= selTo;
    });
    if (wantL4) { edits.push({ start: head, end: head, text: 'l4 ' }); nHead++; }
    const p = plan(wantL4 ? optSimulate(toks, pair, true) : seen);
    edits.push(...p.es);
    nLen += p.len;
    nOct += p.oct;
  });
  if (!edits.length) return null;
  // 同じ位置に削除と挿入が並んだときは、削除を先に適用してから挿入する（降順適用なので end の大きい順）
  edits.sort((x, y) => y.start - x.start || y.end - x.end);
  let out = text;
  edits.forEach(e => { out = out.slice(0, e.start) + e.text + out.slice(e.end); });
  const after = parseTrackBlocks(out).map(b => MMLPlayer.parse(b.mml));
  if (!sameNotes(before, after)) throw new Error(T('opt.verifyFailed'));
  return { out, nLen, nOct, nHead };
}

// 選択範囲（未選択なら全体）を最適化する
document.getElementById('optMml').addEventListener('click', () => {
  error.textContent = '';
  const text = ta.value;
  let selFrom = ta.selectionStart ?? 0, selTo = ta.selectionEnd ?? 0;
  if (selFrom === selTo) { selFrom = 0; selTo = text.length; }
  try {
    tracks().forEach((m, i) => MMLPlayer.parse(m, i));
  } catch (e) {
    error.textContent = T('opt.fixFirst') + locateError(e, parseTrackBlocks(text));
    return;
  }
  let res;
  try {
    res = optimizeMML(text, selFrom, selTo);
  } catch (e) {
    error.textContent = T('opt.aborted') + locateError(e, parseTrackBlocks(text));
    return;
  }
  if (!res) { status.textContent = T('opt.nothing'); return; }
  applyText(res.out);
  status.textContent = T('opt.done', { len: res.nLen, oct: res.nOct, head: res.nHead });
});
// ── 小節チェック ────────────────────────────
// 手書きMMLで一番多い事故は「1小節に入れる音符の数を間違える」こと。MMLとしては何も間違っていないので
// パーサは黙って通し、再生してトラックがズレて初めて気づく。しかもどの小節が原因かは分からない。
// ここでは (1)各トラックの尺が小節の整数倍か (2)全トラックで尺が揃っているか を判定し、
// 崩れているトラックについては「何行目で小節線から外れ始めたか」を示す。
//
// 行ごとの到達位置は、トラック先頭からその行までを丸ごと MMLPlayer.parse して求める。
// こうするとリピートの展開がパーサ任せになるので、[ ]2 や [ ]48 があっても正しく数えられる。
// リピートの途中の行は [ が閉じていなくてパースできないので、開いたままの [ の数だけ ]1
// （1回だけ繰り返す＝中身そのまま）を仮に足して閉じる。こうすると [ ]0 で本体を丸ごと括った
// 曲でも、中の行が全部スキップされずに位置を測れる。
function barCheck(beatsPerBar) {
  const trks = parseTrackBlocks(ta.value);
  const whole = (x) => Math.abs(x - Math.round(x)) < 1e-6;
  // 途中までのMMLを測る。リピートの途中なら開いたままの [ の数だけ ]1 を足して閉じる
  const partial = (src) => {
    let open = 0;
    for (const c of src) { if (c === '[') open++; else if (c === ']') open--; }
    return MMLPlayer.parse(src + ']1'.repeat(Math.max(0, open)));
  };
  // 曲の長さとループ開始点は mml.js の _parse と同じ決め方にする。無限ループ [ ]0 のトラックは
  // 本体が曲末まで敷き詰められて鳴るので、「書いた長さ」ではなく「敷き詰めた後に鳴る長さ」で
  // 判定しないと同尺を誤る（gggggggg と [c] は同じだけ鳴るのに「長さが違う」と言ってしまう）
  const parsed = trks.map((tr, ti) => MMLPlayer.parse(tr.mml, ti));
  const songDur = parsed.reduce((d, q) => Math.max(d, q.duration), 0);
  const songLoop = parsed.reduce((x, q) => (q.loopStart === null ? x : Math.max(x, q.loopStart)), 0);
  const rows = [];
  let allSame = true;

  trks.forEach((tr, ti) => {
    const mml = tr.mml;
    const p = parsed[ti];
    const played = p.loopStart === null ? p.duration : songDur;   // 実際に鳴る長さ
    if (Math.abs(played - songDur) > 1e-6) allSame = false;

    // parse が返す tempo は「最後に設定された値」なので、途中でテンポが変わるトラックでは
    // 小節長を1つに決められない。誤った数字を出すより判定不能と言うほうがいい。
    // 最初の t より前に音符・休符があれば、そこは既定の t120 で鳴っているので 120 も数える
    const tempos = [...new Set((mml.match(/t\d+/gi) || []).map(s => parseInt(s.slice(1), 10)))];
    const firstT = mml.search(/t\d/i);
    let headDur = 0;
    try { headDur = partial(firstT < 0 ? mml : mml.slice(0, firstT)).duration; } catch (e) { /* 途中で切れて読めなければ 0 扱い */ }
    if (headDur > 0 && !tempos.includes(120)) tempos.unshift(120);
    if (tempos.length > 1) {
      rows.push({ ch: ti + 1, notes: p.notes.length, sec: played, multiTempo: tempos });
      return;
    }
    const barSec = beatsPerBar * 60 / p.tempo;
    const bars = played / barSec;

    // 無限ループの内訳。無限ループは曲末で打ち切られるので長さは必ず曲と揃う（同尺NGにはならない）。
    // 本体の長さがループ区間長の約数でないと、繋ぎ目で本体の途中から頭に戻って並びが変わる。
    // 長さの誤りではなく書き手の意図次第なので、内訳として示すだけで要確認にはしない
    let loop = null;
    if (p.loopStart !== null) {
      const bodyLen = p.duration - p.loopStart;
      const times = bodyLen > 1e-9 ? (songDur - songLoop) / bodyLen : 0;
      loop = {
        introBars: p.loopStart / barSec,
        bodyBars: bodyLen / barSec,
        times,
        fit: bodyLen > 1e-9 && whole(times),
      };
    }

    // 小節線に乗っていない箇所を数え、最初の1つを覚えておく（ズレの起点が分かればいい）。
    // 行ではなく | 区切りごとに見るので、1行に複数小節書いていても位置を絞れる
    // 1小節に満たないループ本体（ドラムの1拍パターン等）は、1回ごとに小節線から外れて
    // 当たり前なので数えない。繰り返しの単位そのものなので崩れの手がかりにならない
    let strays = 0, first = null, acc = '';
    if (!loop || whole(loop.bodyBars)) tr.lines.forEach(l => {
      l.text.split('|').forEach((part, pi, arr) => {
        acc += ' ' + part;
        if (!part.trim()) return;
        let q;
        try { q = partial(acc); } catch (e) { return; }
        const b = q.duration / barSec;
        if (!whole(b)) {
          strays++;
          if (!first) first = { no: l.no, part: arr.length > 1 ? pi + 1 : 0, bars: b };
        }
      });
    });
    rows.push({
      ch: ti + 1, bars, notes: p.notes.length, tempo: p.tempo, loop,
      ok: whole(bars), strays, first,
    });
  });
  return { rows, allSame };
}

// 小節チェックの結果を報告にする。html は #barReport に入れる本文（要確認の箇所は span.ng で色を変える）、
// status はステータス欄の一言
function barReport(r, beats) {
  const bad = (s) => `<span class="ng">${s}</span>`;
  const out = [T('bar.header', { beats })];
  r.rows.forEach(x => {
    if (x.multiTempo) {
      out.push(T('bar.rowSec', { ch: x.ch, sec: x.sec.toFixed(3), notes: x.notes })
        + bad(T('bar.multiTempo', { tempos: x.multiTempo.join(' / t') })));
      return;
    }
    let line = T('bar.row', { ch: x.ch, bars: x.bars.toFixed(3), tempo: x.tempo, notes: x.notes });
    if (x.loop) {   // 無限ループは「前奏 + 本体×回数」の内訳を添える（1音でも曲末まで敷き詰まるため）
      line += T('bar.loop', {
        intro: x.loop.introBars > 1e-6 ? x.loop.introBars.toFixed(3) : null,
        body: x.loop.bodyBars.toFixed(3), times: x.loop.times.toFixed(3), cut: !x.loop.fit,
      });
    }
    if (Math.abs(x.bars - Math.round(x.bars)) > 1e-6) line += bad(T('bar.notWhole'));
    if (x.strays) {
      const where = T('bar.where', { no: x.first.no, part: x.first.part });
      const s = T('bar.strays', { n: x.strays, where, bars: x.first.bars.toFixed(3) });
      line += x.ok ? `\n   ${s}` : bad(`\n   ${s}`);
    }
    out.push(line);
  });
  out.push(r.allSame ? T('bar.sameOk') : bad(T('bar.sameNg')));
  const ng = r.rows.some(x => x.multiTempo || !x.ok) || !r.allSame;
  return { html: out.join('\n'), status: ng ? T('bar.statusNg') : T('bar.statusOk') };
}

document.getElementById('checkBars').addEventListener('click', () => {
  error.textContent = '';
  const rep = document.getElementById('barReport');
  const beats = Math.max(1, parseInt(document.getElementById('barBeats').value, 10) || 4);
  localStorage.setItem('mmlforge8-barbeats', String(beats));
  let r;
  try {
    r = barCheck(beats);
  } catch (e) {
    rep.textContent = '';
    error.textContent = T('bar.fixFirst') + locateError(e, parseTrackBlocks(ta.value));
    return;
  }
  if (!r.rows.length) { rep.textContent = ''; status.textContent = T('bar.noTracks'); return; }
  const out = barReport(r, beats);
  rep.innerHTML = out.html;
  status.textContent = out.status;
});

// mml.js に渡せる形（コメント除去済み・1行=1トラック）でクリップボードへ。
// mml.js が読み飛ばすのは空白・タブ・改行・| だけなので、エディタ側の記法（コメント・継続行）は
// ここで潰しておく必要がある
document.getElementById('copyMml').addEventListener('click', () => {
  error.textContent = '';
  const trks = tracks();
  if (!trks.length) { status.textContent = T('copy.noTracks'); return; }
  const el = document.createElement('textarea');
  el.value = trks.join('\n') + '\n';
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  status.textContent = T('copy.done', { n: trks.length });
});
document.getElementById('stop').addEventListener('click', () => {
  MMLPlayer.stop();
  status.textContent = T('common.stopped');
});
vol.addEventListener('input', () => MMLPlayer.setVolume(vol.value / 100));

// 表示言語の切り替え（今と逆の言語へ。保存して読み直す）
document.getElementById('langToggle').addEventListener('click', () => setLang(LANG === 'ja' ? 'en' : 'ja'));

