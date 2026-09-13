/**
 * Service worker —— 只負責「應用外殼離線也打得開」。
 *
 * 兩條規則不能破：
 * 1. **/api/* 一律走網路、絕不進快取。** 課程生成與發音都是即時的，
 *    快取一個 POST 回應只會讓人看到別人的東西或過期的錯誤。
 * 2. 頁面用 network-first。課程內容存在 localStorage 不在這裡，
 *    所以快取的只是外殼；外殼有更新時要能馬上拿到新的。
 */

const VERSION = 'v2';  // 課程化，路徑全變了，一定要換版號把舊快取清掉
const SHELL = `ll-shell-${VERSION}`;

// 用「能抓到就存」而不是 addAll —— addAll 只要一個 404 整批都會失敗，SW 就裝不起來。
// 課程會愈加愈多，這樣比較不怕漏。
const PRECACHE = [
  '/',
  '/zh-en/',
  '/zh-ja/',
  '/zh-th/',
  '/th-zh/',
  '/th-en/',
  '/login/',
  '/shared/ll.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('ll-shell-') && k !== SHELL)
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // 鐵則：API 不碰快取
  if (url.pathname.startsWith('/api/')) return;

  // 發音的音檔由 ll.js 自己管在另一個 cache（ll-tts-v1），這裡不插手
  if (url.pathname.startsWith('/__tts/')) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      // 只存成功的同源回應。opaque 或 4xx/5xx 存進去只會讓離線時看到壞頁面
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(SHELL);
        cache.put(request, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch {
      const hit = await caches.match(request);
      if (hit) return hit;

      // 離線又沒快取過這一頁：導覽請求給一句人話，不要是瀏覽器的恐龍頁
      if (request.mode === 'navigate') {
        const shell = await caches.match('/');
        if (shell) return shell;
      }
      return new Response('離線中，而且這一頁還沒被快取過。', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
