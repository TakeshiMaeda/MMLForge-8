// ソースを静的に調べるための小道具（依存なし）。
// 画面用の JS に日本語の文字列が残っていないか、T('キー') の使い方が文言表と揃っているかを見るのに使う。
'use strict';

// コメントを空白に置き換える（行構造は保つので行番号がずれない）。
// 文字列・テンプレートリテラルの中の // や /* はコメント扱いしない
function stripJsComments(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { out += s[i] === '\n' ? '\n' : ' '; i++; }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') { out += s[i]; i++; }
        out += s[i];
        i++;
      }
      out += q;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// 文字列リテラル（'…' "…" `…`）を行番号つきで拾う。コメントの中は拾わない。
// 入れ子のテンプレートリテラルは内側の ` で分かれるが、日本語の有無を見るぶんには困らない
function literals(src) {
  const code = stripJsComments(src);
  const re = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  const out = [];
  let m;
  while ((m = re.exec(code))) {
    out.push({ line: code.slice(0, m.index).split('\n').length, text: m[0] });
  }
  return out;
}

const JP = /[぀-ゟ゠-ヿ一-鿿]/;

// 日本語を含む文字列リテラルだけ
function jpLiterals(src) {
  return literals(src).filter(x => JP.test(x.text));
}

// T('キー') / T("キー") で使っているキー（コメントの中は拾わない）
function usedTextKeys(src) {
  const keys = new Set();
  const re = /\bT\(\s*(['"])([^'"]+)\1/g;
  const code = stripJsComments(src);
  let m;
  while ((m = re.exec(code))) keys.add(m[2]);
  return keys;
}

// ── HTML ──────────────────────────────────
// 英語表示に紛れ込んだ日本語を探すときは、全角の記号（、。「」（）〜 ＋ など）も日本語扱いにする
const JP_WIDE = /[　-〿぀-ゟ゠-ヿ一-鿿＀-￯]/;
const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'source', 'col', 'area', 'base', 'wbr', 'track', 'embed', 'param']);
const RAW = new Set(['script', 'style']);
const hasClass = (attrs, c) => (' ' + (attrs.class || '') + ' ').includes(' ' + c + ' ');

// index.html をタグとテキストの並びにする。手書きの整った HTML 向けの簡易版
// （コメントと <!DOCTYPE> は読み飛ばす。属性値はダブルクォートのみ）
function htmlTokens(html) {
  const out = [];
  const lineAt = (k) => html.slice(0, k).split('\n').length;
  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const j = html.indexOf('-->', i);
      i = j < 0 ? html.length : j + 3;
      continue;
    }
    if (html[i] === '<') {
      const j = html.indexOf('>', i);
      const raw = html.slice(i + 1, j);
      i = j + 1;
      if (raw.startsWith('!')) continue;
      const close = raw.startsWith('/');
      const body = close ? raw.slice(1) : raw;
      const name = (body.match(/^[a-zA-Z][a-zA-Z0-9]*/) || [''])[0].toLowerCase();
      const attrs = {};
      const re = /([^\s="/]+)(?:\s*=\s*"([^"]*)")?/g;
      const rest = body.slice(name.length);
      let m;
      while ((m = re.exec(rest))) attrs[m[1].toLowerCase()] = m[2] === undefined ? '' : m[2];
      out.push({ type: close ? 'end' : 'start', name, attrs, line: lineAt(i - raw.length - 2), selfClose: raw.endsWith('/') });
      continue;
    }
    const j = html.indexOf('<', i);
    const end = j < 0 ? html.length : j;
    out.push({ type: 'text', text: html.slice(i, end), line: lineAt(i) });
    i = end;
  }
  return out;
}

// 英語表示で見えてしまう日本語を探す。
//   .ja の中は英語表示では隠れるので見ない。lang 属性を持つ要素（<html> 以外）はわざと日本語で書いたものとして見ない
//   title / placeholder に日本語があれば data-title-en / data-placeholder-en が要る
//   <option> の中身に日本語があれば data-en が要る
function englishViewProblems(html) {
  const problems = [];
  const stack = [];
  const any = (f) => stack.some(f);
  for (const t of htmlTokens(html)) {
    if (t.type === 'start') {
      if (!t.name) continue;
      const e = {
        name: t.name,
        hide: hasClass(t.attrs, 'ja'),
        exempt: t.name !== 'html' && 'lang' in t.attrs,
        optEn: t.name === 'option' && 'data-en' in t.attrs,
      };
      if (!any(s => s.hide || s.exempt) && !e.hide && !e.exempt) {
        for (const a of ['title', 'placeholder']) {
          if (JP_WIDE.test(t.attrs[a] || '') && !(`data-${a}-en` in t.attrs)) {
            problems.push(`${t.line}: ${a} に英語が無い（data-${a}-en を付ける）`);
          }
        }
        for (const [k, v] of Object.entries(t.attrs)) {
          if (/^data-(.*-)?en$/.test(k) && JP_WIDE.test(v)) problems.push(`${t.line}: ${k} に日本語が入っている`);
        }
      }
      if (!VOID.has(t.name) && !t.selfClose) stack.push(e);
    } else if (t.type === 'end') {
      const k = stack.map(s => s.name).lastIndexOf(t.name);
      if (k >= 0) stack.length = k;
    } else if (!any(s => s.hide || s.exempt || s.optEn || RAW.has(s.name)) && JP_WIDE.test(t.text)) {
      problems.push(`${t.line}: ${t.text.trim().slice(0, 40)}`);
    }
  }
  return problems;
}

// .ja の要素の直後（空白だけを挟んで）には、同じ要素名の .en が来ること。
// 片方だけ書いた訳（英語が抜けている / 日本語が抜けている）を見つける
function jaEnPairProblems(html) {
  const problems = [];
  const stack = [];
  let expect = null;   // 直前に閉じた .ja { name, line }
  const miss = () => { problems.push(`${expect.line}: .ja の直後に同じ要素の .en が無い`); expect = null; };
  for (const t of htmlTokens(html)) {
    if (t.type === 'text') {
      if (expect && t.text.trim()) miss();
      continue;
    }
    if (t.type === 'start') {
      if (!t.name) continue;
      const isEn = hasClass(t.attrs, 'en');
      if (expect) {
        if (isEn && t.name === expect.name) expect = null; else miss();
      } else if (isEn) {
        problems.push(`${t.line}: .en の直前に .ja が無い`);
      }
      if (!VOID.has(t.name) && !t.selfClose) stack.push({ name: t.name, ja: hasClass(t.attrs, 'ja'), line: t.line });
      continue;
    }
    const k = stack.map(s => s.name).lastIndexOf(t.name);
    if (k < 0) continue;
    const closed = stack[k];
    stack.length = k;
    if (expect) miss();
    if (closed.ja) expect = { name: closed.name, line: closed.line };
  }
  if (expect) miss();
  return problems;
}

// index.html の id（出てきた順。重複も残す）
function htmlIds(html) {
  return htmlTokens(html).filter(t => t.type === 'start' && 'id' in t.attrs).map(t => t.attrs.id);
}

// JS が参照している id。getElementById('x') と、composer-ui.js の v('x')（getElementById の略記）
function jsIdRefs(src) {
  const ids = new Set();
  const code = stripJsComments(src);
  const re = /(?:getElementById|\bv)\(\s*'([^']+)'\s*\)/g;
  let m;
  while ((m = re.exec(code))) ids.add(m[1]);
  return ids;
}

module.exports = {
  stripJsComments, literals, jpLiterals, usedTextKeys,
  htmlTokens, englishViewProblems, jaEnPairProblems, htmlIds, jsIdRefs,
};
