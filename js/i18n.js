// ─────────────────────────────────────────
//  表示言語（日本語 / 英語）
//
//  言語の決め方:
//    保存した言語があればそれを使う。無ければブラウザの言語（navigator.language）が
//    日本語なら日本語、それ以外は英語にして、その結果を保存する（次からは保存した言語）。
//    切り替えボタンで変えたら、それを保存してページを読み直す（画面は読み込み時に組み立てるため）。
//
//  出し分け:
//    HTML … 日英を両方書き、<span class="ja"> / <span class="en"> を CSS で出し分ける。
//           CSS は <html lang> を見るので、このファイルは <head> で読み、描画より前に lang を決める
//    JS   … 画面に出す文字列は T('キー', params) で取る。文言は下の TEXT が持つ
//           （関数名が t でないのは、既存コードで t が時刻などのローカル変数に使われているため）
//    mml.js のエラー文言は js/mml-messages.js（mml.js 自体は文言を持たない）
// ─────────────────────────────────────────
const LANGS = ['ja', 'en'];
const LANG_KEY = 'mmlforge8-lang';

const LANG = (() => {
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch (e) { /* プライベートモード等で読めない */ }
  if (LANGS.includes(saved)) return saved;
  const l = String(navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
  try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* 保存できなくても表示はできる */ }
  return l;
})();
document.documentElement.lang = LANG;

// 言語を切り替える。保存して読み直す（テキストエリアの内容は自動保存済みなので消えない）
function setLang(l) {
  if (!LANGS.includes(l)) return;
  try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* 保存できなければ次回は元の言語に戻る */ }
  location.reload();
}

// 画面に出す文字列。値は文字列か、params を受けて文字列を返す関数。
// ja と en は同じキーを持つこと（test/i18n.test.js が見張る）
const TEXT = {
  ja: {
    'err.at':    p => `トラック${p.track} ${p.line}行目 ${p.col}文字目: ${p.body}`,
    'err.track': p => `トラック${p.track}: ${p.body}`,
  },
  en: {
    'err.at':    p => `Track ${p.track}, line ${p.line}, col ${p.col}: ${p.body}`,
    'err.track': p => `Track ${p.track}: ${p.body}`,
  },
};

// 今の言語の文言を取る。今の言語に無ければ日本語、それも無ければキーそのもの（表示が空にならないように）
function T(key, params = {}) {
  const v = TEXT[LANG][key] ?? TEXT.ja[key];
  if (v === undefined) return key;
  return typeof v === 'function' ? v(params) : v;
}
