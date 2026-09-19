// エディタ側（js/core.js）のテキスト処理と小節チェック。
// core.js は最小のDOMを与えて丸ごと読み込むので、「読み込み時に落ちない」ことも同時に見ている
'use strict';
const { loadPlayer, loadCore, ok, eq, near } = require('./helper');

const P = loadPlayer();
global.MMLPlayer = P;
const core = loadCore(P);
const { stripComments, parseTrackBlocks, trackPos, locateError, barCheck, ta } = core;

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

  'ブロックは属する行の番号(1始まり)と内容を持つ'() {
    const b = parseTrackBlocks('t120 c\n; メモ\n\n  d ; x\nt120 e');
    eq(b[0].lines, [{ no: 1, text: 't120 c' }, { no: 4, text: 'd' }], 'コメントと空行は除かれる');
    eq(b[1].lines, [{ no: 5, text: 't120 e' }]);
    eq([b[0].start, b[0].end], [0, 3], 'start/end は0始まりの行インデックス');
  },

  // ── エラー位置を原文の行と文字位置に直す ──
  '連結後の位置を元の行と文字位置に戻せる'() {
    const b = parseTrackBlocks('t120 c\n  d %')[0];   // 連結後は "t120 c d %"（% は10文字目）
    eq(trackPos(b, 10), { line: 2, col: 5 }, '2行目の5文字目（行頭の空白も数える）');
    eq(trackPos(b, 1), { line: 1, col: 1 });
    eq(trackPos(b, 8), { line: 2, col: 3 }, 'd は2行目3文字目');
  },
  'コメントを挟んでも行と文字位置は原文のまま'() {
    // 3行目 "  d /* x */ %" の % は13文字目（コメントを空白化しても桁は動かない）
    const b = parseTrackBlocks('/* a */ t120 c\n; memo\n  d /* x */ %')[0];
    eq(trackPos(b, b.mml.indexOf('%') + 1), { line: 3, col: 13 });
  },
  'mml.js のエラーを「トラックN L行目 C文字目」に直す'() {
    const text = 't120 c\nt120 d\n  e %';
    const blocks = parseTrackBlocks(text);
    let e = null;
    try { P.play(blocks.map(b => b.mml)); } catch (err) { e = err; }
    ok(e, 'エラーになる');
    eq(e.message, 'BAD_CHAR', 'mml.js 側は文言を持たない');
    eq(locateError(e, blocks), 'トラック2 3行目 5文字目: 解釈できない文字です: "%"');
  },
  '曲全体のエラー（位置なし）はトラック番号を付けない'() {
    const blocks = parseTrackBlocks('');
    let e = null;
    try { P.play(''); } catch (err) { e = err; }
    eq(e.code, 'NO_NOTES');
    eq(locateError(e, blocks), '演奏する音符がありません');
  },
  '文言表に無いコードでも位置は付く'() {
    const blocks = parseTrackBlocks('t120 c\n  d %');
    eq(locateError({ code: 'NOPE', params: {}, track: 0, pos: 10 }, blocks),
      'トラック1 2行目 5文字目: 不明なエラー (NOPE)');
  },
  '英語表示ではエラー位置も英語で書く'() {
    const en = loadCore(P, { language: 'en-US' });
    const blocks = en.parseTrackBlocks('t120 c\nt120 d\n  e %');
    let e = null;
    try { P.play(blocks.map(b => b.mml)); } catch (err) { e = err; }
    eq(en.locateError(e, blocks), 'Track 2, line 3, col 5: Unexpected character: "%"');
  },
  'mml.js 以外のエラーは message をそのまま返す'() {
    eq(locateError(new Error('メロディに音符がありません'), parseTrackBlocks('c')),
      'メロディに音符がありません');
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
  // ── 無限ループ [ ]0 は再生時に曲末まで敷き詰められる（mml.js の _parse）ので、
  //    小節チェックも「敷き詰めた後に鳴る長さ」で判定する ──
  '無限ループのトラックは曲末まで敷き詰められるので同尺と判定される'() {
    // ch1 は2小節。ch2 は音符1つだが、曲末まで8回敷き詰められて同じ2小節ぶん鳴る
    const r = check('t120 l4 gggggggg\n\nt120 l4 [c]', 4);
    eq(r.rows[0].bars, 2);
    eq(r.rows[1].bars, 2, '書いた長さ(0.25小節)ではなく敷き詰め後の長さ');
    ok(r.rows[1].ok, '小節の整数倍');
    ok(r.allSame, '同尺');
  },
  'ループ本体の長さと繰り返し回数を報告する'() {
    const r = check('t120 l4 gggggggg\n\nt120 l4 [c]', 4);
    eq(r.rows[0].loop, null, '無限ループを使わないトラックは loop 情報なし');
    near(r.rows[1].loop.bodyBars, 0.25, 'ループ本体は0.25小節');
    near(r.rows[1].loop.times, 8, '8回で曲末まで埋まる');
    ok(r.rows[1].loop.fit, 'ちょうど割り切れる');
  },
  'ループ本体が曲の長さを割り切れなくても、長さは合っている'() {
    // 無限ループは曲末で打ち切られるので尺は必ず揃う。[c c c] は本体3拍が2.667回ぶん鳴って終わる。
    // 割り切れないと繋ぎ目で本体の途中から頭に戻る（並びは変わる）が、それは長さの問題ではない
    const r = check('t120 l4 gggggggg\n\nt120 l4 [c c c]', 4);
    ok(r.allSame, '無限ループは曲末で切られるので同尺');
    eq(r.rows[1].bars, 2, '曲と同じ2小節');
    ok(r.rows[1].ok, '小節の整数倍。要確認にはしない');
    ok(!r.rows[1].loop.fit, 'ただし本体は曲末で途中まで');
    near(r.rows[1].loop.times, 8 / 3, '割り切れない回数');
  },
  '前奏つきの無限ループは前奏と本体を分けて報告する'() {
    const r = check('t120 l4 c d e f\n  [ g a b >c | <c d e f ]0\nt120 l4 c d e f | g a b >c | c d e f', 4);
    eq(r.rows[0].bars, 3);
    ok(r.rows[0].ok);
    ok(r.allSame, '前奏1小節+本体2小節 = 3小節で揃う');
    near(r.rows[0].loop.introBars, 1, '前奏は1小節');
    near(r.rows[0].loop.bodyBars, 2, 'ループ本体は2小節');
    ok(r.rows[0].loop.fit);
  },
  '1小節に満たないループ本体は小節線チェックの対象外（繰り返しの単位なので）'() {
    // [c] は0.25小節。1回ごとに小節線から外れるのは当たり前なので件数に数えない
    const r = check('t120 l4 gggggggg\n\nt120 l4 [c]', 4);
    eq(r.rows[1].strays, 0);
  },

  // ── 小節チェックの報告文（barReport） ──
  '報告: 問題なければ小節数と同尺OKを並べる'() {
    const r = check('t120 l4 c d e f | g a b >c\nt120 l4 o3 c2 g2 | c2 g2', 4);
    const out = core.barReport(r, 4);
    eq(out.html, '1小節 = 4拍 として判定\nch1  2.000小節  t120  8音\nch2  2.000小節  t120  4音\n全トラック同尺: OK');
    eq(out.status, '小節チェック: 問題なし');
  },
  '報告: 無限ループは前奏と本体の内訳を添え、割り切れなければ「曲末で途中まで」'() {
    const r = check('t120 l4 gggggggg\n\nt120 l4 [c c c]', 4);
    const out = core.barReport(r, 4);
    eq(out.html.split('\n')[2], 'ch2  2.000小節  t120  3音  （[ ]0 本体0.750小節 × 2.667回・曲末で途中まで）');
  },
  '報告: 要確認の箇所は span.ng で囲む'() {
    const r = check('t120 l4 c d e f | g a b\nt120 l4 o3 c2 g2 | c2 g2', 4);
    const out = core.barReport(r, 4);
    ok(out.html.includes('<span class="ng">  ← 小節の整数倍になっていません</span>'));
    ok(out.html.includes('<span class="ng">全トラック同尺: NG ← トラックごとに長さが違います</span>'));
    eq(out.status, '小節チェック: 要確認');
  },
  '報告: 英語表示では英語で書く'() {
    const en = loadCore(P, { language: 'en-US' });
    en.ta.value = 't120 l4 c d e f | c d e f\nt120 l4 r32 c d e f | c d e f8..';
    const out = en.barReport(en.barCheck(4), 4);
    eq(out.html.split('\n'), [
      'Checking with 4 beats per bar',
      'ch1  2.000 bars  t120  8 notes',
      'ch2  2.000 bars  t120  8 notes',
      '     1 spot(s) off the bar lines (first: line 2, segment 1, at bar 1.031)',
      'All tracks same length: OK',
    ]);
    eq(out.status, 'Bar check: OK');
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
  '最初の音符より後で初めて t が出るトラックは、それまで既定の t120 なので複数テンポ扱い'() {
    // 前半は既定の120、後半は60。t60 だけ見て「1.5小節」と出すのは誤り
    const r = check('l4 c d e f t60 g a b >c', 4);
    eq(r.rows[0].multiTempo, [120, 60]);
  },
  '最初の音符より前なら t の位置は問わない'() {
    const r = check('@e3,0,100,40 v10 t60 l4 c d e f', 4);
    ok(!r.rows[0].multiTempo);
    eq(r.rows[0].tempo, 60);
    eq(r.rows[0].bars, 1);
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
