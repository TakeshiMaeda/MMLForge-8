// ─────────────────────────────────────────
//  ワークスペース（DAW 風のウインドウ）
//
//  各機能は .win のウインドウ。タイトルバーをドラッグで移動、右下の角で大きさ変更（CSS の resize）、
//  クリックで最前面、タイトルバーのダブルクリックか「_」で最小化（タイトルバーだけ残す）、「×」で閉じる。
//  閉じたウインドウは上部の「ウインドウ」メニューから開き直す。
//  位置・大きさ・状態は localStorage に保存し、次回も同じ配置で開く。
//  「整列」は開いているウインドウを大きさはそのままで重ならないように並べ直し、
//  「初期化」は位置・大きさ・開閉をすべて初期配置に戻す。
//  ドラッグ中はワークスペースの端とほかのウインドウの端に吸着する（Alt を押している間は吸着しない）。
//  画面が狭いとき・低いとき（DESK_NARROW）はウインドウをやめて縦に並べる（CSS 側。ドラッグもしない）。
//  下部のヒントバーには、マウスを載せた部品の title を出す。
//
//  位置の計算（初期配置・画面内に収める・吸着・保存データの読み込み）は DOM に触れない関数にしてあり、
//  test/desk.test.js で確かめる。
// ─────────────────────────────────────────
const DESK_KEY = 'mmlforge8-desk';
const DESK_WINS = ['winEditor', 'winGen', 'winHarm', 'winExt', 'winDrum', 'winKb', 'winAudio', 'winRef'];
const DESK_GAP = 10;      // ウインドウ同士・ワークスペースの端との間隔（初期配置と吸着で共通）
const DESK_SNAP = 10;     // この距離（px）まで近づいたら吸着する
const DESK_BAR = 30;      // 最小化したウインドウの高さ（タイトルバー。CSS の .win-bar と揃える）
const DESK_KEEP = 60;     // 画面外へ出しても、タイトルバーをこの幅だけは掴めるように残す
// この条件に合う画面ではウインドウをやめて縦に並べる（幅が狭い、または横持ちのスマホのように高さが低い）。
// CSS の @media と同じ文字列にしておくこと
const DESK_NARROW = '(max-width: 800px), (max-height: 500px)';

// ── 位置の計算（DOM に触れない） ──────────────────

// 初期配置。ワークスペースの幅 W と高さ H から、各ウインドウの位置・大きさ・状態を決める。
//   左の列: エディタ（上）とリズムパッド（下）
//   右の列: ガチャを開き、伴奏付け・追い足しは最小化して並べる（チャンネルの切り替えはエディタの中）
//   鍵盤・音声→MML・リファレンスは閉じておく（「ウインドウ」メニューから開く）
// 戻り値: { [id]: { x, y, w, h, z, min, closed } }
function deskDefaultLayout(W, H) {
  const g = DESK_GAP;
  const L = Math.max(360, Math.round((W - 3 * g) * 0.6));
  const R = Math.max(260, W - 3 * g - L);
  const rx = g + L + g;
  const edH = Math.max(240, Math.round((H - 3 * g) * 0.58));
  const drY = g + edH + g;
  const genH = 280;
  const genY = g;
  const harmY = genY + genH + g;
  const layout = {
    winEditor: { x: g, y: g, w: L, h: edH },
    winDrum:   { x: g, y: drY, w: L, h: Math.max(200, H - drY - g) },
    winGen:    { x: rx, y: genY, w: R, h: genH },
    winHarm:   { x: rx, y: harmY, w: R, h: 200, min: true },
    winExt:    { x: rx, y: harmY + DESK_BAR + g, w: R, h: 230, min: true },
    winKb:     { x: g + 40, y: g + 40, w: 540, h: 340, closed: true },
    winAudio:  { x: g + 80, y: g + 80, w: 540, h: 260, closed: true },
    winRef:    { x: rx, y: g, w: R, h: Math.max(300, H - 2 * g), closed: true },
  };
  const out = {};
  DESK_WINS.forEach((id, i) => {
    const s = layout[id];
    out[id] = { x: s.x, y: s.y, w: s.w, h: s.h, z: i + 1, min: !!s.min, closed: !!s.closed };
  });
  return out;
}

// ウインドウをワークスペースの中へ戻す。横は DESK_KEEP だけタイトルバーが見えていればよく、
// 縦はタイトルバーが上下にはみ出さないようにする（掴めなくなって行方不明になるのを防ぐ）
function deskClamp(r, W, H) {
  return {
    ...r,
    x: Math.min(Math.max(r.x, DESK_KEEP - r.w), Math.max(0, W - DESK_KEEP)),
    y: Math.min(Math.max(r.y, 0), Math.max(0, H - DESK_BAR)),
  };
}

// 移動中のウインドウ r を吸着させる。候補は
//   ワークスペースの端（間隔 DESK_GAP をあける）
//   ほかのウインドウと左端・右端（上端・下端）を揃える位置
//   ほかのウインドウの隣（間隔 DESK_GAP をあける。反対の軸で重なっているときだけ）
// のうち、距離 d 以内で一番近いもの。無ければ動かさない
function deskSnap(r, others, W, H, d = DESK_SNAP) {
  const g = DESK_GAP;
  const overlap = (a0, a1, b0, b1) => a0 < b1 + g && b0 < a1 + g;
  const best = (cur, cands) => {
    let v = cur, dist = d + 1;
    cands.forEach(c => { const k = Math.abs(c - cur); if (k <= d && k < dist) { dist = k; v = c; } });
    return v;
  };
  const xs = [g, W - g - r.w];
  const ys = [g];
  if (r.h <= H - 2 * g) ys.push(H - g - r.h);
  others.forEach(o => {
    xs.push(o.x, o.x + o.w - r.w);
    ys.push(o.y, o.y + o.h - r.h);
    if (overlap(r.y, r.y + r.h, o.y, o.y + o.h)) xs.push(o.x + o.w + g, o.x - g - r.w);
    if (overlap(r.x, r.x + r.w, o.x, o.x + o.w)) ys.push(o.y + o.h + g, o.y - g - r.h);
  });
  return { ...r, x: best(r.x, xs), y: best(r.y, ys) };
}

// 整列: 開いているウインドウを、大きさはそのままで重ならないように並べ直す。
//   今の位置の順（上から。40px 以内の差は同じ段とみなして左から）に、左上から詰めていく。
//   置き場所は「スカイライン」（横位置ごとに、そこまで埋まった下端）で決め、幅が入る範囲で一番上を選ぶ。
//   背の低いウインドウの下に空きができれば、後のウインドウがそこへ入る。
//   閉じているウインドウは動かさない。大きさ・開閉・最小化は変えない（画面より広いものだけ幅を縮める）。
//   最小化しているウインドウは、見えている高さ（タイトルバー）で並べる
function deskArrange(state, W) {
  const g = DESK_GAP;
  const right = W - g;
  const out = {};
  Object.keys(state).forEach(id => { out[id] = { ...state[id] }; });
  const row = (id) => Math.round(state[id].y / 40);
  const open = Object.keys(state).filter(id => !state[id].closed)
    .sort((a, b) => (row(a) - row(b)) || (state[a].x - state[b].x));

  let sky = [{ x: g, w: right - g, y: g }];
  // [x, x+w) の下端を y にする（はみ出した分は画面の右端で切る）
  const fill = (x, w, y) => {
    const xe = Math.min(x + w, right);
    const next = [];
    sky.forEach(t => {
      const te = t.x + t.w;
      if (te <= x || t.x >= xe) { next.push(t); return; }
      if (t.x < x) next.push({ x: t.x, w: x - t.x, y: t.y });
      if (te > xe) next.push({ x: xe, w: te - xe, y: t.y });
    });
    next.push({ x, w: xe - x, y });
    sky = next.sort((a, b) => a.x - b.x);
  };
  open.forEach(id => {
    const s = out[id];
    s.w = Math.min(s.w, right - g);
    const h = s.min ? DESK_BAR : s.h;
    let best = null;
    sky.forEach(seg => {
      const x = seg.x;
      if (x + s.w > right) return;
      const y = Math.max(...sky.filter(t => t.x < x + s.w && t.x + t.w > x).map(t => t.y));
      if (!best || y < best.y || (y === best.y && x < best.x)) best = { x, y };
    });
    s.x = best.x;
    s.y = best.y;
    fill(s.x, s.w + g, s.y + h + g);   // 右と下に間隔をあけて埋める
  });
  return out;
}

// 保存データを読む。JSON として壊れていれば null。知らない id や、数値でない・小さすぎる値のウインドウは捨てる
function deskParse(json) {
  let o;
  try { o = JSON.parse(json); } catch (e) { return null; }
  if (!o || typeof o !== 'object') return null;
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const out = {};
  DESK_WINS.forEach(id => {
    const s = o[id];
    if (!s || typeof s !== 'object') return;
    const x = num(s.x), y = num(s.y), w = num(s.w), h = num(s.h);
    if (x === null || y === null || w === null || h === null || w < 100 || h < 40) return;
    out[id] = { x, y, w, h, z: num(s.z) ?? 0, min: !!s.min, closed: !!s.closed };
  });
  return out;
}

// ウインドウが開いていて中身が見えているか（閉じていない・最小化していない）
function deskIsOpen(el) {
  return !!el && !!el.classList && !el.classList.contains('closed') && !el.classList.contains('min');
}

// 一番手前のウインドウか（クリックで手前に来る。markFront が front を付ける）。
// ミニ鍵盤の PC キー入力は、鍵盤のウインドウが見えていて手前にあるときだけ受け付ける
function deskIsFront(el) {
  return !!el && !!el.classList && el.classList.contains('front');
}

// ── 画面への組み込み ──────────────────────

function deskInit() {
  const desk = document.getElementById('desk');
  const wins = {};
  DESK_WINS.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.classList) wins[id] = el;
  });
  if (!Object.keys(wins).length) return;   // テスト用の最小 DOM など、ウインドウが無いときは何もしない

  const narrow = () => window.matchMedia(DESK_NARROW).matches;
  const size = () => ({ W: desk.clientWidth, H: desk.clientHeight });
  // 初期配置の基準の大きさ。狭い画面（縦に並べる表示）で決めると、あとで広い画面で開いたときに
  // 詰まった配置になるので、そのときは標準的な画面の大きさで決めておく
  const layoutSize = () => (narrow() ? { W: 1280, H: 720 } : size());
  const ids = () => DESK_WINS.filter(id => wins[id]);

  // 状態: 保存があればそれ、無いウインドウは初期配置
  let state = {};
  {
    const { W, H } = layoutSize();
    const def = deskDefaultLayout(W, H);
    let saved = null;
    try { saved = deskParse(localStorage.getItem(DESK_KEY)); } catch (e) { saved = null; }
    DESK_WINS.forEach(id => {
      const s = { ...def[id], ...((saved && saved[id]) || {}) };
      state[id] = { ...s, ...deskClamp(s, W, H) };   // 前回より小さい画面で開いても見失わない
    });
  }
  const save = () => {
    try { localStorage.setItem(DESK_KEY, JSON.stringify(state)); } catch (e) { /* 保存できなくても使える */ }
  };
  const apply = (id) => {
    const el = wins[id], s = state[id];
    el.style.left = s.x + 'px';
    el.style.top = s.y + 'px';
    el.style.width = s.w + 'px';
    el.style.height = s.h + 'px';
    el.style.zIndex = s.z;
    el.classList.toggle('min', s.min);
    el.classList.toggle('closed', s.closed);
  };
  // 一番手前の開いているウインドウのタイトルバーを強調する
  const markFront = () => {
    let top = null;
    ids().forEach(id => { if (!state[id].closed && (top === null || state[id].z > state[top].z)) top = id; });
    ids().forEach(id => wins[id].classList.toggle('front', id === top));
  };
  const front = (id) => {
    const max = Math.max(...ids().map(k => state[k].z));
    if (state[id].z !== max) {
      state[id].z = max + 1;
      wins[id].style.zIndex = state[id].z;
      save();
    }
    markFront();
  };

  // ── 「ウインドウ」メニュー（開閉の切り替え） ──
  const menuBtn = document.getElementById('winMenuBtn');
  const menu = document.getElementById('winMenu');
  const renderMenu = () => {
    menu.innerHTML = '';
    ids().forEach(id => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'menu-item' + (state[id].closed ? '' : ' on');
      item.appendChild(wins[id].querySelector('.win-title').cloneNode(true));   // 日英の span ごと写す
      item.addEventListener('click', () => {
        const s = state[id];
        if (s.closed) {
          s.closed = false;
          s.min = false;
          const { W, H } = size();
          Object.assign(s, deskClamp(s, W, H));
          apply(id);
          front(id);
        } else {
          s.closed = true;
          apply(id);
          markFront();
        }
        save();
        renderMenu();
      });
      menu.appendChild(item);
    });
  };
  // メニューはボタンの右端に揃えて左へ開く。狭い画面でボタンが左寄りにあると画面の左外へ出るので、
  // 開いたあとに測って、はみ出した分だけ内側へずらす
  const placeMenu = () => {
    menu.style.left = '';
    menu.style.right = '';
    const m = 8;
    const vw = document.documentElement.clientWidth;
    const r = menu.getBoundingClientRect();
    const wrap = menu.parentElement.getBoundingClientRect();
    if (r.left < m) {
      menu.style.right = 'auto';
      menu.style.left = (m - wrap.left) + 'px';
    } else if (r.right > vw - m) {
      menu.style.right = (wrap.right - (vw - m)) + 'px';
    }
  };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    if (!menu.hidden) { renderMenu(); placeMenu(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) menu.hidden = true;
  });

  // ── タイトルバーのボタン・ドラッグ ──
  const mkBtn = (label, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'win-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  };
  const toggleMin = (id) => { state[id].min = !state[id].min; apply(id); save(); };

  ids().forEach(id => {
    const el = wins[id];
    const bar = el.querySelector('.win-bar');
    const btns = document.createElement('span');
    btns.className = 'win-btns';
    if (el.querySelector('.win-help')) btns.appendChild(mkBtn('?', T('desk.help'), () => el.classList.toggle('show-help')));
    btns.appendChild(mkBtn('_', T('desk.min'), () => toggleMin(id)));
    btns.appendChild(mkBtn('×', T('desk.close'), () => {
      state[id].closed = true;
      apply(id);
      markFront();
      save();
      if (!menu.hidden) renderMenu();
    }));
    bar.appendChild(btns);

    el.addEventListener('pointerdown', () => front(id));
    bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleMin(id); });
    bar.addEventListener('pointerdown', (e) => {
      if (narrow() || e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const s = state[id];
      const sx = e.clientX, sy = e.clientY, ox = s.x, oy = s.y;
      const w = el.offsetWidth, h = el.offsetHeight;
      const others = ids().filter(k => k !== id && !state[k].closed)
        .map(k => ({ x: state[k].x, y: state[k].y, w: wins[k].offsetWidth, h: wins[k].offsetHeight }));
      bar.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const move = (ev) => {
        const { W, H } = size();
        let r = { x: ox + ev.clientX - sx, y: oy + ev.clientY - sy, w, h };
        if (!ev.altKey) r = deskSnap(r, others, W, H);
        r = deskClamp(r, W, H);
        s.x = Math.round(r.x);
        s.y = Math.round(r.y);
        el.style.left = s.x + 'px';
        el.style.top = s.y + 'px';
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        save();
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
  });

  // ── 大きさの変更（CSS の resize）を覚える ──
  let saveTimer = 0;
  const ro = new ResizeObserver(entries => {
    if (narrow()) return;
    entries.forEach(en => {
      const s = state[en.target.id];
      if (!s || s.min || s.closed) return;   // 最小化中の高さは覚えない（元に戻すときに使う）
      s.w = en.target.offsetWidth;
      s.h = en.target.offsetHeight;
    });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
  });

  // ── 整列（開いているウインドウを重ならないように並べ直す） ──
  document.getElementById('deskArrange').addEventListener('click', () => {
    if (narrow()) return;   // 縦に並べる表示では位置を使わない
    state = deskArrange(state, size().W);
    ids().forEach(apply);
    markFront();
    save();
  });

  // ── 初期化（位置・大きさ・開閉をすべて初期配置に戻す） ──
  document.getElementById('deskReset').addEventListener('click', () => {
    const { W, H } = layoutSize();
    state = deskDefaultLayout(W, H);
    ids().forEach(apply);
    markFront();
    save();
    if (!menu.hidden) renderMenu();
  });

  // ブラウザの大きさが変わったら、はみ出したウインドウを戻す
  window.addEventListener('resize', () => {
    if (narrow()) return;
    const { W, H } = size();
    ids().forEach(id => {
      Object.assign(state[id], deskClamp(state[id], W, H));
      apply(id);
    });
    save();
  });

  // ── ヒントバー: マウスを載せた部品の説明（title）を出す ──
  const hint = document.getElementById('hint');
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest && e.target.closest('[title]');
    hint.textContent = t ? t.title : '';
  });

  ids().forEach(apply);
  ids().forEach(id => ro.observe(wins[id]));
  markFront();
}
deskInit();
