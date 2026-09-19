// エラーコードと文言表（js/mml-messages.js）の同期を見張る。
//
// mml.js は文言を持たない。文言は js/mml-messages.js だけが持つので、
// mml.js に throw を足して文言を足し忘れると「不明なエラー」しか出せなくなる。
// 実行時に気づくのでは遅いので、ここで落とす。
'use strict';
const { read, loadPlayer, loadCore, eq, ok } = require('./helper');

const P = loadPlayer();
global.MMLPlayer = P;
const { mmlMessage, MML_MSG } = loadCore(P);

// mml.js のソースから「大文字だけの文字列リテラル」= エラーコードを拾う。
// mml.js の他の文字列は 'sine' 'bandpass' や記号1文字なので取り違えない
function codesInSource() {
  const set = new Set();
  const re = /'([A-Z][A-Z_]{2,})'/g;
  const src = read('mml.js');
  let m;
  while ((m = re.exec(src))) set.add(m[1]);
  return [...set].sort();
}

module.exports = {

  'mml.js が投げうるコードを25個拾えている'() {
    // 拾い方（正規表現）が壊れたら他の同期テストが素通りしてしまうので、件数も見ておく
    ok(codesInSource().length === 25, `拾えたコード数: ${codesInSource().length}（期待 25）`);
  },

  'mml.js の全エラーコードに日本語の文言がある'() {
    const missing = codesInSource().filter(c => !MML_MSG.ja[c]);
    eq(missing, [], 'これらの文言が js/mml-messages.js にありません');
  },

  '文言表に、mml.js が投げなくなったコードが残っていない'() {
    const codes = new Set(codesInSource());
    const stale = Object.keys(MML_MSG.ja).filter(c => c !== 'UNKNOWN' && !codes.has(c));
    eq(stale, [], 'mml.js が投げないコードが js/mml-messages.js に残っています');
  },

  '用意した言語はすべて同じコードを網羅している'() {
    const base = Object.keys(MML_MSG.ja).sort();
    Object.keys(MML_MSG).forEach(lang => {
      eq(Object.keys(MML_MSG[lang]).sort(), base, `${lang} のキーが ja と揃っていません`);
    });
  },

  'どの言語にも受け皿の UNKNOWN がある'() {
    Object.keys(MML_MSG).forEach(lang => {
      ok(typeof MML_MSG[lang].UNKNOWN === 'function', `${lang} に UNKNOWN がありません`);
    });
  },

  // ── 文言の組み立て ──
  'コードと params から文言を作る'() {
    eq(mmlMessage({ code: 'BAD_CHAR', params: { char: '%' } }), '解釈できない文字です: "%"');
    eq(mmlMessage({ code: 'WAVE_RANGE', params: { max: 4 } }), '@ の後に音色番号(0-4)が必要です');
    eq(mmlMessage({ code: 'COMMA_REQUIRED', params: { label: '@e' } }), '@e の値はカンマ区切りで指定してください');
    eq(mmlMessage({ code: 'TOO_MANY_STEPS', params: { max: 1000000 } }),
      'リピートの展開が大きすぎます（音符と休符の合計が 1000000 を超えました）');
  },
  'params を使わない文言は params 無しでも作れる'() {
    eq(mmlMessage({ code: 'O_RANGE' }), 'o の後にオクターブ数(0-8)が必要です');
    eq(mmlMessage({ code: 'NO_NOTES' }), '演奏する音符がありません');
  },
  '表に無いコードは「不明なエラー」になる'() {
    eq(mmlMessage({ code: 'NOPE' }), '不明なエラー (NOPE)');
  },
  '知らない言語を指定されたら日本語で出す'() {
    eq(mmlMessage({ code: 'NO_NOTES' }, 'xx'), '演奏する音符がありません');
  },
  '英語の文言も作れる'() {
    eq(mmlMessage({ code: 'BAD_CHAR', params: { char: '%' } }, 'en'), 'Unexpected character: "%"');
    eq(mmlMessage({ code: 'WAVE_RANGE', params: { max: 4 } }, 'en'), '@ needs a wave number (0-4)');
    eq(mmlMessage({ code: 'NOPE' }, 'en'), 'Unknown error (NOPE)');
  },
  '言語を省略したら今の表示言語で出す'() {
    const en = loadCore(P, { language: 'en-US' });
    eq(en.LANG, 'en');
    eq(en.mmlMessage({ code: 'NO_NOTES' }), 'Nothing to play');
  },

  // ── 実際に mml.js が投げたものを文言にできる ──
  'mml.js が投げる全コードを実際に文言化できる'() {
    const cases = [
      'cde%', 'c0', 'o', 'o9', 'o8>', 'o0<', 'l', 't', 'v', 'q', 'p', '@', '@5',
      '@e3,0,100 c', '@e3,0,100,', '@e3,0,101,40', 'm120,5 c', 'm120,5,', '@b-200 c', '@b-200,',
      '&c', 'c&r', 'c&', '[c', 'c]2', '[c]0 d', '[]', 'c [[r]1000]1001',
    ];
    cases.forEach(src => {
      let e = null;
      try { P.parse(src); } catch (err) { e = err; }
      ok(e && e.code, `${src} はエラーになるはず`);
      Object.keys(MML_MSG).forEach(lang => {
        const text = mmlMessage(e, lang);
        const unknown = MML_MSG[lang].UNKNOWN({ code: e.code });
        ok(text && text !== unknown, `${lang}: ${src} → ${e.code} の文言がありません（${text}）`);
      });
    });
  },
};
