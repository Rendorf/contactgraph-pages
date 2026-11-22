# ContactGraph managed OSINT backend

The production OSINT API runs on Cloud Run in `europe-west1` and stores state in the existing `contactgraph-vusal-2026` Firestore database (`eur3`). It does not require Hermes, DuckDB, SearXNG, or RSSHub.

## One-time bootstrap

1. Create Artifact Registry repository `contactgraph` in `europe-west1`.
2. Create runtime, scheduler, and GitHub deploy service accounts using least-privilege IAM. The runtime account needs Firestore access, Cloud Tasks enqueue access, and Secret Manager access only to `brave-search-api-key` and `open-api-key`; the scheduler identity does not need data access. Permit the Cloud Scheduler and Cloud Tasks service agents to mint OIDC tokens for the scheduler identity.
3. Create Secret Manager secrets `brave-search-api-key` and `open-api-key`, then add the current keys as versions without printing them in a terminal, workflow, or log. The OpenAI secret preserves birthday and holiday message generation after the API hostname moves away from Hermes.
4. Configure GitHub environment `production-osint` with repository variables:
   `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_RUNTIME_SERVICE_ACCOUNT`, and `GCP_SCHEDULER_SERVICE_ACCOUNT`.
5. The Pages client uses the stable Cloud Run service URL directly and sends Firebase ID tokens only to that compile-time-fixed origin. Verify `https://contactgraph-osint-api-el2lney4da-ew.a.run.app/health`, then deploy the Pages client. A Firebase Hosting site and `api.contacts.vusalkhalilov.com` may be added later as an optional alias; neither the alias nor the retired `CONTACTGRAPH_CLOUD_API_READY` gate blocks the managed UI.
6. Enable automatic cleanup of temporary results: `gcloud firestore fields ttls update expires_at --project contactgraph-vusal-2026 --collection-group=osint_transients --enable-ttl`.
7. Add Google Cloud billing alerts at USD 10, 15, and 20. The service independently enforces 2,500 Brave requests per UTC month.

The workflow builds an immutable image tagged with the git commit, deploys at most one scale-to-zero instance, configures the five-minute authenticated scheduler tick, and verifies `/health`. If the required GitHub variables are absent, verification still runs and deployment is deliberately skipped.

## Migration and rollback

Keep Hermes OSINT writes paused during cutover. Export the closed DuckDB with `firebase-pages/export-duckdb.py`, import missing records with the existing resumable Firestore importer, and compare collection counts before routing traffic. The Firestore store maps legacy `searxng` monitor selections to `web` on read.

Rollback is a DNS/Hosting switch back to the previous API origin plus deployment of the prior immutable Cloud Run image digest. Do not delete the private DuckDB export until Firestore backup and restore have been verified.

## Operations

- Cloud Run structured logs contain request IDs but no tokens, queries, contact data, or provider keys.
- `/health` is the only unauthenticated diagnostic response. Cloud Run reserves externally routed paths ending in `z`, so do not rename it to `/healthz`. OSINT endpoints still require Firebase ID tokens and role permissions.
- The scheduler uses an OIDC token whose audience and service-account email are both verified.
- Alert on Cloud Run 5xx rate, p95 latency above 60 seconds, scheduler failures, and managed-search budget usage above 80%.
