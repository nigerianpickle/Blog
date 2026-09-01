---
layout: post
title: "Fine-tuning NLLB for Ìjẹ̀bú Yorùbá"
date: 2026-09-01 14:59:44
backdrop: /assets/img/2026-09-01-fine-tuning-nllb-for-ijebu-yoruba-backdrop.jpg
excerpt: "Motivation"
---

## Motivation

### What Is NLLB?

NLLB: No Language Left Behind is a multilingual translation model. It’s trained on data using data mining techniques tailored for low-resource languages and supports over 200 languages.

My mom is Yorùbá, specifically from an Ìjẹ̀bú background. Growing up with that background, one thing I caught on to;  is that "Yorùbá" isn't really one language. There's a version everyone treats as the default (which is mostly drawn from Ọ̀yọ́), and then there's what people actually speak at home, which can sound pretty different depending on where your family is from. Words, pronunciation, sometimes whole phrasing changes.

This isn't just a personal observation, it's a documented gap. Yorùbá has something like 47 million speakers across Nigeria, Benin, and Togo, and standard Yorùbá has gotten real attention from NLP researchers over the years, but until pretty recently, basically none of the non-standard dialects had any dedicated resources at all.

![Yoruba has the 37th highest speakers in the world \(https://en.wikipedia.org/wiki/List_of_languages_by_total_number_of_speakers#cite_note-9\)]({{ "/assets/img/2026-09-01-fine-tuning-nllb-for-ijebu-yoruba-1.jpg" | relative_url }})

*Yoruba has the 37th highest speakers in the world \(https://en.wikipedia.org/wiki/List_of_languages_by_total_number_of_speakers#cite_note-9\)*

That's the general pattern with low-resource language work, actually: the "low-resource" conversation almost always means most of the data about the ethnology of language is missing.

I came across a Global Voices interview with Aremu Anuoluwapo, a computational linguist who, along with Oreva Ahia (a PhD student at the University of Washington), built YorùLect specifically to address this.

The story behind it is a lot more grounded than "we scraped some data." Anuoluwapo traces the idea back to an undergrad dialectology course, where he first noticed that even a basic word like "stool" differs between his hometown dialect and standard Yorùbá. He and Ahia later worked out the project's framework in person, and he then traveled to the specific communities where each target dialect is spoken to actually collect the data,   deliberately choosing dialects from different regional branches of the language (southwest, southeast, and beyond) rather than just picking whatever was easiest to reach.

A few things from that interview reframed how I'm thinking about this project. First, they'd already run the comparison I was planning to run myself: 

They tested existing ASR and MT systems on these dialects before any fine-tuning and found the pure performance was bad, with fine-tuning helping but not closing the gap evenly.

Interestingly, they found Ifè came out closest to standard Yorùbá, and Ìlàje came out most different, partly because Ìlàje uses letters that don't even exist in the standard alphabet.

Second, data collection itself was the hard part:

Some dialects barely have a population of fluent writers, so their approach was to record speech first and get native speakers to transcribe it afterward, rather than assuming written data would just be sitting there to find.

!["An Egungun Priest"]({{ "/assets/img/2026-09-01-fine-tuning-nllb-for-ijebu-yoruba-2.jpg" | relative_url }})

*"An Egungun Priest"*

That last point is worth sitting with. The actual hard, unglamorous part of low-resource NLP isn't the model.

It's the fact that someone had to have this idea, travel to specific communities, and do the work of collecting and transcribing dialect data with real speakers.

I'm not doing any of that. I'm standing entirely on top of it. Which is fine, that's what public research datasets are for, but I want to be upfront that the genuinely hard part of this space already happened before I show up. What I'm doing is a much smaller, more contained question layered on top of their work.

## My Experiment

So the question I actually want to poke at with my own small slice of this: if I take a model that already knows standard Yorùbá, can I nudge it to specifically understand Ìjẹ̀bú? Given their own finding that dialects vary a lot in how much fine-tuning helps, does Ìjẹ̀bú respond well to this, or is the gap stubborn?

## what I actually think is going to happen

Here's my prediction, written down now so I can't quietly move the goalposts later:

- If I take NLLB (Meta's translation model, already knows 200+ languages including standard Yorùbá) and just point it at Ìjẹ̀bú with zero extra training, it'll do noticeably worse than it does on standard Yorùbá. Not useless, but visibly worse.
- If I then fine-tune it on a few hundred Ìjẹ̀bú parallel sentences from YorùLect, that gap should shrink. Not disappear — a few hundred examples is not a lot — but shrink in a way that's measurable.

If neither of those things happen — if zero-shot is already fine, or fine-tuning does nothing — that's also a real result and I'll say so.

## the actual plan

- Model: NLLB-200-distilled-600M. Not the bigger 1.3B/3.3B versions — this one's small enough to actually train on what I've got access to, and it's what basically every low-resource fine-tuning writeup I've read uses for exactly this reason.
- Data: YorùLect's Ìjẹ̀bú split. Roughly 800 sentences to train on, 200 to check against while training, 500 held back to actually measure performance at the end.
- Metric: BLEU and chrF2, since that's the standard pair for this kind of MT eval and it's what most of the papers I've been reading report, so I can actually compare.
- Steps: get a standard-Yorùbá baseline running first (so I know my pipeline itself isn't broken), then run zero-shot on Ìjẹ̀bú, then fine-tune, then compare.

I've never actually fine-tuned a translation model before, so there's a real chance week one is just me fighting library versions and tokenizer weirdness before I see a single real number. If so, that's going in the next post too.

More soon.
