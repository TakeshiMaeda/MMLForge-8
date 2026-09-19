// index.html の日英の出し分けと、JS との結び付き（id）。
//
// 日英は <span class="ja">…</span><span class="en">…</span> の対で書き、CSS が <html lang> を見て出し分ける。
// title / placeholder / <option> の中身は span が使えないので、data-title-en / data-placeholder-en / data-en に英語を書く。
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, read, eq, ok } = require('./helper');
const { englishViewProblems, jaEnPairProblems, htmlIds, jsIdRefs } = require('./scan');

const html = read('index.html');
const jsFiles = () => fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);

module.exports = {

  // ── 日英の出し分け ──
  '英語表示で日本語が見えない（.ja は隠れ、title / placeholder / 選択肢には英語がある）'() {
    eq(englishViewProblems(html), []);
  },
  '.ja の直後には同じ要素の .en がある（片方だけの訳を見落とさないため）'() {
    eq(jaEnPairProblems(html), []);
  },

  // ── 検査そのものが効いていること（壊れた HTML を渡すと見つける） ──
  '検査: 隠れていない日本語を見つける'() {
    ok(englishViewProblems('<p>日本語</p>').length === 1);
    eq(englishViewProblems('<p class="ja">日本語</p><p class="en">English</p>'), []);
  },
  '検査: 英語の無い title / placeholder / 選択肢を見つける'() {
    ok(englishViewProblems('<button title="説明">x</button>').length === 1);
    eq(englishViewProblems('<button title="説明" data-title-en="Help">x</button>'), []);
    ok(englishViewProblems('<input placeholder="自動">').length === 1);
    ok(englishViewProblems('<select><option>自動</option></select>').length === 1);
    eq(englishViewProblems('<select><option data-en="Auto">自動</option></select>'), []);
  },
  '検査: lang 属性でわざと日本語にした箇所は見逃す（切り替えボタンの「日本語」など）'() {
    eq(englishViewProblems('<span class="en" lang="ja">日本語</span>'), []);
  },
  '検査: 対になっていない .ja / .en を見つける'() {
    ok(jaEnPairProblems('<span class="ja">a</span>').length === 1, '.en が無い');
    ok(jaEnPairProblems('<span class="en">a</span>').length === 1, '.ja が無い');
    ok(jaEnPairProblems('<span class="ja">a</span><p class="en">b</p>').length === 1, '要素名が違う');
    eq(jaEnPairProblems('<span class="ja">a</span> <span class="en">b</span>'), [], '空白を挟むのはよい');
  },

  // ── JS との結び付き ──
  'index.html の id は重複しない（日英の対を作るときに id ごと複製していないこと）'() {
    const seen = new Set(), dup = [];
    htmlIds(html).forEach(id => { if (seen.has(id)) dup.push(id); seen.add(id); });
    eq(dup, []);
  },
  'JS が参照する id はすべて index.html にある'() {
    const ids = new Set(htmlIds(html));
    const missing = [];
    jsFiles().forEach(f => jsIdRefs(read(f)).forEach(id => { if (!ids.has(id)) missing.push(`${f}: ${id}`); }));
    eq(missing, []);
  },
  'i18n.js は <head> で読み、ほかの JS は本文の後で読む'() {
    const head = html.slice(0, html.indexOf('</head>'));
    ok(head.includes('<script src="js/i18n.js"></script>'), '描画前に <html lang> を決めるため');
    ok(!head.includes('js/core.js'), 'core.js は本文の要素を使うので本文の後');
  },
};
