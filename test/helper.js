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

// core.js を動かすための最小DOM。属性は読み書きできればよく、描画はしない
function makeDom() {
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
    },
    localStorage: {
      _d: {},
      getItem(k) { return k in this._d ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
    navigator: { clipboard: { writeText: async () => {} } },
  };
}

// core.js を評価して、DOMに依存しない関数と textarea 要素を取り出す
function loadCore(MMLPlayer) {
  const dom = makeDom();
  const { document, localStorage, navigator } = dom;   // 直下の eval から見える必要がある
  void navigator;
  const api = eval(read('js/core.js')                  // eslint-disable-line no-eval
    + ';({ stripComments, parseTrackBlocks, barCheck, optimizeMML, ta })');
  return { ...api, localStorage, document };
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
// fn を呼ぶと want を含むメッセージの例外が飛ぶこと。エラー文言は仕様なので全文一致に近い形で見る
const throwsWith = (fn, want, msg) => {
  let e = null;
  try { fn(); } catch (err) { e = err; }
  if (!e) fail(`${msg || ''}: 例外が投げられませんでした（期待: ${want}）`);
  if (!e.message.includes(want)) fail(`${msg || ''}: 文言が違います\n      期待に含む: ${want}\n      実際      : ${e.message}`);
};

module.exports = { ROOT, read, loadPlayer, loadCore, ok, eq, near, throwsWith, Failed };
