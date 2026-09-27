# Acceptance Test Matrix

| ID | Scenario | Expected |
|---|---|---|
| AT-001 | User logs in | session created |
| AT-002 | User changes own profile | success |
| AT-003 | User reads another user's private child | denied |
| AT-004 | Provider submits incomplete verification | rejected |
| AT-005 | Unapproved provider publishes service | denied |
| AT-006 | Approved provider publishes service | success |
| AT-007 | Parent searches provider | only eligible providers |
| AT-008 | Parent creates order with fake price | server ignores/rejects |
| AT-009 | Parent pays | order becomes PAID only after server confirmation |
| AT-010 | Duplicate payment callback | no duplicate transition |
| AT-011 | Refund exceeds paid | denied |
| AT-012 | Completed order review | success |
| AT-013 | Pending order review | denied |
| AT-014 | Blocked user chats | denied |
| AT-015 | Report submitted | moderation case created |
| AT-016 | Admin approves provider | audit created |
| AT-017 | Teacher compliance pending | not orderable |
| AT-018 | Career feature off | career UI/API hidden |
| AT-019 | Career feature on | mentor flow works |
| AT-020 | Child profile created | guardian consent captured |
