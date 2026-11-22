# Threat note: shared meeting lists

Date: 2026-11-22

## Sensitive assets and boundaries

- A list name, its membership, cadence, snooze date, and last quick check-in reveal relationship priorities and are private contact data.
- DuckDB HTTP authorization and Firestore rules are the enforcement boundaries. Hiding a control in React is only a usability measure.
- Meeting notes remain separate records. **Met today** advances schedules without inventing a meeting or note.

## Controls implemented

- Reading lists requires `followups.view`; creating, editing, deleting, enrolling, snoozing, or marking met requires `followups.manage`. Contact merge additionally requires both so memberships can be moved without becoming orphaned.
- Server input uses action-specific allowlists, bounded names and batches, 7–365 day cadence limits, strict IDs and real ISO calendar dates. DuckDB queries are parameterized.
- Firestore rules repeat shape, range, reference, revision, and immutable-membership checks. Contact deletion may read and delete dependent memberships but cannot otherwise edit them.
- A membership ID is derived from the list/person pair for deterministic three-store reconciliation. The sync normalizer rejects a mismatched ID, invalid date, missing reference, or oversized/invalid cadence.
- Due dates are derived from source facts rather than synchronized as a second source of truth: the latest non-future meeting or quick check-in plus cadence, or the join date when there is no history, then any later snooze.
- Offline replay orders parent records before dependent creates and dependent deletes before parents. Conflict and revision behavior remains the existing trusted-device outbox behavior.
- Tests use synthetic people and cover authorization, rule rejection, date/cadence derivation, all-list quick check-in, merge/delete integrity, registry drift, and DuckDB export/apply/re-export equality.

## Residual risks

- Firebase list deletion and bulk membership writes use several revision-checked operations, not one unbounded transaction. A connection failure can leave a safe partial result that is visible after refresh and can be retried; it does not silently remove the parent before its memberships.
- Firestore cannot enforce case-insensitive list-name uniqueness by rule alone. Both application backends enforce it, and DuckDB also has a unique index; a privileged user bypassing the application could create a duplicate that the next sync refuses to apply.
- Roles that can merge contacts must also receive both follow-up permissions. This is explicit in routing and UI checks because preserving a private schedule during a browser-side Firestore transaction cannot safely bypass the list permission boundary.
