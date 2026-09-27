# IM Spec

## Goal

Provide user-to-user conversation without building an IM server.

## Adapter

`MessagingGateway`.

Possible provider implementation is configurable. The core domain must not depend on a vendor SDK.

## Conversation creation

Allowed when:
- both users active;
- neither blocks the other;
- target provider/service is discoverable;
- anti-spam limits pass.

Conversation may be attached to:
- provider inquiry;
- order;
- report.

## Message policy

- Support text/image at minimum if provider supports it.
- Server does not expose phone/email automatically.
- Public profile must reject direct contact fields.
- Rate-limit new conversations and messages.
- Report/block must be available.
- Moderation hooks must exist.
- Do not store message content unless required by provider/compliance design.

## System messages

The platform may send:
- order created
- payment succeeded
- booking confirmed
- cancellation
- refund
- review reminder

System messages are generated server-side.

## Safety

- blocked user cannot start new conversation;
- abuse report creates moderation case;
- suspicious spam may trigger temporary restrictions;
- moderator access must be audited.
