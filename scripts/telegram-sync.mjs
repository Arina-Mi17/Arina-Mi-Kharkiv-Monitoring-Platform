import fs from "node:fs";
import path from "node:path";

const token = process.env.TELEGRAM_BOT_TOKEN;
const channel = (process.env.TELEGRAM_CHANNEL_USERNAME || "kharkiv_info_chanel").replace(/^@/, "").toLowerCase();
if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN repository secret");

async function call(method, body) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!data.ok) throw new Error("Telegram " + method + ": " + (data.description || response.status));
  return data.result;
}

const offsetPath = ".telegram-offset";
const dataPath = "data/messages.json";
const offset = fs.existsSync(offsetPath) ? Number(fs.readFileSync(offsetPath, "utf8").trim() || 0) : 0;
const current = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, "utf8")) : { messages: [] };
const updates = await call("getUpdates", { offset, timeout: 0, allowed_updates: ["channel_post"] });

let nextOffset = offset;
let changed = false;
for (const update of updates) {
  nextOffset = Math.max(nextOffset, update.update_id + 1);
  const post = update.channel_post;
  if (!post || !post.chat || (post.chat.username || "").toLowerCase() !== channel) continue;
  const text = (post.text || post.caption || "").trim();
  if (!text) continue;

  // Only posts explicitly selected by the channel owner for the public civil feed.
  const normalized = text.toLocaleLowerCase("uk");
  if (!normalized.includes("#намапу") || !normalized.includes("#цивільне")) continue;

  // Exclude operational details and target tracking from the public website.
  const sensitive = /(координат|широт|довгот|азимут|курс(?:\s|:)|маршрут|летить|рухається|переміщ|ціль|fpv|шахед|іскандер|кинджал|ракет|ппо|позиці|пусков|військов)/iu;
  if (sensitive.test(text) || /\b\d{1,2}[.,]\d{3,}\s*[,;/ ]\s*\d{1,3}[.,]\d{3,}\b/u.test(text)) continue;

  const townTags = {
    "#місто_харків": "Харків", "#місто_дергачі": "Дергачі", "#місто_чугуїв": "Чугуїв",
    "#місто_богодухів": "Богодухів", "#місто_мерефа": "Мерефа", "#місто_зміїв": "Зміїв",
    "#місто_балаклія": "Балаклія", "#місто_ізюм": "Ізюм", "#місто_лозова": "Лозова",
    "#місто_купянськ": "Куп’янськ"
  };
  const townEntry = Object.entries(townTags).find(([tag]) => normalized.includes(tag));
  const id = String(post.chat.id) + "_" + String(post.message_id);
  if (current.messages.some((item) => item.id === id)) continue;
  current.messages.unshift({
    id,
    town: townEntry ? townEntry[1] : "",
    text: text.replace(/#намапу|#цивільне|#місто_[а-яіїєґ_]+/giu, "").trim(),
    date: post.date || Math.floor(Date.now() / 1000),
    sourceUrl: "https://t.me/" + channel + "/" + post.message_id,
    category: "Цивільне повідомлення",
  });
  changed = true;
}
current.messages = current.messages.slice(0, 100);
fs.mkdirSync(path.dirname(dataPath), { recursive: true });
fs.writeFileSync(dataPath, JSON.stringify(current, null, 2) + "\n");
fs.writeFileSync(offsetPath, String(nextOffset) + "\n");
console.log(changed ? "New selected civil posts added." : "No new eligible posts.");
