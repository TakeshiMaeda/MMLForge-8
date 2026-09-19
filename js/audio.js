// ─────────────────────────────────────────
//  音声→MML（マイク / 音声ファイル → MMLAudio で解析 → eventsToMML で量子化）
//  録音中は検出音名をリアルタイム表示し、MML変換は停止後に全波形を一括解析する
// ─────────────────────────────────────────
const micBtn    = document.getElementById('micRec');
const micNote   = document.getElementById('micNote');
const audFile   = document.getElementById('audFile');
const audStatus = document.getElementById('audStatus');
const audOut    = document.getElementById('audOut');
const AUD_SENS  = { high: 0.005, mid: 0.012, low: 0.03 };

let _actx = null;   // 解析・マイク監視用（MMLPlayer・鍵盤とは独立）
function actx() {
  if (!_actx) _actx = new AudioContext();
  if (_actx.state === 'suspended') _actx.resume();
  return _actx;
}

function audAnalyze(buffer, label) {
  // ステレオ以上は全chを平均してモノラル化
  let ch = buffer.getChannelData(0);
  if (buffer.numberOfChannels > 1) {
    const mono = new Float32Array(ch.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += d[i] / buffer.numberOfChannels;
    }
    ch = mono;
  }
  const { events } = MMLAudio.analyze(ch, buffer.sampleRate, {
    rmsThresh: AUD_SENS[document.getElementById('audSens').value],
  });
  if (!events.length) {
    audOut.value = '';
    audStatus.textContent = T('aud.none', { label });
    return;
  }
  audOut.value = eventsToMML(events, +document.getElementById('audBpm').value,
                             +document.getElementById('audQuant').value);
  audStatus.textContent = T('aud.found', { label, n: events.length });
}

let micStream = null, micRecorder = null, micChunks = [], micRaf = 0;

micBtn.addEventListener('click', async () => {
  if (!micRecorder) {
    try {
      // ピッチ検出にはブラウザの音声加工（エコー除去等）が邪魔なので全部切る
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      audStatus.textContent = T('aud.micFail') + e.message;
      return;
    }
    const c = actx();
    const analyser = c.createAnalyser();
    analyser.fftSize = 2048;
    c.createMediaStreamSource(micStream).connect(analyser);
    const frame = new Float32Array(analyser.fftSize);
    const disp = () => {
      analyser.getFloatTimeDomainData(frame);
      const p = MMLAudio.detectPitch(frame, c.sampleRate);
      if (p) {
        const mi = Math.round(p.midi);
        micNote.textContent = `♪ o${Math.floor(mi / 12) - 1} ${NOTE_NAMES[((mi % 12) + 12) % 12]}`;
      } else {
        micNote.textContent = '…';
      }
      micRaf = requestAnimationFrame(disp);
    };
    micRaf = requestAnimationFrame(disp);
    micChunks = [];
    micRecorder = new MediaRecorder(micStream);
    micRecorder.ondataavailable = (e) => { if (e.data.size) micChunks.push(e.data); };
    micRecorder.start();
    micBtn.textContent = T('aud.micStop');
    micBtn.classList.add('rec-on');
    audStatus.textContent = T('aud.micRecording');
    audOut.value = '';
  } else {
    const rec = micRecorder;
    micRecorder = null;
    cancelAnimationFrame(micRaf);
    micNote.textContent = '';
    micBtn.textContent = T('aud.micStart');
    micBtn.classList.remove('rec-on');
    audStatus.textContent = T('aud.analyzing');
    rec.onstop = async () => {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
      try {
        const blob = new Blob(micChunks, { type: rec.mimeType });
        const buffer = await actx().decodeAudioData(await blob.arrayBuffer());
        audAnalyze(buffer, T('aud.micLabel'));
      } catch (e) {
        audStatus.textContent = T('aud.analyzeFail') + e.message;
      }
    };
    rec.stop();
  }
});

audFile.addEventListener('change', async () => {
  const f = audFile.files[0];
  if (!f) return;
  audStatus.textContent = T('aud.analyzing');
  audOut.value = '';
  try {
    const buffer = await actx().decodeAudioData(await f.arrayBuffer());
    audAnalyze(buffer, f.name);
  } catch (e) {
    audStatus.textContent = T('aud.fileFail') + e.message;
  }
});

document.getElementById('audCopy').addEventListener('click', () => {
  if (!audOut.value) return;
  audOut.select();
  document.execCommand('copy');
  audStatus.textContent = T('common.copied');
});
document.getElementById('audInsert').addEventListener('click', () => {
  if (!audOut.value) return;
  const pos = ta.selectionStart ?? ta.value.length;
  applyText(ta.value.slice(0, pos) + audOut.value + ta.value.slice(pos));
  audStatus.textContent = T('common.inserted');
});

