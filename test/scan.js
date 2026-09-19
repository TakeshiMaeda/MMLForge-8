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

module.exports = { stripJsComments, literals, jpLiterals, usedTextKeys };
