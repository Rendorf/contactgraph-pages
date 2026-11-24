# OpenAlex API-key integration threat note

Date: 2026-11-23  
Backlog: B-007

## Inputs and assets

- Inputs: the fixed OpenAlex authors endpoint, a contact-derived public search name, the `OPENALEX_API_KEY` runtime environment variable, and OpenAlex JSON responses.
- Assets: the OpenAlex API key, its daily request budget, OSINT availability, and the rule that private contact fields never enter provider queries.
- Classification: the API key is a credential (`pii-sensitive` controls); provider queries and responses are confidential application data.

## Attack surface and abuse cases

1. A key in the query string leaks through URLs, logs, monitoring, or error reports.
2. A changed `CONTACTGRAPH_OPENALEX_URL` sends the key to an attacker-controlled host.
3. An empty or malformed key is silently treated as authenticated configuration and makes failures hard to diagnose.
4. Automatic retries on daily-budget `429` responses amplify spend or keep the provider unavailable.
5. Error handling or tests print the key or an authorization header.
6. A principal with broad Secret Manager access reads unrelated production secrets.

At 10,000 automated searches per minute, OpenAlex and the application can exhaust the account budget. Existing OSINT authentication, authorization, Cloud Run concurrency, and provider-result limits remain the business-operation boundary; this change does not add retries or increase request volume.

## Measures and detection

- Send the key in an `Authorization: Bearer` header, never in the URL.
- Attach the header only when the request origin is exactly `https://api.openalex.org`; custom and test endpoints receive no key.
- Permit an absent key for local anonymous development, but fail with a neutral configuration error when a configured value is empty, outside a 16–256 byte bound, or contains whitespace/control characters.
- Keep the current one-request behavior and neutral `429` error; do not retry automatically.
- Add negative tests for custom-origin exfiltration, missing keys, malformed keys, and header construction with a synthetic key.
- Inject the secret from Google Secret Manager at deploy time and grant the Cloud Run runtime service account access only to `openalex-api-key`.
- Never log request headers, environment values, or provider keys. Use Cloud Audit Logs and OpenAlex usage reporting for access and budget anomalies.

## Trace target

- Abuse cases 1–5: `scripts/osint-providers.mjs` and `scripts/osint-service.test.mjs`.
- Abuse case 6: `.github/workflows/cloudrun-osint.yml`, `cloudrun/README.md`, and the per-secret IAM binding.
