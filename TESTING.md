# Testing

## Prerequisites

- Node.js 20+
- pnpm 9 (`corepack enable`)
- Docker (for Postgres, Redis and MinIO)

## Setup

```bash
pnpm install
cp .env.example .env        # then fill in real values; .env is git-ignored
docker compose up -d        # postgres, redis, minio
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

- Recordings are stored in MinIO (`docker compose up -d minio`) and are only reachable through the API,
  which checks who may listen and hands out five-minute links. For a quick trial without MinIO set
  `STORAGE_DRIVER=memory` (recordings vanish when the API restarts).
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
