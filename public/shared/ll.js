/**
 * 三語研究室的共用底層。三個語言的頁面共用這一份。
 *
 * 這一層取代了原本 artifact 版的兩個東西：
 *   window.claude.use("sample")  →  POST /api/lesson
 *   window.speechSynthesis       →  POST /api/tts（Google Cloud TTS）
 *
 * 頁面本身（React 那一大坨）幾乎不用動，只是把呼叫對象換掉。
 *
 * 這是傳統 script 不是 module —— 頁面的程式是 IIFE，直接掛 window.LL 最省事。
 */
(function () {
  "use strict";

  var LL = {};

  // 由 tools/release.sh 更新，顯示在頁尾 —— 用來確認眼前這頁是哪一版。
  // 進版規則見 CHANGELOG.md。
  LL.VERSION = "1.2.1";

  /* ============================ 課程生成 ============================ */

  // 伺服器會連訊息一起回，這裡是拿不到訊息時的備援文案
  var FALLBACK = {
    rate_limited: "今天的生成次數用到上限了，或 Gemini 的免費額度暫時滿了。等一下再試。",
    bad_input: "送出的內容不合格，改一下再試。",
    upstream: "生成服務出了狀況，再試一次。",
    bad_json: "回傳的內容格式不完整，通常再生成一次就會好。",
    offline: "目前離線。已存下來的課程可以讀，生成新課程需要連線。",
    unauthorized: "登入已經過期，請重新登入。",
    network: "連線出了狀況，再試一次。",
    cancelled: ""
  };

  LL.ERRORS = FALLBACK;

  function err(code, message) {
    var e = new Error(message || FALLBACK[code] || FALLBACK.network);
    e.code = code;
    return e;
  }

  /**
   * 生成一堂課。回傳 { id, title, lesson } —— 課程在伺服器端就已經寫進 D1，
   * id 是那筆紀錄的 id，前端沿用它，兩邊才對得起來。
   *
   * 前端只送 lang 與 topic —— **prompt 在伺服器端**。這是刻意的：
   * 如果前端可以送任意 prompt，任何人都能把這支 Gemini 金鑰當免費的通用 LLM 用。
   */
  LL.generate = function (course, topic, opts) {
    opts = opts || {};
    if (!navigator.onLine) return Promise.reject(err("offline"));

    return fetch("/api/lesson", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ course: course, topic: topic }),
      signal: opts.signal
    }).catch(function (e) {
      if (e && e.name === "AbortError") throw err("cancelled");
      throw err("network");
    }).then(function (res) {
      return res.json().catch(function () {
        throw err("bad_json");
      }).then(function (payload) {
        if (!res.ok || !payload || payload.ok !== true) {
          var code = (payload && payload.code) || "upstream";
          if (code === "unauthorized") return kickToLogin();
          throw err(code, payload && payload.message);
        }
        return { id: payload.id, title: payload.title, lesson: payload.lesson };
      });
    });
  };

  /* ============================ 發音 ============================ */

  /**
   * **發音只有 Google Cloud TTS 一種，沒有任何後備。**
   *
   * 不用瀏覽器內建的 speechSynthesis：品質看裝置，而且泰文在很多裝置上
   * 根本沒有語音 —— 更糟的是瀏覽器會退而拿英文語音去念泰文，聲調全錯。
   * 對一個拿來練聲調的工具，錯的發音比沒有聲音更危險。
   *
   * **失敗一律回報錯誤，不靜默降級。** 原本是靜默的（想法是「讀課文時
   * 每個念不出來的詞都彈對話框會很煩」），代價是出問題時畫面上看不出
   * 任何原因 —— 使用者只覺得「壞了」，也無從回報。現在會顯示一則
   * 可關閉的提示，講清楚是額度、連線、還是服務端的問題。
   *
   * iOS 的兩個硬限制決定了這一段的結構：
   *   1. 音訊只能由使用者手勢啟動  → unlock()
   *   2. 連續播放必須沿用同一個 Audio 實例，每次 new Audio() 會被擋
   *      → 整個頁面只有一個 audioEl
   */

  var CACHE = "ll-tts-v1";

  var audioEl = null;
  var unlocked = false;
  var urls = {};        // 記憶體快取：同一次瀏覽重播免再解碼
  var seq = 0;          // 每次播放遞增，回呼比對後才生效
  var queueSeq = 0;

  var Speech = {};

  // 發音出錯時通知頁面。頁面自己決定怎麼顯示、用哪個語言的文案
  var errListeners = [];
  Speech.onError = function (fn) { errListeners.push(fn); };
  function emitError(code) {
    for (var i = 0; i < errListeners.length; i++) {
      try { errListeners[i](code); } catch (e) {}
    }
  }

  Speech.unlock = function () {
    if (unlocked) return;
    unlocked = true;
    try {
      audioEl = new Audio();
      audioEl.preload = "auto";
      audioEl.src = silentWav();
      var p = audioEl.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {
      audioEl = null;
    }
  };

  // 手寫 44 bytes 的 WAV 標頭、資料長度 0。比塞一坨 base64 好讀也不會有編碼問題
  function silentWav() {
    var bytes = new Uint8Array(44);
    var view = new DataView(bytes.buffer);
    function put(off, s) { for (var i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); }

    put(0, "RIFF");
    view.setUint32(4, 36, true);
    put(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    put(36, "data");
    view.setUint32(40, 0, true);

    return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  }

  /** 只停目前這一句，不動連續播放的佇列 */
  function stopAudio() {
    seq++;
    try {
      if (audioEl) { audioEl.pause(); audioEl.currentTime = 0; }
    } catch (e) { /* 還沒載入就 pause 會抱怨，無所謂 */ }
  }

  /** 使用者按停止：連佇列一起收掉 */
  Speech.stop = function () {
    queueSeq++;
    stopAudio();
  };

  /**
   * 念一段文字。回傳 Promise<boolean>；失敗時透過 onError 通知頁面。
   */
  Speech.speak = function (lang, text, key, opts) {
    opts = opts || {};
    Speech.unlock();
    stopAudio(); // 只打斷這一句；用 stop() 會把自己所屬的佇列也殺掉

    var word = String(text || "").trim();
    if (!word) return Promise.resolve(false);

    var mine = ++seq;
    var rate = opts.rate || 1;
    var voice = opts.voice || "";
    var id = lang + "|" + voice + "|" + rate + "|" + word;

    if (urls[id]) return play(urls[id], mine);

    return loadBlob(lang, word, rate, voice, id).then(function (blob) {
      if (seq !== mine) return false;
      urls[id] = URL.createObjectURL(blob);
      return play(urls[id], mine);
    }).catch(function (e) {
      if (seq === mine) emitError((e && e.code) || "upstream");
      return false;
    });
  };

  /**
   * 依序念一串。中途 stop() 會提早結束。
   * 每個 item 自己帶 lang —— 單字總表是跨語言的，用同一個語言去念會全部念錯。
   *
   * @param items [{ lang, text, key, voice }]
   */
  Speech.playQueue = function (items, opts) {
    opts = opts || {};
    Speech.unlock();
    Speech.stop();
    var mine = ++queueSeq;

    return items.reduce(function (chain, item) {
      return chain.then(function () {
        if (queueSeq !== mine) return;
        if (opts.onItem) opts.onItem(item);
        return Speech.speak(item.lang, item.text, item.key, {
          rate: opts.rate,
          voice: item.voice || opts.voice
        }).then(function () {
          if (queueSeq !== mine) return;
          return wait(220);
        });
      });
    }, Promise.resolve()).then(function () {
      if (opts.onDone && queueSeq === mine) opts.onDone();
    });
  };

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function loadBlob(lang, text, rate, voice, id) {
    var cacheUrl = location.origin + "/__tts/" + encodeURIComponent(id);

    // 先問瀏覽器的 Cache Storage —— 跨 session 有效，重開 app 同一個詞還是免費。
    // 快取本身失敗不算錯誤（無痕視窗就沒有），用 then 的第二個參數接住，
    // 才不會把後面 fetchSpeech 丟出來的錯誤也一起吞掉
    return caches.open(CACHE).then(function (c) {
      return c.match(cacheUrl).then(function (hit) {
        if (hit) return hit.blob();
        return fetchSpeech(lang, text, rate, voice).then(function (blob) {
          c.put(cacheUrl, new Response(blob.slice(), {
            headers: { "content-type": "audio/mpeg" }
          })).catch(function () {});
          return blob;
        });
      });
    }, function () {
      return fetchSpeech(lang, text, rate, voice);
    });
  }

  function speechError(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }

  function fetchSpeech(lang, text, rate, voice) {
    if (!navigator.onLine) return Promise.reject(speechError("offline"));

    return fetch("/api/tts", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang: lang, text: text, rate: rate, voice: voice })
    }).catch(function () {
      throw speechError("network");
    }).then(function (res) {
      if (res.ok) return res.blob();

      // 伺服器回的 code 直接用，分得出是額度、沒登入、還是上游壞掉
      return res.json().catch(function () { return null; }).then(function (data) {
        if (data && data.code === "unauthorized") kickToLogin();
        throw speechError((data && data.code) || "upstream");
      });
    });
  }

  function play(url, mine) {
    if (!audioEl) return Promise.resolve(false);

    return new Promise(function (resolve) {
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        audioEl.removeEventListener("ended", onEnd);
        audioEl.removeEventListener("error", onErr);
        resolve(ok);
      }
      function onEnd() { finish(true); }
      function onErr() { finish(false); }

      audioEl.addEventListener("ended", onEnd);
      audioEl.addEventListener("error", onErr);

      try {
        audioEl.src = url;
        var p = audioEl.play();
        if (p && p.catch) p.catch(function () { finish(false); });
      } catch (e) {
        finish(false);
      }
    }).then(function (ok) {
      if (seq !== mine) return false;
      // 音檔拿到了卻播不出來 —— 多半是瀏覽器的自動播放限制
      if (!ok) emitError("playback");
      return ok;
    });
  }

  LL.speech = Speech;

  /* ============================ 語言切換 ============================ */

  /**
   * 課程 = 母語 × 學習語言。
   *
   * 加入「泰語母語者學中文」之前只有一個軸（學習語言），說明語言寫死繁中。
   * 現在兩個軸都要選，所以網址變成 /{母語}-{學習語言}/。
   * 舊網址 /en/ /ja/ /th/ 由 Worker 做 301 轉址，已經加到主畫面的 app 不會壞。
   */
  LL.COURSES = [
    { id: "zh-en", ui: "zh", target: "en", path: "/zh-en/", label: "英文",     uiLabel: "繁體中文" },
    { id: "zh-ja", ui: "zh", target: "ja", path: "/zh-ja/", label: "日文",     uiLabel: "繁體中文" },
    { id: "zh-th", ui: "zh", target: "th", path: "/zh-th/", label: "泰文",     uiLabel: "繁體中文" },
    { id: "th-zh", ui: "th", target: "zh", path: "/th-zh/", label: "ภาษาจีน",     uiLabel: "ภาษาไทย" },
    { id: "th-en", ui: "th", target: "en", path: "/th-en/", label: "ภาษาอังกฤษ", uiLabel: "ภาษาไทย" }
  ];

  /** 同一個母語底下有哪些學習語言 —— 語言列只列這些，不會混到別的母語 */
  LL.siblings = function (ui) {
    return LL.COURSES.filter(function (c) { return c.ui === ui; });
  };

  /** 記住最後看的課程，根目錄會導向這裡 */
  LL.remember = function (course) {
    try { localStorage.setItem("ll.course", course); } catch (e) {}
  };

  LL.lastCourse = function () {
    try { return localStorage.getItem("ll.course"); } catch (e) { return null; }
  };

  /* ============================ 歷史 ============================ */

  /**
   * 課程歷史存在伺服器的 D1 裡，localStorage 只是本機快取。
   * 這樣換手機、換瀏覽器、清快取，紀錄都還在。
   */
  var History = {};

  /**
   * 開頁時用伺服器的清單覆寫本機的。
   *
   * 只抓清單不抓內文 —— 內文等使用者真的點開那一堂再抓（見 get()）。
   * 一次把所有課程的 JSON 拉下來會愈用愈慢。
   */
  History.hydrate = function (prefix, course) {
    return fetch("/api/history?course=" + encodeURIComponent(course), { credentials: "same-origin" })
      .then(function (res) {
        if (res.status === 401) { kickToLogin(); return null; }
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || data.ok !== true) return null;

        // 伺服器是事實來源，但不能整個覆寫掉本機 —— 首次開啟塞進去的示範課程
        // 不在 D1 裡，直接覆寫會把它洗掉。所以伺服器的排前面，本機獨有的接在後面。
        var merged = data.items.slice();
        var seen = {};
        merged.forEach(function (it) { seen[it.id] = true; });
        try {
          var local = JSON.parse(localStorage.getItem(prefix + ".index") || "[]");
          if (Array.isArray(local)) {
            local.forEach(function (it) {
              if (it && it.id && !seen[it.id]) merged.push(it);
            });
          }
        } catch (e) { /* 讀不到就只用伺服器那份 */ }

        try {
          localStorage.setItem(prefix + ".index", JSON.stringify(merged));
        } catch (e) { /* 無痕視窗寫不進去，畫面仍然吃得到回傳值 */ }
        return merged;
      })
      .catch(function () { return null; });
  };

  /** 取一堂課的完整內容。本機快取沒有的時候才會用到 */
  History.get = function (id) {
    return fetch("/api/history?id=" + encodeURIComponent(id), { credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { return data && data.ok ? data.lesson : null; })
      .catch(function () { return null; });
  };

  History.remove = function (id) {
    return fetch("/api/history?id=" + encodeURIComponent(id), {
      method: "DELETE",
      credentials: "same-origin"
    }).catch(function () { /* 刪不掉不擋畫面，本機那份已經移除了 */ });
  };

  LL.history = History;

  /* ============================ 登入 ============================ */

  function kickToLogin() {
    var next = encodeURIComponent(location.pathname + location.search);
    location.replace("/login/?next=" + next);
    // 回一個永遠不 resolve 的 Promise，避免呼叫端在轉頁途中又跑下一步
    return new Promise(function () {});
  }

  LL.logout = function () {
    return fetch("/api/logout", { method: "POST", credentials: "same-origin" })
      .catch(function () {})
      .then(function () { location.replace("/login/"); });
  };

  /* ============================ PWA ============================ */

  // 只快取應用外殼；/api/* 一律走網路（規則在 sw.js 裡）
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  window.LL = LL;
})();
