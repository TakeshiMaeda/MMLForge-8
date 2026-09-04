// MMLのエラーのテスト。
//
// mml.js は文言を持たない（言語非依存）。投げるのは MMLError で、外向きの約束は
//   code   … エラーの種類を表す識別子。文言はエディタ側（js/mml-messages.js）が持つ
//   params … 文言に埋める値（{ char } { max } { label }）。MMLの記号や数値だけで言語に依らない
//   track  … 0始まりのトラック番号。曲全体のエラー（NO_NOTES）は null
//   pos    … 1始まりの「原文」の文字位置。リピート [ ]n の後ろでも展開後の位置にはならない
// の4つ。ここではその4つを押さえる（日本語の文言は test/messages.test.js が見る）。
// mml.js の throw 箇所を網羅する（増やしたらここも増やすこと）。
'use strict';
const { loadPlayer, throwsCode, eq, ok } = require('./helper');
const P = loadPlayer();
const parse = (s) => () => P.parse(s);

module.exports = {

  // ── 位置とプロパティそのもの ──
  '位置は1始まりで、問題の文字を指す'() {
    // "cde%" の % は4文字目
    throwsCode(parse('cde%'), { code: 'BAD_CHAR', pos: 4, params: { char: '%' } });
  },
  '解釈できない文字は params にその文字を入れる'() {
    throwsCode(parse(';コメント'), { code: 'BAD_CHAR', pos: 1, params: { char: ';' } },
      'コメントは mml.js の機能ではないのでエラーになる');
  },
  'MMLError は code / params / track / pos を持ち、message は code だけ'() {
    let e = null;
    try { P.parse('cde%'); } catch (err) { e = err; }
    ok(e, '例外が投げられる');
    eq(e.name, 'MMLError');
    eq(e.code, 'BAD_CHAR');
    eq(e.track, 0, 'track はトラックのインデックス（0始まり）');
    eq(e.pos, 4, 'pos は原文の文字位置（1始まり）');
    eq(e.message, 'BAD_CHAR', 'message は言語非依存にするためコードそのもの');
    ok(e instanceof Error, 'Error のサブクラス');
  },
  'MMLError は外にも公開する（利用側が instanceof で判別できる）'() {
    let e = null;
    try { P.parse('%'); } catch (err) { e = err; }
    ok(e instanceof P.MMLError, 'MMLPlayer.MMLError で判別できる');
  },
  'リピートの後ろでも位置は原文を指す（展開後の位置ではない）'() {
    // "[cde]3 %" の % は8文字目。展開すると "cdecdecde %" で11文字目になってしまうが、それは仕様違反
    throwsCode(parse('[cde]3 %'), { code: 'BAD_CHAR', pos: 8 });
  },
  'リピートの中のエラーも原文を指す'() {
    throwsCode(parse('[cd]2 [e %]2'), { code: 'BAD_CHAR', pos: 10 });
  },
  '2周目以降でしか起きないエラーも原文を指す'() {
    // 1周目は o4→o5、2周目で o5→o6 … 4周目に o8 から > で範囲外になる
    throwsCode(parse('[c >]5'), { code: 'OCT_OVER', pos: 4 });
  },

  // ── リピート ──
  '[ ] の対応が取れない（閉じ忘れ）は [ の位置を指す'() {
    throwsCode(parse('c [de'), { code: 'UNMATCHED_OPEN', pos: 3 });
  },
  '[ ] の対応が取れない（開き忘れ）は ] の位置を指す'() {
    throwsCode(parse('cde]2'), { code: 'UNMATCHED_CLOSE', pos: 4 });
  },
  'ネストの閉じ忘れは、閉じられていない側の [ を指す'() {
    // "[c [d]2" の ]2 は内側を閉じるので、開いたまま残るのは1文字目の [
    throwsCode(parse('[c [d]2'), { code: 'UNMATCHED_OPEN', pos: 1 });
  },
  '無限ループの後ろに音符があると拒否する（[ の位置）'() {
    throwsCode(parse('c [de]0 f'), { code: 'LOOP_NOT_LAST', pos: 3 });
  },
  '無限ループをリピートの中に書くと拒否する'() {
    throwsCode(parse('[[cd]0]2'), { code: 'LOOP_NOT_LAST', pos: 2 });
  },
  '無限ループの中身が空だと拒否する'() {
    throwsCode(parse('c4 []'), { code: 'LOOP_EMPTY', pos: 4 });
  },
  '無限ループの後ろが空白と | だけなら通る'() {
    const r = P.parse('c4 [de]0 |  ');
    eq(r.notes.length, 3, '音符は3つ');
  },
  '] の直後の付点はエラー（最後の周の音符には付かない）'() {
    throwsCode(parse('[c]2. d'), { code: 'BAD_CHAR', pos: 5, params: { char: '.' } });
  },
  '] の直後のシャープはエラー（最後の周の音符には付かない）'() {
    throwsCode(parse('[c]2# d'), { code: 'BAD_CHAR', pos: 5, params: { char: '#' } });
  },

  // ── 音長 ──
  // 値の範囲エラーは「その値の先頭」を指す（直せばよい場所を指す）。
  // 数値が無いエラーも「数値があるべき場所」を指すので、両者で流儀が揃う
  '音長0は拒否する'() {
    throwsCode(parse('c0'), { code: 'LEN_MIN', pos: 2 });
  },

  // ── 単独コマンドの引数不足・範囲外（記法表の範囲: o0-8 v0-15 q1-8） ──
  // 「数値が無い」と「範囲外」は直す場所が同じなので、同じコードを使う
  'o に数値が無い'() {
    throwsCode(parse('o'), { code: 'O_RANGE', pos: 2 });
  },
  'o9 は範囲外'() {
    throwsCode(parse('o9 c'), { code: 'O_RANGE', pos: 2 });
  },
  'o8 は通る'() {
    eq(P.parse('o8 c').notes[0].midi, 108);
  },
  '> で o8 を超えると拒否する'() {
    throwsCode(parse('o8 > c'), { code: 'OCT_OVER', pos: 4 });
  },
  '< で o0 を下回ると拒否する'() {
    throwsCode(parse('o0 < c'), { code: 'OCT_UNDER', pos: 4 });
  },
  'l に数値が無い'() {
    throwsCode(parse('l'), { code: 'L_ARG', pos: 2 });
  },
  'l0 は拒否する'() {
    throwsCode(parse('l0'), { code: 'L_ARG', pos: 2 });
  },
  't に数値が無い'() {
    throwsCode(parse('t'), { code: 'T_ARG', pos: 2 });
  },
  't0 は拒否する'() {
    throwsCode(parse('t0'), { code: 'T_ARG', pos: 2 });
  },
  'v に数値が無い'() {
    throwsCode(parse('v'), { code: 'V_RANGE', pos: 2 });
  },
  'v16 は範囲外'() {
    throwsCode(parse('v16 c'), { code: 'V_RANGE', pos: 2 });
  },
  'q に数値が無い'() {
    throwsCode(parse('q'), { code: 'Q_RANGE', pos: 2 });
  },
  'q0 と q9 は範囲外'() {
    throwsCode(parse('q0 c'), { code: 'Q_RANGE', pos: 2 });
    throwsCode(parse('q9 c'), { code: 'Q_RANGE', pos: 2 });
  },
  'p に数値が無い'() {
    throwsCode(parse('p c4'), { code: 'P_ARG', pos: 2 });
  },

  // ── 音色・エンベロープ ──
  '@ に音色番号が無い'() {
    throwsCode(parse('@ c4'), { code: 'WAVE_RANGE', pos: 2, params: { max: 4 } });
  },
  '範囲外の音色番号'() {
    throwsCode(parse('@5 c4'), { code: 'WAVE_RANGE', pos: 2, params: { max: 4 } });
  },
  '@e の値が足りない（カンマが来ない）'() {
    throwsCode(parse('@e3,0,100 c4'), { code: 'COMMA_REQUIRED', pos: 11, params: { label: '@e' } });
  },
  '@e のカンマの後に値が無い'() {
    throwsCode(parse('@e3,0,100, c4'), { code: 'E_ARGS', pos: 12 });
  },
  '@e の区切りがカンマでない'() {
    throwsCode(parse('@e3 0 100 40'), { code: 'COMMA_REQUIRED', pos: 5, params: { label: '@e' } });
  },
  '@e の sustain は % なので 100 を超えると拒否する'() {
    // 位置7 = 101 の先頭（3つ目の値そのものを指す）
    throwsCode(parse('@e3,0,101,40 c'), { code: 'E_SUSTAIN', pos: 7 });
  },
  '@e の値の前に空白があっても、指すのは値の先頭'() {
    throwsCode(parse('@e3, 0, 101, 40 c'), { code: 'E_SUSTAIN', pos: 9 });
  },

  // ── & タイ/スラー ──
  '& の前に音符が無い'() {
    throwsCode(parse('&c4'), { code: 'TIE_NO_PREV', pos: 1 });
  },
  '& の後が休符'() {
    throwsCode(parse('c4&r4'), { code: 'TIE_REST', pos: 4 });
  },
  '& でトラックが終わる（& の位置を指す）'() {
    throwsCode(parse('c4&'), { code: 'TIE_NO_NEXT', pos: 3 });
  },
  '& の後にコマンドだけ続いて音符が無い'() {
    throwsCode(parse('c4& o5 v10'), { code: 'TIE_NO_NEXT', pos: 3 });
  },

  // ── m LFO ──
  'm の値が足りない（カンマが来ない）'() {
    throwsCode(parse('m120,5 c4'), { code: 'COMMA_REQUIRED', pos: 8, params: { label: 'm' } });
  },
  'm のカンマの後に値が無い'() {
    throwsCode(parse('m120,5, c4'), { code: 'M_ARGS', pos: 9 });
  },

  // ── @b ベンド ──
  '@b の値が足りない（カンマが来ない）'() {
    throwsCode(parse('@b-200 c4'), { code: 'COMMA_REQUIRED', pos: 8, params: { label: '@b' } });
  },
  '@b のカンマの後に値が無い'() {
    throwsCode(parse('@b-200, c4'), { code: 'B_ARGS', pos: 9 });
  },

  // ── リピートの上限（タイプミス1つでブラウザが固まらないように） ──
  'リピートの展開が大きすぎると拒否する（音符と休符の合計。位置は一番外の [）'() {
    // 1音あたり約570B なので 100万で約0.6GB。ここを超えたら止める
    throwsCode(parse('c [[r]1000]1001'), { code: 'TOO_MANY_STEPS', pos: 3, params: { max: 1000000 } });
  },
  '上限ちょうどまでは通る'() {
    eq(P.parse('[[r]1000]1000').notes.length, 0);
  },

  // ── トラック番号 ──
  'track はエラーの起きたトラックを指す'() {
    // parse() は単トラック用なので既定は0。第2引数で番号を渡せる
    throwsCode(parse('%'), { code: 'BAD_CHAR', track: 0 });
    throwsCode(() => P.parse('%', 3), { code: 'BAD_CHAR', track: 3 });
  },

  // ── play() 固有（パースは再生の前に済むので AudioContext 無しで確かめられる） ──
  '空のトラックしか無ければ play() は拒否する'() {
    // 曲全体のエラーなので track も pos も無い
    throwsCode(() => P.play(''), { code: 'NO_NOTES', track: null, pos: null });
    throwsCode(() => P.play([]), { code: 'NO_NOTES' });
    throwsCode(() => P.play(['', ' | ']), { code: 'NO_NOTES' });
  },
  'play() のエラーは何トラック目かを示す'() {
    throwsCode(() => P.play(['cde', 'c %']), { code: 'BAD_CHAR', track: 1, pos: 3 });
  },
};
