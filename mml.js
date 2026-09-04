// MMLForge-8 / MMLPlayer — MML(Music Macro Language) パーサ + Web Audio シーケンサ（外部依存なし）
// Copyright (c) 2026 Takeshi Maeda (SPSoft)
// SPDX-License-Identifier: MIT
// この1ファイルだけコピーして使う場合も、上記の著作権表示とMITライセンス全文を添えること。
//
// ブラウザに <script src="mml.js"> で読み込むだけで、グローバル MMLPlayer が使える。
// 例: MMLPlayer.play(['t120 l8 cdefgab>c'], { loop: true });
//     MMLPlayer.setTrackMute(0, true);   // 再生中のトラック0を即時ミュート（false で復帰）
//
// 対応記法（1トラック = 1文字列、複数トラックで和音・伴奏）:
//   c d e f g a b   音符。直後に # or + でシャープ、- でフラット
//   数字            音長（4=四分, 8=八分, 12=三連 等）。省略時は l の値
//   .               付点（重ねがけ可: c4. c4..）
//   r               休符（音長・付点は音符と同様）
//   o<n>            オクターブ指定 (0-8, 初期値4。o4 の a = 440Hz)
//   > / <           オクターブ +1 / -1（0-8 の範囲を出るとエラー）
//   l<n>            デフォルト音長 (初期値4)
//   t<n>            テンポ BPM (初期値120)
//   v<n>            音量 0-15 (初期値10。範囲外はエラー)
//   q<n>            ゲートタイム 1-8 (8=音長いっぱい。初期値8。範囲外はエラー)
//   @<n>            音色 0=sine 1=square 2=triangle 3=sawtooth 4=noise (初期値1)
//   @e<a>,<d>,<s>,<r> エンベロープ: attack(ms), decay(ms), sustain(%), release(ms)
//                     初期値 @e3,0,100,40
//   &               タイ/スラー。前の音符と繋いでアタックを鳴らし直さない
//                     c4&c8 = 同じ高さを繋いで長くする（タイ）
//                     c4&e4 = 再アタックせず音程だけ差し替える（スラー）
//   m<遅>,<速>,<深> LFO（ビブラート）: 遅れ(ms), 速さ(Hz), 深さ(セント。中心から±)
//                     遅れは音符ごとに数え直す（& で繋いだ音は繋いだ全体で1音）
//                     波形はサイン波固定。初期値 m0,0,0（無効）
//   p<n>            ポルタメント。& の繋ぎ目を n ミリ秒かけて滑らせる。
//                     & のない音符の並びには効かない。初期値 p0（瞬時に切り替え）
//   @b<ずれ>,<時間> ベンド。出だしの音程を「ずれ」セント（負で下から/正で上から。+ を付けてもよい）ずらし、
//                     「時間」ミリ秒で正規の音程へ寄せる。次の音符1つにだけ効く（休符は
//                     消費しない）ので解除は不要。m と同じ detune 上で加算される
//   [ ... ]<n>      リピート n回（ネスト可）。1トラックの音符+休符が 100万 を超えるとエラー
//   [ ... ]0        n を省略するか 0 で無限ループ: 2周目以降ここから繰り返す（曲のループ開始点）。
//                   トラック末尾にのみ書ける。ループ再生OFF時は1回だけ演奏。
//                   複数トラックに書いた場合は最も遅い開始点を曲のループ開始点に採用。
//                   & の直後に置いてもよい（c4& [d4 e4]0）: 1周目は繋いで鳴り、2周目以降は d4 を頭から鳴らす
//   |               小節区切り（無視される。見た目整理用）
//   スペース・改行   無視
//
// 記法エラーは MMLError を投げる。表示用の文言は持たない（言語に依存させないため）:
//   code   … エラーの種類を表す識別子（'BAD_CHAR' 'O_RANGE' など。message も同じ値）
//   params … 文言に埋める値（{ char } { max } { label }）。MMLの記号と数値だけ
//   track  … 0始まりのトラック番号。曲全体のエラー（NO_NOTES）は null
//   pos    … 1始まりの「原文」の文字位置。リピート [ ]n の後ろでも展開後の位置にはならない
// 文言は利用側で code から作る（このリポジトリでは js/mml-messages.js が持つ）
const MMLPlayer = (() => {
  let _ctx        = null;
  let _masterGain = null;
  let _sessionGain = null;   // 再生セッションごとの出力（stop で切断して即消音）
  let _trackGains  = [];     // トラック別ゲイン（setTrackMute 用）
  let _timer   = null;
  let _events  = [];
  let _ptr     = 0;
  let _loopOff = 0;
  let _loopStart = 0;   // 曲のループ開始点（秒）。無限ループ [ ]0 指定時のみ >0
  let _loopPtr   = 0;   // ループ開始点以降の最初のイベント index
  let _songDur = 0;
  let _loop    = true;
  let _startTime = 0;
  let _stopAt    = 0;   // ループ再生OFF時に自動停止する時刻（秒）
  let _noiseBuf  = null;
  let _volume    = 0.8;

  const NOTE_INDEX = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const WAVES = ['sine', 'square', 'triangle', 'sawtooth', 'noise'];
  const LOOKAHEAD_SEC = 0.15;
  const TICK_MS = 50;
  const LFO_FADE = 0.05;   // LFOが効き始めるときの立ち上がり時間（秒）
  const STOP_FADE = 0.02;  // stop() で音を消すときのフェード時間（秒）
  // 1トラックの音符+休符の上限。リピートのタイプミス（[[[c]99]99]99 等）でブラウザが固まるのを防ぐ。
  // 1音あたり約570B なので 100万で約0.6GB・パース約0.4秒
  const MAX_STEPS = 1000000;

  // エラー。mml.js は文言を持たない（言語非依存）ので、種類は code、埋める値は params で伝える
  class MMLError extends Error {
    constructor(code, params = {}, track = null, pos = null) {
      super(code);          // message はコードそのもの。捕まえ損ねてもコンソールで種類は分かる
      this.name = 'MMLError';
      this.code = code;
      this.params = params;
      this.track = track;   // 0始まり。曲全体のエラーは null
      this.pos = pos;       // 1始まり・原文の文字位置。位置を持たないエラーは null
    }
  }

  function _getCtx() {
    if (!_ctx) {
      _ctx = new AudioContext();
      _masterGain = _ctx.createGain();
      _masterGain.gain.value = _volume;
      _masterGain.connect(_ctx.destination);
    }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  function _getNoiseBuf(c) {
    if (!_noiseBuf) {
      const len = c.sampleRate * 2;
      _noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const data = _noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return _noiseBuf;
  }

  // ── パース ──────────────────────────────────
  //
  // リピート [ ]n はテキストを展開せず、] に来たときに [ の直後へ読み戻して n 回走査する。
  // こうするとエラーの「位置M」が常に原文の文字位置になる（展開すると後ろの位置がずれる）。
  // 投げる Error には message のほか track（0始まりのトラック番号）と pos（1始まりの位置）を付ける

  function _parseTrack(src, ti) {
    let pos = 0;
    let oct = 4, defLen = 4, tempo = 120, vol = 10, wave = 1, q = 8;
    let env = { a: 3, d: 0, s: 100, r: 40 };
    let lfo = { delay: 0, rate: 0, depth: 0 };   // m: 遅れ(秒), 速さ(Hz), 深さ(セント)
    let porta = 0;          // p: & の繋ぎ目を滑らせる時間（秒）
    let bend = null;        // @b: 次の音符1つにだけ効く（使うと消える）
    let tie = false;        // & の直後か（次の音符を前の音に繋ぐ）
    let tiePos = 0;         // その & の位置（音符が来なかったときのエラー用）
    let time = 0;
    let loopStart = null;   // 無限ループ開始点（秒）
    let steps = 0;          // 音符+休符の数（MAX_STEPS の見張り）
    const evs = [];
    // 走査中のリピート（入れ子順）: open=[ の位置, body=中身の先頭, iter=済んだ周回数, time=[ に入った時刻,
    //   tieAt=[ の時点で & が保留中ならその繋ぎ先イベントの index（無ければ -1）
    const stack = [];

    const err = (code, params = {}, at = pos) => new MMLError(code, params, ti, at + 1);
    // 値の範囲エラーは「その値の先頭」を指したいので、読んだ数値の開始位置を覚えておく
    // （数値が無かった場合は「数値があるべき場所」がそのまま入る）
    let numAt = 0;      // 直近の readInt で読んだ値の開始位置
    let numsAt = [];    // 直近の readNums で読んだ各値の開始位置
    const readInt = () => {
      numAt = pos;
      let s = '';
      while (pos < src.length && /\d/.test(src[pos])) s += src[pos++];
      return s === '' ? null : parseInt(s, 10);
    };
    // カンマ区切りの整数を n 個読む（値の前後の空白は許す）。signed=true なら先頭の - を符号と見る
    const readNums = (n, signed, label, needCode) => {
      const out = [];
      numsAt = [];
      for (let i = 0; i < n; i++) {
        while (pos < src.length && src[pos] === ' ') pos++;
        numsAt.push(pos);
        let sign = 1;
        if (signed && (src[pos] === '-' || src[pos] === '+')) { sign = src[pos] === '-' ? -1 : 1; pos++; }
        const v = readInt();
        if (v === null) throw err(needCode);
        out.push(sign * v);
        if (i < n - 1) {
          while (pos < src.length && src[pos] === ' ') pos++;
          if (src[pos] !== ',') throw err('COMMA_REQUIRED', { label });
          pos++;
        }
      }
      return out;
    };
    const step = () => {
      if (++steps > MAX_STEPS) {
        throw err('TOO_MANY_STEPS', { max: MAX_STEPS }, stack.length ? stack[0].open : pos);
      }
    };
    const readDots = () => {
      let n = 0;
      while (pos < src.length && src[pos] === '.') { n++; pos++; }
      return n;
    };
    // 音長(数字+付点) → 拍数（四分音符=1拍）
    const readDuration = () => {
      const n = readInt();
      const base = n === null ? defLen : n;
      if (base <= 0) throw err('LEN_MIN', {}, numAt);
      let beats = 4 / base;
      let add = beats;
      const dots = readDots();
      for (let i = 0; i < dots; i++) { add /= 2; beats += add; }
      return beats;
    };

    while (pos < src.length) {
      const ch = src[pos].toLowerCase();
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '|') { pos++; continue; }

      if (NOTE_INDEX[ch] !== undefined) {
        pos++;
        let idx = NOTE_INDEX[ch];
        while (pos < src.length && (src[pos] === '#' || src[pos] === '+' || src[pos] === '-')) {
          idx += (src[pos] === '-') ? -1 : 1;
          pos++;
        }
        step();
        const beats = readDuration();
        const dur = beats * (60 / tempo);
        const midi = 12 * (oct + 1) + idx;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        if (tie) {
          // & で前の音に繋ぐ。新たに発音せず、前の音に音程の区間を足して伸ばすだけ。
          // 音色・音量・エンベロープは繋いだ先頭の音のものを全体に使う（発音は1回だから）
          const last = evs[evs.length - 1];
          last.segs.push({ freq, midi, dur });
          last.dur += dur;
          last.gate = Math.max(last.dur * last.q / 8, 0.02);
          tie = false;
        } else {
          evs.push({
            time, dur, midi, track: ti, q,
            gate: Math.max(dur * q / 8, 0.02),
            freq, wave,
            vol: Math.max((vol / 15) * 0.3, 0.0005),
            env: { ...env },
            segs: [{ freq, midi, dur }],   // & で繋いだ音程の区間（通常は1つ）
            lfo: { ...lfo }, porta, bend,
          });
          bend = null;   // @b は1回限り
        }
        time += dur;
      } else if (ch === 'r') {
        if (tie) throw err('TIE_REST');
        step();
        pos++;
        time += readDuration() * (60 / tempo);
      } else if (ch === '&') {
        if (!evs.length) throw err('TIE_NO_PREV');
        tiePos = pos;
        pos++;
        tie = true;
      } else if (ch === '[') {
        stack.push({ open: pos, body: pos + 1, iter: 0, time, tieAt: tie ? evs.length - 1 : -1 });
        pos++;
      } else if (ch === ']') {
        if (!stack.length) throw err('UNMATCHED_CLOSE');
        const fr = stack[stack.length - 1];
        pos++;
        const n = readInt();
        if (n === null || n === 0) {
          // 無限ループ。後続に音符等があると「どこまでがループか」が曖昧になるため、トラック末尾のみ許可
          if (stack.length > 1 || /[^\s|]/.test(src.slice(pos))) {
            throw err('LOOP_NOT_LAST', {}, fr.open);
          }
          if (time - fr.time < 0.01) throw err('LOOP_EMPTY', {}, fr.open);
          loopStart = fr.time;
          if (fr.tieAt >= 0) {
            // & がループ開始点をまたいでいる（例: c4& [d4 e4]0）。1周目は c→d と繋がった1発音だが、
            // 2周目以降は c4 が無いので、開始点から先の区間（d4）を頭から鳴らす専用の音を足す。
            // loopOnly の音は1周目では鳴らさず、parse() の notes にも出さない
            const ev = evs[fr.tieAt];
            let t = ev.time;
            const tail = ev.segs.filter(sg => { const at = t; t += sg.dur; return at >= loopStart - 1e-6; });
            if (tail.length) {
              const dur = tail.reduce((a, sg) => a + sg.dur, 0);
              evs.push({
                ...ev, time: loopStart, dur, midi: tail[0].midi, freq: tail[0].freq,
                gate: Math.max(dur * ev.q / 8, 0.02), segs: tail, bend: null, loopOnly: true,
              });
            }
          }
          stack.pop();
        } else if (++fr.iter < n) {
          pos = fr.body;   // 次の周へ（状態はそのまま引き継ぐ）
        } else {
          stack.pop();
        }
      } else if (ch === 'm') {
        pos++;
        const [dl, rt, dp] = readNums(3, false, 'm', 'M_ARGS');
        lfo = { delay: dl / 1000, rate: rt, depth: dp };
      } else if (ch === 'p') {
        pos++;
        const n = readInt();
        if (n === null) throw err('P_ARG');
        porta = n / 1000;
      } else if (ch === 'o') {
        pos++;
        const n = readInt();
        if (n === null || n > 8) throw err('O_RANGE', {}, numAt);
        oct = n;
      } else if (ch === '>') {
        if (oct >= 8) throw err('OCT_OVER');
        oct++; pos++;
      } else if (ch === '<') {
        if (oct <= 0) throw err('OCT_UNDER');
        oct--; pos++;
      } else if (ch === 'l') {
        pos++;
        const n = readInt();
        if (n === null || n <= 0) throw err('L_ARG', {}, numAt);
        defLen = n;
      } else if (ch === 't') {
        pos++;
        const n = readInt();
        if (n === null || n <= 0) throw err('T_ARG', {}, numAt);
        tempo = n;
      } else if (ch === 'v') {
        pos++;
        const n = readInt();
        if (n === null || n > 15) throw err('V_RANGE', {}, numAt);
        vol = n;
      } else if (ch === 'q') {
        pos++;
        const n = readInt();
        if (n === null || n < 1 || n > 8) throw err('Q_RANGE', {}, numAt);
        q = n;
      } else if (ch === '@') {
        pos++;
        const sub = pos < src.length ? src[pos].toLowerCase() : '';
        if (sub === 'e') {
          pos++;
          const n = readNums(4, false, '@e', 'E_ARGS');
          if (n[2] > 100) throw err('E_SUSTAIN', {}, numsAt[2]);
          env = { a: n[0], d: n[1], s: n[2], r: n[3] };
        } else if (sub === 'b') {
          pos++;
          const [ct, ms] = readNums(2, true, '@b', 'B_ARGS');
          bend = ct === 0 ? null : { cent: ct, sec: ms / 1000 };
        } else {
          const n = readInt();
          if (n === null || n < 0 || n >= WAVES.length) throw err('WAVE_RANGE', { max: WAVES.length - 1 }, numAt);
          wave = n;
        }
      } else {
        throw err('BAD_CHAR', { char: src[pos] });
      }
    }
    if (stack.length) throw err('UNMATCHED_OPEN', {}, stack[stack.length - 1].open);
    if (tie) throw err('TIE_NO_NEXT', {}, tiePos);
    return { evs, dur: time, tempo, loopStart };
  }

  function _parse(tracks) {
    const parsed = tracks.map((src, ti) => _parseTrack(src, ti));
    const songDur = parsed.reduce((d, p) => Math.max(d, p.dur), 0);
    // 無限ループ [ ]0 のトラックは、より長いトラックに合わせて本体を曲末まで敷き詰める。
    // 曲全体のループ開始点は最も遅いマーカー位置（イントロが最長のトラックに合わせる）。
    // 敷き詰めがループ区間で切れずにつながるよう、本体の長さはループ区間長の約数にしておくこと
    let loopStart = null;
    const all = [];
    parsed.forEach(p => {
      if (p.loopStart !== null) {
        loopStart = Math.max(loopStart ?? 0, p.loopStart);
        const bodyLen = p.dur - p.loopStart;
        const body = p.evs.filter(e => e.time >= p.loopStart - 1e-6);
        let guard = 0;
        for (let off = bodyLen; p.loopStart + off < songDur - 1e-6 && ++guard <= 10000; off += bodyLen) {
          body.forEach(e => {
            // 敷き詰めた複製は1周目から鳴らす（loopOnly は「曲頭からの1周目だけ鳴らさない」の意味なので外す）
            if (e.time + off < songDur - 1e-6) p.evs.push({ ...e, time: e.time + off, loopOnly: false });
          });
        }
      }
      all.push(...p.evs);
    });
    all.sort((x, y) => x.time - y.time);
    return { events: all, duration: songDur, loopStart };
  }

  // ── 再生（lookaheadスケジューラ） ──────────────

  function _scheduleNote(ev, t) {
    const c = _ctx;
    const g = c.createGain();
    g.connect(_trackGains[ev.track] || _sessionGain);

    // ノイズはバンドパスで帯域の大半を捨てるぶん音量が大きく下がる（低音ほど顕著）ので、
    // 通過帯域幅に応じたメイクアップゲインで他の波形と聴感を揃える
    // （& で音程が動く場合も繋いだ先頭の音を基準にする。1発音につき1つの値）
    const noiseComp = (WAVES[ev.wave] === 'noise')
      ? Math.min(8, Math.sqrt(c.sampleRate / (2 * ev.freq))) : 1;
    const vol = ev.vol * noiseComp;

    const gate = ev.gate;
    const a = Math.min(ev.env.a / 1000, gate * 0.5);
    const d = Math.min(ev.env.d / 1000, Math.max(gate - a, 0));
    const sus = Math.max(vol * (ev.env.s / 100), 0.0001);
    const r = Math.max(ev.env.r / 1000, 0.005);
    const tGateEnd = t + gate;

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    if (d > 0) g.gain.linearRampToValueAtTime(sus, t + a + d);
    g.gain.setValueAtTime(d > 0 ? sus : vol, tGateEnd);
    g.gain.exponentialRampToValueAtTime(0.0001, tGateEnd + r);

    const tEnd = tGateEnd + r + 0.05;

    // 音程を動かす先（ノイズはバンドパスの中心周波数）。detune はセント単位なので
    // ベンドとLFOはここで自然に加算される
    let src, pitch, detune;
    if (WAVES[ev.wave] === 'noise') {
      src = c.createBufferSource();
      src.buffer = _getNoiseBuf(c);
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      src.connect(filter);
      filter.connect(g);
      pitch = filter.frequency;
      detune = filter.detune;
    } else {
      src = c.createOscillator();
      src.type = WAVES[ev.wave];
      src.connect(g);
      pitch = src.frequency;
      detune = src.detune;
    }

    // & で繋いだ区間ごとに音程を差し替える。p 指定時は繋ぎ目を滑らせる
    // （周波数を指数カーブで動かす = 音程としては等速に聞こえる）
    pitch.setValueAtTime(ev.segs[0].freq, t);
    let ts = t;
    for (let i = 1; i < ev.segs.length; i++) {
      ts += ev.segs[i - 1].dur;
      const glide = Math.min(ev.porta, ev.segs[i].dur);
      if (glide > 0.001) {
        pitch.setValueAtTime(ev.segs[i - 1].freq, ts);
        pitch.exponentialRampToValueAtTime(ev.segs[i].freq, ts + glide);
      } else {
        pitch.setValueAtTime(ev.segs[i].freq, ts);
      }
    }

    // ベンド: 出だしをずらして正規の音程へ寄せる（音より長い指定はゲート長で頭打ち）
    if (ev.bend) {
      detune.setValueAtTime(ev.bend.cent, t);
      const bs = Math.min(ev.bend.sec, gate);
      if (bs > 0) detune.linearRampToValueAtTime(0, t + bs);
      else detune.setValueAtTime(0, t);
    }

    // LFO（ビブラート）: 遅れてから効き始める。立ち上がりを少しなだらかにして唐突さを消す
    if (ev.lfo.rate > 0 && ev.lfo.depth > 0) {
      const lo = c.createOscillator();
      lo.type = 'sine';
      lo.frequency.value = ev.lfo.rate;
      const lg = c.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.setValueAtTime(0, t + ev.lfo.delay);
      lg.gain.linearRampToValueAtTime(ev.lfo.depth, t + ev.lfo.delay + LFO_FADE);
      lo.connect(lg);
      lg.connect(detune);
      lo.start(t);
      lo.stop(tEnd);
    }

    src.start(t);
    src.stop(tEnd);
  }

  function _tick() {
    const horizon = _ctx.currentTime + LOOKAHEAD_SEC;
    let guard = 0;
    while (guard++ < 1000) {
      if (_ptr >= _events.length) {
        // 2周目以降はループ開始点（無限ループ未使用時は曲頭）から曲末までを繰り返す
        if (_loop && _songDur - _loopStart > 0.01 && _loopPtr < _events.length) {
          _loopOff += _songDur - _loopStart;
          _ptr = _loopPtr;
        } else break;
      }
      const ev = _events[_ptr];
      if (ev.loopOnly && _loopOff === 0) { _ptr++; continue; }   // 2周目以降専用（& がループ開始点をまたぐ音）
      const t = _startTime + _loopOff + ev.time;
      if (t > horizon) break;
      _scheduleNote(ev, t);
      _ptr++;
    }
    // ループ再生OFF: 全音をスケジュールし終え、最後の音のリリースも終わったら止める
    if (!_loop && _ptr >= _events.length && _ctx.currentTime > _stopAt) stop();
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_sessionGain) {
      // いきなり切断するとクリックノイズが出るので、短くフェードしてから切り離す
      const g = _sessionGain, t = _ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + STOP_FADE);
      setTimeout(() => g.disconnect(), STOP_FADE * 1000 + 50);
      _sessionGain = null;
    }
    _trackGains = [];
    _events = [];
  }

  // tracks: MML文字列 or その配列。opts: { loop: true }
  // 戻り値: { duration, loopStart } （1周目の秒数と、無限ループ [ ]0 の開始秒。未使用時 null。
  //          2周目以降の1ループは duration - loopStart 秒）。パース失敗時は Error を投げる
  function play(tracks, opts = {}) {
    if (typeof tracks === 'string') tracks = [tracks];
    const { events, duration, loopStart } = _parse(tracks);  // 先にパース（失敗時は現行再生を守る）
    if (duration <= 0) throw new MMLError('NO_NOTES');
    stop();
    const c = _getCtx();
    _sessionGain = c.createGain();
    _sessionGain.gain.value = 0.6;   // 同時発音ヘッドルーム
    _sessionGain.connect(_masterGain);
    _trackGains = tracks.map(() => {
      const g = c.createGain();
      g.connect(_sessionGain);
      return g;
    });
    _events = events;
    _songDur = duration;
    _loopStart = loopStart || 0;
    _loopPtr = _loopStart > 0 ? _events.findIndex(e => e.time >= _loopStart - 1e-6) : 0;
    if (_loopPtr < 0) _loopPtr = _events.length;   // ループ区間にイベントがない（実質無音）
    _loop = opts.loop !== false;
    _ptr = 0;
    _loopOff = 0;
    _startTime = c.currentTime + 0.05;
    // ループ再生OFFのとき止める時刻: 曲の尺と、最後まで鳴っている音のリリース終了のうち遅いほう
    _stopAt = _startTime + events.reduce((m, e) => Math.max(m, e.time + e.gate + e.env.r / 1000), duration) + 0.1;
    _tick();
    _timer = setInterval(_tick, TICK_MS);
    return { duration, loopStart };
  }

  function setVolume(v) {
    _volume = Math.max(0, Math.min(1, v));
    if (_masterGain) _masterGain.gain.value = _volume;
  }

  // 再生中のトラックを即時ミュート/解除する（i は play() に渡した配列のインデックス）
  function setTrackMute(i, muted) {
    const g = _trackGains[i];
    if (!g || !_ctx) return;
    const t = _ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(muted ? 0 : 1, t, 0.01);   // 10msで滑らかに（クリックノイズ回避）
  }

  // 単一トラックをパースして音符列を返す（作曲支援ツール用。再生はしない）
  // track は省略可。エラー文言の「トラックN」に使う0始まりの番号（複数トラックを1本ずつ調べるとき用）
  // 戻り値: { notes: [{time,dur,midi}], duration, tempo, loopStart }
  //         （loopStart は無限ループ [ ]0 の開始秒。未使用時 null。本体の敷き詰めはしない）
  function parse(src, track = 0) {
    const { evs, dur, tempo, loopStart } = _parseTrack(String(src), track | 0);
    return {
      notes: evs.filter(e => !e.loopOnly).map(e => ({ time: e.time, dur: e.dur, midi: e.midi })),
      duration: dur,
      tempo,
      loopStart,
    };
  }

  return {
    MMLError,   // 利用側が instanceof で判別できるように公開する
    play,
    stop,
    setVolume,
    setTrackMute,
    parse,
    get volume() { return _volume; },
    get playing() { return _timer !== null; },
  };
})();
