# Design: live teaching sessions and the recitation cycle

A plan for adding Zoom-style live lessons to Itqan and closing the loop from lesson to final grade.
It is written against the code as it is today, so each item says whether it **exists**, needs a **change**, or is **new**.

## The workflow

| # | Stage | Today | To build |
|---|---|---|---|
| 1 | Live session: teacher shares the sura, students listen and ask | Nothing | New: live rooms |
| 2 | The session is recorded and shared with the halaqa | Teacher can record audio «آيات للحفظ» by hand | New: session recording, published as a lesson |
| 3 | Student records the assigned verses and submits | **Exists** (`POST /v1/tasmi` with `lessonId`) | Small change: link to the session's lesson |
| 4 | Teacher listens, evaluates, writes feedback | **Exists** (review scores, verdict, text and voice reply) | Small change: "under review" marker |
| 5 | Student records again and resubmits | Possible, but attempts are not chained | Change: attempt chain |
| 6 | Teacher gives final feedback and the updated grade | Scores exist per recitation | Change: final grade per lesson, history kept |

Stages 3, 4 and 6 are mostly built. The real work is stages 1 and 2, and a modest change for stage 5.

## 1. Platform and tools

**Recommendation: embed LiveKit, self-hosted, inside the existing web app.** Do not build video conferencing, and do not send students to Zoom.

| Need | Tool | Why |
|---|---|---|
| Video, audio, screen share | LiveKit server + its React components | Open source and self-hostable, so recordings of a girls' college stay on the institution's server. Rooms are joined with a short-lived token the API issues, which maps directly onto Itqan's roles. |
| Recording | LiveKit Egress | Records chosen tracks to S3-compatible storage and calls a webhook when the file is ready. |
| Questions and chat | LiveKit data messages, persisted by the API | One channel for live delivery; the API keeps the questions so they survive the session. |
| File storage | The existing storage driver, `s3` mode | Session recordings are large; they need object storage, not the single-volume `file` driver. |
| Student recordings, review, grades | Existing Itqan features | Already built and tested. |

How they connect:

```
Browser (teacher / student)
   │  1. POST /v1/sessions/:id/join      → API checks role and enrolment, returns a room token
   │  2. connects to LiveKit with the token (media never passes through the API)
   ▼
LiveKit server ──(room ended, recording ready: webhooks)──► Itqan API ──► Postgres
   │                                                            │
   └── Egress ──► object storage (recording file) ◄── short-lived links ── API
```

**Alternatives considered**

- *Zoom Meeting SDK*: familiar, but recordings live in Zoom's cloud, licences are per host, and students leave the app. Rejected on privacy and cost.
- *Jitsi (iframe)*: also self-hostable and quicker to embed, but recording needs a separate heavyweight service and role control is coarser. A reasonable fallback if LiveKit proves hard to operate.
- *A pasted meeting link plus manual upload*: the cheapest first step; see Phase A below.

Verify LiveKit's current token, egress and webhook details against its documentation before building; the shape above is stable but the option names change.

## 2. Roles and permissions

| Action | Teacher of the halaqa | Dean / operator | Student of the halaqa | Guardian | Anyone else |
|---|---|---|---|---|---|
| Schedule, start, end a session | Yes | Yes | No | No | No |
| Join a live session | Yes | Yes (observer) | Yes | No | No |
| Share screen, camera | Yes | No | No | No | No |
| Speak | Yes | No | Only after the teacher accepts a raised hand | No | No |
| Send a written question | Yes | Yes | Yes | No | No |
| Start / stop recording | Yes (auto by default) | Yes | No | No | No |
| Watch the session recording | Yes | Yes | Yes | No | No |
| Delete a recording | Yes | Yes | No | No | No |
| Submit a recitation | No | No | Her own only | No | No |
| Listen to a submission | Her students' | Yes | Her own only | No | No |
| Grade and reply | Her students' | Yes | No | No | No |
| See grades and feedback | Her students' | Yes | Her own | Her child's grades and monthly record, not audio | No |

These are the rules the app already applies to recordings (`loadManagedSection`, `canViewStudent`, enrolment checks). The room token carries the same decision: a student's token allows subscribing and data messages only; the teacher's allows publishing and screen share. Speaking is granted by the teacher updating that student's permissions for the moment, then revoked.

## 3. Data model

New tables:

```
live_sessions
  id, section_id, teacher_id
  title, start_ref, end_ref           -- the verses taught and assigned
  scheduled_at, started_at, ended_at
  status          scheduled | live | ended | cancelled
  room_name       -- opaque, random; never guessable from the halaqa
  recording_status  none | recording | processing | ready | failed | deleted
  recording_key, recording_bytes, recording_duration_ms
  lesson_id       -- the «آيات للحفظ» entry created when the session ends

session_participants          -- who attended, for how long
  session_id, user_id, joined_at, left_at

session_questions             -- kept after the room closes
  id, session_id, user_id, text, asked_at, answered_at
```

Changes to existing tables:

```
recitation_lessons
  + session_id        nullable  -- set when the lesson came from a live session
  ~ audio_key         nullable  -- a session lesson plays the session recording instead

tasmi_submissions
  + revision_of       nullable  -- the previous attempt this one replaces
  + attempt           integer, default 1
  + review_started_at nullable  -- first time a teacher opened it
```

Nothing existing is dropped or rewritten; every new column is nullable or has a default.

## 4. Data flow, stage by stage

### Stage 1 — Live session

1. The teacher opens «الدروس المباشرة», picks the sura and verses, and schedules or starts now. `POST /v1/sections/:id/sessions`.
2. Students see «درس مباشر الآن» on their home screen. `POST /v1/sessions/:id/join` checks enrolment and returns a room token valid for a few minutes.
3. The teacher shares her screen. Students listen with microphone and camera off.
4. Questions: a student types a question (stored in `session_questions`, shown to the teacher in a side panel) or raises her hand; the teacher grants the microphone to one student at a time.
5. `session_participants` rows record joins and leaves. On session end the teacher is offered «تسجيل الحضور من الدرس», which pre-fills the existing attendance sheet; she confirms it.

**A better alternative to raw screen sharing, for a later phase:** show the app's own mushaf view to everyone and send only "the teacher is on verse X" as a data message. The text stays sharp on a phone and uses a fraction of the bandwidth. Screen share stays available for anything else.

### Stage 2 — Recording and sharing

1. Recording starts automatically when the teacher goes live, with a visible «يُسجَّل» indicator for everyone. She can pause or stop it.
2. **Only the teacher's audio and screen are recorded.** Students' voices and cameras are not, so no student consent is needed for the recording and a question asked aloud is not kept.
3. When the room ends, LiveKit Egress writes the file to object storage and calls the API webhook. The API sets `recording_status = ready` and creates a `recitation_lessons` row with `session_id` set and the session's verses.
4. The lesson appears in every student's «آيات للحفظ» list, exactly where audio lessons appear now, with a video player. Playback uses the same short-lived, token-protected links as every other recording.
5. If recording fails, the session still ends normally, the teacher is told, and she can record an audio «آيات للحفظ» by hand as she does today.

### Stage 3 — Student submission *(exists)*

The student presses «سمّعي هذه الآيات» on the lesson; the form is pre-filled; `POST /v1/tasmi` stores the audio and links it by `lesson_id`. No change except that the lesson may now come from a session.

### Stage 4 — Teacher evaluation *(exists, one addition)*

The teacher opens the submission in «التسميع والتقييم», listens, sets the three scores and a verdict, and replies in writing, by voice, or both. Addition: the first time she requests the audio link, `review_started_at` is set, which gives the "under review" status.

### Stage 5 — Revision cycle *(change)*

1. A verdict of «يُعاد التسميع» is a revision request. The student sees the feedback and a single button «أعيدي التسجيل».
2. The new submission is stored with `revision_of` = the previous attempt and `attempt` = previous + 1. The earlier attempt, its scores and its feedback are never modified.
3. Suggested limit: three attempts per lesson, configurable per institution. After the last, the teacher's verdict is final.

### Stage 6 — Final assessment *(change)*

1. The teacher reviews the new attempt with the previous attempt's feedback shown beside it.
2. **The lesson's grade is the latest graded attempt's weighted total.** Earlier attempts remain visible as history: attempt number, date, scores, feedback.
3. The monthly record should then count one grade per lesson (the latest attempt) instead of averaging every attempt. This is a deliberate change to today's calculation in `lib/monthly.ts`, and its tests must change with it.

## 5. Submission status

One status per submission, **derived from facts already stored** rather than kept in its own column, so it can never disagree with the data:

| Status | Arabic label | Rule |
|---|---|---|
| Submitted | أُرسل | No verdict, `review_started_at` empty |
| Under review | قيد المراجعة | No verdict, `review_started_at` set |
| Feedback given | وصلكِ ردّ المعلمة | No verdict yet, but a text or voice reply exists |
| Revision requested | أعيدي التسجيل | Verdict `redo`, and no later attempt exists |
| Revised | أُعيد التسجيل | Verdict `redo`, and a later attempt exists |
| Referred | عند الشيخة للمراجعة | Verdict `flagged` (exists today) |
| Final graded | الدرجة النهائية | Verdict `approved`, or `redo` on the last allowed attempt |

Implement as one pure function shared by the API and tested on its own, returned as `status` on every submission. The student sees it on the lesson and in «تسميعاتي»; the teacher sees it as a filter in «التسميع والتقييم».

## 6. Arabic and right-to-left

- The app is already Arabic-first and RTL throughout; the session screens follow the same components and tokens.
- LiveKit's ready-made components are left-to-right. Use its hooks with Itqan's own controls rather than its prebuilt layout, so buttons, the participant list and the question panel mirror correctly.
- Verse text in the lesson and review screens keeps using the existing Uthmani rendering (`VerseText`); a screen share shows whatever mushaf the teacher opens.
- Counts and dates use the existing helpers (`toArabicDigits`, `ayatCount`).
- Test on a phone at 390 px, as the rest of the app was: most students will join from one.

## 7. Privacy and access

- **Room access**: tokens are issued only after the API checks enrolment or management of that halaqa, expire in minutes, and name one room. Room names are random.
- **Recordings**: stored under `sessions/<section>/<id>`; never served by key; reached only through short-lived links issued after the same checks; no public URLs.
- **What is recorded**: the teacher's audio and screen only. State this on the join screen.
- **Students' cameras**: off, and not offered in v1. Microphone only on the teacher's grant.
- **Guardians**: grades and the monthly record, never audio or video. Unchanged.
- **Retention**: session recordings deleted at the end of term or after 90 days, whichever the institution sets; add to the existing retention job. Student recitations keep today's rule (24 hours after review, 30 days if unreviewed).
- **Audit**: session start and end, recording start, stop and deletion, and each recording view, in the existing audit log.
- **Self-hosting**: LiveKit and object storage run beside the API in the institution's deployment; no media leaves it.

## 8. API surface (new)

```
POST   /v1/sections/:id/sessions            schedule or start
GET    /v1/sections/:id/sessions            list for the halaqa
GET    /v1/sessions/live                    the student's live or upcoming sessions
POST   /v1/sessions/:id/join                → room token
POST   /v1/sessions/:id/end
POST   /v1/sessions/:id/recording           { action: start | stop }
POST   /v1/sessions/:id/questions           a written question
PATCH  /v1/sessions/:id/participants/:uid   grant or revoke the microphone
POST   /v1/webhooks/livekit                 room and egress events (signature verified)
GET    /v1/lessons/:id/media-link           short-lived link (audio or session video)
GET    /v1/tasmi/:id/history                the attempt chain for a lesson
```

## 9. Build order

**Phase A — close the cycle without live video (small).** Worth shipping first; it needs no new infrastructure.
1. Attempt chain (`revision_of`, `attempt`) and «أعيدي التسجيل».
2. Derived status, shown to both sides, with a teacher filter.
3. `review_started_at`.
4. One grade per lesson in the monthly record; attempt history view.
5. Optional: a "meeting link" field on a lesson so a teacher can paste an external meeting link meanwhile.

**Phase B — live sessions, no recording (medium).**
1. LiveKit in the deployment (`compose.prod.yml`), with TURN for restrictive networks.
2. `live_sessions`, join tokens, teacher and student room screens.
3. Screen share, raised hands, written questions.
4. Attendance pre-fill from participants.

**Phase C — recording and sharing (medium).**
1. Egress, object storage in `s3` mode, the webhook.
2. Session lesson with video playback in «آيات للحفظ».
3. Retention and audit for session recordings.

**Phase D — refinements.** Synced mushaf view; attempt limit per institution; scheduled-session reminders over WhatsApp.

## 10. Risks and open decisions

| Risk | Mitigation |
|---|---|
| Home bandwidth in Egypt is uneven | Audio-first design; low frame-rate screen share; the synced mushaf view in Phase D |
| A teacher cannot share her screen from a phone browser | Teachers run sessions from a laptop; say so in the teacher guide |
| Running a media server is new operational work | Phase A delivers value without it; consider LiveKit's hosted service for the pilot only if the institution accepts media leaving its server |
| Recording storage grows quickly | Record teacher audio and screen only; 90-day retention; show usage in the admin console |
| The monthly degree changes meaning | Announce it; keep attempt history visible |

For the owner to decide:

1. Self-hosted media server, or a hosted service for the pilot?
2. May a student ever turn her camera on? (This design says no.)
3. How many attempts per lesson, and does a late attempt still count?
4. How long are session recordings kept?
5. Is Phase A alone enough for the first pilot, with live lessons held in person?
