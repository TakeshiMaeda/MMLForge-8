// ─────────────────────────────────────────
//  セクション開閉状態の記憶
// ─────────────────────────────────────────
['secGen', 'secKb', 'secAudio', 'secDrum'].forEach(id => {
  const el = document.getElementById(id);
  el.open = localStorage.getItem('mmlforge8-open-' + id) === '1';
  el.addEventListener('toggle', () => localStorage.setItem('mmlforge8-open-' + id, el.open ? '1' : '0'));
});
