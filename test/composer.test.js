// 作曲エンジン（js/mml-composer.js）のうち、表示言語に従う部分（雰囲気名・生成コメント・警告）。
// 生成される曲そのもの（MML）は言語に依らないことも確かめる（シード再現性を言語で壊さないため）
'use strict';
const { loadPlayer, loadComposer, eq, ok } = require('./helper');

const P = loadPlayer();
global.MMLPlayer = P;
const ja = loadComposer('ja-JP');
const en = loadComposer('en-US');

module.exports = {

  '雰囲気名は表示言語で出す（id は言語に依らない）'() {
    eq(ja.MOOD_LIST.map(m => m.label), ['しずか・おだやか', '幻想・浮遊', '疾走・激しい', '緊迫・不穏', '明るい・陽気']);
    eq(en.MOOD_LIST.map(m => m.label), ['Calm / gentle', 'Mystic / floating', 'Driving / intense', 'Tense / ominous', 'Bright / cheerful']);
    eq(en.MOOD_LIST.map(m => m.id), ja.MOOD_LIST.map(m => m.id));
  },

  '生成コメントは表示言語で書く'() {
    const opts = { mood: 'dark', bars: 8, seed: 7 };
    eq(ja.generate(opts).comment,
      '; 自動生成: 緊迫・不穏 / key=Am(minor) / t150 / 進行1-4-2-7 / 8小節 / seed=7 / ハーモニー / リズムch(hard)');
    eq(en.generate(opts).comment,
      '; Generated: Tense / ominous / key=Am(minor) / t150 / progression 1-4-2-7 / 8 bars / seed=7 / harmony / rhythm (hard)');
  },

  '言語が違っても生成される曲は同じ'() {
    ['calm', 'mystic', 'intense', 'dark', 'bright'].forEach(mood => {
      const opts = { mood, bars: 8, seed: 42 };
      eq(en.generate(opts).channels, ja.generate(opts).channels, mood);
    });
  },

  '伴奏付けのコメントと警告も表示言語で書く'() {
    const r = en.harmonize('t120 l4 c d e f g', { seed: 5 });
    eq(r.warning, 'The melody is not exactly 2 bars of 4/4. Pad the end with r to line up the loop');
    ok(r.comment.startsWith('; Accompaniment: '), r.comment);
    eq(en.harmonize('t120 l4 c d e f g', { seed: 5 }).channels,
      ja.harmonize('t120 l4 c d e f g', { seed: 5 }).channels, '伴奏そのものは言語に依らない');
  },

  '追い足しの警告も表示言語で書く'() {
    eq(en.extendMelody('t120 l4 c d e f g64', { seed: 2 }).warning,
      'The melody ends with a fraction shorter than a 16th, so the added bars start slightly off');
  },

  '音符の無いメロディは表示言語のエラーになる'() {
    let e = null;
    try { en.harmonize('t120 r4'); } catch (err) { e = err; }
    eq(e && e.message, 'The melody has no notes');
  },
};
