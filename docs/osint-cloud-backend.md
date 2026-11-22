# Managed OSINT backend change record

## Change

- Type: normal, structural backend change requested by the owner on 2026-11-22.
- Goal: retain ContactGraph OSINT functionality without depending on Hermes.
- Strategy: deploy a new Cloud Run revision and Firebase Hosting API proxy before changing the API DNS route. Hermes remains the rollback target until migration verification.
- Data location: existing Firestore `eur3`; Cloud Run `europe-west1`.

## Mini threat model

| Asset or boundary | Abuse case | Mitigation and verification |
| --- | --- | --- |
| Firebase identities and roles | Forged, revoked, or wrong-provider token; role bypass | Firebase Admin token verification with revocation check; active-member and server-side permission checks; negative bridge tests |
| Private contacts and OSINT records | IDOR or unauthorised status/confirmation change | Contact existence checks, permission checks, strict IDs, Admin-only OSINT collections, Firestore transactions |
| Provider and OpenAI credentials | Secret committed, returned, or logged | Secret Manager/env injection, no response field, no query/header logging, source and artifact secret scans |
| Feed, image, and public-profile fetching | SSRF, redirect to metadata/private network, oversized content | HTTPS-only validation, DNS pinning and private-range blocking, redirect revalidation, byte/time limits, negative tests |
| Search spend and compute | Parallel counter bypass, deep-scan abuse, duplicate scheduler execution | Atomic monthly counter, per-user transactional rate limit, one Cloud Run instance, one Maigret queue, atomic daily claim |
| Scheduled collector | Forged scheduler request | Exact internal path/method, Google OIDC audience and service-account verification |
| Personal data | Excessive disclosure to providers or logs | Queries use only selected public identity context; no notes/contact details; structured logs contain no query or personal fields |

## Acceptance scenarios

1. Firebase owner and permitted roles can use every existing OSINT action; denied roles cannot read or mutate OSINT.
2. Web/news/image, GDELT, Wikidata, OpenAlex, Maigret, direct feeds, candidates, reports, confirmation, dismissal, and daily monitoring operate without Hermes.
3. A deep Maigret scan keeps the request open for up to five minutes and the UI remains in its searching state.
4. Existing `searxng` monitor selections appear and persist as `web`; historical findings are retained.
5. A provider failure returns partial results and a source error without losing successful findings.
6. Search calls stop when the 2,500 monthly managed-search limit is reached; free providers and saved data remain available.
7. A repeated scheduler tick cannot launch the same daily collection twice.

## Rollout and rollback

1. Pause Hermes OSINT writes and take a closed, encrypted DuckDB export.
2. Dry-run and then resume-import missing OSINT collections into Firestore; reconcile counts and sample statuses.
3. Deploy the immutable container to Cloud Run, run authenticated smoke tests, deploy the Firebase Hosting proxy, then change the API route.
4. Roll back if health fails, authenticated availability/search fails, Firestore writes fail, or elevated 5xx errors persist. Restore the previous API route and prior immutable artifact; Firestore changes are additive and remain compatible.
5. Do not delete the Hermes export until an independent Firestore restore test and owner UAT are complete.

## Required production checks

- Health and authenticated availability.
- One managed web search and one free-provider search using a synthetic query.
- One save/dismiss cycle on synthetic data.
- Scheduler authentication rejection and one authorised no-op tick.
- Cloud Run error rate, latency, saturation, Scheduler failures, and the 80% search-budget threshold.
