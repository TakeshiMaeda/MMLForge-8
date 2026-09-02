// エディタ側（js/core.js）のテキスト処理と小節チェック。
// core.js は最小のDOMを与えて丸ごと読み込むので、「読み込み時に落ちない」ことも同時に見ている
'use strict';
const { loadPlayer, loadCore, ok, eq, near } = require('./helper');

const P = loadPlayer();
global.MMLPlayer = P;
const core = loadCore(P);
const { stripComments, parseTrackBlocks, barCheck, ta } = core;

const check = (text, beats) => { ta.value = text; return barCheck(beats); };

module.exports = {

  // ── コメント除去（行構造を保つので行番号がずれない） ──
  '; は行末までを空白にする'() {
    const src = 'cde ; メモ\nfga';
    const out = stripComments(src);
    eq(out.length, src.length, '長さは変わらない（行番号と桁が保たれる）');
    eq(out.split('\n')[0].trim(), 'cde', 'コメントは消える');
    eq(out.split('\n')[1], 'fga', '次の行はそのまま');
  },
  '/* */ は複数行にまたがれる'() {
    const out = stripComments('c /* あ\nい */ d');
    eq(out.length, 'c /* あ\nい */ d'.length, '長さが変わらない（行番号が保たれる）');
    ok(out.includes('c'), 'コメント外は残る');
    ok(out.includes('d'), 'コメント外は残る');
    ok(!out.includes('あ'), 'コメント内は消える');
  },
  'コメント除去は文字数を変えない'() {
    const src = 'abc ; xyz\n/* pq */ r';
    eq(stripComments(src).length, src.length);
  },

  // ── トラック分割 ──
  '行頭から始まる行が新トラック'() {
    eq(parseTrackBlocks('t120 c\nt120 d').map(b => b.mml), ['t120 c', 't120 d']);
  },
  '行頭が空白の行は前のトラックの続き'() {
    eq(parseTrackBlocks('t120 c\n  d e').map(b => b.mml), ['t120 c d e']);
  },
  '空行とコメントだけの行はトラックを分断しない'() {
    const b = parseTrackBlocks('t120 c\n; メモ\n\n  d');
    eq(b.length, 1, 'トラックは1つのまま');
    eq(b[0].mml, 't120 c d');
  },

  // ── 小節チェック ──
  '正しい4/4は小節の整数倍・同尺と判定される'() {
    const r = check('t120 l4 c d e f | g a b >c\nt120 l4 o3 c2 g2 | c2 g2', 4);
    eq(r.rows.map(x => x.bars), [2, 2], '2小節ずつ');
    ok(r.rows.every(x => x.ok), '整数倍');
    ok(r.allSame, '同尺');
    ok(r.rows.every(x => !x.strays), '小節線から外れた箇所は無い');
  },
  '1小節に音符が足りないと整数倍でなくなり、その箇所を指す'() {
    const r = check('t120 l4 c d e f | g a b\nt120 l4 o3 c2 g2 | c2 g2', 4);
    ok(!r.rows[0].ok, 'ch1は整数倍でない');
    ok(!r.allSame, '同尺でなくなる');
    eq(r.rows[0].first.no, 1, 'ズレの起点は1行目');
    eq(r.rows[0].first.part, 2, '1行目の2つ目の小節');
    near(r.rows[0].first.bars, 1.75, 'そこまでで1.75小節');
  },
  'リピートの中の行も位置を測れる（[ が閉じていなくても）'() {
    // 2小節を [ ]2 で括り、その2小節目を1拍短くする
    const r = check('t120 l4\n  [ c d e f\n  | g a b\n  ]2', 4);
    ok(!r.rows[0].ok, '整数倍でない');
    eq(r.rows[0].first.no, 3, 'ズレの起点は3行目');
  },
  '無限ループ [ ]0 で括った曲でも中の行を測れる'() {
    const r = check('t120 l4 c d e f\n  [ g a b >c\n  | <c d e f ]0', 4);
    ok(r.rows[0].ok, '整数倍');
    ok(!r.rows[0].strays, '小節線から外れた箇所は無い');
    eq(r.rows[0].bars, 3, '前奏1小節+本体2小節');
  },
  '6/8 は1小節3拍として数える'() {
    const r = check('t175 l8 c d e f g a | c d e f g a', 3);
    near(r.rows[0].bars, 2);
    ok(r.rows[0].ok);
  },
  'トラックごとに長さが違えば同尺NG'() {
    const r = check('t120 l4 c d e f\nt120 l4 c d e f g a', 4);
    ok(!r.allSame);
  },
  'テンポが変わるトラックは判定不能として報告する'() {
    // 小節長を1つに決められないので、誤った小節数を出すより判定不能と言う
    const r = check('t120 l4 c d e f t60 g a b >c', 4);
    eq(r.rows[0].multiTempo, [120, 60], '見つかったテンポを列挙する');
    eq(r.rows[0].bars, undefined, '小節数は出さない');
    ok(r.rows[0].sec > 0, '秒数と音数は出す');
  },
  'テンポが1種類だけなら普通に判定する'() {
    const r = check('t120 l4 c d e f t120 g a b >c', 4);
    ok(!r.rows[0].multiTempo);
    eq(r.rows[0].bars, 2);
  },
  '意図的に小節線をまたぐトラックは件数として報告される'() {
    // エコー用に頭を32分ずらし、末尾の音を同じだけ詰めて尺を合わせたトラック。
    // l4 では 4分=1拍・32分=0.125拍なので、最後の音は 1-0.125=0.875拍 ＝ 複付点8分（8..）。
    // ズレは途中の小節線でしか観測できないので、2小節にして | で区切っておく
    const r = check('t120 l4 c d e f | c d e f\nt120 l4 r32 c d e f | c d e f8..', 4);
    ok(r.allSame, '尺は揃っている');
    ok(r.rows[1].ok, '小節の整数倍でもある');
    eq(r.rows[1].strays, 1, '1小節目の終わりだけ小節線に乗らない');
    ok(!r.rows[0].strays, 'ずらしていない側は乗る');
  },
};
