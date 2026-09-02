// テストランナー（依存なし）。使い方: node test/run.js [絞り込み文字列]
//
// test/*.test.js が「テスト名 → 関数」のオブジェクトを export する。
// 関数が例外を投げなければ成功。npm も設定ファイルも要らない。
'use strict';
const fs = require('fs');
const path = require('path');

const filter = process.argv[2] || '';
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();

let pass = 0, fail = 0;
const failures = [];

for (const file of files) {
  const cases = require(path.join(__dirname, file));
  const names = Object.keys(cases).filter(n => !filter || (file + ' ' + n).includes(filter));
  if (!names.length) continue;
  console.log(`\n${file}`);
  for (const name of names) {
    try {
      cases[name]();
      pass++;
      console.log(`  ok   ${name}`);
    } catch (e) {
      fail++;
      console.log(`  NG   ${name}`);
      failures.push({ file, name, message: e.message, stack: e.stack });
    }
  }
}

if (failures.length) {
  console.log('\n──────── 失敗の詳細 ────────');
  for (const f of failures) {
    console.log(`\n${f.file} › ${f.name}\n  ${f.message}`);
  }
}
console.log(`\n${fail === 0 ? 'すべて成功' : '失敗あり'}: ${pass} 成功 / ${fail} 失敗`);
process.exit(fail === 0 ? 0 : 1);
