---
layout: post
title: "Hello world"
date: 2026-08-17 09:00:00
excerpt: "The first post, written to check that the pipeline works end to end."
---

This post exists to prove the pipeline works. Delete it once you've published something real — send `/list` to the bot, then tap it and confirm.

It has no backdrop image, so the hero falls back to a gradient. Every post the bot creates will have one on top unless you tap **Skip image**.

## How a post gets here

You open Telegram, tap **New post**, and answer three questions: title, backdrop, body. The bot commits a markdown file and your images to this repo, and GitHub rebuilds the site. About a minute, start to finish.

Everything below the body — the links, the contact address — comes from `_config.yml`, not from the post. Edit it once and it updates everywhere.

> Formatting works the way you'd expect. Bold, italics, links, lists, quotes like this one.

- Each Telegram message becomes its own paragraph
- Photos you send while writing get placed inline, in order
- Captions on those photos become the caption underneath

Send `/new` when you're ready.
