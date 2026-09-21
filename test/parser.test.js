// MMLパーサの正常系。記法を変えたらここが落ちるようにしておく
'use strict';
const { loadPlayer, ok, eq, near } = require('./helper');
const P = loadPlayer();

// 内部のイベント（segs / lfo / porta / bend）まで見たいものは、
// mml.js を書き換えずにテスト時だけ _parseTrack を露出させて確かめる
const { read } = require('./helper');
const raw = read('mml.js');
// 公開オブジェクトの中の MMLError の行の前に足す（並び順には依存しない）
const patched = raw.replace(/\n([ \t]*)MMLError,/, (m, ind) => `\n${ind}_pt: _parseTrack,\n${ind}MMLError,`);
if (patched === raw) throw new Error('mml.js の return ブロックの形が変わりました（テストの読み込み方を直してください）');
const Inner = eval(patched + ';MMLPlayer');   // eslint-disable-line no-eval
const ev = (s) => Inner._pt(s, 0);

module.exports = {

  // ── 基本 ──
  'o4 の a は440Hz'() {
    near(ev('o4 a4').evs[0].freq, 440, '基準ピッチ', 1e-9);
  },
  '音長は 4/n 拍（4=四分, 8=八分, 12=三連）'() {
    const r = ev('t120 c4 c8 c12');
    near(r.evs[0].dur, 0.5, '四分');
    near(r.evs[1].dur, 0.25, '八分');
    near(r.evs[2].dur, 1 / 6, '三連八分');
  },
  '付点は重ねがけできる'() {
    const r = ev('t120 c4. c4..');
    near(r.evs[0].dur, 0.75, '付点四分');
    near(r.evs[1].dur, 0.875, '複付点四分');
  },
  '省略時の音長は l の値'() {
    const r = ev('t120 l8 c c4');
    near(r.evs[0].dur, 0.25);
    near(r.evs[1].dur, 0.5);
  },
  '> < でオクターブが上下する'() {
    eq(ev('o4 c >c <c').evs.map(e => e.midi), [60, 72, 60]);
  },
  '# + はシャープ、- はフラット'() {
    eq(ev('o4 c+ c# c-').evs.map(e => e.midi), [61, 61, 59]);
  },
  '| と空白と改行は無視される'() {
    eq(ev('c | d\n\te').evs.length, 3);
  },
  'v は 0-15 で、大きいほど音量が上がる'() {
    const r = ev('v15 c v0 c');
    ok(r.evs[0].vol > r.evs[1].vol, 'v15 は v0 より大きい');
  },
  'q はゲート（音の鳴る割合）'() {
    const r = ev('t120 q4 c4');
    near(r.evs[0].gate, 0.25, '四分音符0.5秒の半分');
  },

  // ── リピート ──
  'リピートは展開される'() {
    eq(ev('[cde]3').evs.length, 9);
  },
  'リピートは入れ子にできる'() {
    eq(ev('[[cd]2 e]2').evs.length, 10);
  },
  'リピートの周回ごとに状態は引き継がれる'() {
    // 1周目 o4、2周目 o5（> が効いたまま次の周に入る）
    eq(ev('o4 [c >]2').evs.map(e => e.midi), [60, 72]);
  },
  'リピートの中の & は周をまたいで繋がる'() {
    // "c4&" を2回 = c4&c4& … 最後の & は次の音符が無いのでエラー。& の後に音符を置けば繋がる
    const r = ev('t120 [c4&c4]2');
    eq(r.evs.length, 2, '2周で2発音');
    near(r.evs[0].dur, 1.0);
  },
  '無限ループはループ開始点を返し、長さは変えない'() {
    const r = P.parse('t120 l4 c d [e f]0');
    near(r.duration, 2.0, '4分音符4つ ぶん');
    near(r.loopStart, 1.0, 'ループ開始は2音目の後');
  },
  '無限ループを使わなければ loopStart は null'() {
    eq(P.parse('cde').loopStart, null);
  },
  '& の直後にループ開始点が来ても、2周目以降はループ頭の音を改めて鳴らす'() {
    // 1周目: c4&d4 は1発音（c→d と滑らかに繋がる）。2周目以降は c4 が無いので d4 を頭から発音する
    const r = ev('t120 o4 c4& [d4 e4]0');
    const main = r.evs.filter(e => !e.loopOnly);
    eq(main.map(e => e.segs.map(s => s.midi)), [[60, 62], [64]], '1周目は c&d と e の2発音');
    near(r.loopStart, 0.5, 'ループ開始点は c4 の後');
    const lo = r.evs.filter(e => e.loopOnly);
    eq(lo.length, 1, '2周目以降専用の音が1つ足される');
    eq(lo[0].midi, 62, 'それは d');
    near(lo[0].time, 0.5, 'ループ開始点から');
    near(lo[0].dur, 0.5, '繋いだ先の区間ぶん');
    eq(lo[0].segs.map(s => s.midi), [62]);
  },
  '& でループ開始点をまたいだ音は parse() の notes には出ない（1周目の音だけ数える）'() {
    const r = P.parse('t120 c4& [d4 e4]0');
    eq(r.notes.map(n => n.midi), [60, 64]);
    near(r.duration, 1.5);
  },
  'ループ開始点をまたぐ & が無ければ 2周目専用の音は作られない'() {
    eq(ev('c4 [d4& e4]0').evs.filter(e => e.loopOnly).length, 0);
  },

  // ── & タイ/スラー ──
  'タイは1発音にまとまり長さが合算される'() {
    const r = ev('t120 c4&c4');
    eq(r.evs.length, 1, '発音は1回');
    near(r.evs[0].dur, 1.0, '長さは合算');
    eq(r.evs[0].segs.length, 2, '音程の区間は2つ');
    near(r.dur, 1.0, 'トラック長は変わらない');
  },
  'スラーは区間ごとに音程が変わる'() {
    eq(ev('o4 c4&e4').evs[0].segs.map(s => s.midi), [60, 64]);
  },
  '3つ以上つなげられる'() {
    const r = ev('o4 c4&>c4&<c4');
    eq(r.evs.length, 1);
    eq(r.evs[0].segs.map(s => s.midi), [60, 72, 60]);
  },
  '& の間のオクターブ指定は次の音に効く'() {
    eq(ev('o4 c4&>e4').evs[0].segs.map(s => s.midi), [60, 76]);
  },
  'ゲートは合算後の長さから計算する'() {
    near(ev('t120 q4 c4&c4').evs[0].gate, 0.5, '1秒の半分');
  },
  'parse() から見るとタイは1音（長さは合算）'() {
    const r = P.parse('t120 c4&c4');
    eq(r.notes.length, 1);
    near(r.notes[0].dur, 1.0);
  },

  // ── m LFO ──
  'm は遅れを秒に、速さと深さはそのまま持つ'() {
    const e = ev('m120,5,30 c').evs[0];
    near(e.lfo.delay, 0.12, '遅れはミリ秒→秒');
    eq(e.lfo.rate, 5, '速さはHz');
    eq(e.lfo.depth, 30, '深さはセント');
  },
  'm は状態なので以降の音符すべてに効く'() {
    eq(ev('m120,5,30 c d e').evs.map(x => x.lfo.depth), [30, 30, 30]);
  },
  'm0,0,0 で解除できる'() {
    const r = ev('m120,5,30 c m0,0,0 d');
    eq(r.evs[1].lfo, { delay: 0, rate: 0, depth: 0 });
  },
  '既定ではLFOは無効'() {
    eq(ev('c').evs[0].lfo, { delay: 0, rate: 0, depth: 0 });
  },

  // ── p ポルタメント ──
  'p はミリ秒を秒で持ち、状態として残る'() {
    const r = ev('p60 c4&e4 g4');
    near(r.evs[0].porta, 0.06);
    near(r.evs[1].porta, 0.06, '次の音にも残る');
  },
  'p0 で解除できる'() {
    eq(ev('p60 c p0 d').evs[1].porta, 0);
  },
  '& が無ければ区間は1つのまま（p は無関係）'() {
    eq(ev('p60 c4 e4').evs[0].segs.length, 1);
  },

  // ── @b ベンド ──
  '@b は負のセントと時間を読む'() {
    const b = ev('@b-200,60 e4').evs[0].bend;
    eq(b.cent, -200, '負で下から');
    near(b.sec, 0.06, '時間はミリ秒→秒');
  },
  '@b は正のセント（上から入る）も読む'() {
    eq(ev('@b50,30 c').evs[0].bend.cent, 50);
  },
  '@b は + 付きの正の値も読む（音符の + と同じ流儀）'() {
    eq(ev('@b+200,60 c').evs[0].bend.cent, 200);
    eq(ev('@b +200, 60 c').evs[0].bend.cent, 200, '空白を挟んでも同じ');
  },
  '@b は1回限りで次の音符には効かない'() {
    eq(ev('@b-200,60 c d').evs[1].bend, null);
  },
  '@b は休符では消費されない'() {
    eq(ev('@b-200,60 r4 e4').evs[0].bend.cent, -200);
  },
  '@b は & で繋いだ音の先頭にだけ効く'() {
    const r = ev('@b-200,60 c4&e4');
    eq(r.evs.length, 1);
    eq(r.evs[0].bend.cent, -200);
  },
  '@b のずれ0は効果なし扱い'() {
    eq(ev('@b0,60 c').evs[0].bend, null);
  },

  // ── 既存記法が壊れていないこと ──
  '@e は4値を読む'() {
    const e = ev('@e3,20,100,40 c').evs[0].env;
    eq(e, { a: 3, d: 20, s: 100, r: 40 });
  },
  '既定のエンベロープは @e3,0,100,40'() {
    eq(ev('c').evs[0].env, { a: 3, d: 0, s: 100, r: 40 });
  },
  '既定の音色は @1（square）'() {
    eq(ev('c').evs[0].wave, 1);
  },
  '既定は o4 l4 t120'() {
    const r = ev('c');
    eq(r.evs[0].midi, 60, 'o4 の c は C4');
    near(r.evs[0].dur, 0.5, 'l4 かつ t120');
    eq(r.tempo, 120);
  },
};
