# Підключення Telegram-бота до ARINA MI MONITOR

## Що вже додано
Файл `worker.js` містить серверний обробник для Cloudflare Workers:
- відповідає на `/start`, `/help`, `/status`;
- приймає дописи каналу через Telegram webhook;
- кладе їх у чергу на модерацію;
- публікує на API сайту лише після команди адміністратора `/approve ID`;
- віддає схвалені повідомлення через `/api/messages`.

## Що потрібно налаштувати у Cloudflare
1. Створити Worker і вставити в нього вміст `worker.js`.
2. Створити KV namespace, наприклад `ARINA_MESSAGES`, і прив'язати його до Worker під назвою `MESSAGES`.
3. У Worker → Settings → Variables and Secrets додати:
   - Secret `BOT_TOKEN` — токен від BotFather. Не надсилати його в чат і не записувати в GitHub.
   - Secret `WEBHOOK_SECRET` — випадковий секрет не коротший за 32 символи.
   - Variable `ADMIN_IDS` — числовий Telegram user ID адміністратора (можна кілька через кому).
   - Variable `CHANNEL_USERNAME` — username каналу без символу @.
4. Зберегти й опублікувати Worker.

## Підключити webhook
Після публікації Worker отримати його адресу, наприклад `https://назва-worker.ім'я-акаунта.workers.dev`.
Webhook встановлюється запитом до Telegram Bot API методом `setWebhook` з параметрами:
- `url`: `https://...workers.dev/telegram/webhook`
- `secret_token`: те саме значення, що збережене як `WEBHOOK_SECRET`
- `allowed_updates`: `["message","channel_post"]`

Токен бота має залишатися тільки в Cloudflare Secret. Не вставляйте його у відкритий URL, GitHub, сайт або чат.

## Перевірка
1. Написати боту в особисті повідомлення `/start`, потім `/status`.
2. Переконатися, що бот є адміністратором каналу з правом отримувати дописи.
3. Опублікувати тестовий цивільний допис у каналі.
4. У приватному чаті з ботом виконати `/pending`.
5. Після перевірки безпечності опублікувати його командою `/approve ID`.
6. Перевірити `https://...workers.dev/api/messages`.

## Важливо
Зараз сайт GitHub Pages ще не має адреси Worker для завантаження `/api/messages`. Після створення Worker потрібно додати його публічну адресу в інтеграцію сторінки й перевірити відображення. Не схвалюйте повідомлення з точними позиціями, маршрутами, напрямками чи переміщенням повітряних/військових цілей.