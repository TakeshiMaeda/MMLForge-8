// MMLForge-8 / MMLPlayer — MML(Music Macro Language) パーサ + Web Audio シーケンサ（外部依存なし）
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
//   > / <           オクターブ +1 / -1
//   l<n>            デフォルト音長 (初期値4)
//   t<n>            テンポ BPM (初期値120)
//   v<n>            音量 0-15 (初期値10)
//   q<n>            ゲートタイム 1-8 (8=音長いっぱい。初期値8)
//   @<n>            音色 0=sine 1=square 2=triangle 3=sawtooth 4=noise (初期値1)
//   @e<a>,<d>,<s>,<r> エンベロープ: attack(ms), decay(ms), sustain(%), release(ms)
//                     初期値 @e3,0,100,40
//   [ ... ]<n>      リピート n回（ネスト可）
//   [ ... ]0        n を省略するか 0 で無限ループ: 2周目以降ここから繰り返す（曲のループ開始点）。
//                   トラック末尾にのみ書ける。ループ再生OFF時は1回だけ演奏。
//                   複数トラックに書いた場合は最も遅い開始点を曲のループ開始点に採用
//   |               小節区切り（無視される。見た目整理用）
//   スペース・改行   無視
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
  let _noiseBuf  = null;
  let _volume    = 0.8;

  const NOTE_INDEX = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const WAVES = ['sine', 'square', 'triangle', 'sawtooth', 'noise'];
  const LOOKAHEAD_SEC = 0.15;
  const TICK_MS = 50;

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

  const LOOP_MARK = '\x01';   // 無限ループ開始点の内部マーカー（リピート展開後のテキストに埋める）

  // [ ... ]n を展開（ネストは内側から）。n省略・0 は無限ループ = ループ開始点マーカーに置換
  function _expandRepeats(src, ti) {
    let guard = 0;
    while (/[\[\]]/.test(src)) {
      const m = src.match(/\[([^\[\]]*)\](\d*)/);
      if (!m) throw new Error(`トラック${ti + 1}: [ ] の対応が取れません`);
      const count = m[2] ? parseInt(m[2], 10) : 0;
      if (count === 0) {
        // 後続に音符等があると「どこまでがループか」が曖昧になるため、トラック末尾のみ許可
        if (/[^\s|]/.test(src.slice(m.index + m[0].length))) {
          throw new Error(`トラック${ti + 1}: 無限ループ（数字なし・0 の [ ]）はトラックの末尾にのみ書けます（リピートの中も不可）`);
        }
        src = src.slice(0, m.index) + LOOP_MARK + m[1];
      } else {
        src = src.slice(0, m.index) + m[1].repeat(count) + src.slice(m.index + m[0].length);
      }
      if (++guard > 200) throw new Error(`トラック${ti + 1}: リピート展開が深すぎます`);
    }
    return src;
  }

  function _parseTrack(src, ti) {
    src = _expandRepeats(src, ti);
    let pos = 0;
    let oct = 4, defLen = 4, tempo = 120, vol = 10, wave = 1, q = 8;
    let env = { a: 3, d: 0, s: 100, r: 40 };
    let time = 0;
    let loopStart = null;   // 無限ループ開始点（秒）
    const evs = [];

    const err = (msg) => new Error(`トラック${ti + 1} 位置${pos + 1}: ${msg}`);
    const readInt = () => {
      let s = '';
      while (pos < src.length && /\d/.test(src[pos])) s += src[pos++];
      return s === '' ? null : parseInt(s, 10);
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
      if (base <= 0) throw err('音長は1以上で指定してください');
      let beats = 4 / base;
      let add = beats;
      const dots = readDots();
      for (let i = 0; i < dots; i++) { add /= 2; beats += add; }
      return beats;
    };

    while (pos < src.length) {
      const ch = src[pos].toLowerCase();
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '|') { pos++; continue; }
      if (ch === LOOP_MARK) { loopStart = time; pos++; continue; }

      if (NOTE_INDEX[ch] !== undefined) {
        pos++;
        let idx = NOTE_INDEX[ch];
        while (pos < src.length && (src[pos] === '#' || src[pos] === '+' || src[pos] === '-')) {
          idx += (src[pos] === '-') ? -1 : 1;
          pos++;
        }
        const beats = readDuration();
        const dur = beats * (60 / tempo);
        const midi = 12 * (oct + 1) + idx;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        evs.push({
          time, dur, midi, track: ti,
          gate: Math.max(dur * q / 8, 0.02),
          freq, wave,
          vol: Math.max((vol / 15) * 0.3, 0.0005),
          env: { ...env },
        });
        time += dur;
      } else if (ch === 'r') {
        pos++;
        time += readDuration() * (60 / tempo);
      } else if (ch === 'o') {
        pos++;
        const n = readInt();
        if (n === null) throw err('o の後にオクターブ数が必要です');
        oct = n;
      } else if (ch === '>') { oct++; pos++; }
      else if (ch === '<')   { oct--; pos++; }
      else if (ch === 'l') {
        pos++;
        const n = readInt();
        if (n === null || n <= 0) throw err('l の後に音長が必要です');
        defLen = n;
      } else if (ch === 't') {
        pos++;
        const n = readInt();
        if (n === null || n <= 0) throw err('t の後にテンポが必要です');
        tempo = n;
      } else if (ch === 'v') {
        pos++;
        const n = readInt();
        if (n === null) throw err('v の後に音量(0-15)が必要です');
        vol = Math.max(0, Math.min(15, n));
      } else if (ch === 'q') {
        pos++;
        const n = readInt();
        if (n === null) throw err('q の後にゲート(1-8)が必要です');
        q = Math.max(1, Math.min(8, n));
      } else if (ch === '@') {
        pos++;
        if (pos < src.length && src[pos].toLowerCase() === 'e') {
          pos++;
          const nums = [];
          for (let i = 0; i < 4; i++) {
            while (pos < src.length && src[pos] === ' ') pos++;
            const n = readInt();
            if (n === null) throw err('@e は attack,decay,sustain,release の4値が必要です');
            nums.push(n);
            if (i < 3) {
              while (pos < src.length && src[pos] === ' ') pos++;
              if (src[pos] !== ',') throw err('@e の値はカンマ区切りで指定してください');
              pos++;
            }
          }
          env = { a: nums[0], d: nums[1], s: Math.max(0, Math.min(100, nums[2])), r: nums[3] };
        } else {
          const n = readInt();
          if (n === null || n < 0 || n >= WAVES.length) throw err(`@ の後に音色番号(0-${WAVES.length - 1})が必要です`);
          wave = n;
        }
      } else {
        throw err(`解釈できない文字です: "${src[pos]}"`);
      }
    }
    if (loopStart !== null && time - loopStart < 0.01) {
      throw new Error(`トラック${ti + 1}: 無限ループの中身には音符か休符が必要です`);
    }
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
            if (e.time + off < songDur - 1e-6) p.evs.push({ ...e, time: e.time + off });
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

    let src;
    if (WAVES[ev.wave] === 'noise') {
      src = c.createBufferSource();
      src.buffer = _getNoiseBuf(c);
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = ev.freq;
      filter.Q.value = 1.2;
      src.connect(filter);
      filter.connect(g);
    } else {
      src = c.createOscillator();
      src.type = WAVES[ev.wave];
      src.frequency.value = ev.freq;
      src.connect(g);
    }
    src.start(t);
    src.stop(tGateEnd + r + 0.05);
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
      const t = _startTime + _loopOff + ev.time;
      if (t > horizon) break;
      _scheduleNote(ev, t);
      _ptr++;
    }
    if (!_loop && _ptr >= _events.length) {
      // 最後のノートのリリースが終わる頃に自動停止
      const last = _events[_events.length - 1];
      const endT = last ? _startTime + _loopOff + last.time + last.dur + 1 : 0;
      if (_ctx.currentTime > endT) stop();
    }
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_sessionGain) { _sessionGain.disconnect(); _sessionGain = null; }
    _trackGains = [];
    _events = [];
  }

  // tracks: MML文字列 or その配列。opts: { loop: true }
  // 戻り値: { duration, loopStart } （1周目の秒数と、無限ループ [ ]0 の開始秒。未使用時 null。
  //          2周目以降の1ループは duration - loopStart 秒）。パース失敗時は Error を投げる
  function play(tracks, opts = {}) {
    if (typeof tracks === 'string') tracks = [tracks];
    const { events, duration, loopStart } = _parse(tracks);  // 先にパース（失敗時は現行再生を守る）
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
  // 戻り値: { notes: [{time,dur,midi}], duration, tempo, loopStart }
  //         （loopStart は無限ループ [ ]0 の開始秒。未使用時 null。本体の敷き詰めはしない）
  function parse(src) {
    const { evs, dur, tempo, loopStart } = _parseTrack(String(src), 0);
    return {
      notes: evs.map(e => ({ time: e.time, dur: e.dur, midi: e.midi })),
      duration: dur,
      tempo,
      loopStart,
    };
  }

  return {
    play,
    stop,
    setVolume,
    setTrackMute,
    parse,
    get volume() { return _volume; },
    get playing() { return _timer !== null; },
  };
})();
