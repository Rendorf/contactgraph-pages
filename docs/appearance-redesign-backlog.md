# ContactGraph redesign backlog

## Post-launch quality work

- Complete a visual QA matrix on phone, tablet, laptop, and wide desktop for all five appearance regimes.
- Run keyboard-only, screen-reader, contrast, zoom-to-200%, reduced-motion, and touch-target checks.
- Replace the remaining rare-flow hard-coded colors in merge conflict, recording error, and destructive confirmation states with semantic status tokens.
- Add screenshot regression coverage for Today, People, contact Profile/Timeline/Edit, Calendar agenda, Network, and More.
- Test roles that have contacts-only, meetings-only additions, drafts-only additions, and owner permissions to confirm unavailable timeline sources stay absent.
- Add analytics-free structured usability notes for review sessions: task, friction, severity, decision, and follow-up owner.

## Product follow-ups

- Decide whether Today should support inline completion/rescheduling or stay review-only.
- Decide whether relationship status should use a small controlled vocabulary while remaining qualitative.
- Design dedicated tablet split views for People/Profile and Calendar/Agenda.
- Consider user-defined accent colors only after the five regimes have stable contrast guarantees.
- Remove the temporary legacy fallback after one stable release if no blocking issues are reported.

## Engineering follow-ups

- Add integration tests for the DuckDB and Firebase timeline routes, including 400/403/404 responses and cursor tampering.
- Add a stable endpoint for OSINT timeline summaries once its redaction and provenance model is approved.
- Add offline timeline caching only after encrypted-at-rest behavior and eviction limits are specified.
- Revisit bundle splitting for the heavier graph and Canva modules.
