/**
 * 課程登錄表。
 *
 * ── 為什麼會有這支檔案 ──────────────────────────────
 *
 * 一開始只有一個軸：三個「學習語言」，而「說明語言」是寫死的繁體中文 ——
 * 寫死在 prompt、寫死在介面文案、寫死在渲染邏輯。
 *
 * 加入「泰語母語者學中文」之後變成兩個軸，所以「語言」這個概念不夠用了，
 * 要換成**課程**：一堂課程 = 母語（ui）× 學習語言（target）。
 *
 *     zh-en   繁中 → 英文
 *     zh-ja   繁中 → 日文
 *     zh-th   繁中 → 泰文
 *     th-zh   泰文 → 中文（簡體 + 漢語拼音）
 *
 * 網址就是 /{課程 id}/。舊的 /en/ /ja/ /th/ 會轉址過來 ——
 * 使用者已經把 app 加到主畫面了，不能讓它壞掉。
 */

export const COURSES = {
  'zh-en': {
    id: 'zh-en',
    ui: 'zh',
    target: 'en',
    uiLabel: '英文',        // 在該課程的母語裡怎麼稱呼這個學習語言
    path: '/zh-en/',
    ttsLang: 'en',
  },
  'zh-ja': {
    id: 'zh-ja',
    ui: 'zh',
    target: 'ja',
    uiLabel: '日文',
    path: '/zh-ja/',
    ttsLang: 'ja',
  },
  'zh-th': {
    id: 'zh-th',
    ui: 'zh',
    target: 'th',
    uiLabel: '泰文',
    path: '/zh-th/',
    ttsLang: 'th',
  },
  'th-zh': {
    id: 'th-zh',
    ui: 'th',
    target: 'zh',
    uiLabel: 'ภาษาจีน',
    path: '/th-zh/',
    ttsLang: 'zh',
  },
  'th-en': {
    id: 'th-en',
    ui: 'th',
    target: 'en',
    uiLabel: 'ภาษาอังกฤษ',
    path: '/th-en/',
    ttsLang: 'en',
  },
};

export const COURSE_IDS = Object.keys(COURSES);

/** 母語清單，給入口的選單用 */
export const UI_LANGS = {
  zh: { id: 'zh', label: '繁體中文', native: '繁體中文' },
  th: { id: 'th', label: '泰文', native: 'ภาษาไทย' },
};

export function validCourse(id) {
  return typeof id === 'string' && Object.hasOwn(COURSES, id);
}

/**
 * 舊的單語言代碼 → 課程 id。
 *
 * 網址層面**不做轉址**（課程化之前使用的人還很少）。這個對照只為了一件事：
 * 部署新版之後，使用者瀏覽器裡可能還跑著 service worker 快取的舊版 JS，
 * 它送出來的是 { lang: "en" }。這裡把它接住，不要讓那些人看到錯誤。
 */
export function courseFromLegacy(lang) {
  const map = { en: 'zh-en', ja: 'zh-ja', th: 'zh-th' };
  return map[lang] || null;
}

/** 從請求 body 取出課程 id，同時吃新舊兩種格式 */
export function readCourse(body) {
  if (!body) return null;
  if (validCourse(body.course)) return body.course;
  const legacy = courseFromLegacy(body.lang);
  return legacy && validCourse(legacy) ? legacy : null;
}
