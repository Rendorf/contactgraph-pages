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

## Sign-in persistence (2026-11-18)

By default the Google sign-in lasts one browser session. "Keep me signed in on this device" (sign-in screen or Settings → Account) or offline access switches it to local persistence, so the device stays signed in until Sign out. Only the Firebase Auth sign-in is kept; contact data is cached only with offline access. Anyone holding the unlocked device can then open the app, so the device lock is the protection. Access is still revoked centrally: deactivating the member stops all reads, because the rules check `members/<email>.active` on every request.

## Meeting recording preview (2026-11-18)

Microphone audio can contain `pii-sensitive` personal conversations. Stopping a recording therefore creates only a temporary browser-memory object URL: it does not create a meeting, upload audio, or request transcription. The user can listen locally and must explicitly choose **Save recording** before the existing authenticated upload begins.

| Misuse | Required control |
| --- | --- |
| Stopping persists private audio without an explicit choice | Stop only creates the local preview; only **Save recording** calls meeting creation and upload. |
| Accidental navigation loses the preview | Warn on page close/reload while recording, saving, or holding an unsaved preview; offer a local backup download. |
| Discarded audio remains reachable | Clear the Blob reference and revoke the object URL on discard, save, replacement, and unmount. |
| A failed save silently loses the recording | Retain the preview after an error and leave retry, playback, discard, and backup actions available. |
| Preview is mistaken for persisted audio | Label the preview **Not saved** and keep saving as a separate explicit action. |
| The flow is automated at high volume | Preview performs no server operation; the existing authenticated upload limits apply only when Save is pressed. |

Preview and discard are not logged because that would add a private activity record without a security benefit. Existing server-side save and access events remain the auditable boundary. No new endpoint, parser, dependency, or integration is introduced.
