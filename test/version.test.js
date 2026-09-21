// 版の表記。アプリ（js/core.js の APP_VERSION）とエンジン（mml.js の MMLPlayer.version）は別々に持つ。
// mml.js は1ファイルで持ち出されるので、冒頭コメントだけ見ても版が分かるようにしてある。
// 書き方は1行なら「MMLForge-8 v1.0.0 (mml.js v1.0.0)」、2行なら上下に並べる
'use strict';
const { read, loadPlayer, loadCore, eq, ok } = require('./helper');

const P = loadPlayer();
const core = loadCore(P);
const SEMVER = /^\d+\.\d+\.\d+$/;

module.exports = {

  '版は x.y.z の形（v は付けない）'() {
    ok(SEMVER.test(P.version), `mml.js: ${P.version}`);
    ok(SEMVER.test(core.APP_VERSION), `アプリ: ${core.APP_VERSION}`);
  },

  'mml.js の冒頭コメントの版と MMLPlayer.version が同じ'() {
    const head = read('mml.js').split('\n').slice(0, 5).join('\n');
    const m = head.match(/^\/\/ mml\.js v(\S+)$/m);
    ok(m, '冒頭5行に「// mml.js v…」がありません');
    eq(m[1], P.version);
  },

  '画面の1行表記は mml.js を括弧に入れる'() {
    eq(core.versionText(), `MMLForge-8 v${core.APP_VERSION} (mml.js v${P.version})`);
  },

  'README の日英に2行表記があり、版が本体と同じ'() {
    const two = `MMLForge-8 v${core.APP_VERSION}<br>\nmml.js v${P.version}`;
    for (const f of ['README.md', 'README.en.md']) {
      ok(read(f).replace(/\r\n/g, '\n').includes(two), `${f} に2行表記がないか、版が違います`);
    }
  },
};
