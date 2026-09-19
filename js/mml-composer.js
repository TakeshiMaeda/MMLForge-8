// MMLForge-8 / MMLComposer — 定石ベースの自動作曲器（harmonize / extendMelody は MMLPlayer.parse を使用。
// 雰囲気名・生成コメント・警告の文言は js/i18n.js の T() で表示言語に合わせる）
// アルゴリズム:
//   1. 雰囲気プリセット(MOODS)がスケール・テンポ帯・コード進行プール・音色/エンベロープの初期値を決める
//      （scale / tempo / density / drums / drumStyle / harm は opts で個別に上書き可能）
//   2. コード進行を選び、小節数ぶん繰り返す
//   3. ベース = ルート音パターン、アルペジオ = コード構成音の分散、(harm指定の雰囲気のみ)ハーモニー = 5度ロングトーン
//   4. メロディ = 強拍はコードトーン(直前音に近いものを選ぶ=声部連結)、弱拍はスケール隣接音。最終小節は主音終止
//   5. 同一シード+設定なら同じ曲を再現できる
const MMLComposer = (() => {
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
  const randInt = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10] };
  const KEY_PCS = { minor: [9, 4, 2, 0, 7], major: [0, 7, 5, 2, 9], dorian: [2, 9, 4, 7] };
  const LEN_BEATS = { '1': 4, '2.': 3, '2': 2, '4.': 1.5, '4': 1, '8.': 0.75, '8': 0.5, '16': 0.25 };

  // メロディのリズム型（1小節=4拍に収まるものだけ。密度0=静か 1=中 2=激しい）
  const RHYTHMS = [
    [['2', '4', '4'], ['4', '4', '2'], ['2', '2'], ['4', '2', '4'], ['1'], ['2.', '4']],
    [['4', '8', '8', '4', '4'], ['4', '4', '8', '8', '4'], ['8', '8', '4', '2'], ['4', '4', '4', '4'], ['4.', '8', '4', '4']],
    [['8', '8', '8', '8', '4', '4'], ['8', '8', '8', '8', '8', '8', '4'], ['8', '4', '8', '4', '4'],
     ['4', '8', '8', '8', '8', '4'], ['8', '8', '4', '8', '8', '4']],
  ];

  const MOODS = {
    calm: {
      label: T('mood.calm'), scale: 'minor', tempo: [78, 100],
      progs: [[1, 7, 6, 5], [1, 6, 3, 7], [1, 4, 6, 5], [1, 6, 4, 5], [1, 3, 6, 5]],
      density: 0, drums: false, harm: false,
      mel:  { wave: 2, oct: 4, vol: 10, q: 7, env: '@e8,120,55,250' },
      bass: { wave: 1, oct: 3, vol: 7,  q: 8, env: '@e5,60,70,180', style: 'half' },
      arp:  { wave: 0, oct: 5, vol: 5,  q: 8, env: '@e5,0,100,100' },
    },
    mystic: {
      label: T('mood.mystic'), scale: 'dorian', tempo: [104, 126],
      progs: [[1, 4, 1, 5], [1, 7, 4, 1], [1, 4, 7, 1], [1, 2, 4, 5]],
      density: 1, drums: false, harm: false,
      mel:  { wave: 1, oct: 4, vol: 10, q: 7, env: '@e5,60,65,120' },
      bass: { wave: 2, oct: 3, vol: 8,  q: 8, env: '@e5,40,80,100', style: 'roots4' },
      arp:  { wave: 0, oct: 5, vol: 5,  q: 8, env: '@e5,0,100,80' },
    },
    intense: {
      label: T('mood.intense'), scale: 'minor', tempo: [138, 168],
      progs: [[1, 1, 6, 7], [1, 7, 6, 7], [1, 6, 7, 1], [1, 4, 5, 7]],
      density: 2, drums: true, harm: false,
      mel:  { wave: 1, oct: 5, vol: 10, q: 7, env: '@e3,40,70,60' },
      bass: { wave: 3, oct: 2, vol: 8,  q: 7, env: '@e3,30,80,60', style: 'pump8' },
      arp:  { wave: 2, oct: 4, vol: 6,  q: 8, env: '@e3,0,100,50' },
    },
    dark: {
      label: T('mood.dark'), scale: 'minor', tempo: [150, 176],
      progs: [[1, 2, 1, 7], [1, 6, 2, 7], [1, 7, 1, 2], [1, 4, 2, 7]],
      density: 2, drums: true, harm: true,
      mel:  { wave: 1, oct: 5, vol: 10, q: 7, env: '@e3,30,75,50' },
      bass: { wave: 3, oct: 2, vol: 9,  q: 7, env: '@e3,20,85,50', style: 'pump8' },
      arp:  { wave: 2, oct: 4, vol: 6,  q: 8, env: '@e3,0,100,40' },
      harmT: { wave: 0, oct: 5, vol: 4, q: 8, env: '@e20,200,60,400' },
    },
    bright: {
      label: T('mood.bright'), scale: 'major', tempo: [116, 140],
      progs: [[1, 5, 6, 4], [1, 4, 5, 1], [1, 6, 4, 5], [1, 4, 1, 5]],
      density: 1, drums: false, harm: false,
      mel:  { wave: 1, oct: 5, vol: 10, q: 7, env: '@e4,60,65,100' },
      bass: { wave: 2, oct: 3, vol: 8,  q: 8, env: '@e5,40,80,120', style: 'roots4' },
      arp:  { wave: 0, oct: 5, vol: 5,  q: 8, env: '@e5,0,100,80' },
    },
  };

  // キー指定（'c' 'f#' 'b-' などの音名 or ピッチクラス0-11）→ ピッチクラス。不正は null
  function parseKey(k) {
    if (typeof k === 'number') return (k >= 0 && k <= 11) ? Math.floor(k) : null;
    if (typeof k !== 'string') return null;
    const m = k.trim().toLowerCase().match(/^([a-g])([#+-]?)$/);
    if (!m) return null;
    const BASE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
    const pc = BASE[m[1]] + (m[2] === '-' ? -1 : (m[2] ? 1 : 0));
    return ((pc % 12) + 12) % 12;
  }

  // harm を後付けで有効にした雰囲気に harmT（ハーモニー音色）が無いときの既定値
  const HARM_T_DEFAULT = { wave: 0, oct: 5, vol: 4, q: 8, env: '@e20,200,60,400' };

  // 雰囲気プリセットに opts の個別指定を上書きした実効パラメータを作る
  function resolveMood(opts) {
    const m = { ...(MOODS[opts.mood] || MOODS.calm) };
    if (SCALES[opts.scale]) m.scale = opts.scale;
    if (opts.density !== undefined) m.density = Math.max(0, Math.min(2, +opts.density || 0));
    if (typeof opts.harm === 'boolean') m.harm = opts.harm;
    if (m.harm && !m.harmT) m.harmT = HARM_T_DEFAULT;
    return m;
  }

  // ── 音高ヘルパー（semi = 絶対半音。octave = floor(semi/12) が MML の o と一致） ──

  function chordPcs(keyPc, scale, degree) {
    const pc = (d) => (keyPc + scale[(d - 1) % 7]) % 12;
    return [pc(degree), pc(degree + 2), pc(degree + 4)];
  }

  // 範囲内で prev に最も近い、指定ピッチクラスの半音を返す
  function nearestOfPcs(pcs, prev, lo, hi) {
    let best = null, bestDist = 1e9;
    for (let s = lo; s <= hi; s++) {
      if (!pcs.includes(s % 12)) continue;
      const d = Math.abs(s - prev);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    return best ?? prev;
  }

  // スケール上で prev から step 段となり合わせに動く
  function scaleStep(keyPc, scale, prev, step, lo, hi) {
    const pcs = scale.map(iv => (keyPc + iv) % 12);
    const line = [];
    for (let s = lo - 12; s <= hi + 12; s++) if (pcs.includes(s % 12)) line.push(s);
    let idx = 0, bd = 1e9;
    line.forEach((s, i) => { const d = Math.abs(s - prev); if (d < bd) { bd = d; idx = i; } });
    const next = line[Math.max(0, Math.min(line.length - 1, idx + step))];
    return Math.max(lo, Math.min(hi, next));
  }

  // {semi,len} / {rest,len} の列を o付きMMLトークンに（オクターブ変化時のみ o を出す）
  function notesToTokens(seq) {
    const out = [];
    let curOct = null;
    for (const n of seq) {
      if (n.rest) { out.push('r' + n.len); continue; }
      const oct = Math.floor(n.semi / 12);
      if (oct !== curOct) { out.push('o' + oct); curOct = oct; }
      out.push(NOTE_NAMES[n.semi % 12] + n.len);
    }
    return out;
  }

  const joinBars = (bars) => bars.map(b => b.join(' ')).join(' | ');
  const prefix = (tempo, tr) => `t${tempo} @${tr.wave} v${tr.vol} q${tr.q} ${tr.env}`;

  // ── 各トラック生成 ──

  // 1小節ぶんのメロディを生成（強拍=コードトーン(声部連結)、弱拍=スケール順次進行、まれに休符）
  // genMelody と extendMelody で共用。rand の消費順を変えるとシード互換が壊れるので注意
  function genMelodyBar(rand, keyPc, scale, chord, density, prev, lo, hi) {
    const seq = [];
    const rhythm = pick(rand, RHYTHMS[density]);
    let beatPos = 0;
    rhythm.forEach((len, i) => {
      if (i > 0 && rand() < 0.07) {
        seq.push({ rest: true, len });
      } else if (i === 0 || (Number.isInteger(beatPos) && rand() < 0.6)) {
        // 強拍: コードトーン（直前音の近くを選ぶ）
        const s = nearestOfPcs(chord, prev + (rand() < 0.3 ? (rand() < 0.5 ? 3 : -3) : 0), lo, hi);
        seq.push({ semi: s, len });
        prev = s;
      } else {
        // 弱拍: スケール上のとなり合わせ
        const dir = rand() < 0.5 ? 1 : -1;
        const s = scaleStep(keyPc, scale, prev, dir, lo, hi);
        seq.push({ semi: s, len });
        prev = s;
      }
      beatPos += LEN_BEATS[len];
    });
    return { seq, prev };
  }

  // 終止小節: 5度→主音 または 主音ロングトーン（ループの頭や曲の締めで主音に着地する）
  // genMelody の最終小節と extendMelody の「締め」で共用。rand を1回消費する
  function genCadenceBar(rand, keyPc, prev, lo, hi) {
    const seq = [];
    const tonicPcs = [keyPc % 12];
    if (rand() < 0.5) {
      seq.push({ semi: nearestOfPcs([(keyPc + 7) % 12], prev, lo, hi), len: '2' });
      seq.push({ semi: nearestOfPcs(tonicPcs, prev, lo, hi), len: '2' });
    } else {
      seq.push({ semi: nearestOfPcs(tonicPcs, prev, lo, hi), len: '1' });
    }
    return { seq, prev: seq[seq.length - 1].semi };
  }

  function genMelody(rand, mood, keyPc, prog, bars, tempo) {
    const scale = SCALES[mood.scale];
    const cfg = mood.mel;
    const lo = 12 * cfg.oct + keyPc;
    const hi = lo + 19;   // 1オクターブ+5度のレンジ
    let prev = lo + 12;
    const outBars = [];
    for (let b = 0; b < bars; b++) {
      const chord = chordPcs(keyPc, scale, prog[b % prog.length]);
      const r = (b === bars - 1)
        ? genCadenceBar(rand, keyPc, prev, lo, hi)
        : genMelodyBar(rand, keyPc, scale, chord, mood.density, prev, lo, hi);
      prev = r.prev;
      outBars.push(r.seq);
    }
    return prefix(tempo, cfg) + ' ' + joinBars(outBars.map(notesToTokens));
  }

  function genBass(rand, mood, keyPc, prog, bars, tempo) {
    const scale = SCALES[mood.scale];
    const cfg = mood.bass;
    const outBars = [];
    for (let b = 0; b < bars; b++) {
      const deg = prog[b % prog.length];
      const rootPc = (keyPc + scale[(deg - 1) % 7]) % 12;
      const root = 12 * cfg.oct + rootPc;
      const fifth = root + 7;
      const seq = [];
      if (cfg.style === 'half') {
        seq.push({ semi: root, len: '2' });
        seq.push({ semi: rand() < 0.3 ? fifth : root, len: '2' });
      } else if (cfg.style === 'roots4') {
        for (let i = 0; i < 4; i++) {
          const s = (i === 3 && rand() < 0.4) ? fifth : root;
          seq.push({ semi: s, len: '4' });
        }
      } else { // pump8
        for (let i = 0; i < 8; i++) {
          const s = ((i === 3 || i === 7) && rand() < 0.5) ? root + 12 : root;
          seq.push({ semi: s, len: '8' });
        }
      }
      outBars.push(seq);
    }
    return prefix(tempo, cfg) + ' ' + joinBars(outBars.map(notesToTokens));
  }

  function genArp(rand, mood, keyPc, prog, bars, tempo) {
    const scale = SCALES[mood.scale];
    const cfg = mood.arp;
    const order = pick(rand, [[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 0]]);
    const outBars = [];
    for (let b = 0; b < bars; b++) {
      const pcs = chordPcs(keyPc, scale, prog[b % prog.length]);
      const root = 12 * cfg.oct + pcs[0];
      const tone = (i) => { let s = 12 * cfg.oct + pcs[i]; if (s < root) s += 12; return s; };
      const seq = [];
      for (let i = 0; i < 8; i++) seq.push({ semi: tone(order[i % 4]), len: '8' });
      outBars.push(seq);
    }
    return prefix(tempo, cfg) + ' ' + joinBars(outBars.map(notesToTokens));
  }

  function genHarmony(mood, keyPc, prog, bars, tempo) {
    const scale = SCALES[mood.scale];
    const cfg = mood.harmT;
    const outBars = [];
    for (let b = 0; b < bars; b++) {
      const pcs = chordPcs(keyPc, scale, prog[b % prog.length]);
      outBars.push([{ semi: 12 * cfg.oct + pcs[2], len: '1' }]);   // 5度ロングトーン
    }
    return prefix(tempo, cfg) + ' ' + joinBars(outBars.map(notesToTokens));
  }

  function genDrums(rand, bars, tempo, style) {
    // ノイズch: K=低域(キック) S=中域(スネア) h=高域(ハット) .=休符（8分×8スロット/小節）
    // 打楽器はサステイン0の急減衰エンベロープを打点種別ごとに切り替えて歯切れを出す
    const SETS = {
      hard: {
        vol: 9,
        patterns: ['KhSh KhSh', 'KhSh KKSh', 'KhSh KhSS', 'KKSh KhSh'],
        fill: 'KhSh SSSS',
      },
      soft: {
        vol: 6,
        patterns: ['K.h. S.h.', 'K.h. S.hh', 'K.h. h.h.', 'K..h S.h.'],
        fill: 'K.h. S.hh',
      },
    };
    const set = SETS[style] || SETS.hard;
    const HIT = {
      K: { tok: 'o3c8', env: '@e1,90,0,50' },    // キック: 130Hz付近を短く太く
      S: { tok: 'o5c8', env: '@e1,120,0,60' },   // スネア: 中域をやや長めに減衰
      h: { tok: 'o7c8', env: '@e1,30,0,25' },    // ハット: 高域を極短で
    };
    const outBars = [];
    const pat = pick(rand, set.patterns);
    let curEnv = null;
    for (let b = 0; b < bars; b++) {
      const p = (b % 4 === 3) ? set.fill : (rand() < 0.2 ? pick(rand, set.patterns) : pat);
      const bar = [];
      for (const ch of p.replace(/ /g, '')) {
        if (ch === '.') { bar.push('r8'); continue; }
        const hit = HIT[ch];
        if (hit.env !== curEnv) { bar.push(hit.env); curEnv = hit.env; }
        bar.push(hit.tok);
      }
      outBars.push(bar);
    }
    return `t${tempo} @4 v${set.vol} q8 ` + joinBars(outBars);
  }

  // ── 公開API ──

  // opts: { mood: 'calm'|'mystic'|'intense'|'dark'|'bright', bars: 4|8|16, seed: number,
  //         --- 以下は雰囲気プリセットの個別上書き（省略時 undefined = プリセットに従う） ---
  //         scale: 'major'|'minor'|'dorian', tempo: BPM直接指定, key: 'c'〜'b'(主音の音名),
  //         density: 0-2(メロディの激しさ),
  //         drums: true|false, drumStyle: 'hard'|'soft', harm: true|false(ハーモニートラック) }
  // 戻り値: { tracks: string[], comment: string }
  function generate(opts = {}) {
    const m = resolveMood(opts);
    const bars = opts.bars || 8;
    const seed = (opts.seed ?? 1) >>> 0;
    const rand = mulberry32(seed === 0 ? 1 : seed);

    // テンポ・キーの乱数は明示指定時も消費する
    // （同じシードで「テンポだけ違う同じ曲」「キーだけ違う=移調しただけの同じ曲」を作れるように）
    const autoTempo = randInt(rand, m.tempo[0], m.tempo[1]);
    const tempo = (+opts.tempo > 0) ? Math.round(+opts.tempo) : autoTempo;
    const autoKey = pick(rand, KEY_PCS[m.scale]);
    const keyPc = parseKey(opts.key) ?? autoKey;
    const prog = pick(rand, m.progs);

    const tracks = [
      genMelody(rand, m, keyPc, prog, bars, tempo),
      genBass(rand, m, keyPc, prog, bars, tempo),
      genArp(rand, m, keyPc, prog, bars, tempo),
    ];
    if (m.harm) tracks.push(genHarmony(m, keyPc, prog, bars, tempo));
    const useDrums = opts.drums === undefined ? m.drums : opts.drums;
    const drumStyle = (opts.drumStyle === 'hard' || opts.drumStyle === 'soft')
      ? opts.drumStyle : (m.drums ? 'hard' : 'soft');
    if (useDrums) tracks.push(genDrums(rand, bars, tempo, drumStyle));

    const keyName = NOTE_NAMES[keyPc].toUpperCase() + (m.scale === 'major' ? '' : 'm');
    const progName = prog.join('-');
    const comment = T('gen.comment', {
      mood: m.label, key: keyName, scale: m.scale, tempo, prog: progName, bars, seed,
      harm: m.harm, drums: useDrums, drumStyle,
    });
    return { tracks, comment };
  }

  // ── メロディ伴奏付け（harmonize） ──────────────
  //   1. メロディをパース（MMLPlayer.parse に依存）
  //   2. キー/スケール推定: 音価重み付きでスケール適合度を採点（開始音・終止音の主音ボーナス付き）
  //   3. 小節ごとのコード推定: 小節内の音の滞在時間でダイアトニック7和音を採点
  //   4. 推定した進行を使い、既存の伴奏生成器（ベース/アルペジオ/ハーモニー/ドラム）を流す

  function detectKey(notes) {
    const CAND = { minor: SCALES.minor, major: SCALES.major };
    let best = { score: -Infinity, keyPc: 9, scale: 'minor' };
    for (const [sname, iv] of Object.entries(CAND)) {
      for (let pc = 0; pc < 12; pc++) {
        const pcs = iv.map(x => (pc + x) % 12);
        let sc = 0;
        notes.forEach(n => { sc += pcs.includes(n.midi % 12) ? n.dur : -n.dur * 0.5; });
        const first = notes[0], last = notes[notes.length - 1];
        if (first && first.midi % 12 === pc) sc += first.dur * 2;
        if (last && last.midi % 12 === pc)  sc += last.dur * 3;
        if (sc > best.score) best = { score: sc, keyPc: pc, scale: sname };
      }
    }
    return best;
  }

  function detectChords(notes, keyPc, scaleName, nBars, barSec) {
    const scale = SCALES[scaleName];
    const degs = [];
    let prev = 1;
    for (let b = 0; b < nBars; b++) {
      const t0 = b * barSec, t1 = t0 + barSec;
      const w = {};   // 小節内のピッチクラス滞在時間
      notes.forEach(n => {
        const ov = Math.min(t1, n.time + n.dur) - Math.max(t0, n.time);
        if (ov > 0) { const pc = n.midi % 12; w[pc] = (w[pc] || 0) + ov; }
      });
      let bestD = prev, bestS = -Infinity;
      for (let d = 1; d <= 7; d++) {
        const pcs = chordPcs(keyPc, scale, d);
        let s = 0;
        Object.entries(w).forEach(([pc, wt]) => {
          pc = +pc;
          if (pcs[0] === pc) s += wt * 1.3;        // ルート一致は加点
          else if (pcs.includes(pc)) s += wt;
          else s -= wt * 0.3;
        });
        if (d === prev) s += 0.1;                  // 進行の粘り（無闇に変えない）
        if (b === 0 && d === 1) s += 0.5;          // 頭は主和音を優遇
        if (b === nBars - 1 && (d === 1 || d === 5)) s += 0.5;  // 終止は I / V を優遇
        if (s > bestS) { bestS = s; bestD = d; }
      }
      degs.push(bestD);
      prev = bestD;
    }
    return degs;
  }

  // melodyMML: メロディ1トラックのMML文字列
  // opts: { mood, seed, drums, drumStyle, harm }（generateと同じ意味。moodは伴奏の音色・スタイルに使う。
  //        scale/tempo はメロディからの推定値を使うため上書き不可）
  // 戻り値: { tracks: string[](伴奏のみ), comment, warning|null }
  function harmonize(melodyMML, opts = {}) {
    if (typeof MMLPlayer === 'undefined' || !MMLPlayer.parse) {
      throw new Error(T('comp.noPlayer'));
    }
    const seed = (opts.seed ?? 1) >>> 0;
    const rand = mulberry32(seed === 0 ? 1 : seed);

    const { notes, duration, tempo } = MMLPlayer.parse(melodyMML);
    if (!notes.length) throw new Error(T('comp.noNotes'));

    const { keyPc, scale: scaleName } = detectKey(notes);
    const barSec = 4 * 60 / tempo;
    const nBars = Math.max(1, Math.ceil(duration / barSec - 1e-6));
    const prog = detectChords(notes, keyPc, scaleName, nBars, barSec);

    const m = resolveMood({ ...opts, scale: undefined });
    m.scale = scaleName;   // スケールは常に推定結果を使う
    const tracks = [
      genBass(rand, m, keyPc, prog, nBars, tempo),
      genArp(rand, m, keyPc, prog, nBars, tempo),
    ];
    if (m.harm) tracks.push(genHarmony(m, keyPc, prog, nBars, tempo));
    const useDrums = opts.drums === undefined ? m.drums : opts.drums;
    const drumStyle = (opts.drumStyle === 'hard' || opts.drumStyle === 'soft')
      ? opts.drumStyle : (m.drums ? 'hard' : 'soft');
    if (useDrums) tracks.push(genDrums(rand, nBars, tempo, drumStyle));

    const keyName = NOTE_NAMES[keyPc].toUpperCase() + (scaleName === 'major' ? '' : 'm');
    const comment = T('harm.comment', {
      key: keyName, scale: scaleName, tempo, prog: prog.join('-'), bars: nBars, seed, mood: m.label,
    });
    const offBar = Math.abs(nBars * barSec - duration) > 0.01;
    const warning = offBar
      ? T('harm.offBar', { bars: nBars })
      : null;
    return { tracks, comment, warning };
  }

  // ── メロディ追い足し（extendMelody） ──────────────
  //   既存メロディのキー・コード進行を推定し、続きの小節を同じ生成ルールで作って末尾に足す。
  //   直前の音から声部連結するので自然につながる。小節の途中で終わっていたら休符で境界まで埋める。
  //
  // melodyMML: メロディ1トラックのMML文字列
  // opts: { seed: number, bars: 追加小節数(既定1), density: 0-2(省略時はメロディの音数から推定),
  //         --- 追加部分の雰囲気を変えるオプション（省略時は元メロディに合わせる） ---
  //         scale: 'major'|'minor'|'dorian'(同主調スケール変更。主音は変えずに明暗を変える),
  //         octave: -1|0|1(追加部分の音域を1オクターブ下げる/上げる),
  //         build: true(盛り上げ: 追加小節をメロディより一段激しくし、小節ごとにさらに上げる),
  //         cadence: true(締め: 最後の追加小節を終止形(5度→主音 or 主音ロングトーン)にする) }
  // 戻り値: { mml: 追い足し後の全文, added: 追加部分のみ, warning|null }
  //   同じメロディ+同じ設定なら同じ結果。追い足すたびに元の小節数が変わるので、連続実行では毎回違う小節が出る
  function extendMelody(melodyMML, opts = {}) {
    if (typeof MMLPlayer === 'undefined' || !MMLPlayer.parse) {
      throw new Error(T('comp.noPlayer'));
    }
    const { notes, duration, tempo } = MMLPlayer.parse(melodyMML);
    if (!notes.length) throw new Error(T('comp.noNotes'));

    const { keyPc, scale: detScale } = detectKey(notes);
    // コード推定は元メロディのスケールで行い、生成は指定スケールで行う（同主調転調）
    const scaleName = SCALES[opts.scale] ? opts.scale : detScale;
    const scale = SCALES[scaleName];
    const barSec = 4 * 60 / tempo;
    const nBars = Math.max(1, Math.ceil(duration / barSec - 1e-6));
    const degs = detectChords(notes, keyPc, detScale, nBars, barSec);
    const addBars = Math.max(1, opts.bars | 0 || 1);

    // 激しさ: 未指定ならメロディの音数密度から推定
    let density = opts.density !== undefined ? Math.max(0, Math.min(2, +opts.density || 0))
      : (notes.length / nBars <= 3.2 ? 0 : notes.length / nBars <= 5.2 ? 1 : 2);

    // 小節数を乱数シードに混ぜる: 再現可能なまま、追い足すたびに違う小節が出る
    const seed = (opts.seed ?? 1) >>> 0;
    const rand = mulberry32(((seed ^ Math.imul(nBars + 1, 2654435761)) >>> 0) || 1);

    // 音域: メロディの中央値を中心に、キーに揃えた下端から1オクターブ+5度（genMelodyと同じ幅）
    // MMLPlayer の midi は o4のc=60、composer の semi は o4のc=48（floor(semi/12)=o値）なので -12 して変換する
    const octShift = 12 * Math.max(-1, Math.min(1, opts.octave | 0));
    const mids = notes.map(n => n.midi - 12).sort((a, b) => a - b);
    const median = mids[Math.floor(mids.length / 2)];
    const lo = keyPc + 12 * Math.round((median - 10 - keyPc) / 12) + octShift;
    const hi = lo + 19;
    let prev = Math.max(lo, Math.min(hi, notes[notes.length - 1].midi - 12 + octShift));

    // 小節境界からのずれを休符で埋める（16分単位まで。それ未満の端数は警告）
    const totalBeats = duration * tempo / 60;
    let gap = nBars * 4 - totalBeats;
    const padTokens = [];
    const LENS_DESC = Object.entries(LEN_BEATS).sort((a, b) => b[1] - a[1]);
    for (const [len, beats] of LENS_DESC) {
      while (gap >= beats - 1e-6) { padTokens.push('r' + len); gap -= beats; }
    }
    const warning = gap > 1e-3 ? T('ext.fraction') : null;

    // 推定した進行を循環継続して続きの小節を生成
    const outBars = [];
    for (let b = 0; b < addBars; b++) {
      let r;
      if (opts.cadence && b === addBars - 1) {
        r = genCadenceBar(rand, keyPc, prev, lo, hi);
      } else {
        // 盛り上げ: メロディより一段激しく始め、小節ごとにさらに一段上げる（最大2）
        const dBar = opts.build ? Math.min(2, density + 1 + b) : density;
        const chord = chordPcs(keyPc, scale, degs[(nBars + b) % degs.length]);
        r = genMelodyBar(rand, keyPc, scale, chord, dBar, prev, lo, hi);
      }
      outBars.push(r.seq);
      prev = r.prev;
    }

    const added = (padTokens.length ? padTokens.join(' ') + ' | ' : '') + joinBars(outBars.map(notesToTokens));
    return { mml: melodyMML.trimEnd() + ' | ' + added, added, warning };
  }

  const MOOD_LIST = Object.entries(MOODS).map(([id, m]) => ({ id, label: m.label }));

  return { generate, harmonize, extendMelody, MOOD_LIST };
})();
