  // ─────────────────────────────────────────
  //  MML試聴（既存機能）
  // ─────────────────────────────────────────
  const SAMPLE = [
    '; サンプル: きらきら星（行頭から始まる行=新トラック、行頭に空白=前のトラックの続き）',
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
      return `再生中 (イントロ ${info.loopStart.toFixed(1)} 秒 + 1ループ ${(info.duration - info.loopStart).toFixed(1)} 秒)`;
    }
    return `再生中 (1ループ ${info.duration.toFixed(1)} 秒)`;
  }

  ta.value = localStorage.getItem('mmlforge8') || SAMPLE;
  ta.addEventListener('input', () => {
    localStorage.setItem('mmlforge8', ta.value);
    renderChToggles();
  });
  renderChToggles();

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

  // テキストエリアをトラックブロックに分解する
  // ルール: 行頭から始まる行 = 新トラック。行頭が空白の行 = 前のトラックの継続。
  //         コメント（; 行末まで / ブロック /* */）は stripComments で空白化済みのため
  //         コメントだけの行や空行は透過（トラックを分断しない。トラック途中に挟める）
  // 戻り値: [{ mml: 連結済みMML, start, end }]（start/end = トラックに属する行番号の範囲）
  function parseTrackBlocks(text) {
    const lines = stripComments(text).split('\n');
    const blocks = [];
    let cur = null;
    lines.forEach((line, i) => {
      const t = line.trim();
      if (!t) return;
      if (/^[ \t]/.test(line) && cur) {
        cur.mml += ' ' + t;
        cur.end = i;
      } else {
        cur = { mml: t, start: i, end: i };
        blocks.push(cur);
      }
    });
    return blocks;
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
          i++;
          if (i < to && s[i].toLowerCase() === 'e') {
            i++;
            for (let k = 0; k < 4; k++) {
              while (i < to && s[i] === ' ') i++;
              num();
              if (k < 3) { while (i < to && s[i] === ' ') i++; if (s[i] === ',') i++; }
            }
          } else num();
          toks.push({ type: 'other', start: st, end: i });
        } else if ('tvq'.includes(ch)) { i++; num(); toks.push({ type: 'other', start: st, end: i }); }
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
      else if (tk.type === ']') { if (!stack.length) throw new Error('[ ] の対応が取れません'); pair[stack.pop()] = i; }
    });
    if (stack.length) throw new Error('[ ] の対応が取れません');
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
        if (++steps > 200000) throw new Error('リピートの展開が大きすぎます');
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
      error.textContent = e.message;
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
    if (!sameNotes(before, after)) throw new Error('検算に失敗しました');
    return { out, nLen, nOct, nHead };
  }

  // 選択範囲（未選択なら全体）を最適化する
  document.getElementById('optMml').addEventListener('click', () => {
    error.textContent = '';
    const text = ta.value;
    let selFrom = ta.selectionStart ?? 0, selTo = ta.selectionEnd ?? 0;
    if (selFrom === selTo) { selFrom = 0; selTo = text.length; }
    try {
      tracks().forEach(m => MMLPlayer.parse(m));
    } catch (e) {
      error.textContent = '最適化の前にMMLのエラーを直してください — ' + e.message;
      return;
    }
    let res;
    try {
      res = optimizeMML(text, selFrom, selTo);
    } catch (e) {
      error.textContent = '最適化を中止しました（内容は変えていません） — ' + e.message;
      return;
    }
    if (!res) { status.textContent = '縮められる記述はありませんでした'; return; }
    applyText(res.out);
    status.textContent = `最適化しました（音長${res.nLen}箇所・オクターブ${res.nOct}箇所`
      + (res.nHead ? `・l4追加${res.nHead}トラック）` : '）');
  });
  // mml.js に渡せる形（コメント除去済み・1行=1トラック）でクリップボードへ。
  // mml.js が読み飛ばすのは空白・タブ・改行・| だけなので、エディタ側の記法（コメント・継続行）は
  // ここで潰しておく必要がある
  document.getElementById('copyMml').addEventListener('click', () => {
    error.textContent = '';
    const trks = tracks();
    if (!trks.length) { status.textContent = 'コピーするトラックがありません'; return; }
    const el = document.createElement('textarea');
    el.value = trks.join('\n') + '\n';
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    status.textContent = `mml.js用に整形してコピーしました（${trks.length}トラック）`;
  });
  document.getElementById('stop').addEventListener('click', () => {
    MMLPlayer.stop();
    status.textContent = '停止';
  });
  vol.addEventListener('input', () => MMLPlayer.setVolume(vol.value / 100));

