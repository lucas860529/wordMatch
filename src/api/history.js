/**
 * GET    /api/history?lang=en        列出這個人在這個語言的課程（不含內文）
 * GET    /api/history?id=xxx         取一堂課的完整內容
 * DELETE /api/history?id=xxx         刪一堂課
 *
 * 課程原本只存在瀏覽器的 localStorage，換裝置就沒了。這裡把它搬到 D1，
 * localStorage 留著當本機快取（開頁時會用伺服器的資料覆寫過去）。
 */

import { currentUser, sameOrigin } from './_shared/auth.js';
import { validCourse } from './_shared/courses.js';
import { fail, json } from './_shared/guard.js';

const LIST_LIMIT = 200;

export async function onRequestGet({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return fail('unauthorized', '還沒登入。', 401);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (id) {
    const row = await env.DB.prepare(
      'SELECT id, lang, topic, title, body, created_at FROM lessons WHERE id = ? AND user_id = ?',
    ).bind(id, user.id).first();

    if (!row) return fail('not_found', '找不到這堂課。', 404);

    return json({ ok: true, lesson: toEntry(row, true) });
  }

  const course = url.searchParams.get('course');
  if (!validCourse(course)) return fail('bad_input', '課程代碼不對。');

  // 清單不帶 body —— 歷史列表只需要標題跟時間，把整份課程 JSON 一起拉出來
  // 會讓這支端點隨著使用愈來愈慢
  const { results } = await env.DB.prepare(
    `SELECT id, lang, topic, title, created_at FROM lessons
      WHERE user_id = ? AND lang = ?
      ORDER BY created_at DESC LIMIT ?`,
  ).bind(user.id, course, LIST_LIMIT).all();

  return json({ ok: true, items: (results || []).map((r) => toEntry(r, false)) });
}

export async function onRequestDelete({ request, env }) {
  if (!sameOrigin(request)) return fail('bad_input', '來源不對。', 403);

  const user = await currentUser(env, request);
  if (!user) return fail('unauthorized', '還沒登入。', 401);

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return fail('bad_input', '沒有指定要刪哪一堂。');

  // user_id 一起帶進 WHERE —— 不然知道 id 就能刪別人的
  await env.DB.prepare('DELETE FROM lessons WHERE id = ? AND user_id = ?')
    .bind(id, user.id).run();

  return json({ ok: true });
}

/** 存課程。由 /api/lesson 在生成成功後直接呼叫，前端不用多送一次請求 */
export async function save(env, userId, { id, course, topic, title, lesson }) {
  await env.DB.prepare(
    `INSERT INTO lessons (id, user_id, lang, topic, title, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, userId, course, topic, title, JSON.stringify(lesson), Date.now()).run();
}

function toEntry(row, withBody) {
  const out = {
    id: row.id,
    course: row.lang,   // 欄位名還叫 lang，存的是課程 id（見 db/migrations）
    topic: row.topic,
    title: row.title,
    createdAt: row.created_at,
  };
  if (withBody) {
    try { out.lesson = JSON.parse(row.body); } catch { out.lesson = null; }
  }
  return out;
}
