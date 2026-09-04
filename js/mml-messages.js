// ─────────────────────────────────────────
//  mml.js のエラーコード → 表示文言
//
//  mml.js は文言を持たない（どの言語のアプリからでも使えるように、種類を表す code と
//  埋める値 params だけを投げる）。文言はこのファイルだけが持つ。
//  mml.js にエラーを増やしたらここにも足すこと。同期漏れは test/messages.test.js が落とす。
//
//  UNKNOWN は表に無いコードが来たときの受け皿（古いエディタに新しい mml.js を
//  組み合わせた場合など）。文言が無くても、位置は core.js の locateError が付ける。
// ─────────────────────────────────────────
const MML_MSG = {
  ja: {
    UNKNOWN:        p => `不明なエラー (${p.code})`,

    BAD_CHAR:       p => `解釈できない文字です: "${p.char}"`,
    LEN_MIN:        () => '音長は1以上で指定してください',
    COMMA_REQUIRED: p => `${p.label} の値はカンマ区切りで指定してください`,
    TOO_MANY_STEPS: p => `リピートの展開が大きすぎます（音符と休符の合計が ${p.max} を超えました）`,

    TIE_NO_PREV:    () => '& の前に音符が必要です',
    TIE_NO_NEXT:    () => '& の後には音符が必要です',
    TIE_REST:       () => '& の後には音符が必要です（休符は繋げません）',

    UNMATCHED_OPEN:  () => '[ に対応する ] がありません',
    UNMATCHED_CLOSE: () => '] に対応する [ がありません',
    LOOP_NOT_LAST:   () => '無限ループ（数字なし・0 の [ ]）はトラックの末尾にのみ書けます（リピートの中も不可）',
    LOOP_EMPTY:      () => '無限ループの中身には音符か休符が必要です',

    O_RANGE:    () => 'o の後にオクターブ数(0-8)が必要です',
    OCT_OVER:   () => '> でオクターブが 8 を超えます',
    OCT_UNDER:  () => '< でオクターブが 0 を下回ります',
    L_ARG:      () => 'l の後に音長が必要です',
    T_ARG:      () => 't の後にテンポが必要です',
    V_RANGE:    () => 'v の後に音量(0-15)が必要です',
    Q_RANGE:    () => 'q の後にゲート(1-8)が必要です',
    P_ARG:      () => 'p の後にポルタメント時間(ミリ秒)が必要です',

    M_ARGS:     () => 'm は 遅れ,速さ,深さ の3値が必要です',
    E_ARGS:     () => '@e は attack,decay,sustain,release の4値が必要です',
    E_SUSTAIN:  () => '@e の sustain は 0-100 で指定してください',
    B_ARGS:     () => '@b は ずれ(セント),時間(ミリ秒) の2値が必要です',
    WAVE_RANGE: p => `@ の後に音色番号(0-${p.max})が必要です`,

    NO_NOTES:   () => '演奏する音符がありません',
  },
};

// MMLError を文言にする（位置は付けない。位置つきの整形は core.js の locateError）
function mmlMessage(e, lang = 'ja') {
  const table = MML_MSG[lang] || MML_MSG.ja;
  const f = table[e.code];
  return f ? f(e.params || {}) : table.UNKNOWN({ code: e.code });
}
