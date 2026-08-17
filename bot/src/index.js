/**
 * Blog bot — Telegram in, GitHub commits out.
 *
 * Flow: /new -> title -> backdrop -> body (any number of messages,
 * text and photos) -> preview -> Publish. Draft state lives in KV and
 * expires after a week.
 */

const DRAFT_TTL = 60 * 60 * 24 * 7;

/* ── entry point ─────────────────────────────────────────── */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // One-time webhook registration: visit /setup?key=<TELEGRAM_WEBHOOK_SECRET>
    if (url.pathname === "/setup") {
      if (url.searchParams.get("key") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("Wrong key.", { status: 403 });
      }
      const res = await tg(env, "setWebhook", {
        url: `${url.origin}/`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      return json(res);
    }

    if (request.method !== "POST") {
      return new Response("Blog bot is running.", { status: 200 });
    }

    if (request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    // Answer Telegram immediately, do the work after.
    ctx.waitUntil(safeHandle(update, env));
    return new Response("ok");
  },
};

async function safeHandle(update, env) {
  const chatId = update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
  try {
    await handleUpdate(update, env);
  } catch (err) {
    console.log("handler error:", err?.stack || String(err));
    if (chatId) {
      await send(env, chatId, `Something broke: ${escapeHtml(String(err?.message || err))}\n\nYour draft is safe. Try that step again.`);
    }
  }
}

/* ── routing ─────────────────────────────────────────────── */

async function handleUpdate(update, env) {
  if (update.callback_query) return handleCallback(update.callback_query, env);
  if (update.message) return handleMessage(update.message, env);
}

async function handleMessage(msg, env) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!isAllowed(userId, env)) {
    await send(env, chatId,
      `This bot only publishes for its owner.\n\nYour Telegram ID is <code>${userId}</code> — if that's you, add it to <code>ALLOWED_USER_IDS</code> and redeploy.`);
    return;
  }

  const text = (msg.text || "").trim();
  const cmd = normalizeCommand(text);

  if (cmd === "/start" || cmd === "/help") return showHelp(env, chatId);
  if (cmd === "/cancel") {
    await clearDraft(env, chatId);
    return send(env, chatId, "Draft dropped. <code>/new</code> when you want to start again.");
  }
  if (cmd === "/new") return startDraft(env, chatId);
  if (cmd === "/list") return listPosts(env, chatId);

  const draft = await getDraft(env, chatId);

  if (!draft) {
    return send(env, chatId, "No draft in progress. Tap <b>New post</b> or send <code>/new</code>.", mainKeyboard());
  }

  if (cmd === "/done") return showPreview(env, chatId, draft);

  switch (draft.step) {
    case "title":   return takeTitle(env, chatId, draft, text);
    case "image":   return takeBackdrop(env, chatId, draft, msg);
    case "content": return takeContent(env, chatId, draft, msg);
    case "confirm":
      return send(env, chatId, "Draft's ready — use the buttons above to publish, keep writing, or discard it.");
    default:
      await clearDraft(env, chatId);
      return send(env, chatId, "Lost track of that draft. Send <code>/new</code> to restart.");
  }
}

function normalizeCommand(text) {
  const map = {
    "📝 New post": "/new",
    "📚 My posts": "/list",
    "✅ Done writing": "/done",
    "❌ Cancel": "/cancel",
    "❓ Help": "/help",
  };
  if (map[text]) return map[text];
  if (text.startsWith("/")) return text.split(/[\s@]/)[0].toLowerCase();
  return null;
}

/* ── steps ───────────────────────────────────────────────── */

async function showHelp(env, chatId) {
  await send(env, chatId,
    `<b>Blog bot</b>\n\n` +
    `<code>/new</code> — write a post\n` +
    `<code>/list</code> — see what's published, delete a post\n` +
    `<code>/done</code> — finish writing and see the preview\n` +
    `<code>/cancel</code> — throw away the current draft\n\n` +
    `While writing you can send as many messages as you like. Photos go inline where you send them; captions become captions.`,
    mainKeyboard());
}

async function startDraft(env, chatId) {
  await putDraft(env, chatId, { step: "title", title: "", backdrop: null, blocks: [] });
  await send(env, chatId, "<b>New post.</b>\n\nWhat's the title?", cancelKeyboard());
}

async function takeTitle(env, chatId, draft, text) {
  if (!text) return send(env, chatId, "Titles have to be text. Send one.");
  if (text.length > 120) return send(env, chatId, "That's over 120 characters — trim it a bit.");

  draft.title = text;
  draft.step = "image";
  await putDraft(env, chatId, draft);

  await send(env, chatId,
    `Title: <b>${escapeHtml(text)}</b>\n\nNow send the backdrop image — the one that sits behind the title. Send it as a file instead of a photo if you want full resolution.`,
    { inline_keyboard: [[{ text: "Skip image", callback_data: "skipimg" }]] });
}

async function takeBackdrop(env, chatId, draft, msg) {
  const file = pickImage(msg);
  if (!file) return send(env, chatId, "That wasn't an image. Send a photo, or tap <b>Skip image</b>.");

  draft.backdrop = file.fileId;
  draft.step = "content";
  await putDraft(env, chatId, draft);
  await promptForBody(env, chatId);
}

async function promptForBody(env, chatId) {
  await send(env, chatId,
    `Backdrop saved. <b>Now write the post.</b>\n\n` +
    `Every message becomes a paragraph. Photos land inline where you send them. Markdown works — <code>**bold**</code>, <code>[text](url)</code>, <code>## headings</code>, <code>- lists</code>.\n\n` +
    `Tap <b>Done writing</b> when you've finished.`,
    writingKeyboard());
}

async function takeContent(env, chatId, draft, msg) {
  const file = pickImage(msg);

  if (file) {
    draft.blocks.push({ type: "image", fileId: file.fileId, caption: msg.caption || "" });
  } else if (msg.text) {
    draft.blocks.push({ type: "text", text: msg.text });
  } else {
    return send(env, chatId, "I can only take text and photos in the body.");
  }

  await putDraft(env, chatId, draft);
  await react(env, chatId, msg.message_id, "👍");
}

async function showPreview(env, chatId, draft) {
  if (!draft.blocks.length) {
    return send(env, chatId, "The post is empty. Write something first, then tap <b>Done writing</b>.");
  }

  draft.step = "confirm";
  await putDraft(env, chatId, draft);

  const words = draft.blocks
    .filter((b) => b.type === "text")
    .reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  const photos = draft.blocks.filter((b) => b.type === "image").length;

  const body = draft.blocks.map((b) => (b.type === "text" ? b.text : "[photo]")).join("\n\n");
  const peek = body.length > 400 ? body.slice(0, 400) + "…" : body;

  await send(env, chatId,
    `<b>${escapeHtml(draft.title)}</b>\n` +
    `<i>${draft.backdrop ? "backdrop set" : "no backdrop"} · ${words} words · ${photos} inline photo${photos === 1 ? "" : "s"}</i>\n\n` +
    `<blockquote>${escapeHtml(peek)}</blockquote>`,
    {
      inline_keyboard: [
        [{ text: "Publish", callback_data: "publish" }],
        [{ text: "Keep writing", callback_data: "resume" }, { text: "Discard", callback_data: "discard" }],
      ],
    });
}

/* ── button presses ──────────────────────────────────────── */

async function handleCallback(cq, env) {
  const chatId = cq.message.chat.id;
  const data = cq.data || "";

  if (!isAllowed(cq.from?.id, env)) {
    return tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Not your blog." });
  }

  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });

  if (data === "skipimg") {
    const draft = await getDraft(env, chatId);
    if (!draft) return send(env, chatId, "That draft's gone. Send <code>/new</code>.");
    draft.backdrop = null;
    draft.step = "content";
    await putDraft(env, chatId, draft);
    await stripButtons(env, chatId, cq.message.message_id);
    return promptForBody(env, chatId);
  }

  if (data === "resume") {
    const draft = await getDraft(env, chatId);
    if (!draft) return send(env, chatId, "That draft's gone. Send <code>/new</code>.");
    draft.step = "content";
    await putDraft(env, chatId, draft);
    await stripButtons(env, chatId, cq.message.message_id);
    return send(env, chatId, "Still listening — keep going.", writingKeyboard());
  }

  if (data === "discard") {
    await clearDraft(env, chatId);
    await stripButtons(env, chatId, cq.message.message_id);
    return send(env, chatId, "Discarded.", mainKeyboard());
  }

  if (data === "publish") {
    const draft = await getDraft(env, chatId);
    if (!draft) return send(env, chatId, "That draft's gone. Send <code>/new</code>.");
    await stripButtons(env, chatId, cq.message.message_id);
    return publish(env, chatId, draft);
  }

  if (data.startsWith("del:")) return confirmDelete(env, chatId, data.slice(4));
  if (data.startsWith("yesdel:")) return doDelete(env, chatId, data.slice(7));
  if (data === "nodel") return send(env, chatId, "Left alone.");
}

/* ── publishing ──────────────────────────────────────────── */

async function publish(env, chatId, draft) {
  const status = await send(env, chatId, "Publishing…");
  const statusId = status?.result?.message_id;
  const edit = (t) => statusId && tg(env, "editMessageText", { chat_id: chatId, message_id: statusId, text: t, parse_mode: "HTML" });

  const { date, time } = localNow(env.SITE_TZ || "America/Winnipeg");

  // Find a filename nobody's using
  let slug = slugify(draft.title);
  let path = `_posts/${date}-${slug}.md`;
  let n = 2;
  while (await fileExists(env, path)) {
    slug = `${slugify(draft.title)}-${n}`;
    path = `_posts/${date}-${slug}.md`;
    n++;
    if (n > 40) throw new Error("Too many posts with that title today.");
  }
  const stem = `${date}-${slug}`;

  let backdropPath = null;
  if (draft.backdrop) {
    await edit("Uploading backdrop…");
    const { bytes, ext } = await downloadTgFile(env, draft.backdrop);
    backdropPath = `/assets/img/${stem}-backdrop.${ext}`;
    await putFile(env, backdropPath.slice(1), toBase64(bytes), `Backdrop for ${draft.title}`);
  }

  const parts = [];
  let i = 0;
  for (const block of draft.blocks) {
    if (block.type === "text") {
      parts.push(normalizeBody(block.text));
      continue;
    }
    i++;
    await edit(`Uploading photo ${i}…`);
    const { bytes, ext } = await downloadTgFile(env, block.fileId);
    const imgPath = `/assets/img/${stem}-${i}.${ext}`;
    await putFile(env, imgPath.slice(1), toBase64(bytes), `Image ${i} for ${draft.title}`);
    const alt = block.caption ? escapeMd(block.caption) : "";
    parts.push(block.caption ? `![${alt}](${imgPath})\n\n*${alt}*` : `![](${imgPath})`);
  }

  const firstText = draft.blocks.find((b) => b.type === "text")?.text || "";
  const excerpt = firstText.replace(/[#*_`>\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);

  const frontMatter = [
    "---",
    "layout: post",
    `title: ${yaml(draft.title)}`,
    `date: ${date} ${time}`,
    backdropPath ? `backdrop: ${backdropPath}` : null,
    excerpt ? `excerpt: ${yaml(excerpt)}` : null,
    "---",
    "",
  ].filter(Boolean).join("\n");

  await edit("Committing the post…");
  await putFile(env, path, toBase64(new TextEncoder().encode(frontMatter + parts.join("\n\n") + "\n")),
    `Post: ${draft.title}`);

  await clearDraft(env, chatId);

  const [y, m, d] = date.split("-");
  const liveUrl = `${(env.SITE_URL || "").replace(/\/$/, "")}/${y}/${m}/${d}/${slug}/`;

  await edit(
    `<b>Published.</b>\n\n${escapeHtml(draft.title)}\n${liveUrl}\n\n` +
    `<i>GitHub takes 30–60 seconds to rebuild, so give it a moment before you open it.</i>`);
}

/* ── listing and deleting ────────────────────────────────── */

async function listPosts(env, chatId) {
  const res = await gh(env, `/repos/${env.GITHUB_REPO}/contents/_posts?ref=${env.GITHUB_BRANCH}`);
  if (res.status === 404) return send(env, chatId, "Nothing published yet.");
  if (!res.ok) throw new Error(`GitHub ${res.status}`);

  const files = (await res.json())
    .filter((f) => f.name.endsWith(".md"))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, 20);

  if (!files.length) return send(env, chatId, "Nothing published yet.");

  const index = files.map((f) => f.name);
  await env.BLOG_BOT.put(`idx:${chatId}`, JSON.stringify(index), { expirationTtl: 3600 });

  const rows = index.map((name, i) => [{ text: prettyName(name), callback_data: `del:${i}` }]);

  await send(env, chatId,
    `<b>${index.length} post${index.length === 1 ? "" : "s"}</b>\n\nTap one to delete it.`,
    { inline_keyboard: rows });
}

async function confirmDelete(env, chatId, idxRaw) {
  const index = JSON.parse((await env.BLOG_BOT.get(`idx:${chatId}`)) || "[]");
  const name = index[Number(idxRaw)];
  if (!name) return send(env, chatId, "That list expired. Send <code>/list</code> again.");

  await send(env, chatId, `Delete <b>${escapeHtml(prettyName(name))}</b>? This removes the post and its images.`, {
    inline_keyboard: [[
      { text: "Delete it", callback_data: `yesdel:${idxRaw}` },
      { text: "Keep it", callback_data: "nodel" },
    ]],
  });
}

async function doDelete(env, chatId, idxRaw) {
  const index = JSON.parse((await env.BLOG_BOT.get(`idx:${chatId}`)) || "[]");
  const name = index[Number(idxRaw)];
  if (!name) return send(env, chatId, "That list expired. Send <code>/list</code> again.");

  await deleteFile(env, `_posts/${name}`, `Delete post ${name}`);

  // Images share the post's filename stem
  const stem = name.replace(/\.md$/, "");
  const imgs = await gh(env, `/repos/${env.GITHUB_REPO}/contents/assets/img?ref=${env.GITHUB_BRANCH}`);
  if (imgs.ok) {
    for (const f of await imgs.json()) {
      if (f.name.startsWith(stem + "-")) await deleteFile(env, `assets/img/${f.name}`, `Delete image ${f.name}`);
    }
  }

  await send(env, chatId, `Deleted <b>${escapeHtml(prettyName(name))}</b>. The site rebuilds in about a minute.`);
}

function prettyName(filename) {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  if (!m) return filename;
  return `${m[1]} · ${m[2].replace(/-/g, " ")}`;
}

/* ── GitHub ──────────────────────────────────────────────── */

function gh(env, path, options = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "blog-telegram-bot",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

async function fileExists(env, path) {
  const res = await gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}?ref=${env.GITHUB_BRANCH}`);
  return res.ok;
}

async function putFile(env, path, base64, message) {
  const head = await gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}?ref=${env.GITHUB_BRANCH}`);
  const sha = head.ok ? (await head.json()).sha : undefined;

  const res = await gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: base64, branch: env.GITHUB_BRANCH, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new Error(`GitHub refused ${path} (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

async function deleteFile(env, path, message) {
  const head = await gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}?ref=${env.GITHUB_BRANCH}`);
  if (!head.ok) return;
  const { sha } = await head.json();
  await gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}`, {
    method: "DELETE",
    body: JSON.stringify({ message, sha, branch: env.GITHUB_BRANCH }),
  });
}

const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

/* ── Telegram ────────────────────────────────────────────── */

async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) console.log(`telegram ${method} failed:`, JSON.stringify(data));
  return data;
}

const send = (env, chatId, text, reply_markup) =>
  tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(reply_markup ? { reply_markup } : {}) });

const react = (env, chatId, messageId, emoji) =>
  tg(env, "setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji }] });

const stripButtons = (env, chatId, messageId) =>
  tg(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });

const mainKeyboard = () => ({
  keyboard: [[{ text: "📝 New post" }], [{ text: "📚 My posts" }, { text: "❓ Help" }]],
  resize_keyboard: true,
});

const writingKeyboard = () => ({
  keyboard: [[{ text: "✅ Done writing" }, { text: "❌ Cancel" }]],
  resize_keyboard: true,
});

const cancelKeyboard = () => ({
  keyboard: [[{ text: "❌ Cancel" }]],
  resize_keyboard: true,
});

function pickImage(msg) {
  if (msg.photo?.length) {
    const best = msg.photo[msg.photo.length - 1];
    return { fileId: best.file_id };
  }
  if (msg.document && (msg.document.mime_type || "").startsWith("image/")) {
    return { fileId: msg.document.file_id };
  }
  return null;
}

async function downloadTgFile(env, fileId) {
  const info = await tg(env, "getFile", { file_id: fileId });
  if (!info.ok) throw new Error("Telegram wouldn't hand over that file — it may be older than 24 hours.");

  const filePath = info.result.file_path;
  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);

  let ext = (filePath.split(".").pop() || "jpg").toLowerCase();
  if (!/^(jpg|jpeg|png|gif|webp|avif)$/.test(ext)) ext = "jpg";

  return { bytes: new Uint8Array(await res.arrayBuffer()), ext };
}

/* ── draft state ─────────────────────────────────────────── */

const draftKey = (chatId) => `draft:${chatId}`;

async function getDraft(env, chatId) {
  const raw = await env.BLOG_BOT.get(draftKey(chatId));
  return raw ? JSON.parse(raw) : null;
}

const putDraft = (env, chatId, draft) =>
  env.BLOG_BOT.put(draftKey(chatId), JSON.stringify(draft), { expirationTtl: DRAFT_TTL });

const clearDraft = (env, chatId) => env.BLOG_BOT.delete(draftKey(chatId));

function isAllowed(userId, env) {
  const allowed = (env.ALLOWED_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return false;
  return allowed.includes(String(userId));
}

/* ── text helpers ────────────────────────────────────────── */

function slugify(s) {
  return (
    s.toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’`]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "post"
  );
}

/**
 * Phone typing uses single newlines where markdown wants blank lines.
 * Insert the blank lines, but leave lists, quotes and headings tight.
 */
function normalizeBody(text) {
  if (text.includes("```")) return text;

  const lines = text.split("\n");
  const isBlock = (l) => /^\s*(?:[-*+]\s|\d+[.)]\s|>|#{1,6}\s|\|)/.test(l);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const cur = lines[i];
    const next = lines[i + 1];
    if (next === undefined) break;
    if (!cur.trim() || !next.trim()) continue;
    if (isBlock(cur) && isBlock(next)) continue;
    out.push("");
  }
  return out.join("\n");
}

const yaml = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const escapeMd = (s) => s.replace(/([\[\]()])/g, "\\$1");

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function localNow(timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(new Date()).map((p) => [p.type, p.value]));

  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}:${parts.second}`,
  };
}

const json = (obj) => new Response(JSON.stringify(obj, null, 2), { headers: { "Content-Type": "application/json" } });
