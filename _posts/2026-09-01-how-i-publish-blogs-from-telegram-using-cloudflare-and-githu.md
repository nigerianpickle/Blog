---
layout: post
title: "How I Publish Blogs from Telegram Using Cloudflare and GitHub"
date: 2026-09-01 14:14:28
backdrop: /assets/img/2026-09-01-how-i-publish-blogs-from-telegram-using-cloudflare-and-githu-backdrop.jpg
excerpt: "I have a lot of things I've procrastinated on. Like this blog, like this side project I'm writing. Most of the time it's some limbic friction I feel. But more often, I think it's b"
---

I have a lot of things I've procrastinated on. Like this blog, like this side project I'm writing. Most of the time it's some limbic friction I feel. But more often, I think it's because the processes in my day-to-day life aren't as streamlined as they could be with AI. There's a lot AI can do for us, especially in terms of running tasks autonomously.([I'm not the only one who thinks this way either.](https://www.linkedin.com/pulse/how-automate-your-daily-tasks-using-ai-golabstech-idg6e/))

So I finally put on my engineering hat and started working on this project. The reason I wanted a blog I could publish from Telegram was simple: I wanted to be able to write and publish on my very long commute to work.

So what did I actually need?

A blog that was live, and a way for Telegram to talk to it.

## The problem, structured

Before touching any code, the requirement broke down into 3 main concerns:

Constraint 1 (the trigger has to be a chat message)

Since the way I wanted the system to be designed was mostly conversational, since I would be writing this on my commute, on a phone.

Constraint 2 (the site should be easy to manage)

I needed a site with no server to run updates on, no database to back up, and nothing that cost money.

Constraint 3 (the conversational end and blog post needed to communicate)

I needed to come up with a simple protocol for communication between the 2 ends of my system.

After taking some time to think and consulting with over a thousand experts (prompting Claude's 85,000 MOE), I finally arrived at a solution for each of my constraints.

## My solution

For constraint 1 (the trigger):

I used a Telegram bot. Telegram makes it very easy to consult with the BotFather and get a bot created.

![]({{ "/assets/img/2026-09-01-how-i-publish-blogs-from-telegram-using-cloudflare-and-githu-1.jpg" | relative_url }})

Telegram's Bot API supports webhooks natively, so Telegram can push an event to a URL the moment a message arrives, which was perfect. This was exactly what I needed to create a blog conversationally from Telegram.

For constraint 2 (easy site):

The solution for the easy site was sitting right in front of me. I used GitHub Pages running Jekyll with static output. This provided me with free hosting, and made the source of truth just files in a Git repo. That meant "publishing a post" could be reduced to "committing a file". The process of handling commits has an existing, well-documented API.

For constraint 3 (the connection):

Duh duh duh.

This is where I feel the actual skill sits. The Sprezzatura, the It factor, whatever you may call it.

Point being, this is where the actual engineering decision lived. A webhook needs something listening on a public URL, and I didn't want to run or pay for a server that sits idle 99% of the time waiting for a commute.

So I needed serverless computers. Cloudflare Workers fit exactly: near-zero cost at low volume, no infrastructure to maintain, and a request/response model that matches what a webhook actually needs.

That decision immediately created a new problem, though, which turned out to be the most interesting part of the build.

## State on stateless infrastructure

Serverless compute is stateless by design, so every request gets a fresh context with no memory of the last one.

But for what I wanted, I wanted to create the blog post piece by piece, conversationally. Every part of the blog post isn't a single request. It's a conversation: send a title, then an image, then several paragraphs, then confirm.

So what does this mean for my stateless worker? The system has to remember which step you're on between messages that might arrive minutes apart, and the compute layer handling those messages has no built-in way to remember anything.

## Hot Fix!

The fix, once I actually understood it: the Worker has amnesia after every single message. So instead of trying to remember anything itself, it writes a note to itself in a shared notebook (Cloudflare KV) after every message, and reads that note back before deciding what to do next.

The conversation isn't held in the Worker's memory at all.

So where's the conversation actually living?

In a JSON object sitting in Cloudflare KV, labeled with my Telegram chat ID. That object is just four things: what step I'm on, my title so far, a reference to my header image, and a list of everything I've written or sent. Every message, the Worker's entire job is: read that object, update it based on what I just sent, save it back.

After fixing that, we have our publishing pipeline.

## Publishing: what actually happens

When you confirm a post, the Worker does a sequence of things against GitHub's Contents API: fetch each image's bytes from Telegram, commit each one, assemble the markdown and front matter, commit that.

So a single post I write might actually be four or five separate saves happening behind the scenes: one per image, plus one for the post itself.

Every part of my blog is decoupled when my Worker is building it.

Let that stick with you...

There's no transaction wrapping the whole sequence. If the process fails partway through, you can end up with an orphaned image committed with no post referencing it, and no clean way to resume from where it stopped.

This is a limitation of my system right now, and I think the fix would be a more durable job record written before the calls to the GitHub API start. But that's next weekend's problem.

## Closing

It works now. I write on the bus and it's live by the time I get to my desk at work. There are still some rough edges, but I'm probably going to keep working and refactoring this project

![My blog haha]({{ "/assets/img/2026-09-01-how-i-publish-blogs-from-telegram-using-cloudflare-and-githu-2.jpg" | relative_url }})

*My blog haha*
