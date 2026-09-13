/**
 * 三語的 prompt 與回傳結構 —— **只存在於伺服器端**。
 *
 * 為什麼不放前端：如果前端可以送任意 prompt，任何人都能把這支 Gemini 金鑰
 * 當成免費的通用 LLM 代理來用。前端只准送 lang 與 topic 兩個值，
 * 其餘一律由這裡決定。這是整份架構最重要的一條安全規則。
 */

// ── Gemini responseSchema 的共用零件 ──────────────────
// 開 responseSchema 之後模型只能吐符合結構的 JSON，吐不出 markdown 圍籬，
// 所以 bad_json 幾乎不會發生 —— 比在 prompt 裡拜託「只回 JSON」可靠一個檔次。

const S = 'STRING';

const trapItem = {
  type: 'OBJECT',
  properties: {
    point: { type: S },
    wrong: { type: S },
    right: { type: S },
    why: { type: S },
  },
  required: ['point', 'wrong', 'right', 'why'],
};

/** 六段共同的外框；各語言只需要給 compare / examples / collocations 三段的形狀 */
function lessonSchema({ compare, examples, collocations }) {
  return {
    type: 'OBJECT',
    properties: {
      title: { type: S },
      summary: { type: S },
      core: { type: S },
      compare: { type: 'ARRAY', items: compare },
      examples: { type: 'ARRAY', items: examples },
      traps: { type: 'ARRAY', items: trapItem },
      collocations: { type: 'ARRAY', items: collocations },
      notes: { type: S },
    },
    required: ['title', 'summary', 'core', 'compare', 'examples', 'traps', 'collocations', 'notes'],
  };
}

const COMMON_TAIL = [
  '',
  '通則：',
  '- **title 與 summary 一律是純文字，不要放任何標記** —— 這兩處是當標題排版的，',
  '  標記會原樣顯示出來。標記只用在 core、notes、note、why 這些說明性段落裡',
  '- 解釋一律用繁體中文（台灣用語），例句與詞彙用目標語言',
  '- 不要寫廢話式的鼓勵語，直接給知識',
  '- 不要用 markdown 標題或清單符號，段落就是段落',
];

// ── 英文 ────────────────────────────────────────────

const EN = {
  schema: lessonSchema({
    compare: {
      type: 'OBJECT',
      properties: { en: { type: S }, ipa: { type: S }, note: { type: S } },
      required: ['en', 'ipa', 'note'],
    },
    examples: {
      type: 'OBJECT',
      properties: { en: { type: S }, zh: { type: S } },
      required: ['en', 'zh'],
    },
    collocations: {
      type: 'OBJECT',
      properties: { en: { type: S }, zh: { type: S } },
      required: ['en', 'zh'],
    },
  }),
  build: (topic) => [
    `你是一位教繁體中文母語者學英文的老師。使用者想學的主題是：「${topic}」`,
    '',
    '請針對這個主題產生一份完整課程。',
    '',
    '各段要求：',
    '- core：主要用法、語感差異、正式或口語、使用場合。開門見山，不要鋪陳。',
    '  英文字詞用 <en>...</en> 包起來',
    '- compare：3 到 6 列，涵蓋近義詞的細微差異、反義詞、容易搞混的詞，每列都要附 IPA 音標',
    '- examples：3 到 5 句真實語境，每句附繁體中文翻譯或使用情境說明',
    '- traps：2 到 4 項，針對台灣學習者的典型錯誤（中式英文、介系詞、時態），',
    '  明確標出錯誤寫法與正確寫法。必須是真正會犯的錯，不要湊數',
    '- collocations：4 到 8 項 collocation、慣用語、母語者真正會說的講法',
    '- notes：詞源、重音位置、同音字、英美差異 —— 挑真正有幫助的，沒有就回傳空字串。',
    '  英文字詞同樣用 <en>...</en> 標記',
    '',
    '英文專屬規則：',
    '- 音標用 IPA，美式優先',
    '- 重音位置若容易念錯（如 photograph / photographer / photography 重音移位），一定要指出',
    '- 提到英美用法差異時，兩邊都要給',
    '- 所有出現在中文段落裡的英文字詞，都必須用 <en>...</en> 標記',
    '- wrong 和 right 都要是完整可讀的英文',
    ...COMMON_TAIL,
  ].join('\n'),
};

// ── 日文 ────────────────────────────────────────────

const JA = {
  schema: lessonSchema({
    compare: {
      type: 'OBJECT',
      properties: { jp: { type: S }, kana: { type: S }, accent: { type: S }, note: { type: S } },
      required: ['jp', 'kana', 'accent', 'note'],
    },
    examples: {
      type: 'OBJECT',
      properties: {
        jp: { type: S },
        kana: { type: S },
        tokens: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { w: { type: S }, r: { type: S } },
            required: ['w'],
          },
        },
        zh: { type: S },
      },
      required: ['jp', 'kana', 'tokens', 'zh'],
    },
    collocations: {
      type: 'OBJECT',
      properties: { jp: { type: S }, kana: { type: S }, zh: { type: S } },
      required: ['jp', 'kana', 'zh'],
    },
  }),
  build: (topic) => [
    `你是一位教繁體中文母語者學日文的老師。使用者想學的主題是：「${topic}」`,
    '',
    '請針對這個主題產生一份完整課程。',
    '',
    '各段要求：',
    '- core：主要用法、語感差異、敬體常體或正式口語的分別、使用場合。開門見山，不要鋪陳。',
    '  日文詞用 <jp>漢字|かんじ</jp> 標記，純假名或外來語寫成 <jp>ください</jp>',
    '- compare：3 到 6 列，涵蓋近義詞的細微差異或容易混淆的詞，',
    '  每列都要有假名讀音（kana）與東京式アクセント型（accent）',
    '- examples：3 到 5 句真實語境。tokens 必須把整句切成可以逐詞點擊的單位，',
    '  助詞與標點各自獨立；含漢字的 token 要附 r 讀音，純假名的 token 省略 r。',
    '  把 tokens 的 w 依序接起來必須完全等於 jp，一個字都不能多也不能少',
    '- traps：2 到 4 項，針對台灣學習者的典型錯誤 —— 漢字同形異義、助詞誤用、',
    '  自他動詞混淆、敬語層級錯置。必須是真正會犯的錯，不要湊數',
    '- collocations：4 到 8 項慣用搭配或母語者真正會說的講法',
    '- notes：語源、アクセント、音読み與訓読み、和製漢語與中文的異同 —— ',
    '  挑真正有幫助的，沒有就回傳空字串',
    '',
    '日文專屬規則：',
    '- アクセント一律用東京式，格式如「0型（平板）」「1型（頭高）」「2型（尾高）」「3型（中高）」',
    '- 動詞若對理解有幫助，請標出辭書形與活用類別（五段／一段／不規則）',
    '- 所有出現在中文段落裡的日文詞，都必須用 <jp>...</jp> 標記；',
    '  有漢字就寫成 <jp>漢字|讀音</jp>，讀音是該詞的全假名',
    ...COMMON_TAIL,
  ].join('\n'),
};

// ── 泰文 ────────────────────────────────────────────
//
// 轉寫系統選 Paiboon 而不是 RTGS，理由有兩個：
// 1. RTGS 完全不標聲調，對一個五聲調語言等於把最難的一關拿掉不教
// 2. 使用者的泰文字卡庫（~/Developer/thai）3,132 張卡全部是 Paiboon，
//    兩套並行只會互相干擾
// 選定就不要中途更換。

const TH = {
  schema: lessonSchema({
    compare: {
      type: 'OBJECT',
      properties: { th: { type: S }, rom: { type: S }, tone: { type: S }, note: { type: S } },
      required: ['th', 'rom', 'tone', 'note'],
    },
    examples: {
      type: 'OBJECT',
      properties: {
        th: { type: S },
        rom: { type: S },
        tokens: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { w: { type: S }, r: { type: S } },
            required: ['w'],
          },
        },
        zh: { type: S },
      },
      required: ['th', 'rom', 'tokens', 'zh'],
    },
    collocations: {
      type: 'OBJECT',
      properties: { th: { type: S }, rom: { type: S }, zh: { type: S } },
      required: ['th', 'rom', 'zh'],
    },
  }),
  build: (topic) => [
    `你是一位教繁體中文母語者學泰文的老師。使用者想學的主題是：「${topic}」`,
    '',
    '請針對這個主題產生一份完整課程。',
    '',
    '各段要求：',
    '- core：主要用法、語感差異、正式或口語、使用場合。開門見山，不要鋪陳。',
    '  泰文詞用 <thai>泰文|轉寫</thai> 標記，例如 <thai>สวัสดี|sà-wàt-dii</thai>',
    '- compare：3 到 6 列，涵蓋近義詞的細微差異或容易混淆的詞。',
    '  每列要有 th（泰文）、rom（Paiboon 轉寫）、tone（逐音節聲調）、note（語感說明）',
    '- examples：3 到 5 句真實語境。tokens 必須把整句切成可以逐詞點擊的單位。',
    '  **泰文不用空格斷詞**，所以切詞由你負責，不要指望程式用空白切。',
    '  每個 token 的 w 是泰文、r 是該詞的 Paiboon 轉寫；標點與空格自成一個 token 且省略 r。',
    '  把 tokens 的 w 依序接起來必須完全等於 th，一個字元都不能多也不能少',
    '- traps：2 到 4 項，針對華語母語者的典型錯誤 —— 聲調記錯、母音長短不分、',
    '  子音分類（高/中/低）判斷錯、詞序、語氣詞漏掉。必須是真正會犯的錯，不要湊數',
    '- collocations：4 到 8 項慣用搭配或泰國人真正會說的講法（含禮貌詞 ครับ／ค่ะ 的用法差異）',
    '- notes：詞源（巴利語／梵語／高棉語借詞）、拼寫與發音不一致之處、',
    '  聲調規則為什麼是這樣、男女用語差異 —— 挑真正有幫助的，沒有就回傳空字串',
    '',
    '泰文專屬規則（**這幾條最重要，不要違反**）：',
    '',
    '1. 轉寫一律用 **Paiboon**，不要用 RTGS、不要用其他系統，全份課程前後一致：',
    '   - 長母音寫兩次：maa / dii / kuu，短母音寫一次',
    '   - 不送氣塞音要標出來：ก=g、ต=dt、ป=bp；送氣的才是 k / t / p',
    '     （所以 ไป 是 bpai 不是 pai，กิน 是 gin 不是 kin）',
    '   - 母音用 IPA 式符號：ɛ、ɔ、ɤ、ʉ（แมว=mɛɛo、ขอบ=kɔ̀ɔp）',
    '   - 音節之間用連字號：sà-wàt-dii、kɔ̀ɔp-kun',
    '   - 聲調用附加符號標在母音上：',
    '     中平調不加符號（kun）、低調 à、降調 â、高調 á、上升調 ǎ',
    '   - 對照範例：สวัสดี=sà-wàt-dii、ขอบคุณ=kɔ̀ɔp-kun、ผม=pǒm、ไป=bpai、',
    '     น้ำ=náam、ข้าว=kâao、หมา=mǎa、แมว=mɛɛo、ดี=dii',
    '',
    '2. tone 欄位用**繁體中文聲調名**，逐音節以連字號串起來，',
    '   數量必須跟 rom 的音節數一模一樣。五個名稱只能用這五個：',
    '   中平、低、降、高、上升',
    '   例：สวัสดี 的 rom 是 sà-wàt-dii（三音節），tone 就是「低-低-中平」',
    '',
    '3. 所有出現在中文段落裡的泰文詞，都必須寫成 <thai>泰文|轉寫</thai>。',
    '   標記名稱是 thai，不是 th',
    '',
    '4. traps 的 wrong 與 right 都要是完整可讀的泰文句子',
    ...COMMON_TAIL,
  ].join('\n'),
};

// ── 出口 ────────────────────────────────────────────

const TABLE = { en: EN, ja: JA, th: TH };

export function promptFor(lang, topic) {
  return TABLE[lang].build(topic);
}

export function schemaFor(lang) {
  return TABLE[lang].schema;
}
