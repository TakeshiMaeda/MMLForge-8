// 表示言語の決め方と切り替え（js/i18n.js）。
//
// 初回はブラウザの言語で決めて保存し、次からは保存した言語。
// 切り替えボタンで変えたら保存してページを読み直す。
'use strict';
const { loadI18n, eq, ok } = require('./helper');

module.exports = {

  // ── 初回（保存が無い） ──
  '初回、日本語のブラウザなら日本語になり、それを保存する'() {
    const r = loadI18n({ language: 'ja-JP' });
    eq(r.LANG, 'ja');
    eq(r.saved(), 'ja', '次から同じ言語で開くために保存する');
  },
  '初回、日本語以外のブラウザなら英語になり、それを保存する'() {
    eq(loadI18n({ language: 'en-US' }).LANG, 'en');
    const r = loadI18n({ language: 'fr-FR' });
    eq(r.LANG, 'en', '用意していない言語は英語');
    eq(r.saved(), 'en');
  },
  '言語コードだけ（ja）でも日本語と判定する'() {
    eq(loadI18n({ language: 'ja' }).LANG, 'ja');
  },
  'ブラウザの言語が取れなければ英語'() {
    eq(loadI18n({ language: undefined }).LANG, 'en');
  },

  // ── 2回目以降（保存がある） ──
  '保存した言語があれば、ブラウザの言語より優先する'() {
    eq(loadI18n({ language: 'ja-JP', saved: 'en' }).LANG, 'en');
    eq(loadI18n({ language: 'en-US', saved: 'ja' }).LANG, 'ja');
  },
  '保存値が壊れていたらブラウザの言語で決め直して保存し直す'() {
    const r = loadI18n({ language: 'ja-JP', saved: 'xx' });
    eq(r.LANG, 'ja');
    eq(r.saved(), 'ja');
  },
  'localStorage が使えない環境でもブラウザの言語で表示できる'() {
    // プライベートモード等で getItem / setItem が例外を投げても落ちない
    eq(loadI18n({ language: 'ja-JP', storageBroken: true }).LANG, 'ja');
    eq(loadI18n({ language: 'en-US', storageBroken: true }).LANG, 'en');
  },

  // ── 出し分け ──
  '<html lang> を言語に合わせる（HTML の日英の出し分けは CSS がこれを見る）'() {
    eq(loadI18n({ language: 'ja-JP' }).htmlLang(), 'ja');
    eq(loadI18n({ language: 'en-US' }).htmlLang(), 'en');
  },

  // ── 切り替え ──
  '切り替えると保存してページを読み直す'() {
    const r = loadI18n({ language: 'ja-JP' });
    r.setLang('en');
    eq(r.saved(), 'en', '次からこの言語で開く');
    ok(r.reloaded(), '画面は読み込み時に組み立てるので読み直す');
  },
  '用意していない言語には切り替えない'() {
    const r = loadI18n({ language: 'ja-JP' });
    r.setLang('xx');
    eq(r.saved(), 'ja', '保存は変えない');
    ok(!r.reloaded(), '読み直さない');
  },

  // ── 文言 ──
  'T は今の言語の文言を返し、params を埋める'() {
    const p = { track: 2, line: 3, col: 5, body: 'X' };
    eq(loadI18n({ language: 'ja-JP' }).T('err.at', p), 'トラック2 3行目 5文字目: X');
    eq(loadI18n({ language: 'en-US' }).T('err.at', p), 'Track 2, line 3, col 5: X');
  },
  '表に無いキーはキーそのものを返す（表示が空にならないように）'() {
    eq(loadI18n({ language: 'en-US' }).T('no.such.key'), 'no.such.key');
  },
  '日本語と英語で同じキーを持つ（片方だけ足すと落ちる）'() {
    const { TEXT } = loadI18n({ language: 'ja-JP' });
    const ja = Object.keys(TEXT.ja).sort(), en = Object.keys(TEXT.en).sort();
    eq(ja.filter(k => !en.includes(k)), [], '英語に無いキー');
    eq(en.filter(k => !ja.includes(k)), [], '日本語に無いキー');
  },
};
