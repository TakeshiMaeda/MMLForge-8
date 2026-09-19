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

// title / placeholder と、プルダウンの選択肢（<option>）の中身は span で出し分けられない。
// そこで HTML には日本語を書き、英語を data-title-en / data-placeholder-en / data-en に並べておき、
// 英語のときだけ差し替える。本文を読み終えてから（DOMContentLoaded）行う
function applyLangAttrs(root) {
  if (LANG === 'ja') return;
  root.querySelectorAll('[data-title-en]').forEach(el => { el.title = el.dataset.titleEn; });
  root.querySelectorAll('[data-placeholder-en]').forEach(el => { el.placeholder = el.dataset.placeholderEn; });
  root.querySelectorAll('option[data-en]').forEach(el => { el.textContent = el.dataset.en; });
}
document.addEventListener('DOMContentLoaded', () => applyLangAttrs(document));

// 言語を切り替える。保存して読み直す（テキストエリアの内容は自動保存済みなので消えない）
function setLang(l) {
  if (!LANGS.includes(l)) return;
  try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* 保存できなければ次回は元の言語に戻る */ }
  location.reload();
}

// 画面に出す文字列。値は文字列か、params を受けて文字列を返す関数。
// ja と en は同じキーを同じ順に並べる（キーの一致は test/i18n.test.js が見張る）
const TEXT = {
  ja: {
    // ── 共通 ──
    'common.stopped':  '停止',
    'common.copied':   'コピーしました',
    'common.inserted': 'テキストエリアに挿入しました',
    'common.warn':     p => ` ※${p.msg}`,

    // ── エラー位置（core.js の locateError） ──
    'err.at':    p => `トラック${p.track} ${p.line}行目 ${p.col}文字目: ${p.body}`,
    'err.track': p => `トラック${p.track}: ${p.body}`,

    // ── 試聴プレイヤー（core.js） ──
    'sample.comment':   '; サンプル: きらきら星（行頭から始まる行=新トラック、行頭に空白=前のトラックの続き）',
    'play.status':      p => `再生中 (1ループ ${p.loop} 秒)`,
    'play.statusIntro': p => `再生中 (イントロ ${p.intro} 秒 + 1ループ ${p.loop} 秒)`,
    'copy.noTracks':    'コピーするトラックがありません',
    'copy.done':        p => `mml.js用に整形してコピーしました（${p.n}トラック）`,

    // ── 記述の最適化（core.js） ──
    'opt.unbalanced':   '[ ] の対応が取れません',
    'opt.tooLarge':     'リピートの展開が大きすぎます',
    'opt.verifyFailed': '検算に失敗しました',
    'opt.fixFirst':     '最適化の前にMMLのエラーを直してください — ',
    'opt.aborted':      '最適化を中止しました（内容は変えていません） — ',
    'opt.nothing':      '縮められる記述はありませんでした',
    'opt.done':         p => `最適化しました（音長${p.len}箇所・オクターブ${p.oct}箇所` + (p.head ? `・l4追加${p.head}トラック）` : '）'),

    // ── 小節チェック（core.js） ──
    'bar.fixFirst':   '小節チェックの前にMMLのエラーを直してください — ',
    'bar.noTracks':   'チェックするトラックがありません',
    'bar.header':     p => `1小節 = ${p.beats}拍 として判定`,
    'bar.row':        p => `ch${p.ch}  ${p.bars}小節  t${p.tempo}  ${p.notes}音`,
    'bar.rowSec':     p => `ch${p.ch}  ${p.sec}秒  ${p.notes}音`,
    'bar.multiTempo': p => `  ← テンポが変わる（t${p.tempos}）ので小節数を判定できません`,
    'bar.loop':       p => `  （[ ]0 ${p.intro ? `前奏${p.intro}小節 + ` : ''}本体${p.body}小節 × ${p.times}回${p.cut ? '・曲末で途中まで' : ''}）`,
    'bar.notWhole':   '  ← 小節の整数倍になっていません',
    'bar.where':      p => `${p.no}行目` + (p.part ? `の${p.part}つ目` : ''),
    'bar.strays':     p => `  小節線に乗らない箇所 ${p.n}件（最初は${p.where}・${p.bars}小節の位置）`,
    'bar.sameOk':     '全トラック同尺: OK',
    'bar.sameNg':     '全トラック同尺: NG ← トラックごとに長さが違います',
    'bar.statusOk':   '小節チェック: 問題なし',
    'bar.statusNg':   '小節チェック: 要確認',

    // ── 自動作曲・伴奏付け・追い足し（composer-ui.js / mml-composer.js） ──
    'gen.swapped':    '入れ替えました',
    'gen.noMelody':   'メロディが見つかりません（コメント以外のMML行が必要です）',
    'gen.extended':   p => `メロディに${p.bars}小節追い足しました（「元に戻す」で取り消し可）`,
    'gen.comment':    p => `; 自動生成: ${p.mood} / key=${p.key}(${p.scale}) / t${p.tempo} / 進行${p.prog} / ${p.bars}小節 / seed=${p.seed}`
      + (p.harm ? ' / ハーモニー' : '') + (p.drums ? ` / リズムch(${p.drumStyle})` : ''),
    'harm.comment':   p => `; 伴奏付け: key=${p.key}(${p.scale}) / t${p.tempo} / 進行${p.prog} / ${p.bars}小節 / seed=${p.seed} / 雰囲気=${p.mood}`,
    'harm.offBar':    p => `メロディが4/4×${p.bars}小節ちょうどではありません。末尾を r で埋めるとループが揃います`,
    'ext.fraction':   'メロディ末尾に16分未満の端数があります。追加小節の頭が少しずれます',
    'comp.noPlayer':  'MMLPlayer.parse が見つかりません（mml.js を先に読み込んでください）',
    'comp.noNotes':   'メロディに音符がありません',
    'mood.calm':      'しずか・おだやか',
    'mood.mystic':    '幻想・浮遊',
    'mood.intense':   '疾走・激しい',
    'mood.dark':      '緊迫・不穏',
    'mood.bright':    '明るい・陽気',

    // ── ミニ鍵盤・演奏録音（keyboard.js / record.js） ──
    'kb.prefix':      p => `MML指定: @${p.wave} v${p.vol} @e${p.a},${p.d},${p.s},${p.r}`,
    'rec.start':      '● 録音開始',
    'rec.stop':       '■ 録音終了',
    'rec.recording':  '録音中… 最初の打鍵が時刻0になります',
    'rec.converted':  p => `${p.n}音を変換しました`,
    'rec.empty':      '録音された音がありません',

    // ── 音声→MML（audio.js） ──
    'aud.micStart':     '● マイク録音',
    'aud.micStop':      '■ マイク録音終了',
    'aud.micRecording': '録音中… 検出音をリアルタイム表示します',
    'aud.micLabel':     'マイク録音',
    'aud.micFail':      'マイクを取得できませんでした: ',
    'aud.analyzing':    '解析中…',
    'aud.analyzeFail':  '解析に失敗しました: ',
    'aud.fileFail':     'このファイルを読めませんでした: ',
    'aud.none':         p => `${p.label}: 音を検出できませんでした（感度を上げる・大きめの音で試してください）`,
    'aud.found':        p => `${p.label}: ${p.n}音を検出しました`,

    // ── リズムパッド（drum.js） ──
    'drum.kick':           'キック',
    'drum.snare':          'スネア',
    'drum.hatClosed':      'ハット(閉)',
    'drum.hatOpen':        'ハット(開)',
    'drum.tom':            'タム',
    'drum.clap':           'クラップ風',
    'drum.manual':         '(手動)',
    'drum.userGroup':      'ユーザー定義',
    'drum.tipWave':        '波形 @0-4（noise以外は o の音程で鳴る）',
    'drum.tipPitch':       '音程（音名+オクターブ。例: c5, f#4。ノイズはバンドパス中心の微調整になる）',
    'drum.tipVol':         '音量 v0-15',
    'drum.tipGate':        'ゲート q1-8（小さいとDecayを切り詰めて短く硬い音になる）',
    'drum.tipEnv':         'エンベロープ @e a,d,s,r',
    'drum.register':       '登録',
    'drum.tipRegister':    'この行の現在の音（@/o/v/q/@e）をユーザー楽器として登録',
    'drum.promptName':     '登録する楽器名（同名は上書き）',
    'drum.registered':     p => `楽器「${p.name}」を登録しました`,
    'drum.tipDelete':      '選択中のユーザー楽器を削除',
    'drum.deleteOnlyUser': 'ユーザー定義楽器を選択している行でのみ削除できます',
    'drum.confirmDelete':  p => `楽器「${p.name}」を削除しますか？`,
    'drum.deleted':        p => `楽器「${p.name}」を削除しました`,
    'drum.noHits':         '打点がありません',
    'drum.playing':        'パターン再生中',
    'drum.cleared':        'クリアしました',
    'drum.inserted':       '本編末尾にトラックを追加しました',

    // ── ワークスペースのウインドウ（desk.js） ──
    'desk.help':  '説明を表示／隠す',
    'desk.min':   '最小化（タイトルバーのダブルクリックでも）。もう一度で元に戻す',
    'desk.close': '閉じる（上部の「ウインドウ」から開き直せます）',
  },

  en: {
    // ── 共通 ──
    'common.stopped':  'Stopped',
    'common.copied':   'Copied',
    'common.inserted': 'Inserted into the text area',
    'common.warn':     p => ` (note: ${p.msg})`,

    // ── エラー位置 ──
    'err.at':    p => `Track ${p.track}, line ${p.line}, col ${p.col}: ${p.body}`,
    'err.track': p => `Track ${p.track}: ${p.body}`,

    // ── 試聴プレイヤー ──
    'sample.comment':   '; Sample: Twinkle Twinkle Little Star (a line starting at the left edge = new track; a line starting with a space continues the track above)',
    'play.status':      p => `Playing (loop ${p.loop}s)`,
    'play.statusIntro': p => `Playing (intro ${p.intro}s + loop ${p.loop}s)`,
    'copy.noTracks':    'No tracks to copy',
    'copy.done':        p => `Copied in mml.js format (${p.n} tracks)`,

    // ── 記述の最適化 ──
    'opt.unbalanced':   '[ and ] do not match',
    'opt.tooLarge':     'Repeats expand too far',
    'opt.verifyFailed': 'Verification failed',
    'opt.fixFirst':     'Fix the MML errors before optimizing — ',
    'opt.aborted':      'Optimization cancelled (nothing was changed) — ',
    'opt.nothing':      'Nothing to shorten',
    'opt.done':         p => `Optimized (${p.len} lengths, ${p.oct} octaves` + (p.head ? `, l4 added to ${p.head} tracks)` : ')'),

    // ── 小節チェック ──
    'bar.fixFirst':   'Fix the MML errors before checking bars — ',
    'bar.noTracks':   'No tracks to check',
    'bar.header':     p => `Checking with ${p.beats} beats per bar`,
    'bar.row':        p => `ch${p.ch}  ${p.bars} bars  t${p.tempo}  ${p.notes} notes`,
    'bar.rowSec':     p => `ch${p.ch}  ${p.sec}s  ${p.notes} notes`,
    'bar.multiTempo': p => `  ← the tempo changes (t${p.tempos}), so bars cannot be counted`,
    'bar.loop':       p => `  ([ ]0 ${p.intro ? `intro ${p.intro} bars + ` : ''}body ${p.body} bars × ${p.times}${p.cut ? ', cut off at the end' : ''})`,
    'bar.notWhole':   '  ← not a whole number of bars',
    'bar.where':      p => `line ${p.no}` + (p.part ? `, segment ${p.part}` : ''),
    'bar.strays':     p => `  ${p.n} spot(s) off the bar lines (first: ${p.where}, at bar ${p.bars})`,
    'bar.sameOk':     'All tracks same length: OK',
    'bar.sameNg':     'All tracks same length: NG ← the tracks differ in length',
    'bar.statusOk':   'Bar check: OK',
    'bar.statusNg':   'Bar check: needs attention',

    // ── 自動作曲・伴奏付け・追い足し ──
    'gen.swapped':    'Swapped with the previous text',
    'gen.noMelody':   'No melody found (needs an MML line that is not a comment)',
    'gen.extended':   p => `Added ${p.bars} bars to the melody (use "Undo" to revert)`,
    'gen.comment':    p => `; Generated: ${p.mood} / key=${p.key}(${p.scale}) / t${p.tempo} / progression ${p.prog} / ${p.bars} bars / seed=${p.seed}`
      + (p.harm ? ' / harmony' : '') + (p.drums ? ` / rhythm (${p.drumStyle})` : ''),
    'harm.comment':   p => `; Accompaniment: key=${p.key}(${p.scale}) / t${p.tempo} / progression ${p.prog} / ${p.bars} bars / seed=${p.seed} / mood=${p.mood}`,
    'harm.offBar':    p => `The melody is not exactly ${p.bars} bars of 4/4. Pad the end with r to line up the loop`,
    'ext.fraction':   'The melody ends with a fraction shorter than a 16th, so the added bars start slightly off',
    'comp.noPlayer':  'MMLPlayer.parse not found (load mml.js first)',
    'comp.noNotes':   'The melody has no notes',
    'mood.calm':      'Calm / gentle',
    'mood.mystic':    'Mystic / floating',
    'mood.intense':   'Driving / intense',
    'mood.dark':      'Tense / ominous',
    'mood.bright':    'Bright / cheerful',

    // ── ミニ鍵盤・演奏録音 ──
    'kb.prefix':      p => `MML: @${p.wave} v${p.vol} @e${p.a},${p.d},${p.s},${p.r}`,
    'rec.start':      '● Record',
    'rec.stop':       '■ Stop recording',
    'rec.recording':  'Recording… the first key press is time 0',
    'rec.converted':  p => `Converted ${p.n} notes`,
    'rec.empty':      'Nothing was recorded',

    // ── 音声→MML ──
    'aud.micStart':     '● Mic record',
    'aud.micStop':      '■ Stop mic',
    'aud.micRecording': 'Recording… showing detected notes live',
    'aud.micLabel':     'Mic recording',
    'aud.micFail':      'Could not access the microphone: ',
    'aud.analyzing':    'Analyzing…',
    'aud.analyzeFail':  'Analysis failed: ',
    'aud.fileFail':     'Could not read this file: ',
    'aud.none':         p => `${p.label}: no notes detected (try a higher sensitivity or a louder sound)`,
    'aud.found':        p => `${p.label}: detected ${p.n} notes`,

    // ── リズムパッド ──
    'drum.kick':           'Kick',
    'drum.snare':          'Snare',
    'drum.hatClosed':      'Hi-hat (closed)',
    'drum.hatOpen':        'Hi-hat (open)',
    'drum.tom':            'Tom',
    'drum.clap':           'Clap-like',
    'drum.manual':         '(manual)',
    'drum.userGroup':      'User-defined',
    'drum.tipWave':        'Wave @0-4 (waves other than noise play at the o pitch)',
    'drum.tipPitch':       'Pitch (note + octave, e.g. c5, f#4; for noise it fine-tunes the band-pass center)',
    'drum.tipVol':         'Volume v0-15',
    'drum.tipGate':        'Gate q1-8 (smaller cuts the decay for a shorter, harder sound)',
    'drum.tipEnv':         'Envelope @e a,d,s,r',
    'drum.register':       'Save',
    'drum.tipRegister':    "Save this row's current sound (@/o/v/q/@e) as a user instrument",
    'drum.promptName':     'Instrument name (the same name overwrites)',
    'drum.registered':     p => `Saved instrument "${p.name}"`,
    'drum.tipDelete':      'Delete the selected user instrument',
    'drum.deleteOnlyUser': 'Deleting works only on a row with a user-defined instrument selected',
    'drum.confirmDelete':  p => `Delete instrument "${p.name}"?`,
    'drum.deleted':        p => `Deleted instrument "${p.name}"`,
    'drum.noHits':         'No hits',
    'drum.playing':        'Playing the pattern',
    'drum.cleared':        'Cleared',
    'drum.inserted':       'Added the tracks to the end of the main text',

    // ── ワークスペースのウインドウ ──
    'desk.help':  'Show or hide help',
    'desk.min':   'Minimize (or double-click the title bar). Again to restore',
    'desk.close': 'Close (reopen it from "Windows" at the top)',
  },
};

// 今の言語の文言を取る。今の言語に無ければ日本語、それも無ければキーそのもの（表示が空にならないように）
function T(key, params = {}) {
  const v = TEXT[LANG][key] ?? TEXT.ja[key];
  if (v === undefined) return key;
  return typeof v === 'function' ? v(params) : v;
}
