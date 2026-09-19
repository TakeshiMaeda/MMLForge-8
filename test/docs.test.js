// README の日英（README.md / README.en.md）の同期。
// 記法とエラーコードは外向きの約束なので、片方だけ直して食い違うと利用者を惑わせる。
// 訳文の良し悪しは人が見る。ここで見るのは数えられるもの（表の行・コマンド・コード・見出しの数・相互リンク）だけ
'use strict';
const { read, eq, ok } = require('./helper');

const ja = read('README.md');
const en = read('README.en.md');

// Markdown の表の本体の行（区切り行 |---| の次から、| で始まる行が続く間）。表は見出し文字列の後で最初に現れるもの
function tableRows(md, after) {
  const i = md.indexOf(after);
  if (i < 0) throw new Error(`見つかりません: ${after}`);
  const lines = md.slice(i).split('\n');
  const k = lines.findIndex(l => /^\|\s*-/.test(l));
  const rows = [];
  for (let j = k + 1; j < lines.length && lines[j].startsWith('|'); j++) rows.push(lines[j]);
  return rows;
}
// 表の行を列に分ける（\| はエスケープされた | なので区切りにしない）
const cells = (row) => row.split(/(?<!\\)\|/).slice(1, -1).map(s => s.trim());
// セルの中の `…` を拾う
const codeSpans = (s) => (s.match(/`[^`]+`/g) || []).map(x => x.slice(1, -1));
// エラーコード（大文字だけの `…`）
const errorCodes = (rows) => [...new Set(rows.flatMap(r => codeSpans(r)).filter(c => /^[A-Z][A-Z_]{2,}$/.test(c)))].sort();
const mmlCodes = () => [...new Set((read('mml.js').match(/'[A-Z][A-Z_]{2,}'/g) || []).map(s => s.slice(1, -1)))].sort();

module.exports = {

  '日本語版と英語版が互いにリンクしている'() {
    ok(ja.includes('(README.en.md)'), 'README.md から英語版へ');
    ok(en.includes('(README.md)'), 'README.en.md から日本語版へ');
  },

  '見出しの数が同じ（節の抜けが無い）'() {
    const heads = (md) => md.split('\n').filter(l => /^#{1,3} /.test(l)).map(l => l.match(/^#+/)[0]);
    eq(heads(en), heads(ja));
  },

  '記法表は行数と、各行のコマンド（1列目の `…`）が同じ'() {
    const a = tableRows(ja, '## MML記法').map(r => codeSpans(cells(r)[0]));
    const b = tableRows(en, '## MML notation').map(r => codeSpans(cells(r)[0]));
    ok(a.length > 10, `記法表の行を拾えている（${a.length}行）`);
    eq(b, a);
  },

  'エラーコード表は日英とも mml.js が投げるコードと一致する'() {
    const codes = mmlCodes();
    ok(codes.length === 25, `mml.js から拾えたコード: ${codes.length}`);
    eq(errorCodes(tableRows(ja, '| 分類 | code | params |')), codes, 'README.md');
    eq(errorCodes(tableRows(en, '| Group | code | params |')), codes, 'README.en.md');
  },
};
