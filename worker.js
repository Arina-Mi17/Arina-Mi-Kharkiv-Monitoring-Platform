/**
 * ARINA MI MONITOR — Telegram channel bridge (Cloudflare Worker)
 *
 * Required Worker bindings / variables:
 *   BOT_TOKEN       Secret: Telegram bot token (never commit it)
 *   WEBHOOK_SECRET  Secret: random 32+ character webhook secret
 *   ADMIN_IDS       Variable: comma-separated numeric Telegram user IDs
 *   CHANNEL_USERNAME Variable: channel username without @ (optional)
 *   MESSAGES        KV namespace binding
 *
 * Routes:
 *   POST /telegram/webhook  Telegram updates
 *   GET  /api/messages      approved public civil messages only
 *   GET  /health            health check
 *
 * Channel posts are NEVER published automatically. They enter a private
 * moderation queue and require an administrator's /approve command.
 * Do not approve posts containing exact target positions, routes, directions,
 * movement, military locations, or other operationally sensitive details.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders, ...extraHeaders },
  });
}

function isAdmin(userId, env) {
  const allowed = (env.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  return allowed.includes(String(userId));
}

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram API error");
  return result.result;
}

async function sendText(env, chatId, text) {
  return telegram(env, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

function extractPost(update, env) {
  const post = update.channel_post;
  if (!post) return null;
  const text = (post.text || post.caption || "").trim();
  if (!text) return null;
  const id = `${post.chat.id}_${post.message_id}`;
  const username = env.CHANNEL_USERNAME ? env.CHANNEL_USERNAME.replace(/^@/, "") : "";
  const sourceUrl = username ? `https://t.me/${username}/${post.message_id}` : "";
  return {
    id,
    text: text.slice(0, 5000),
    date: post.date || Math.floor(Date.now() / 1000),
    sourceUrl,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

async function handleCommand(update, env) {
  const message = update.message;
  if (!message || !message.text || !message.from) return;
  const chatId = message.chat.id;
  const userId = message.from.id;
  const [command, ...args] = message.text.trim().split(/\s+/);
  const cmd = command.split("@")[0].toLowerCase();

  if (cmd === "/start" || cmd === "/help") {
    await sendText(env, chatId,
      "ARINA MI MONITOR — керування повідомленнями\n\n" +
      "/status — стан сервісу\n/pending — дописи на перевірці\n" +
      "/approve ID — опублікувати перевірений цивільний допис\n\n" +
      "Публікація на сайті відбувається лише після ручного підтвердження адміністратора.");
    return;
  }

  if (cmd === "/status") {
    await sendText(env, chatId, "Бот отримує команди. Модуль каналу працює через webhook; дописи проходять ручну модерацію.");
    return;
  }

  if (!isAdmin(userId, env)) {
    await sendText(env, chatId, "Ця команда доступна лише адміністратору.");
    return;
  }

  if (cmd === "/pending") {
    const listed = await env.MESSAGES.list({ prefix: "pending:", limit: 20 });
    if (!listed.keys.length) {
      await sendText(env, chatId, "Немає дописів, що очікують перевірки.");
      return;
    }
    const rows = [];
    for (const key of listed.keys) {
      const item = await env.MESSAGES.get(key.name, "json");
      if (item) rows.push(`ID: ${item.id}\n${item.text.slice(0, 450)}`);
    }
    await sendText(env, chatId, "ДОПИСИ НА ПЕРЕВІРЦІ\n\n" + rows.join("\n\n---\n\n"));
    return;
  }

  if (cmd === "/approve") {
    const id = args[0];
    if (!id || !/^-?\d+_\d+$/.test(id)) {
      await sendText(env, chatId, "Формат: /approve ID\nСпочатку відкрий /pending.");
      return;
    }
    const key = `pending:${id}`;
    const item = await env.MESSAGES.get(key, "json");
    if (!item) {
      await sendText(env, chatId, "Допис не знайдено або його вже опрацьовано.");
      return;
    }
    item.status = "published";
    item.publishedAt = new Date().toISOString();
    await env.MESSAGES.put(`public:${id}`, JSON.stringify(item));
    await env.MESSAGES.delete(key);
    await sendText(env, chatId, "Допис опубліковано на сайті. Перевір його в розділі повідомлень.");
    return;
  }

  await sendText(env, chatId, "Невідома команда. Надішли /help.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (url.pathname === "/health") return json({ ok: true, service: "arina-mi-monitor-bridge" });

    if (url.pathname === "/api/messages" && request.method === "GET") {
      if (!env.MESSAGES) return json({ error: "Storage is not configured" }, 503);
      const listed = await env.MESSAGES.list({ prefix: "public:", limit: 100 });
      const messages = [];
      for (const key of listed.keys) {
        const item = await env.MESSAGES.get(key.name, "json");
        if (item && item.status === "published") {
          messages.push({
            id: item.id,
            text: item.text,
            date: item.date,
            publishedAt: item.publishedAt,
            sourceUrl: item.sourceUrl,
          });
        }
      }
      messages.sort((a, b) => b.date - a.date);
      return json({ messages });
    }

    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) return json({ error: "Unauthorized" }, 401);
      if (!env.BOT_TOKEN || !env.MESSAGES) return json({ error: "Worker is not configured" }, 503);
      let update;
      try { update = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

      try {
        if (update.message) {
          await handleCommand(update, env);
        } else if (update.channel_post) {
          const item = extractPost(update, env);
          if (item) {
            await env.MESSAGES.put(`pending:${item.id}`, JSON.stringify(item));
            const admins = (env.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
            for (const adminId of admins) {
              try { await sendText(env, adminId, `Новий допис каналу очікує перевірки.\nID: ${item.id}\nВідкрий /pending для перегляду.`); } catch {}
            }
          }
        }
      } catch (error) {
        return json({ error: error.message || "Webhook processing failed" }, 500);
      }
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  },
};
