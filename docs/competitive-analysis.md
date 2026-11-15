# Competitive analysis (November 2026)

Written 2026-11-14. **Read the evidence note first.**

> **Evidence note.** The research was done by web search only. The session could not open any competitor's own page
> (store listings, pricing pages, review sites all failed to resolve), so **every competitor claim below comes from search-result
> summaries, not from pages read in full.** No page dates were visible. Prices in particular are unreliable and some conflict.
> Tags used: **[listing]** an app-store or directory listing (marketing copy by the vendor), **[third-party]** a review or
> aggregator, **[unverified]** could not be confirmed. Nothing here has been observed by using the competing product.
> Hosts that must be allowed to redo this properly: `tarteel.ai`, `apps.apple.com`, `play.google.com`, `capterra.com`,
> `alifcloud.com`, `quran.com`.

## 1. Itqan today (from the code and docs)

An Arabic-first Quran memorization platform sold to **institutions** (halaqat, colleges); pilot planned with a women's college
in Egypt (`docs/pilot/README.md`). A web app that installs as a PWA (works offline for daily review). Arabic only.

| Area | What exists |
| --- | --- |
| Student | FSRS-scheduled daily review (new / recent / old), previous verse as the cue and a reveal button, mushaf reader, look-alike verse (mutashabihat) drills, badges and streaks with freeze days, per-student plan |
| Recitation | Student records audio; the teacher grades (hifz, tajweed, fluency), replies in text or voice, up to a set number of re-attempts; optional AI checking (off in the pilot); audio is deleted after review |
| Teaching | Live lessons (LiveKit): hand-raise, synced mushaf, scheduled with reminders, browser-side recording shared with the halaqa; «آيات للحفظ» recorded verses |
| Programme | Dean-defined programme by period with verse ranges, pace, weights, **period tests** that decide moving on |
| People | Attendance with guardian alerts, guardian portal and weekly report, monthly record, notification bell, WhatsApp messages, admin console (users, modules on/off, audit log), data export and deletion requests |
| Plans | Tiers `free`, `madrasa_basic`, `madrasa_pro`, `enterprise` in code (`lib/plan.ts`); limits on students and halaqat. **No payment flow, no prices in the repository.** |

Not found in the code: certificates or ijazah/sanad issuance, fees or invoices, SMS, an English or other-language UI,
native mobile apps. Gaps in what the files tell us: real prices, how many institutions are in conversation, target market
outside Egypt.

## 2. Comparable products

| Product | Kind | What the evidence says | Evidence |
| --- | --- | --- | --- |
| **Tarteel** (tarteel.ai) | Consumer; the clear leader for AI recitation | Real-time word-level mistake detection, mistake history with playback, Testing Mode over memorized verses, verse peeking, goals and analytics, family plan (up to 5). No teacher or class features found (a `/schools` page exists but could not be read). Reported weaknesses: tajweed not scored, false positives, detection is paid-only. Prices seen: ~$99 to $240 a year in the US store, other regions differ | [listing] [third-party]; accuracy figures are marketing claims and not comparable to anything of ours |
| **Retain Quran** | Consumer, lesser known | Spaced repetition synced across devices, offline, free | [listing]; ratings unverified |
| **HifzAI, Quoranize, HifzPath, Tasmi, HeifzLoop** | Consumer lookalikes | AI feedback and/or a review ladder | [listing] only; HifzAI borrows Tarteel's name |
| **Alif Cloud** (formerly Dugsi Cloud) | Islamic-school SaaS in English | Student, parent and class records; attendance; Quran progress; behaviour logs; grades; **invoices, recurring tuition, payments**; email and SMS; e-signatures. Price listings conflict ($0.75 to $1.99 per student, or "contact") | [listing] [third-party], vendor copy |
| **Maher / MMS** (Saudi tahfeez associations) | Regional institutional ERP, Arabic | Teacher app for daily evaluation, attendance (التحضير), hifz and review log, **nominating students for the staged final exam** | [listing]; vendor site not found |
| **Sabaq** | School tool, free iPad app | Teachers log recitation; parents see **colour-coded tiles and a per-juz bar**; date-range reports; push alerts not yet supported | [listing], 5 ratings |
| **Qaf School, QuranRecord, Rattil Smart Halaqa, Injazi, Mofassal** | Small school apps, mostly free | Attendance with parent push, homework by surah (new or revision), parent view, separate teacher/student/parent apps; Qaf is Arabic/French/Turkish/Somali | [listing] only |
| **IQRA Network and small academies** | Online Quran teaching | Live one-to-one lessons; monthly progress reports; free trial lessons; per-hour prices (about $8 to $16) | [third-party] and vendor pages; no hifz-specific evidence |
| **Quran.com / Quran Foundation** | Reference reader and open API | Text, translations, tafsir, audio, page/juz mappings | docs snippets; no institutional or hifz offering found |

Not verified and dropped: Quran Companion, Ayah, Quranly, Hafiz, Bayyinah and Al-Maghrib as relevant products.
**No regional market leader for institutions was established**; the closest evidence is Maher/MMS in Saudi Arabia.

## 3. What stands out, table stakes versus differentiators

- **Table stakes** (seen in many listings): attendance, parent view, per-surah/juz progress, homework or recitation log, free tier.
- **Differentiators with some evidence:** word-level AI mistake feedback (Tarteel only); Testing Mode over memorized verses (Tarteel);
  fees and recurring payments in the same system as Quran progress (Alif Cloud); embedding in an association-wide ERP and staged
  exam nomination (Maher); colour-coded parent progress tiles (Sabaq).
- **Not documented by any competitor found:** FSRS scheduling (others use fixed ladders or say "spaced repetition"), teacher-graded
  rubrics with voice replies, live lessons with recording and a synced mushaf, WhatsApp messages. That absence is weak evidence,
  because most sources were listings.

## 4. Gap map

| Competitor strength | Itqan | Class |
| --- | --- | --- |
| Attendance and parent alerts | Attendance, WhatsApp and in-app alerts, guardian portal | Matched (WhatsApp is probably stronger in this market) |
| Spaced repetition | FSRS | Matched, likely ahead |
| Offline | PWA, offline review | Matched |
| Staged exams (Maher) | Period tests with pass rules | Matched in substance |
| Live teaching | Live lessons, recording, reminders | Matched or ahead |
| Verse peeking (Tarteel) | Previous verse as cue plus reveal | Matched |
| **Testing Mode over memorized verses (Tarteel)** | Not available | **Missing, high value: built in this change** |
| **Per-surah progress picture (Sabaq, Tarteel analytics)** | Totals only, no per-surah view | **Partial: built in this change** |
| Mistake history with playback (Tarteel) | Flags per recitation; audio deleted after review, so no playback | Partial; depends on AI checking, which is off in the pilot |
| Fees, invoices, recurring payments (Alif Cloud) | None | Missing, low priority for a college pilot |
| Certificates, ijazah, sanad | None | Missing; **demand unverified**, ask the pilot |
| Several UI languages (Qaf, Tarteel) | Arabic only | Missing; low for Egypt, matters for expansion |
| Native mobile apps (Maher, Sabaq, Alif) | PWA | Partial; WhatsApp covers alerts |
| Institution tier of the market leader | Unknown | **Unverified: read Tarteel's schools page first** |

## 5. Recommendations, by impact over effort

1. **Random self-test over memorized verses.** From Tarteel's Testing Mode. Students who revise only what is due never test
   what they think they know; it serves the pilot's question (do students revise more). Small: reuses the review session and FSRS.
   **Done.**
2. **Memorization map.** From Sabaq's tiles and Tarteel's analytics. Gives students and, next, guardians a picture instead of
   four totals. Small. **Done for students.** Next step: show it in the guardian report.
3. **Weak-spots list.** Aggregate the verses and words flagged across recitations (teacher or AI) and queue them as extra reviews.
   Draws on Tarteel's mistake history; playback is not possible because audio is deleted after review (a privacy choice to keep).
   Medium; worth it only once AI checking or teachers' flags are in regular use.
4. **Guardian map and monthly certificate-style summary.** Reuse the map in the guardian report; a printable summary is cheap.
   Small to medium.
5. **Fees and invoices.** Only if the pilot institution asks; needs a payment provider and merchant account. Large.
6. **Certificates / ijazah workflow.** Ask the pilot dean what they issue today before designing anything. Unknown size.
7. **English and other UI languages.** Medium to large; for expansion, not the pilot.

## 6. Built in this change

- `GET /v1/scheduler/test` (random memorized verses, any day, optional sura and count) and the «اختبريني» card on the student's
  home tab; answers go through the normal rating, so they also move the schedule.
- `GET /v1/scheduler/map` and «خريطة حفظكِ» in «خطتي والكفايات»: 114 tiles coloured by how much of each sura is memorized
  or solid, with a mark for suras that have verses due.
- 6 new API tests; checked in a browser with a student holding cards in every state.
