# ContactGraph redesign backlog

## Before making the redesign the default

- Complete a visual QA matrix on phone, tablet, laptop, and wide desktop for all five appearance regimes.
- Run keyboard-only, screen-reader, contrast, zoom-to-200%, reduced-motion, and touch-target checks.
- Replace remaining legacy hard-coded colors inside advanced modules with semantic tokens, prioritizing Calendar, Network, Canva, OSINT, dialogs, and empty/error states.
- Add screenshot regression coverage for Today, People, contact Profile/Timeline/Edit, Calendar agenda, Network, and More.
- Test roles that have contacts-only, meetings-only additions, drafts-only additions, and owner permissions to confirm unavailable timeline sources stay absent.
- Add analytics-free structured usability notes for review sessions: task, friction, severity, decision, and follow-up owner.

## Product follow-ups

- Decide whether Today should support inline completion/rescheduling or stay review-only.
- Decide whether relationship status should use a small controlled vocabulary while remaining qualitative.
- Design dedicated tablet split views for People/Profile and Calendar/Agenda.
- Consider user-defined accent colors only after the five regimes have stable contrast guarantees.
- Define the one-release legacy fallback window and removal criteria after the preview is approved.

## Engineering follow-ups

- Add integration tests for the DuckDB and Firebase timeline routes, including 400/403/404 responses and cursor tampering.
- Add a stable endpoint for OSINT timeline summaries once its redaction and provenance model is approved.
- Add offline timeline caching only after encrypted-at-rest behavior and eviction limits are specified.
- Revisit bundle splitting for the heavier graph and Canva modules after the redesign becomes default.
