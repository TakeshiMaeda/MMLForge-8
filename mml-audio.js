// MMLForge-8 / MMLAudio — 単音音声のピッチ解析（外部依存なし）
// マイク録音や音声ファイルの波形から鼻歌・口笛・単音楽器のメロディを検出し、
// 音符イベント列 {semi, tOn, tOff} に変換する（semi: C4=0 の相対半音。鍵盤録音と同じ形式）。
// ポリフォニック（和音・伴奏入りの曲）は対象外。
//
//   MMLAudio.analyze(samples, sampleRate, { rmsThresh }) → { events: [{semi, tOn, tOff}] }
//     samples: Float32Array（モノラル波形）。rmsThresh: 有声判定の音量しきい値
//   MMLAudio.detectPitch(frame, sampleRate) → { freq, midi, clarity, rms } | null
//     1フレーム分の即時ピッチ検出（録音中のリアルタイム表示用）
//
// アルゴリズム: 約16kHzにダウンサンプル → フレームごとに YIN 法でピッチ推定
// → 中央値フィルタで外れ値除去 → 半音に量子化（ヒステリシス付き）して音符に切り出し
const MMLAudio = (() => {
  const TARGET_SR = 16000;   // 解析サンプルレート（この付近になるよう整数比で間引く）
  const FRAME     = 1024;    // 解析フレーム長（16kHzで64ms）
  const HOP       = 256;     // フレーム間隔（16kHzで16ms）
  const FMIN      = 60;      // 検出下限Hz（男声の低い鼻歌までカバー）
  const FMAX      = 1600;    // 検出上限Hz（口笛の中域まで）
  const YIN_THRESH   = 0.15; // YIN: この値を最初に割った谷を採用
  const CLARITY_MIN  = 0.7;  // 有声判定（1 - 正規化差分の谷の深さ）
  const GAP_SEC      = 0.05; // これ以上の無声区間で音符を閉じる
  const MIN_NOTE_SEC = 0.06; // これより短い検出は捨てる
  const STABLE_FRAMES = 2;   // 新しい半音がこのフレーム数続いたら音符を切り替え

  // 整数比の間引きでダウンサンプル（箱型平均で簡易ローパス）
  function downsample(data, sr) {
    const k = Math.max(1, Math.round(sr / TARGET_SR));
    if (k === 1) return { data, sr };
    const out = new Float32Array(Math.floor(data.length / k));
    for (let i = 0; i < out.length; i++) {
      let s = 0;
      for (let j = 0; j < k; j++) s += data[i * k + j];
      out[i] = s / k;
    }
    return { data: out, sr: sr / k };
  }

  function rmsOf(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  // YIN法: 差分関数 → 累積平均正規化 → しきい値を割る最初の谷 → 放物線補間
  function yin(buf, sr) {
    const maxLag = Math.floor(sr / FMIN);
    const minLag = Math.max(2, Math.floor(sr / FMAX));
    const W = buf.length - maxLag;   // 積分窓
    if (W < minLag) return null;
    const nd = new Float32Array(maxLag + 1);   // 正規化差分
    let cum = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      let sum = 0;
      for (let i = 0; i < W; i++) {
        const diff = buf[i] - buf[i + tau];
        sum += diff * diff;
      }
      cum += sum;
      nd[tau] = sum * tau / (cum || 1e-12);
    }
    let tau = -1;
    for (let t = minLag; t <= maxLag; t++) {
      if (nd[t] < YIN_THRESH) {
        while (t + 1 <= maxLag && nd[t + 1] < nd[t]) t++;   // 谷底まで降りる
        tau = t;
        break;
      }
    }
    if (tau === -1) {
      let best = minLag;
      for (let t = minLag; t <= maxLag; t++) if (nd[t] < nd[best]) best = t;
      tau = best;
    }
    let lag = tau;
    if (tau > 1 && tau < maxLag) {
      const a = nd[tau - 1], b = nd[tau], c = nd[tau + 1];
      const denom = a + c - 2 * b;
      if (Math.abs(denom) > 1e-12) lag = tau + (a - c) / (2 * denom);
    }
    return { freq: sr / lag, clarity: 1 - nd[tau] };
  }

  const toMidi = (freq) => 69 + 12 * Math.log2(freq / 440);

  // 1フレームの即時検出（リアルタイム表示用）。無声・不明瞭なら null
  function detectPitch(frame, sampleRate) {
    const { data, sr } = downsample(frame, sampleRate);
    const rms = rmsOf(data);
    if (rms < 0.005) return null;
    const p = yin(data, sr);
    if (!p || p.clarity < CLARITY_MIN || p.freq < FMIN || p.freq > FMAX) return null;
    return { freq: p.freq, midi: toMidi(p.freq), clarity: p.clarity, rms };
  }

  // 波形全体を解析して音符イベント列に変換
  function analyze(samples, sampleRate, opts = {}) {
    const rmsThresh = opts.rmsThresh ?? 0.012;
    const { data, sr } = downsample(samples, sampleRate);
    const hopSec = HOP / sr;

    // フレームごとのピッチ列（m: MIDIノート実数値 or null=無声）
    // 有声判定のRMSはフレーム先頭の短い窓（HOP*2=32ms）で取る。ピッチ推定窓（64ms）で取ると
    // 短い無音が前後の音のエネルギーに埋もれ、同音連打の切れ目を検出できないため
    const frames = [];
    for (let i = 0; i + FRAME <= data.length; i += HOP) {
      const buf = data.subarray(i, i + FRAME);
      const t = i / sr;
      let m = null;
      if (rmsOf(data.subarray(i, i + HOP * 2)) >= rmsThresh) {
        const p = yin(buf, sr);
        if (p && p.clarity >= CLARITY_MIN && p.freq >= FMIN && p.freq <= FMAX) m = toMidi(p.freq);
      }
      frames.push({ t, m });
    }

    // 中央値フィルタ（±2フレームの有声値の中央値）でオクターブ誤検出などの単発外れ値を除去
    const med = frames.map((f, i) => {
      if (f.m === null) return null;
      const vals = [];
      for (let j = Math.max(0, i - 2); j <= Math.min(frames.length - 1, i + 2); j++) {
        if (frames[j].m !== null) vals.push(frames[j].m);
      }
      vals.sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)];
    });

    // 半音に量子化して連続区間を音符に切り出し
    const events = [];
    const gapFrames = Math.max(1, Math.round(GAP_SEC / hopSec));
    let cur = null;                       // { semi, tOn, tLast }
    let pendSemi = null, pendCount = 0, pendT = 0;
    let unvoiced = 0;
    const close = (tOff) => {
      if (cur && tOff - cur.tOn >= MIN_NOTE_SEC) events.push({ semi: cur.semi, tOn: cur.tOn, tOff });
      cur = null;
    };
    frames.forEach((f, i) => {
      const m = med[i];
      if (m === null) {
        if (cur && ++unvoiced >= gapFrames) close(cur.tLast + hopSec);
        pendSemi = null; pendCount = 0;
        return;
      }
      unvoiced = 0;
      // ヒステリシス: 現在の音から±0.7半音以内は同じ音とみなす（ビブラート・音程の揺れ対策）
      const semi = (cur && Math.abs(m - (cur.semi + 60)) < 0.7) ? cur.semi : Math.round(m) - 60;
      if (!cur) {
        cur = { semi, tOn: f.t, tLast: f.t };
        pendSemi = null; pendCount = 0;
      } else if (semi === cur.semi) {
        cur.tLast = f.t;
        pendSemi = null; pendCount = 0;
      } else if (semi === pendSemi) {
        if (++pendCount >= STABLE_FRAMES) {   // 新しい半音が安定 → 音符切り替え
          close(pendT);
          cur = { semi, tOn: pendT, tLast: f.t };
          pendSemi = null; pendCount = 0;
        }
      } else {
        pendSemi = semi; pendCount = 1; pendT = f.t;
      }
    });
    if (cur) close(cur.tLast + hopSec);

    return { events };
  }

  return { analyze, detectPitch };
})();
