# Incident response

## Severity

| Level  | Meaning                                                       | Response                                                     | Examples                                                                     |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **S1** | Users cannot use the platform, or money/child data is at risk | Page immediately, all hands, status updates every 30 minutes | Database unreachable, payment callbacks failing, suspected data exposure     |
| **S2** | Degradation, or a queue that will harm users if it waits      | Page during waking hours, updates every 2 hours              | High latency, refund failures, moderation backlog, backup missing            |
| **S3** | Needs a human, not a hero                                     | Business hours, ticket                                       | A single provider stuck in a state, a slow query, an alert that needs tuning |

When in doubt, declare one level higher and downgrade: downgrading is cheap,
under-declaring costs users.

## Roles

One person per role, named explicitly in the incident channel:

- **Incident commander** — decides, does not debug. Owns severity, comms cadence
  and the decision to roll back or restore.
- **Operations lead** — runs the procedures in [`runbook.md`](./runbook.md).
- **Scribe** — timeline. Written while it happens, not reconstructed afterwards.
- **Communications** — status page, support, and (for S1) management.

A person who is debugging is not the incident commander.

## First fifteen minutes

1. Declare: severity, commander, one-sentence summary, channel.
2. Stop the bleeding: roll back, take the instance out of the pool, block the
   abusive address. Containment beats diagnosis.
3. Say what is known, what is not known, and when the next update comes.

## Containment

| Situation                                       | First containment                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Database compromised or data exposure suspected | Rotate credentials, restrict network access, **preserve** logs and dumps — do not delete anything, it is evidence          |
| Credential stuffing / account takeover          | Block at the edge, invalidate sessions, rotate token secrets if tokens may have leaked                                     |
| Payment gateway misbehaving                     | Stop new payment sessions (feature flag), leave orders in `PENDING_PAYMENT` — a stuck order is better than a wrong payment |
| Malicious content or user                       | Suspend the provider (`POST /admin/providers/:id/suspend`), hide the review through moderation; both are audited           |

Every containment action taken through the platform is audited — that is the
point. Do not "fix" data with SQL: an unaudited change is a second incident.

## Communications

- Internal: one channel, one timeline, updates on the declared cadence even when
  there is nothing new.
- External (S1 only): status page with impact, what is being done, and when the
  next update is. Never speculate about cause.
- Data exposure: follow the applicable breach-notification path and
  `specs/10-privacy-and-minors.md` — minors' data raises the bar, notify legal
  before any external statement.

## Evidence

- Preserve: application logs (structured, request-id correlated), the audit log
  (`GET /admin/audit-logs`), the database and its dumps, and the incident
  timeline.
- Never log secrets, tokens or child data while investigating
  (`specs/13` §Logging). Redact before pasting anything into a channel.

## Postmortem

Written within three working days for S1 and S2. Blameless: if the answer is
"a person made a mistake", the question was wrong.

```markdown
# Incident <date> — <one-line summary>

Severity: S1 | Duration: <start> → <end> (UTC) | Impact: <who, how many, what>

## Timeline (UTC)

- hh:mm — <what happened, from the scribe's notes>
- hh:mm — <detection>
- hh:mm — <containment>
- hh:mm — <resolution>

## Root cause

<What failed, and why it was allowed to fail.>

## What went well

- …

## What went badly

- …

## Detection

<Which alert fired, or: how a user found it before we did.>

## Actions

| Action                                     | Owner | Due |
| ------------------------------------------ | ----- | --- |
| <alert, guardrail, test or runbook change> | …     | …   |
```

Every action item gets an owner and a date. An action item that says "be more
careful" is not an action item.

## Drills

- Restore drill: every CI run (see [`backups.md`](./backups.md)).
- Incident drill: quarterly — declare a fake S1, restore a dump into a scratch
  database, and walk the timeline. A runbook nobody has executed is a guess.
