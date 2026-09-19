// テスト用の読み込みと検証ヘルパー（依存なし・素のNode）
//
// 方針: 本体のコードは1文字も変えない。
//   mml.js  … ブラウザ用の1ファイル（依存ゼロ・持ち出し用）のまま保つため、
//             module.exports を足したりせず、読み込んで評価し末尾の式で取り出す。
//   js/*.js … DOM前提のクラシックスクリプト。最小のDOMを用意して丸ごと評価する。
//             関数を抜き書きせず実物を動かすので「読み込み時にエラーが出ない」ことも同時に確かめられる。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function loadPlayer() {
  return eval(read('mml.js') + ';MMLPlayer');   // eslint-disable-line no-eval
}

// core.js を動かすための最小DOM。属性は読み書きできればよく、描画はしない。
// language はブラウザの言語（navigator.language）。undefined を渡せば「取れない」環境になる
function makeDom(language) {
  const els = {};
  const el = () => ({
    value: '', textContent: '', innerHTML: '', checked: false, title: '', type: '',
    style: {}, children: [], selectionStart: 0, selectionEnd: 0,
    addEventListener() {}, appendChild(c) { this.children.push(c); },
    createTextNode() {}, focus() {}, setSelectionRange() {},
  });
  return {
    document: {
      getElementById: (id) => (els[id] || (els[id] = el())),
      createElement: () => el(),
      createTextNode: () => ({}),
      addEventListener() {},
      documentElement: { lang: '' },   // js/i18n.js が <html lang> を決める
    },
    localStorage: {
      _d: {},
      getItem(k) { return k in this._d ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
    navigator: { language, clipboard: { writeText: async () => {} } },
    location: { reloaded: false, reload() { this.reloaded = true; } },
  };
}

// core.js を評価して、DOMに依存しない関数と textarea 要素を取り出す。
// 読む順は index.html と同じ: i18n.js（表示言語）→ mml-messages.js（エラー文言）→ core.js。
// opts.language でブラウザの言語を差し替えられる（既定は日本語＝既存のテストは日本語の文言で見る）
function loadCore(MMLPlayer, opts = {}) {
  const dom = makeDom(opts.language ?? 'ja-JP');
  const { document, localStorage, navigator, location } = dom;   // 直下の eval から見える必要がある
  void navigator; void location;
  const src = [read('js/i18n.js'), read('js/mml-messages.js'), read('js/core.js')].join(';' + String.fromCharCode(10));
  const api = eval(src   // eslint-disable-line no-eval
    + ';({ LANG, T, TEXT, stripComments, parseTrackBlocks, trackPos, locateError, mmlMessage, MML_MSG, barCheck, barReport, playStatusText, optimizeMML, ta })');
  return { ...api, localStorage, document };
}

// mml-composer.js を評価する。雰囲気名や生成コメントは表示言語に従うので i18n.js を先に読む。
// harmonize / extendMelody は MMLPlayer を使うので、呼ぶ側で global.MMLPlayer を用意すること
function loadComposer(language = 'ja-JP') {
  const dom = makeDom(language);
  const { document, localStorage, navigator, location } = dom;
  void document; void localStorage; void navigator; void location;
  return eval([read('js/i18n.js'), read('js/mml-composer.js')].join(';' + String.fromCharCode(10)) + ';MMLComposer');   // eslint-disable-line no-eval
}

// i18n.js だけを評価する（言語の決め方と切り替えのテスト用）。
//   language … ブラウザの言語。saved … 保存済みの言語。storageBroken … localStorage が例外を投げる環境
function loadI18n({ language, saved, storageBroken } = {}) {
  const dom = makeDom(language);
  const { document, navigator, location } = dom;
  void navigator;
  if (saved !== undefined) dom.localStorage.setItem('mmlforge8-lang', saved);
  const localStorage = storageBroken
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : dom.localStorage;
  const api = eval(read('js/i18n.js') + ';({ LANG, T, TEXT, setLang, applyLangAttrs })');   // eslint-disable-line no-eval
  return {
    ...api,
    saved: () => dom.localStorage.getItem('mmlforge8-lang'),
    reloaded: () => location.reloaded,
    htmlLang: () => document.documentElement.lang,
  };
}

// ── 検証 ──────────────────────────────────
class Failed extends Error {}
const fail = (msg) => { throw new Failed(msg); };

const ok = (cond, msg) => { if (!cond) fail(msg || '条件が満たされませんでした'); };
const eq = (actual, expected, msg) => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) fail(`${msg || '値が違います'}: 期待 ${b} / 実際 ${a}`);
};
const near = (actual, expected, msg, eps = 1e-9) => {
  if (Math.abs(actual - expected) > eps) fail(`${msg || '値が違います'}: 期待 ${expected} / 実際 ${actual}`);
};
// fn を呼ぶと MMLError が飛ぶこと。mml.js は文言を持たない（言語非依存）ので、
// コード・位置・params で見る。expect に書いた項目だけを突き合わせる
//   例: throwsCode(parse('cde%'), { code: 'BAD_CHAR', pos: 4, params: { char: '%' } })
const throwsCode = (fn, expect, msg) => {
  let e = null;
  try { fn(); } catch (err) { e = err; }
  if (!e) fail(`${msg || ''}: 例外が投げられませんでした（期待: ${JSON.stringify(expect)}）`);
  if (!e.code) fail(`${msg || ''}: MMLError ではありません: ${e.message}`);
  const got = {};
  Object.keys(expect).forEach(k => { got[k] = e[k]; });
  const a = JSON.stringify(got), b = JSON.stringify(expect);
  if (a !== b) fail(`${msg || ''}: エラーが違います\n      期待: ${b}\n      実際: ${a}`);
};

// fn を呼ぶと want を含むメッセージの例外が飛ぶこと。エラー文言は仕様なので全文一致に近い形で見る
const throwsWith = (fn, want, msg) => {
  let e = null;
  try { fn(); } catch (err) { e = err; }
  if (!e) fail(`${msg || ''}: 例外が投げられませんでした（期待: ${want}）`);
  if (!e.message.includes(want)) fail(`${msg || ''}: 文言が違います\n      期待に含む: ${want}\n      実際      : ${e.message}`);
};

module.exports = { ROOT, read, loadPlayer, loadCore, loadComposer, loadI18n, ok, eq, near, throwsCode, throwsWith, Failed };
