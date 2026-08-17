# Blog

A static blog you publish to from Telegram.

Posts open with a full-bleed backdrop image that dissolves into the page, with the title sitting on the seam. Below that: the body, your links, and a contact address.

**[Setup instructions →](SETUP.md)**

## How it works

```
Telegram  →  Cloudflare Worker  →  GitHub commit  →  Pages rebuild
```

The Worker walks you through a post one step at a time, then commits a markdown file and your images straight to this repo. GitHub Pages does the rest. Nothing else is running anywhere.

## Layout

| Path | What it is |
|---|---|
| `_config.yml` | Site title, links, contact. **The only file you edit by hand.** |
| `_posts/` | Published posts. The bot writes here. |
| `assets/img/` | Backdrops and inline images. The bot writes here. |
| `_layouts/post.html` | The hero, body, and prev/next |
| `_layouts/default.html` | Head, masthead, and the links + contact footer |
| `index.html` | The post list |
| `assets/css/style.css` | Everything visual |
| `bot/` | The Cloudflare Worker. Excluded from the site build. |

## Changing the look

Colours and typefaces are variables at the top of `assets/css/style.css`:

```css
--void:   #0E1113;   /* page */
--ink:    #EAE7E1;   /* text */
--haze:   #8E959B;   /* secondary text */
--signal: #B9A3FF;   /* links, accents */
```

Swapping `--signal` changes the accent everywhere. If you change typefaces, update the Google Fonts `<link>` in `_layouts/default.html` to match.

## Post front matter

The bot writes this for you, but if you want to add a post by hand, drop a file in `_posts/` named `YYYY-MM-DD-some-slug.md`:

```yaml
---
layout: post
title: "Your title"
date: 2026-08-17 14:30:00
backdrop: /assets/img/2026-08-17-some-slug-backdrop.jpg
excerpt: "One or two sentences for the post list."
---
```

`backdrop` is optional — leave it out and the hero falls back to a gradient.

## Running the site locally

Optional, and it needs Ruby.

```bash
gem install bundler jekyll
jekyll serve
```

Then open `http://localhost:4000`.
