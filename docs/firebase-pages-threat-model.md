# Firebase Pages migration threat model

The new GitHub Pages shell is public. Contacts, photos, meetings, follow-ups,
canvases, holidays and message history are private personal data. The browser,
the Firebase Authentication token, Firestore documents, the local DuckDB
snapshot, GitHub repository and Pages artifact are separate trust boundaries.

| Misuse | Required control |
| --- | --- |
| A build publishes `contacts.json`, photos or secrets | Remove old public snapshots; deny them in the repository; scan the exact Pages artifact before upload. |
| A signed-in but unapproved Google account reads contacts | Firestore Rules verify a live approved-email record for every collection; the UI signs the account out. |
| A user forges a role or changes protected records | Rules read server-owned permissions and validate record IDs, allowed operations and bounded fields. |
| A revoked user reconnects with queued offline edits | Rules reject the writes; the client keeps the rejected local draft for review. |
| Two devices edit the same contact | Compare revisions before upload and expose a conflict rather than silently replacing either edit. |
| A browser loses its cache | An authorized admin can export an encrypted backup with the private CLI and verify or restore it to an empty project. |
| A malformed or oversized photo consumes storage or leaks publicly | Validate MIME and size, store bounded private Firestore chunks and hash the reassembled bytes. |
| An automated client exhausts Spark reads or writes | Limit list subscriptions and bulk operations, bound payloads, and show quota failures without losing local drafts. |

No production data is used in emulator tests. The active local DuckDB remains
authoritative until import verification and domain cutover are complete.
