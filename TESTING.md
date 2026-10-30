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
