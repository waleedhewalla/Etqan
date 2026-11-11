# Pilot kit

Everything needed to run a first four-week pilot of Itqan with one or two halaqat. The numbers below are
**proposed** starting points, not findings: change them before the pilot starts, not after.

| File | For | Language |
| --- | --- | --- |
| this page | whoever runs the pilot | English |
| [teacher-guide.ar.md](teacher-guide.ar.md) | each teacher, before week 1 | Arabic |
| [student-guide.ar.md](student-guide.ar.md) | each student, on day 1 | Arabic |
| [weekly-interview.ar.md](weekly-interview.ar.md) | a 15-minute call with each teacher, every week | Arabic |

## The question

> Do students revise more regularly with Itqan than without it, and does it save the teacher time rather than cost her time?

Nothing else is being tested. Automatic recitation checking, badges and look-alike verses are extras; if the
answer to the question is no, they do not matter.

## Shape

- **Who:** 1–2 halaqat, 20–40 students, teachers who volunteered.
- **How long:** 4 weeks, Saturday to Friday, plus a setup week before.
- **Automatic checking:** off. It needs a transcription service to be chosen, data-processing terms and a test
  on real recordings first. Teachers listen and grade as they do today.

## Setup week

1. Deploy the staging stack ([DEPLOY.md](../DEPLOY.md)) and create the institution and its admin.
2. The dean signs in and, in the admin console, adds each teacher and opens her halaqa. Give each teacher her
   halaqa's join code.
3. Sit with each teacher for 30 minutes with the teacher guide: she signs in, adds two students herself, and
   **sets each student's memorization plan** — without it a student's daily list is empty.
4. Students join with the code in the halaqa, in person, on day 1. Do not send the code by message and hope.
5. Record the baseline by asking each teacher: of your students, how many revise on most days? How long do
   you spend each week listening to recitations and chasing absences?

## What to read each week

The admin console (`/admin`) shows these week by week.

| Measure | Where | Proposed target by week 4 | Rethink if |
| --- | --- | --- | --- |
| Students revising on 4+ days a week | Pilot metrics: "regular" | 60% of enrolled | under 30% in week 3 |
| First week's active students still active | Pilot metrics: retention | 70% | under 50% |
| Median time from recitation to review | Pilot metrics | under 48 hours | over 4 days |
| Guardians opening the weekly report | Pilot metrics | half of those linked | — (informative only) |
| Teacher time, by her own estimate | Weekly interview | no more than before | more than before in week 3 |

Read the numbers together with the interviews. A halaqa at 40% regular whose teacher says "they never
revised before" is a success; one at 70% whose teacher is exhausted is not.

## Decision at the end

- **Go on** (more halaqat, next term): the regular-revision target is met or close, and teachers would choose
  to continue.
- **Fix and repeat** with the same halaqat: students use it but teachers are overloaded, or the reverse.
- **Stop**: neither students nor teachers kept using it after week 2 with no fixable cause.

Write the decision and its reasons down on the day, in a paragraph, before discussing what to build next.

## Before any student signs in

These are the owner's decisions and are not settled by the software:

- The Quran text source and its licence terms (the bundled text is CC BY-SA 4.0).
- How long recordings are kept (default: 24 hours after review, 30 days if never reviewed).
- The college's actual endorsement: the landing page still claims accreditation and scientific-committee
  approval. Remove the claims or get them in writing.
- A real support mailbox and a real phone number on the data-deletion page.
- WhatsApp sender with approved templates, and an email sender, for sign-in codes and links.
