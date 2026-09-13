/**
 * 列出三個語言實際存在的 Google TTS 語音。
 *
 * Google 的語音清單會變動，不要寫死一份用猜的 —— 部署前跑這支，
 * 把實際存在的名字填回 functions/api/tts.js 的 VOICES。
 *
 *   GOOGLE_TTS_API_KEY=xxx node tools/list-voices.mjs
 *
 * 預設只印 Standard（免費額度 400 萬字元／月）。要看全部加 --all。
 */

const KEY = process.env.GOOGLE_TTS_API_KEY;
if (!KEY) {
  console.error('沒有 GOOGLE_TTS_API_KEY。用法：GOOGLE_TTS_API_KEY=xxx node tools/list-voices.mjs');
  process.exit(1);
}

const ALL = process.argv.includes('--all');
const LANGS = ['en-US', 'ja-JP', 'th-TH'];

// 單價級距（US$／百萬字元）與月免費額度，用來提醒哪些碰不得
const TIERS = [
  ['Chirp3-HD', 'Chirp3-HD　 貴　 免費 100 萬'],
  ['Studio', 'Studio　　　 最貴 免費 10 萬'],
  ['Neural2', 'Neural2　　　$16 免費 100 萬'],
  ['Wavenet', 'Wavenet　　　$16 免費 100 萬'],
  ['Standard', 'Standard　　 $4　免費 400 萬  ← 用這個'],
];

function tierOf(name) {
  for (const [needle, label] of TIERS) if (name.includes(needle)) return label;
  return '其他';
}

for (const code of LANGS) {
  const url = `https://texttospeech.googleapis.com/v1/voices?languageCode=${code}`;
  const res = await fetch(url, { headers: { 'x-goog-api-key': KEY } });

  if (!res.ok) {
    console.error(`\n${code}：查詢失敗 ${res.status}`);
    console.error((await res.text()).slice(0, 400));
    continue;
  }

  const { voices = [] } = await res.json();
  const rows = voices
    .filter((v) => ALL || v.name.includes('Standard'))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\n── ${code} ── 共 ${voices.length} 個語音${ALL ? '' : `，其中 Standard ${rows.length} 個`}`);
  for (const v of rows) {
    const gender = (v.ssmlGender || '').padEnd(7);
    console.log(`  ${v.name.padEnd(26)} ${gender} ${ALL ? tierOf(v.name) : ''}`);
  }
  if (!rows.length) console.log('  （沒有 Standard 語音，用 --all 看全部）');
}

console.log('\n把要用的名字填進 functions/api/tts.js 的 VOICES。只收 Standard 是刻意的成本護欄。');
