# Threat note: appearance and relationship timeline redesign

Date: 2026-11-18

## Sensitive assets and trust boundaries

- Contact details, meeting notes, follow-up state, saved messages, and occasion outcomes are private relationship data.
- The DuckDB HTTP service and Firestore security rules remain authorization boundaries. UI visibility is not authorization.
- Theme and temporary legacy-interface preferences are presentation-only values stored in browser local storage and are not synchronized.

## Controls implemented

- Theme values are selected from a fixed allowlist; no user CSS, URL, HTML, or script is accepted.
- The timeline route first requires `contacts.view`, confirms that the requested contact exists, then includes meetings, follow-ups, and messages only when their source-specific view permission is present.
- Timeline results are contact-scoped server-side, use `private, no-store`, cap page size at 100, and use validated opaque cursors.
- Firebase collection reads remain subject to Firestore rules; the compatibility adapter reads the current role before projecting source collections.
- Timeline summaries render as React text nodes. Message/meeting content is not injected as HTML.
- Tests use synthetic identifiers and content only.

## Residual risks and follow-up

- OSINT summaries are intentionally excluded until provenance/redaction behavior is approved.
- Full endpoint integration tests for authenticated role combinations remain in the redesign backlog.
- Browser local storage reveals only appearance choices, never contact content.
