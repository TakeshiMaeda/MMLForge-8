// ワークスペースのウインドウ（js/desk.js）の位置の計算と、index.html のウインドウの組み立て。
// ドラッグの手触りや見た目はブラウザで人が確かめる。ここで見るのは数えられるものだけ
'use strict';
const { read, loadDesk, eq, ok } = require('./helper');
const { htmlTokens } = require('./scan');

const D = loadDesk();
const W = 1280, H = 720;

// 2つの長方形が重なっているか（接しているだけは重なりとしない）
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// 画面に出ている形（最小化はタイトルバーだけの高さ）
const shown = (s) => ({ x: s.x, y: s.y, w: s.w, h: s.min ? D.DESK_BAR : s.h });

// index.html の .win を拾い、中にタイトルバー・タイトル・中身があるかを見る
function htmlWindows() {
  const wins = {};
  let cur = null, depth = 0;
  htmlTokens(read('index.html')).forEach(t => {
    if (t.type === 'start' && t.name === 'section' && / win( |$)|^win( |$)/.test(t.attrs.class || '')) {
      cur = { id: t.attrs.id, classes: new Set() };
      wins[cur.id] = cur;
      depth = 0;
      return;
    }
    if (!cur) return;
    if (t.type === 'start') {
      depth++;
      (t.attrs.class || '').split(/\s+/).forEach(c => c && cur.classes.add(c));
    } else if (t.type === 'end') {
      if (t.name === 'section' && depth === 0) cur = null; else depth--;
    }
  });
  return wins;
}

module.exports = {

  // ── index.html との対応 ──
  'desk.js のウインドウ一覧と index.html の .win が一致する'() {
    eq(Object.keys(htmlWindows()).sort(), [...D.DESK_WINS].sort());
  },
  'チャンネルの切り替えはエディタのウインドウの中にある（専用のウインドウは無い）'() {
    let inWin = null, where = null;
    htmlTokens(read('index.html')).forEach(t => {
      if (t.type === 'start' && t.name === 'section' && (' ' + (t.attrs.class || '') + ' ').includes(' win ')) inWin = t.attrs.id;
      if (t.type === 'start' && t.attrs.id === 'chToggles') where = inWin;
    });
    eq(where, 'winEditor');
    ok(!D.DESK_WINS.includes('winCh'), 'チャンネルのウインドウは無い');
  },
  'どのウインドウにもタイトルバー・タイトル・中身がある'() {
    const bad = Object.values(htmlWindows())
      .filter(w => !['win-bar', 'win-title', 'win-body'].every(c => w.classes.has(c)))
      .map(w => w.id);
    eq(bad, []);
  },

  // ── 初期配置 ──
  '初期配置は全ウインドウの位置と大きさを持つ'() {
    const L = D.deskDefaultLayout(W, H);
    eq(Object.keys(L).sort(), [...D.DESK_WINS].sort());
    D.DESK_WINS.forEach(id => ['x', 'y', 'w', 'h', 'z'].forEach(k => ok(Number.isFinite(L[id][k]), `${id}.${k}`)));
  },
  '初期配置: エディタとリズムパッドとガチャを開き、伴奏付けと追い足しは最小化、残りは閉じる'() {
    const L = D.deskDefaultLayout(W, H);
    const pick = (f) => D.DESK_WINS.filter(id => f(L[id]));
    eq(pick(s => !s.closed && !s.min), ['winEditor', 'winGen', 'winDrum']);
    eq(pick(s => s.min), ['winHarm', 'winExt']);
    eq(pick(s => s.closed), ['winKb', 'winAudio', 'winRef']);
  },
  '初期配置: 見えているウインドウは画面に収まり、互いに重ならない'() {
    const L = D.deskDefaultLayout(W, H);
    const vis = D.DESK_WINS.filter(id => !L[id].closed);
    vis.forEach(id => {
      const r = shown(L[id]);
      ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `${id} が画面外: ${JSON.stringify(r)}`);
    });
    for (let i = 0; i < vis.length; i++) {
      for (let j = i + 1; j < vis.length; j++) {
        ok(!overlaps(shown(L[vis[i]]), shown(L[vis[j]])), `${vis[i]} と ${vis[j]} が重なる`);
      }
    }
  },
  '初期配置: エディタが一番大きい'() {
    const L = D.deskDefaultLayout(W, H);
    const area = (id) => L[id].w * L[id].h;
    D.DESK_WINS.filter(id => id !== 'winEditor' && !L[id].closed && !L[id].min)
      .forEach(id => ok(area('winEditor') > area(id), `${id} のほうが大きい`));
  },
  '初期配置: 小さい画面でもエディタとリズムパッドは最低限の大きさを保つ'() {
    const L = D.deskDefaultLayout(820, 480);
    ok(L.winEditor.h >= 240 && L.winEditor.w >= 360, JSON.stringify(L.winEditor));
    ok(L.winDrum.h >= 200, JSON.stringify(L.winDrum));
  },

  // ── 画面内に収める ──
  '画面外へ出たウインドウは、タイトルバーを掴める位置まで戻す'() {
    const r = { x: 0, y: 0, w: 400, h: 300 };
    eq(D.deskClamp({ ...r, x: 5000 }, W, H).x, W - D.DESK_KEEP, '右へ出すぎ');
    eq(D.deskClamp({ ...r, x: -5000 }, W, H).x, D.DESK_KEEP - 400, '左へ出すぎ（右端の60pxは見える）');
    eq(D.deskClamp({ ...r, y: -50 }, W, H).y, 0, '上へは出さない（タイトルバーが隠れる）');
    eq(D.deskClamp({ ...r, y: 5000 }, W, H).y, H - D.DESK_BAR, '下へ出すぎ（タイトルバーは見える）');
    eq(D.deskClamp({ ...r, x: 100, y: 100 }, W, H), { ...r, x: 100, y: 100 }, '画面内ならそのまま');
  },

  // ── 吸着 ──
  '画面の端に近づけると、間隔をあけて端に揃う'() {
    const r = { x: 14, y: 17, w: 300, h: 200 };
    const s = D.deskSnap(r, [], W, H);
    eq([s.x, s.y], [D.DESK_GAP, D.DESK_GAP]);
    const t = D.deskSnap({ ...r, x: W - 300 - 13 }, [], W, H);
    eq(t.x, W - 300 - D.DESK_GAP, '右端');
  },
  '隣のウインドウに近づけると、間隔をあけて隣に並ぶ（縦に重なっているとき）'() {
    const o = { x: 100, y: 100, w: 200, h: 200 };
    const s = D.deskSnap({ x: 313, y: 150, w: 150, h: 100 }, [o], W, H);
    eq(s.x, 100 + 200 + D.DESK_GAP);
  },
  '縦に離れたウインドウの隣には吸着しない（揃える位置には吸着する）'() {
    const o = { x: 100, y: 100, w: 200, h: 100 };
    eq(D.deskSnap({ x: 313, y: 500, w: 150, h: 100 }, [o], W, H).x, 313, '隣には付かない');
    eq(D.deskSnap({ x: 104, y: 500, w: 150, h: 100 }, [o], W, H).x, 100, '左端は揃う');
  },
  '遠ければ動かさない'() {
    const o = { x: 100, y: 100, w: 200, h: 200 };
    const r = { x: 340, y: 150, w: 150, h: 100 };
    eq(D.deskSnap(r, [o], W, H), r);
  },

  // ── 整列（開いているウインドウを、大きさはそのままで重ならないように並べ直す） ──
  '整列: 開いているウインドウは重ならず、画面の幅に収まる'() {
    // 決まった乱数で、ばらばらに散らかした配置を何通りも試す
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 50; n++) {
      const st = {};
      D.DESK_WINS.forEach((id, i) => {
        st[id] = { x: Math.round(rnd() * 900), y: Math.round(rnd() * 500), w: 220 + Math.round(rnd() * 500),
          h: 60 + Math.round(rnd() * 400), z: i + 1, min: rnd() < 0.2, closed: rnd() < 0.3 };
      });
      const A = D.deskArrange(st, W);
      const open = D.DESK_WINS.filter(id => !A[id].closed);
      open.forEach(id => {
        const r = shown(A[id]);
        ok(r.x >= D.DESK_GAP && r.x + r.w <= W - D.DESK_GAP && r.y >= D.DESK_GAP, `${n}: ${id} が画面の幅からはみ出す ${JSON.stringify(r)}`);
      });
      for (let i = 0; i < open.length; i++) {
        for (let j = i + 1; j < open.length; j++) {
          ok(!overlaps(shown(A[open[i]]), shown(A[open[j]])), `${n}: ${open[i]} と ${open[j]} が重なる`);
        }
      }
    }
  },
  '整列: 大きさ・開閉・最小化は変えず、閉じているウインドウは動かさない'() {
    const st = D.deskDefaultLayout(W, H);
    st.winKb = { ...st.winKb, closed: false, x: 700, y: 300 };   // 鍵盤を開いて散らかす
    const A = D.deskArrange(st, W);
    D.DESK_WINS.forEach(id => {
      eq([A[id].w, A[id].h, A[id].min, A[id].closed], [st[id].w, st[id].h, st[id].min, st[id].closed], id);
      if (st[id].closed) eq([A[id].x, A[id].y], [st[id].x, st[id].y], `${id} は閉じているので動かさない`);
    });
  },
  '整列: 一番左上にあったウインドウが左上に来る（元の並びの順に詰める）'() {
    const st = D.deskDefaultLayout(W, H);
    st.winGen = { ...st.winGen, x: 5, y: 3 };   // ガチャを一番左上に
    const A = D.deskArrange(st, W);
    eq([A.winGen.x, A.winGen.y], [D.DESK_GAP, D.DESK_GAP]);
  },
  '整列: 画面より幅の広いウインドウは画面の幅に収める'() {
    const st = D.deskDefaultLayout(W, H);
    st.winEditor = { ...st.winEditor, w: 5000 };
    eq(D.deskArrange(st, W).winEditor.w, W - 2 * D.DESK_GAP);
  },

  // ── 保存データ ──
  '保存データが壊れていたら使わない'() {
    eq(D.deskParse('{壊れた'), null);
    eq(D.deskParse('null'), null);
    eq(D.deskParse('123'), null);
  },
  '保存データは知らない id と不正な値を捨て、正しいものだけ使う'() {
    const json = JSON.stringify({
      winEditor: { x: 1, y: 2, w: 300, h: 200, z: 5, min: true },
      winDrum: { x: 'a', y: 2, w: 300, h: 200 },
      winCh: { x: 1, y: 2, w: 10, h: 200 },
      winNope: { x: 1, y: 2, w: 300, h: 200 },
    });
    eq(D.deskParse(json), { winEditor: { x: 1, y: 2, w: 300, h: 200, z: 5, min: true, closed: false } });
  },

  // ── 開いているか（ミニ鍵盤の PC キー入力に使う） ──
  '閉じている・最小化しているウインドウは開いていない扱い'() {
    const el = (...cls) => ({ classList: { contains: (c) => cls.includes(c) } });
    ok(D.deskIsOpen(el()), '開いている');
    ok(!D.deskIsOpen(el('closed')), '閉じている');
    ok(!D.deskIsOpen(el('min')), '最小化');
    ok(!D.deskIsOpen(null), '無い');
  },
};
