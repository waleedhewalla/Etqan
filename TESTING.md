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

## Try the pilot locally

Start the API and the web app in two terminals:

```bash
pnpm --filter @itqan/core dev      # http://localhost:4000
pnpm --filter @itqan/web dev       # http://localhost:9050
```

With `WHATSAPP_API_KEY` and `SENDGRID_API_KEY` empty, login codes, magic links
and absence alerts are written to the API terminal instead of being sent.

| Sign in as | Where | How |
| --- | --- | --- |
| Student | `/auth/login` | `010 0000 0101` (to `…0104`), code from the API log |
| Guardian | `/auth/login` | `010 0000 0201` (linked to مريم علي) |
| Teacher | `/auth/login/faculty` | `teacher@itqan.local`, open the link from the API log |
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
