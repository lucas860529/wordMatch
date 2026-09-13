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

  /* ============================ 課程生成 ============================ */

  // 伺服器會連訊息一起回，這裡是拿不到訊息時的備援文案
  var FALLBACK = {
    rate_limited: "今天的生成次數用到上限了，或 Gemini 的免費額度暫時滿了。等一下再試。",
    bad_input: "送出的內容不合格，改一下再試。",
    upstream: "生成服務出了狀況，再試一次。",
    bad_json: "回傳的內容格式不完整，通常再生成一次就會好。",
    offline: "目前離線。已存下來的課程可以讀，生成新課程需要連線。",
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
   * 生成一堂課。
   *
   * 前端只送 lang 與 topic —— **prompt 在伺服器端**。這是刻意的：
   * 如果前端可以送任意 prompt，任何人都能把這支 Gemini 金鑰當免費的通用 LLM 用。
   */
  LL.generate = function (lang, topic, opts) {
    opts = opts || {};
    if (!navigator.onLine) return Promise.reject(err("offline"));

    return fetch("/api/lesson", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang: lang, topic: topic }),
      signal: opts.signal
    }).catch(function (e) {
      if (e && e.name === "AbortError") throw err("cancelled");
      throw err("network");
    }).then(function (res) {
      return res.json().catch(function () {
        throw err("bad_json");
      }).then(function (payload) {
        if (!res.ok || !payload || payload.ok !== true) {
          throw err((payload && payload.code) || "upstream", payload && payload.message);
        }
        return payload.lesson;
      });
    });
  };

  /* ============================ 發音 ============================ */

  /**
   * 為什麼不用瀏覽器內建的 speechSynthesis：品質看裝置，而且泰文在很多裝置上
   * 根本沒有語音 —— 更糟的是瀏覽器會退而拿英文語音去念泰文，聲調全錯。
   * 對一個拿來練聲調的工具，錯的發音比沒有聲音更危險。
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
   * 念一段文字。
   *
   * 失敗時**靜默降級**成不發音（只回 false）—— 點一個詞念不出來就彈對話框，
   * 讀一段課文會被打斷十次。
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
      if (!blob || seq !== mine) return false;
      urls[id] = URL.createObjectURL(blob);
      return play(urls[id], mine);
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

    // 先問瀏覽器的 Cache Storage —— 跨 session 有效，重開 app 同一個詞還是免費
    return caches.open(CACHE).then(function (c) {
      return c.match(cacheUrl).then(function (hit) {
        if (hit) return hit.blob();
        return fetchSpeech(lang, text, rate, voice).then(function (blob) {
          if (!blob) return null;
          c.put(cacheUrl, new Response(blob.slice(), {
            headers: { "content-type": "audio/mpeg" }
          })).catch(function () {});
          return blob;
        });
      });
    }).catch(function () {
      // 沒有 Cache Storage（或無痕視窗擋掉）就直接打 API
      return fetchSpeech(lang, text, rate, voice);
    });
  }

  function fetchSpeech(lang, text, rate, voice) {
    return fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang: lang, text: text, rate: rate, voice: voice })
    }).then(function (res) {
      if (!res.ok) return null;
      return res.blob();
    }).catch(function () {
      return null; // 靜默降級
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
      return seq === mine ? ok : false;
    });
  }

  LL.speech = Speech;

  /* ============================ 語言切換 ============================ */

  LL.LANGS = [
    { id: "en", path: "/en/", label: "英文" },
    { id: "ja", path: "/ja/", label: "日文" },
    { id: "th", path: "/th/", label: "泰文" }
  ];

  /** 記住最後看的語言，根目錄會導向這裡 */
  LL.remember = function (lang) {
    try { localStorage.setItem("ll.lang", lang); } catch (e) {}
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
