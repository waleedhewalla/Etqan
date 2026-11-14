# Testing

## Prerequisites

- Node.js 20+
- pnpm 9 (`corepack enable`)
- Docker (for Postgres and Redis)

## Setup

```bash
pnpm install
cp .env.example .env        # then fill in real values; .env is git-ignored
docker compose up -d        # postgres, redis
pnpm db:migrate
pnpm --filter @itqan/core db:seed   # demo pilot halaqa (safe to re-run)
```

The API reads `.env` from the project root (and `apps/core/.env` if you keep one there). With no `.env` at all it
uses the database that `docker compose up -d` starts. If the database is not running, or has no tables yet, the API
says so when it starts and tells you which command to run.

## Quran text

The verse text is not stored in this repository. Load it into the database once:

```bash
pnpm --filter @itqan/core db:seed-quran            # downloads QURAN_TEXT_URL
QURAN_TEXT_PATH=./quran.json pnpm --filter @itqan/core db:seed-quran   # or a local file
```

The loader checks the file against the standard Hafs verse counts (114 suras,
6,236 ayat) and refuses a damaged or partial file without touching the table.
Running it again does nothing unless you pass `--force`. Until it has run, the
app shows "text not loaded yet" where verses would appear.

The source is the `quran-json` dataset, which is published under **CC BY-SA 4.0**
(its package metadata says CC-BY, but its README and LICENSE say BY-SA). The app
credits it on `/credits`. Check that licence with whoever signs off on the
content before a public launch.

## Recording a recitation

Students record from the **التسميع** tab; the teacher listens in **التسميع والتقييم**.

- Recordings are stored as private files under `AUDIO_DIR` (`STORAGE_DRIVER=file`, the default; nothing extra to run) and are only
  reachable through the API, which checks who may listen and hands out five-minute links. `STORAGE_DRIVER=s3` uses a managed
  S3-compatible bucket instead; `memory` keeps them in the API process only (lost on restart, refused in production).
- A student must first agree to voice recording (a prompt appears on the tab; the join flow also asks).
- The browser only allows the microphone on **HTTPS or `localhost`**. A production deployment needs HTTPS.
- Automated browser runs can use Chromium's fake microphone:
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`.

### The automatic first check (optional)

A check runs only when **all four** hold: `ENABLE_ASR=true` with an `ASR_PROVIDER` other than `none`;
the institution's administrator turned it on (التسميع والتقييم tab, dean/advisor/operator);
the student allowed it (an optional consent, separate from voice recording);
and the Quran text is loaded. To try it locally:

```bash
ENABLE_ASR=true ASR_PROVIDER=demo STORAGE_DRIVER=memory pnpm --filter @itqan/core dev
```

The `demo` provider cannot hear anything: it skips one word and swaps another so the flags,
dispute and teacher screens have something to show. The result is only a first look for the teacher:
it is never a grade, and the teacher confirms or dismisses each flag. A check that fails or hears too little
never blocks the teacher. Queued checks survive an API restart (they live in the database).

### Trying a real transcription service (before students use it)

1. Collect sample recordings with known verse ranges, recited **cleanly** first (then some with a deliberate skipped or swapped word),
   and a `manifest.json` next to them: `[{ "file": "fatiha.webm", "startRef": "1:1", "endRef": "1:7", "notes": "clean" }]`.
2. Load the Quran text (`db:seed-quran`), then run the bench with the service's address and key in the environment
   (the key is never printed):

```bash
ENABLE_ASR=true ASR_PROVIDER=openai-compatible ASR_API_URL=https://api.openai.com/v1 ASR_API_KEY=... ASR_MODEL=whisper-1 \
  pnpm --filter @itqan/core asr:bench ./samples
```

It prints, per file, what the service heard, the accuracy against the Quran text, every flag, and a summary. On clean
recitations aim for **mean accuracy 90%+** with nothing "could not hear"; a flag on a correctly recited word means the service
(or our matching), so read the "heard" line. Suggested go/no-go for a pilot: clean accuracy 90%+ here, then flag precision 80%+ from `asr:eval`
once teachers have decided at least 30 flags. Audio is sent to the service you name, so only use recordings you may share.
The confidence shown comes from Whisper's own scores and is not calibrated for recitation; watch it on your samples before relying
on the "could not hear" cut-off (0.5).

Matching ignores vowel marks and alefs (the Uthmani text's dagger alef vs a transcription's full alef), but not other spelling
differences such as صلاة/صلوة: if the bench shows a systematic one, add it to `packages/quran/src/arabic.ts` with a test.

Does it agree with your teachers? After some recitations have been reviewed:

```bash
pnpm --filter @itqan/core asr:eval            # add --tenant <slug> for one institution
```

It reports how often teachers confirm the flags (overall, per kind of flag, and per student, numbered rather than named),
how many the students disputed, and whether "ready for approval" hints matched approvals. It reads only the teachers'
decisions, never audio. Collect at least ~30 decided flags per kind before drawing conclusions, and check it on your
own students' voices before relying on it.

### Revision and retention

- When a teacher first reviews a recitation, each ayah recited is rescheduled (`apps/core/src/lib/grading.ts`):
  *redo* → again; *approved* → good (easy at a memorization score of 95+), hard with one confirmed memory error in that ayah,
  again with two or more. *Flagged* (waiting for the sheikha) reschedules nothing. Only cards the student already has are touched.
- Recordings are deleted `AUDIO_RETENTION_HOURS` (24) after review, or `AUDIO_UNREVIEWED_MAX_DAYS` (30) after submission if never reviewed.
  The job runs when the API starts and then hourly. Scores, notes and flags stay.

## Memorization plan

A student who has just joined has nothing to revise until her teacher says what she knows. In the teacher's
dashboard, قائمة الطالبات → «الخطة والتقرير» opens the student's panel; «خطة الحفظ» is at the top.

- **محفوظة من قبل** puts the ayat straight into revision, about twenty a day so a whole juz is not due on the
  first morning.
- **حفظ جديد** queues them as new memorization in the student's daily list.
- Up to 300 ayat per step; ayat she already has are skipped, never reset.
- **الحفظ الجديد في اليوم** caps how many new ayat she is offered a day (default 10, 1–50). The rest wait for the
  next day, in the order the teacher added them and in mushaf order within one addition.
- The bin removes a range, but only ayat she has never reviewed — her history stays.

API: `GET|POST|DELETE /v1/sections/:id/students/:studentId/plan` and `PUT …/plan/pace`, for whoever manages the halaqa.

## Memorization program (admin)

The dean sets what must be memorized, period by period. Sign in as `dean@itqan.local` and open «لوحة الإدارة»: under the
setup section is **برنامج الحفظ**.

- **Create** a program (name only to start). Settings: days of new memorization a week (default 4, Sunday to Wednesday;
  Thursday is the weekly test; Friday and Saturday are outside the program), the evaluation weights (حفظ 40، تجويد 25،
  مراجعة 20، تثبيت 15 — they must add up to 100), the total needed to move on (85) and the least any one criterion may
  reach (70% of its weight).
- **Periods:** «إضافة فترة», then a name, an optional goal, and either *حفظ جديد* (from verse to verse, across suras if
  you like, a pace in pages a day, and optional extra time for long or similar passages) or *تثبيت* (a number of weeks,
  no new verses). The line under each period updates as you type: pages, memorization weeks, plus one test week. Pages
  are an estimate from the word count of the verses (about half a page either way). «حفظ الفترات» saves; leaving with
  unsaved changes warns. Changing a verse range, a pace or the days a week re-draws the whole schedule.
- **الملخص الشامل** shows every period with its verses, pages, pace, length and week numbers, and warns when ranges
  overlap or a period has fewer than 3 or more than 6 memorization weeks.
- **Assign:** under «الحلقات التي تتبع البرنامج» choose a program and the week it starts for each halaqa (the Sunday of
  that week is used). A halaqa follows one program; an archived program or one with no periods cannot be assigned, and a
  program in use cannot be deleted (archive it).
- **The teacher** sees «مقرّر الحفظ» on her overview: the period, its verses, the pace, the week rhythm, the dates and how
  the period is passed. «أضيفي آيات الفترة إلى خطط الطالبات» puts the verses in every student's plan as new
  memorization (verses already in a plan are left alone; pressing it again adds nothing). It is offered only in a
  memorization week, not in the test week or a consolidation period.
- **The student** sees the same card at the top of «اليوم», read-only.
- Not built yet: entering the period test's scores and moving a student to the next period. The weights and pass marks
  are stored for that.
- API: `GET|POST /v1/admin/programs`, `PATCH|DELETE /v1/admin/programs/:id`, `PUT /v1/admin/programs/:id/periods`,
  `PUT /v1/admin/halaqat/:id/program`, `GET /v1/sections/:id/program`, `POST /v1/sections/:id/program/apply`.
  Deans, operators and superadmins configure; advisors, teachers and students get 403.

## Live lessons

Needs a LiveKit server. Locally: download `livekit-server`, run `livekit-server --dev`, set `LIVEKIT_URL=ws://localhost:7880`,
`LIVEKIT_API_KEY=devkey`, `LIVEKIT_API_SECRET=secret` in `.env`, and restart the API. Without these the teacher's tab
says live lessons are not set up and nothing else changes.

- **Teacher** — «الدرس المباشر»: give the lesson a title (and optionally its verses) and start. In the room her
  microphone opens; she can share her screen or camera, sees written questions and raised hands, gives one student
  the microphone at a time, and ends the lesson for everyone. Past lessons show how many attended and can fill the
  attendance sheet («تسجيل الحضور من الدرس»), which sends the usual absence alerts.
- **Student** — a «درس مباشر الآن» banner on her home screen. She enters as a listener: microphone off, no camera
  offered. She can write a question, or raise her hand and speak once the teacher allows it.
- **Rules.** Only the halaqa's students and whoever manages it can enter; the teacher who opened the lesson hosts
  and a dean listens. One live lesson per halaqa at a time. The room name never leaves the server; a join token
  lasts ten minutes and names one room. A student's token cannot publish anything until the teacher grants the
  microphone, and then only audio. Reconnecting takes the microphone back.
- State (who is here, hands, questions) is polled every three seconds; media is live.
- API: `POST|GET /v1/sections/:id/live`, `GET /v1/live/now`, `POST /v1/live/:id/join`, `GET /v1/live/:id/state`,
  `POST /v1/live/:id/questions`, `PATCH /v1/live/:id/questions/:qid`, `PUT /v1/live/:id/hand`,
  `PUT /v1/live/:id/participants/:userId/speak`, `POST /v1/live/:id/end`, `GET /v1/live/:id/attendance`.
- The API tests replace the media server with a recorder (`setLiveGateway`), so they need no LiveKit.

### Recorded live lessons

- **Teacher:** at the door of the lesson «سجّلي الدرس وشاركيه مع الحلقة» is ticked. Enter: «يُسجَّل» shows beside «مباشر»
  for everyone in the room. Share the screen or the camera, talk for half a minute, then «إنهاء الدرس» (or «إيقاف التسجيل»
  first; it cannot be resumed). Under «الدروس السابقة» the lesson says «مسجَّل» with a player and «حذف التسجيل».
- **Student** (same halaqa): «التسميع» now starts with «دروس مسجَّلة». «شاهدي التسجيل» plays it with a timeline she can
  drag; «سمّعي آيات الدرس» fills the recording form with the lesson's verses.
- What is recorded: the teacher's microphone and the stage (her screen or camera, or the lesson's title when she shares
  nothing). A student who is given the microphone is heard live but is not in the recording.
- The recording is made by the teacher's browser (desktop Chrome, Edge or Firefox) and sent in ten-second pieces.
  Closing or reloading the page stops it; what was sent is kept, and re-entering says so. A browser that cannot record
  says so and the lesson goes on unrecorded.
- A guardian, another halaqa's student or teacher gets 404 for the list entry and the link. The link lasts four hours.
- `LIVE_RECORDING_MAX_MB` (default 600) stops a recording that grows too large; `LIVE_RECORDING_RETENTION_DAYS`
  (default 90) deletes old ones in the nightly job. While a lesson runs its pieces are in `AUDIO_DIR/.recording`.
- API: `POST /v1/live/:id/recording/start`, `POST /v1/live/:id/recording/chunks` (multipart `seq`, `chunk`),
  `POST /v1/live/:id/recording/finish`, `GET /v1/live/recordings`, `GET /v1/live/:id/recording-link`,
  `GET /v1/live/:id/recording?token=`, `DELETE /v1/live/:id/recording`.

## Verses to memorize, recorded by the teacher («آيات للحفظ»)

The teacher's «آيات للحفظ» tab: choose verses of one sura (up to 60, the most a student can recite back in one
recording), record them, add an optional note, and publish to the halaqa. With the box ticked, the verses are also
added to each student's plan as new memorization; verses she already has are left alone.

Students find the lessons at the top of their «التسميع» tab: listen, show the verses, then «سمّعي هذه الآيات» fills
the recording form with the lesson's halaqa and verses. The recitation is linked to the lesson, so the student
sees its result on the lesson and the teacher sees how many students have recited each one.

- The recording is stored with the same storage driver as recitations, under `lessons/`, and is never exposed by
  key. The halaqa's students and whoever manages it can listen; guardians and other halaqat cannot.
- It is kept until the teacher deletes the lesson. Deleting removes the file; recitations of it stay.
- Changing the verses in the form drops the link to the lesson: a linked recitation always covers the lesson's verses.
- API: `POST|GET /v1/sections/:id/lessons`, `GET /v1/lessons/mine`, `GET /v1/lessons/:id/audio-link`,
  `DELETE /v1/lessons/:id`; `POST /v1/tasmi` accepts an optional `lessonId`.

## The recitation cycle: status, recording again, final grade

Every recitation carries a `status` both sides see, derived from what is stored (`apps/core/src/lib/tasmi-status.ts`):

| Status | Shown as | When |
| --- | --- | --- |
| `submitted` | أُرسل | received, not opened |
| `under_review` | قيد المراجعة | a teacher opened the recording |
| `feedback_given` | وصل ردّ المعلمة | she replied but has not graded yet |
| `revision_requested` | أعيدي التسجيل | graded «يُعاد» and not yet repeated |
| `revised` | أُعيد التسجيل | graded «يُعاد» and then recorded again |
| `referred` | عند الشيخة للمراجعة | sent to the sheikha |
| `final_graded` | الدرجة النهائية | «مقبول», or any verdict on the last allowed attempt |

- After «يُعاد» the student sees «أعيدي التسجيل» in «تسميعاتي» (and on the lesson, if it came from one). The new
  recording is stored as the next attempt (`revision_of`, `attempt`); the earlier attempt, its grade and its
  feedback are never changed. Three attempts at most (`MAX_ATTEMPTS`).
- The teacher's list marks repeats («المحاولة الثانية»), can be filtered to first recordings or repeats, and shows
  what she said about the earlier attempts above the new one.
- **Grade:** the monthly record counts each set of verses once, by its latest *graded* attempt. Until a repeat is
  graded, the earlier grade stands. Earlier attempts stay listed, dimmed, as history.
- API: `POST /v1/tasmi` accepts `revisionOf`; `GET /v1/tasmi/:id/history` returns the chain, oldest first.

## Teacher's reply and the monthly record

**Reply.** In التسميع والتقييم the teacher can answer a recitation in writing («ردّ مكتوب للطالبة») and with a
recorded message («ردّ صوتي للطالبة»). The student sees and hears both under «ردّ المعلمة» in her التسميع tab.

- The written reply is the review note that already existed; the voice reply is stored with the same storage
  driver as recordings, under `tasmi-replies/`, and is never exposed by key.
- The student and her staff can listen; guardians cannot (the same rule as recordings).
- A new voice reply replaces the previous one. The teacher can remove hers. It is deleted
  `AUDIO_UNREVIEWED_MAX_DAYS` (30) days after it was sent; the text stays.
- API: `POST /v1/tasmi/:id/reply` (multipart: `text`, `durationMs`, `audio`), `GET /v1/tasmi/:id/reply-audio-link`,
  `DELETE /v1/tasmi/:id/reply-audio`.

**Monthly record** («السجل الشهري»): in the teacher's student panel (where she writes the month's appraisal),
the student's خطتي والكفايات tab and the guardian's page.

- **Total appraisal** = the plain average of the weighted totals (memorization 50%, tajweed 30%, fluency 20%)
  of the month's recitations whose verdict is final: «مقبول» or «يُعاد». A recitation sent to the sheikha or not
  reviewed yet does not count.
- **Degree** = that average rounded to a whole number out of 100, with a grade: ممتاز from 85, جيد جداً from 75,
  جيد from 65, مقبول from 50, ضعيف below. The bands are in `apps/core/src/lib/monthly.ts`: change them there.
- **Issues** = recitations to repeat, mistakes the teacher confirmed (dismissed and undecided flags are left
  out), any skill averaging under 70, absences, and a month with no recitation at all.
- The teacher's written appraisal is a note; it does not change the degree. One per student per month.
- A month is the calendar month in the institution's time zone, by the day a recitation was sent.
- API: `GET /v1/reports/student/:id/monthly?month=YYYY-MM`, `PUT /v1/reports/student/:id/monthly/appraisal`.

## Badges

Students earn badges automatically after a rating or a teacher's review (`apps/core/src/lib/badges.ts` holds the catalog):
streak length, number of reviews, ayat mastered, approved recitations, and mastering a whole sura (Al-Fatiha, the last three suras,
Ya-Sin, Al-Baqarah). The **خطتي والكفايات** tab shows earned badges and progress toward the rest; a banner appears at the end of a
review session when one is earned, and an in-app notification is left. An earned badge is kept even if progress later dips.
Add a badge by adding a line to the catalog: its definition is copied to the database on first use.

## Look-alike verses (المتشابهات)

There is no bundled dataset: the QUL mutashabihat data's licence could not be verified, so clusters are written by teachers.

- A teacher proposes a cluster (2–6 verses, optional note) in her **المتشابهات** tab. It waits for approval by a scholar:
  the `sheikh_reviewer` role or an administrator of the same institution. Only approved clusters are visible to students,
  and clusters never cross institutions (a null-institution "shared" cluster can only be ruled on by the superadmin).
- A student sees the clusters that contain a verse she is memorizing (**المتشابهات** tab), with the words that set them apart
  highlighted, and can practise: a fill-in-the-blank when two verses differ by exactly one swapped word, or "which verse is this?".
  "Which verse" is only asked about verses worded differently from every other verse in the cluster, since verses worded
  identically (only their surroundings differ) cannot be told apart from their text.
- A wrong answer brings that verse's revision card back sooner (rated "hard"); a right answer changes nothing, so it cannot be
  used to push cards away. The Quran text must be loaded.

## Offline revision

A student can open the app and review today's cards with no connection, and her reviews are sent when it returns.

- **How it works:** a service worker (`apps/web/public/sw.js`) keeps the pages she has opened and the app's scripts, so the
  app opens offline. Today's queue and its verse text are saved on the device (IndexedDB) each time the queue loads. A review
  made offline is stored with the time it happened and sent to `POST /v1/scheduler/rate-batch` when the connection is back
  (the `online` event, and every 30 s while any are waiting). The banner at the top of the dashboard shows what is waiting.
- **Rules on the server:** each review carries a client id, so sending one twice counts once; reviews are applied oldest first and
  scheduled as of when they happened (so the next due date and the streak day are right); a review is skipped as *stale* if the card
  was reviewed more recently (for example on another device); reviews older than 14 days or dated in the future are refused.
- **Needs one online visit first:** the app opens offline only after it has been opened once online with the service worker active
  (the first visit installs it). Signing in and the first queue still need a connection.
- **Trying it:** the service worker registers in production builds only (`pnpm build && pnpm --filter @itqan/web start`), or set
  `NEXT_PUBLIC_ENABLE_SW=true` for a dev server (which may then serve stale code: clear site data when done). In Chrome DevTools, tick
  Network → Offline, reload, and review. Signing out removes the saved queue from the device; reviews still waiting stay for the next sign-in.
- **Limits:** only revision sessions work offline. Recording, the mushaf reader, similar verses and the teacher screens need a connection.
  Sending a review that was made on a card the student has since changed on another device drops it silently as stale.
- The install prompt ("add to home screen") comes from `manifest.json` and its icons; those are simple placeholders, replace them with the real logo.

## Admin console and early warning

Deans, advisors, operators and the superadmin land on **/admin** after signing in (it links to the halaqa screens). It shows, from live data:
students in halaqat, who was active this week and today, reviews this week against last week, average mastery, the plan stored for the institution,
and the early-warning list. A superadmin can switch institution; everyone else only ever sees their own (`GET /v1/admin/overview`).

- **Who is flagged** (`apps/core/src/lib/risk.ts`, shared with the teacher's roster): no review for 3 days or never started, or attendance below 70%
  over 30 days. **High** priority when both apply, when she has been away for 14 days, or when she never started; otherwise medium.
  It is a plain rule with stated reasons, not a prediction or score, and the page says so.
- **Plan limits** (`plan_max_students`, `plan_max_halaqat`, `plan_valid_until`, plus the tier) are shown with their state: ok, near (90%+), full, over,
  and expired. What they *do* is set by `PLAN_ENFORCEMENT` (default `warn`):
  - `warn`: only reported. Nothing is refused.
  - `block`: an institution that is full or expired cannot add a student (joining by code, including a brand-new account, which is refused *before* the
    account is created) or a halaqa. A student who already has a seat can join a second halaqa. Students already learning are never locked out of revision.
  - **AI checking is part of the plan in both modes**, because it costs money per recording: tiers `madrasa_pro` and `enterprise` include it, `free` and
    `madrasa_basic` do not, `plan_features` can add `ai_checking` to any institution, and an expired plan includes nothing. Without it the institution
    cannot switch AI checking on and no recording is sent to the checker. The tier table is in `apps/core/src/lib/plan.ts`: change it there.
  There is no payment flow: plans are set directly on the institution (Fawry needs a merchant account and its API documentation).

## Setting up an institution

The first dean is created with the bootstrap command ([DEPLOY.md](docs/DEPLOY.md)). After that she needs no one:
the admin console (**/admin**) has two cards under the institution's name.

- **المعلمات** — add a teacher by name and email. She signs in from «دخول هيئة التدريس» with a link sent to that
  email; an invitation is emailed when email sending is configured. «إيقاف الدخول» stops new sign-ins for a teacher
  (a session she already has ends when it next refreshes); her halaqat stay hers until they are handed over.
- **الحلقات** — open a halaqa for a teacher, hand an existing one to another teacher, and copy its join code.
  The pencil renames a halaqa, changes its size, or closes it. A closed halaqa accepts no one and leaves its
  teacher's and students' lists; nothing is deleted, and «إعادة فتح» brings it back.

For deans, operators and superadmins only (advisors see the console but not these cards), and only for their own
institution. An email address belongs to one account across all institutions. A dean cannot stop her own access
or another dean's. API: `GET /v1/admin/setup`, `POST|PATCH /v1/admin/staff`, `POST|PATCH /v1/admin/halaqat`.

## Pilot metrics

The admin console (**/admin**) shows the pilot's four questions week by week (`GET /v1/admin/pilot?weeks=4`, weeks start on Saturday):
students revising on 4+ days ("regular") out of those enrolled, recitations reviewed and the median time to review them,
guardians who opened the weekly report (recorded from now on as a `report.weekly.view` audit entry: who and when, nothing else),
and how many of the first week's active students are still active in the last. Only students currently in a halaqa are counted.

## Try the pilot locally

Start the API and the web app in two terminals:

```bash
pnpm --filter @itqan/core dev      # http://localhost:4000
pnpm --filter @itqan/web dev       # http://localhost:9050
```

With `WHATSAPP_API_KEY` and `SENDGRID_API_KEY` empty, nothing is sent. In development (`NODE_ENV=development`)
the sign-in page shows the code itself («وضع التجربة»), and a teacher's or dean's link opens straight away; they
are also written to the API terminal, as are absence alerts. This never happens in production, where an unsent
code is an error.

The browser calls the web app's own address (`/v1/...`) and Next forwards it to the API at
`API_PROXY_TARGET` (default `http://localhost:4000`), so the app works from `localhost`, `127.0.0.1`, another
device on the network, or a tunnel. If a page says «تعذّر الاتصال بالخادم», the API is not running: start it with
`pnpm --filter @itqan/core dev`. A deployment sets `NEXT_PUBLIC_API_URL` instead and nothing is forwarded.

| Sign in as | Where | How |
| --- | --- | --- |
| Student | `/auth/login` | `010 0000 0101` (to `…0104`), the code is shown on the page |
| Guardian | `/auth/login` | `010 0000 0201` (linked to مريم علي) |
| Teacher | `/auth/login/faculty` | `teacher@itqan.local`, you are signed in straight away |
| Dean | `/auth/login/faculty` | `dean@itqan.local` |
| New student | `/auth/join` | join code `AZH001` and any other number |

## Running checks

| Command          | What it runs                                   |
| ---------------- | ---------------------------------------------- |
| `pnpm lint`      | ESLint in every workspace                      |
| `pnpm typecheck` | `tsc --noEmit` in every workspace              |
| `pnpm test`      | Vitest tests in every workspace; the API's integration tests run when `DATABASE_URL` points at a migrated database and are skipped otherwise |
| `pnpm build`     | Production build of every workspace            |

The web app runs at http://localhost:9050 (`pnpm --filter @itqan/web dev`); the API listens on port 4000.

Run a single workspace with Turbo's filter, e.g. `pnpm test --filter=@itqan/fsrs`.

Each workspace (`apps/core`, `apps/web`, `packages/*`) must define its own
`lint`, `typecheck` and `test` scripts; Turbo skips workspaces that lack them.

## CI

`.github/workflows/ci.yml` runs install → lint → typecheck → migrate → test →
build on every pull request and on pushes to `main`, with Postgres 16 and
Redis 7 service containers. Test-only credentials are set in the workflow;
real secrets never belong in the repo.
