const { Telegraf } = require("telegraf");
const fs = require("fs");
const path = require("path");
const express = require("express");
const fetch = require("node-fetch");

const app = express();

app.get("/", (req, res) => res.send("Бот работает"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express сервер запущен на порту ${PORT}`);
});

// Замените на свой Telegram ID владельца
const OWNER_ID = Number(process.env.OWNER_ID);

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("Ошибка: не задан TOKEN");
  process.exit(1);
}
if (!OWNER_ID) {
  console.error("Ошибка: не задан OWNER_ID");
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

// Пути к файлам данных
const adminsFile = path.join(__dirname, "admins.json");
const blacklistFile = path.join(__dirname, "blacklist.json");
const blacklistedAdminsFile = path.join(__dirname, "blacklisted_admins.json");

// Загрузка или инициализация данных
function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let admins = loadJSON(adminsFile);
let blacklist = loadJSON(blacklistFile);
let blacklistedAdmins = loadJSON(blacklistedAdminsFile);

// Проверка прав
function isOwner(id) {
  return id === OWNER_ID;
}

function isAdmin(id) {
  return admins.includes(id) && !blacklistedAdmins.includes(id);
}

function isBlacklisted(id) {
  return blacklist.includes(id);
}

async function resolveUserId(ctx, input) {
  if (!input) return null;
  input = input.trim();
  if (/^\d+$/.test(input)) {
    return Number(input);
  }
  if (input.startsWith("@")) {
    try {
      const user = await ctx.telegram.getChat(input);
      return user.id;
    } catch {
      return null;
    }
  }
  return null;
}

function adminOnly(ctx, next) {
  const id = ctx.from.id;
  if (isOwner(id) || isAdmin(id)) return next();
  ctx.reply("🚫 У вас нет прав для выполнения этой команды.");
}

function ownerOnly(ctx, next) {
  if (isOwner(ctx.from.id)) return next();
  ctx.reply("🚫 Только владелец может это делать.");
}

// Команды

bot.start((ctx) => {
  ctx.reply(
    `Привет, ${ctx.from.first_name}!\n` +
      `Я админ-бот.\n` +
      `Используй /help для списка команд.`
  );
});

bot.command("help", (ctx) => {
  const helpText = `
Список команд:
/start — приветствие
/help — эта справка

👑 Владелец бота:
/addadmin <@username|id> — добавить админа
/removeadmin <@username|id> — удалить админа
/admins — список админов

🛡 Админы:
/kick <@username|id> — кикнуть
/ban <@username|id> — забанить навсегда
/ban_temp <@username|id> <1m/1h/1d> — временный бан
/mute <@username|id> <1m/1h/1d> — мут на время
/blacklist <@username|id> — добавить в ЧС
/unblacklist <@username|id> — убрать из ЧС
/blacklist_admin <@username|id> — заблокировать админа
/unblacklist_admin <@username|id> — разблокировать админа

/wiki <запрос> — поиск в Википедии
  `;
  ctx.reply(helpText);
});

bot.command("admins", ownerOnly, async (ctx) => {
  if (admins.length === 0) return ctx.reply("Админов пока нет.");
  let text = "Список админов:\n";
  for (const id of admins) {
    try {
      const user = await ctx.telegram.getChat(id);
      text += `- ${user.username ? "@" + user.username : user.first_name || id} (${id})\n`;
    } catch {
      text += `- ID: ${id}\n`;
    }
  }
  ctx.reply(text);
});

bot.command("addadmin", ownerOnly, async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  if (args.length === 0) return ctx.reply("Использование: /addadmin @username или ID");

  const userId = await resolveUserId(ctx, args[0]);
  if (!userId) return ctx.reply("Не удалось найти пользователя.");

  if (admins.includes(userId)) return ctx.reply("Пользователь уже админ.");
  admins.push(userId);
  saveJSON(adminsFile, admins);
  ctx.reply(`✅ Пользователь с ID ${userId} добавлен в админы.`);
});

bot.command("removeadmin", ownerOnly, async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  if (args.length === 0) return ctx.reply("Использование: /removeadmin @username или ID");

  const userId = await resolveUserId(ctx, args[0]);
  if (!userId) return ctx.reply("Не удалось найти пользователя.");

  if (!admins.includes(userId)) return ctx.reply("Пользователь не является админом.");
  admins = admins.filter((id) => id !== userId);
  saveJSON(adminsFile, admins);
  ctx.reply(`✅ Пользователь с ID ${userId} удалён из админов.`);
});

bot.command("kick", adminOnly, async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  if (args.length === 0) return ctx.reply("Использование: /kick @username или ID");

  const userId = await resolveUserId(ctx, args[0]);
  if (!userId) return ctx.reply("Не удалось найти пользователя.");
  try {
    await ctx.kickChatMember(userId);
    ctx.reply(`✅ Пользователь ${args[0]} был кикнут.`);
  } catch (e) {
    ctx.reply("Ошибка при попытке кикнуть пользователя.");
  }
});

bot.command("ban", adminOnly, async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  if (args.length === 0) return ctx.reply("Использование: /ban @username или ID");

  const userId = await resolveUserId(ctx, args[0]);
  if (!userId) return ctx.reply("Не удалось найти пользователя.");

  if (isBlacklisted(userId)) return ctx.reply("Пользователь уже в чёрном списке.");

  blacklist.push(userId);
  saveJSON(blacklistFile, blacklist);

  try {
    await ctx.kickChatMember(userId);
  } catch {}

  ctx.reply(`✅ Пользователь ${args[0]} забанен (черный список).`);
});

bot.command("unblacklist", adminOnly, async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  if (args.length === 0) return ctx.reply("Использование: /unblacklist @username или ID");

  const userId = await resolveUserId(ctx, args[0]);
  if (!userId) return ctx.reply("Не удалось найти пользователя.");

  if (!isBlacklisted(userId)) return ctx.reply("Пользователь не в чёрном списке.");

  blacklist = blacklist.filter((id) => id !== userId);
  saveJSON(blacklistFile, blacklist);

  ctx.reply(`✅ Пользователь ${args[0]} удалён из чёрного списка.`);
});

bot.command("blacklist_admin", ownerOnly, async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  if (args.length === 0) return ctx.reply("Использование: /blacklist_admin @username или ID");

  const userId = await resolveUserId(ctx, args[0]);
  if (!userId) return ctx.reply("Не удалось найти пользователя.");

  if (blacklistedAdmins.includes(userId)) return ctx.reply("Админ уже в чёрном списке.");

  blacklistedAdmins.push(userId);
  saveJSON(blacklistedAdminsFile, blacklistedAdmins);

  ctx.reply(`✅ Админ с ID ${userId} заблокирован (не может использовать команды).`);
});

bot.command("unblacklist_admin", ownerOnly, async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  if (args.length === 0) return ctx.reply("Использование: /unblacklist_admin @username или ID");

  const userId = await resolveUserId(ctx, args[0]);
  if (!userId) return ctx.reply("Админ не в чёрном списке.");

  blacklistedAdmins = blacklistedAdmins.filter((id) => id !== userId);
  saveJSON(blacklistedAdminsFile, blacklistedAdmins);

  ctx.reply(`✅ Админ с ID ${userId} разблокирован.`);
});

bot.command("mute", adminOnly, async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  if (args.length < 2) return ctx.reply("Использование: /mute @username|id 10m");

  // Получаем ID пользователя — работает с @username и с ID
  const userId = await resolveUserId(ctx, args[0]);
  if (!userId) return ctx.reply("Не удалось найти пользователя.");

  const duration = parseDuration(args[1]);
  if (!duration) return ctx.reply("Неверный формат времени (пример: 10m, 1h, 1d)");

  try {
    await ctx.telegram.restrictChatMember(ctx.chat.id, userId, {
      permissions: {
        can_send_messages: false,
        can_send_media_messages: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
      },
      until_date: Math.floor(Date.now() / 1000) + duration,
    });
    ctx.reply(`✅ Пользователь ${args[0]} замучен на ${args[1]}`);
  } catch (err) {
    console.error(err);
    ctx.reply("Ошибка при попытке замутить пользователя.");
  }
});

bot.command("ban_temp", adminOnly, async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  if (args.length < 2) return ctx.reply("Использование: /ban_temp @username 1h");

  const userId = await resolveUserId(ctx, args[0]);
  if (!userId) return ctx.reply("Не удалось найти пользователя.");

  const duration = parseDuration(args[1]);
  if (!duration) return ctx.reply("Неверный формат времени (пример: 10m, 1h, 1d)");

  try {
    await ctx.telegram.kickChatMember(ctx.chat.id, userId, {
      until_date: Math.floor(Date.now() / 1000) + duration,
    });
    ctx.reply(`✅ Пользователь ${args[0]} забанен на ${args[1]}`);
  } catch {
    ctx.reply("Ошибка при попытке временно забанить пользователя.");
  }
});

function parseDuration(str) {
  const match = str.match(/^(\d+)([mhd])$/);
  if (!match) return null;
  const val = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "m":
      return val * 60;
    case "h":
      return val * 60 * 60;
    case "d":
      return val * 60 * 60 * 24;
    default:
      return null;
  }
}

bot.command("wiki", async (ctx) => {
  const query = ctx.message.text.split(" ").slice(1).join(" ");
  if (!query) return ctx.reply("Введите запрос для Википедии.");

  const url = `https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return ctx.reply("Не удалось получить данные с Википедии.");
    const data = await res.json();
    let text = `*${data.title}*\n${data.extract}`;
    if (data.content_urls?.desktop?.page) {
      text += `\n[Читать далее](${data.content_urls.desktop.page})`;
    }
    ctx.replyWithMarkdown(text);
  } catch {
    ctx.reply("Ошибка при запросе к Википедии.");
  }
});

// Обработчик всех сообщений - проверка ЧС
bot.use((ctx, next) => {
  if (isBlacklisted(ctx.from.id)) {
    return ctx.reply("Вы в чёрном списке и не можете использовать бота.");
  }
  if (isAdmin(ctx.from.id) === false && admins.includes(ctx.from.id)) {
    // Если админ заблокирован - не дать доступ
    return ctx.reply("Вы заблокированы как админ и не можете использовать команды.");
  }
  return next();
});

bot.launch().then(() => console.log("Бот запущен"));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
