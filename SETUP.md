# Setup

Two halves: the site on GitHub, then the bot on Cloudflare. About fifteen minutes.

You need [Node 18+](https://nodejs.org) installed, a GitHub account, and a Cloudflare account (free).

---

## Part 1 — The site

### 1. Make the repo

Create a new repo on GitHub and push these files to it.

The name matters for your URL:

| Repo name | Your site lives at | In `_config.yml` |
|---|---|---|
| `username.github.io` | `https://username.github.io` | `baseurl: ""` |
| anything else, e.g. `blog` | `https://username.github.io/blog` | `baseurl: "/blog"` |

On a free GitHub account the repo has to be **public** for Pages to work.

```bash
git init
git add .
git commit -m "Blog"
git branch -M main
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

### 2. Edit `_config.yml`

Set `title`, `tagline`, `author`, `url`, `baseurl`, your `links`, and your `contact` email. This is the only file you edit by hand — it feeds the footer on every page.

### 3. Turn on Pages

Repo → **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → **Save**.

Give it a minute, then load your URL. You should see the site with the "Hello world" post on it.

**Don't move on until this loads.** If the bot can commit but Pages isn't on, nothing will appear and you won't know why.

---

## Part 2 — The bot

### 4. Create the bot

In Telegram, message [@BotFather](https://t.me/BotFather):

- `/newbot` → pick a name and a username ending in `bot`
- Copy the token it gives you. It looks like `8123456789:AAH...`

Optional, but makes it nicer to use — still in BotFather:

- `/setcommands` → pick your bot → paste:

```
new - Write a post
list - See published posts
done - Finish writing
cancel - Throw away the draft
help - What this bot does
```

### 5. Create a GitHub token

Go to [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new).

- **Repository access** → Only select repositories → pick your blog repo
- **Permissions** → Repository permissions → **Contents: Read and write**
- Set an expiry you'll remember, generate, copy the token

Contents is the only permission it needs. Don't grant more.

### 6. Make up a webhook secret

Any random string. This is what proves an incoming request is really from Telegram.

```bash
openssl rand -hex 32
```

Copy it somewhere for a minute — you'll paste it twice.

### 7. Configure and deploy

```bash
cd bot
npm install
npx wrangler login
```

Create the storage the bot keeps drafts in:

```bash
npx wrangler kv namespace create BLOG_BOT
```

It prints an `id`. Open `wrangler.toml` and paste it into `id = "PASTE_KV_NAMESPACE_ID_HERE"`.

While you're in `wrangler.toml`, set:

- `GITHUB_REPO` — `"username/repo"`
- `SITE_URL` — your Pages URL, including `/blog` if you used a baseurl
- `SITE_TZ` — leave as `America/Winnipeg` or change it

Now the three secrets, one at a time. Each command prompts you to paste the value:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put GITHUB_TOKEN
```

Deploy:

```bash
npx wrangler deploy
```

It prints your Worker URL — something like `https://blog-bot.yourname.workers.dev`. Copy it.

### 8. Point Telegram at it

Open this in a browser, with your Worker URL and the webhook secret from step 6:

```
https://blog-bot.yourname.workers.dev/setup?key=YOUR_WEBHOOK_SECRET
```

You want to see `"ok": true`. If you get `Wrong key.`, the secret you typed doesn't match the one you set with `wrangler secret put`.

### 9. Lock it to you

Message your bot `/start`. It'll refuse and tell you your numeric Telegram ID.

Put that ID in `wrangler.toml`:

```toml
ALLOWED_USER_IDS = "123456789"
```

Then `npx wrangler deploy` again.

Send `/start` once more. You should get the welcome message and a keyboard.

---

## Writing a post

`/new` or tap **New post**, then:

1. Send the title
2. Send the backdrop image, or tap **Skip image**
3. Write. Every message is a paragraph. Photos go inline where you send them, and captions become captions.
4. Tap **Done writing** → check the preview → **Publish**

The bot replies with the live URL. GitHub takes 30–60 seconds to rebuild, so wait a moment before opening it.

Markdown works in the body: `**bold**`, `*italic*`, `[text](url)`, `## heading`, `- list`, `> quote`, and code fences.

Send photos as a **file** rather than a photo if you want full resolution — Telegram compresses photos to about 1280px.

To delete something: `/list`, tap the post, confirm. It removes the post and its images.

---

## When something goes wrong

**Nothing happens when I message the bot.** Watch the logs live — run `npx wrangler tail` in the `bot` folder, then send a message.

**"GitHub refused ... (404)"** — `GITHUB_REPO` is wrong, or the token doesn't have access to that specific repo.

**"GitHub refused ... (403)"** — the token is missing **Contents: Read and write**, or it expired.

**Published, but the post isn't on the site.** Check the repo — if the `.md` file is in `_posts/`, the commit worked and it's Pages. Look at **Actions** in your repo for a failed build, usually a stray character in a title.

**The image is missing but the post is there.** Check `baseurl` in `_config.yml` matches your repo name.

**"Telegram wouldn't hand over that file"** — the draft sat longer than Telegram keeps the file around. Start over with `/new`.

**Drafts vanish** after seven days of no activity. That's deliberate.

---

## Costs

Free. Cloudflare's free tier allows 100,000 Worker requests a day; a post uses a handful. GitHub Pages is free for public repos. The only limit worth knowing is Cloudflare KV's 1,000 writes a day — each message you send while writing is one write, so you'd need to be extraordinarily chatty to hit it.
