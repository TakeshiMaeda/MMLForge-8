// songs/ に置いた曲が壊れていないことの確認。
// エンジンや記法をいじったときに、既存曲の尺や音数が変わってしまったら気づけるようにする。
// 「音が変わっていない」まではテストできない（それは耳の仕事）が、
// 尺・小節・発音数のような数えられるものは押さえておける。
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, loadPlayer, loadCore, ok, eq, near } = require('./helper');

const P = loadPlayer();
global.MMLPlayer = P;
const { barCheck, ta } = loadCore(P);

const song = (name) => fs.readFileSync(path.join(ROOT, 'songs', name), 'utf8');
const check = (name, beats) => { ta.value = song(name); return barCheck(beats); };

module.exports = {

  'songs/ の曲はすべてパースできる'() {
    const files = fs.readdirSync(path.join(ROOT, 'songs')).filter(f => f.endsWith('.mml'));
    ok(files.length > 0, 'songs/ に曲がある');
    for (const f of files) {
      ta.value = song(f);
      // barCheck は内部で全トラックを parse するので、通れば記法エラーは無い
      const r = barCheck(4);
      ok(r.rows.length > 0, `${f}: トラックが取れる`);
    }
  },

  'elven-morning: 6トラック・152小節・全トラック同尺'() {
    const r = check('elven-morning.mml', 3);   // 6/8 = 4分3つ
    eq(r.rows.length, 6, 'トラック数');
    ok(r.allSame, '全トラック同尺');
    r.rows.forEach(x => near(x.bars, 152, `ch${x.ch} の小節数`, 1e-6));
    r.rows.forEach(x => eq(x.tempo, 175, `ch${x.ch} のテンポ`));
  },

  'elven-morning: エコー(ch6)はハープ(ch3)を32分ずらした複製'() {
    const blocks = [];
    let cur = null;
    const { stripComments } = loadCore(P);
    stripComments(song('elven-morning.mml')).split('\n').forEach(line => {
      const t = line.trim();
      if (!t) return;
      if (/^[ \t]/.test(line) && cur) cur.mml += ' ' + t; else { cur = { mml: t }; blocks.push(cur); }
    });
    const harp = P.parse(blocks[2].mml).notes;
    const echo = P.parse(blocks[5].mml).notes;
    eq(echo.length, harp.length, '音数は同じ');

    const shift = (60 / 175) * 0.125;   // 32分音符 = 0.125拍
    let badTime = 0, badPitch = 0, shorter = 0;
    harp.forEach((h, i) => {
      if (Math.abs((echo[i].time - h.time) - shift) > 1e-9) badTime++;
      if (echo[i].midi !== h.midi) badPitch++;
      if (Math.abs(echo[i].dur - h.dur) > 1e-9) shorter++;
    });
    eq(badTime, 0, 'すべての音が32分だけ遅れている');
    eq(badPitch, 0, 'すべての音高が一致する');
    eq(shorter, 2, '尺合わせで詰めた音は前奏と本体の末尾の2つだけ');
  },

  'elven-morning: 前奏の後にループ開始点がある'() {
    ta.value = song('elven-morning.mml');
    const { stripComments } = loadCore(P);
    const blocks = [];
    let cur = null;
    stripComments(ta.value).split('\n').forEach(line => {
      const t = line.trim();
      if (!t) return;
      if (/^[ \t]/.test(line) && cur) cur.mml += ' ' + t; else { cur = { mml: t }; blocks.push(cur); }
    });
    const bar = 3 * 60 / 175;
    blocks.forEach((b, i) => {
      const p = P.parse(b.mml);
      ok(p.loopStart !== null, `ch${i + 1} に無限ループがある`);
      near(p.loopStart / bar, 8, `ch${i + 1} のループ開始は8小節目`, 1e-6);
    });
  },

  'slow-blues-in-a: 6トラック・12小節・全トラック同尺'() {
    const r = check('slow-blues-in-a.mml', 4);
    eq(r.rows.length, 6, 'トラック数');
    ok(r.allSame, '全トラック同尺');
    r.rows.forEach(x => near(x.bars, 12, `ch${x.ch} の小節数`, 1e-6));
    r.rows.forEach(x => eq(x.tempo, 60, `ch${x.ch} のテンポ`));
    r.rows.forEach(x => eq(x.strays, 0, `ch${x.ch} は全部小節線に乗る`));
  },
};
