# ContactGraph on GitHub Pages and Firebase

The Pages build is a static Vite app. GitHub Actions publishes only HTML, CSS, JavaScript, the app shell, and icons. Private CRM records live in Cloud Firestore under Google sign-in and the rules in `firestore.rules`.

## Live deployment

- Site: https://contacts.vusalkhalilov.com/ (GitHub Pages; its HTTPS certificate was still mismatched on 2026-11-08)
- Working HTTPS fallback: https://contactgraph-vusal-2026.web.app/ (deployed from the tested 2026-11-08 build)
- Public source: https://github.com/Rendorf/contactgraph-pages
- Firebase project: `contactgraph-vusal-2026`; default Firestore database in `eur3` (Europe), Standard edition, free tier.
- Google sign-in is enabled; `contacts.vusalkhalilov.com` and `rendorf.github.io` are authorized authentication domains. The Owner and Assistant email accounts are bound in private Firestore member records.
- The 2026-10-27 closed-file snapshot was imported on 2026-10-28, and all collection counts were verified. The live DuckDB and OSINT files had matching SHA-256 hashes at import time. A GitHub Actions build and deployment completed successfully.

On 2026-11-01 the custom domain was moved from the Hermes Cloudflare Tunnel to
GitHub Pages. Cloudflare DNS has a DNS-only CNAME for `contacts` pointing to
`rendorf.github.io`. GitHub Pages owns the custom-domain setting and HTTPS
certificate. The GitHub Actions build uses `PAGES_BASE_PATH=/` so assets load
at the domain root. Site delivery and normal Firestore-backed edits no longer
depend on the Hermes VM. The old Tunnel configuration remains available for
rollback but is not the public DNS target.

The published site serves the core CRM modules. The Mac app can be reconciled with Firestore from **Settings → Integrations → Mac · Firebase sync → Sync Mac and Firebase**. The Mac must be awake with Docker and its installed sync runner available. The runner checks queued requests every 30 seconds and does not require Hermes. Conflicts stop the sync for review; verified backups are taken before applying changes. Mac and Hermes remain independently editable replicas. Full three-way CLI sync includes Hermes; the dashboard preserves its previous baseline when Hermes is absent. Keep closed-file backups and reconciliation reports until verification succeeds.

## Current migration snapshot

The private 2026-10-27 export was made from a closed copy of the **running local Docker volume**, not the older repository DuckDB. It contains 2,537 contacts, 63 holidays, 22 messages, 188 meetings, three canvases, six follow-up records, 19 photos split into 20 Firestore documents, and the separate OSINT database records. The original DuckDB, OSINT DuckDB, and JSON export remain in `../backups/` outside this public repository. Take a fresh closed-file backup before a real cutover if the local app receives further edits.

## One-time setup

1. Create a Firebase project on the Spark plan. Enable Cloud Firestore and the Google provider in Firebase Authentication. Register a web app. Add the GitHub Pages host and any custom domain to Firebase Authentication's authorized domains.
2. Deploy the rules before importing data:

   ```sh
   firebase login
   firebase deploy --only firestore:rules --project PROJECT_ID --config firebase-pages/firebase.json
   ```

3. Obtain Google Application Default Credentials with Firestore import rights. Keep credentials outside this repository. Review the counts, then import the private snapshot into an **empty** Firestore project:

   ```sh
   node firebase-pages/import-firestore.mjs --input ../backups/contactgraph-firebase-migration-full-2026-10-27.json --owner-email OWNER_GOOGLE_EMAIL
   node firebase-pages/import-firestore.mjs --input ../backups/contactgraph-firebase-migration-full-2026-10-27.json --owner-email OWNER_GOOGLE_EMAIL --project PROJECT_ID --apply
   ```

   The first command is a dry run. The import refuses nonempty target collections. If an import stops partway through, rerun the same command with `--resume`; it checks already imported documents against the snapshot before continuing. The Owner email is required because the local DuckDB account was not bound to one; the Assistant email is already bound in the private export. Admin SDK access bypasses Firestore rules, so restrict those credentials and delete temporary credentials after import.

4. Create a public GitHub repository from the staged, allowlisted source files. Set repository variables `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and `FIREBASE_APP_ID` from the Firebase web app configuration. The Firebase web API key identifies the project; it is not a server secret. Enable GitHub Pages with **GitHub Actions** as its source. The workflow runs typechecking, rules tests, a static build, and an artifact safety check before publishing. For a custom domain set `PAGES_BASE_PATH` to `/`; for a project Pages URL, leave it unset.
5. Test sign-in using the bound Owner and Assistant accounts, the role permissions, all core modules, one edit on each device, and offline conflict review. Mac and Firestore support independent edits with version checks. Use the installed dashboard runner to reconcile them; Hermes is optional. Conflicting edits stop for review.

## Offline and permissions

Each approved person opts in to persistent caching on a trusted device from **Settings → Account**. The service worker caches only the static app shell. An IndexedDB outbox holds offline routine edits and syncs them on reconnect. If the shared record changed, the Sync status panel asks whether to keep the local edit or the shared version. Bulk actions, merges, account changes, and contact deletion require a connection. Browser storage on a trusted device contains private data; use the account setting to clear it after syncing pending edits.

Firestore rules are the authorization boundary. Google sign-in alone is insufficient: an active `members/{email}` record with an allowed role is required. The Owner and Assistant role documents are migrated from DuckDB. The API adapter is for compatibility with the existing screens; it is not an authorization boundary. Run `npm run test:firebase-rules` with Java available when changing permissions.

AI message generation uses the optional Hermes Firebase bridge at `https://api.contacts.vusalkhalilov.com`. The Pages app sends the signed-in user's Firebase ID token; the bridge verifies it, checks the member and role in Firestore, reads the selected contact and holiday records from Firestore, and calls OpenAI using a key saved only in Hermes's private secrets volume. Generated drafts are saved by the browser under the existing Firestore rules. Settings → Integrations shows the OpenAI key field and the Hermes connection status. If the bridge is unreachable, generation is disabled and the rest of the CRM continues to work.

The same bridge serves optional OSINT search, review, saved findings, photo previews, and confirmed positions or photos. The OSINT navigation appears only while the bridge and its private OSINT database respond and the signed-in user has `osint.view`. Writes require `osint.manage`; confirming a candidate also requires `contacts.edit`. Manual searches use current Firestore contact details. Confirmed changes to a contact go through Firestore with its rules and a document-version precondition. Daily monitoring is available in the Hermes app but is hidden in the Firebase build because its existing scheduler uses Hermes's separate contact copy.

The private Hermes deployment adds the `firebase-bridge` Compose service on port 4180. Route the public API hostname to `http://firebase-bridge:4180` through the existing Cloudflare Tunnel, and keep the site and API hostnames separate. The service accepts requests only from `https://contacts.vusalkhalilov.com` and `https://contactgraph-vusal-2026.web.app`; `/healthz` is the only unauthenticated route. The Bridge needs outbound HTTPS access to Firebase's token certificates, Firestore, and OpenAI. It shares the existing Hermes secrets and OSINT volumes, and reaches the Compose SearXNG and RSSHub services. Do not place the OpenAI key in GitHub variables, source, Firestore, or the Pages artifact.

## Private backup

Spark does not provide a managed Firestore backup. Run an encrypted export regularly using Application Default Credentials and a private passphrase, then verify it:

```sh
CONTACTGRAPH_BACKUP_PASSPHRASE='a-long-private-passphrase' node firebase-pages/backup-firestore.mjs --mode export --project PROJECT_ID --file ../backups/firestore-YYYY-MM-DD.cgbak
CONTACTGRAPH_BACKUP_PASSPHRASE='a-long-private-passphrase' node firebase-pages/backup-firestore.mjs --mode verify --file ../backups/firestore-YYYY-MM-DD.cgbak
```

Store the passphrase in a password manager, not in source control or shell history. The backup script refuses to write inside the public repository. A synthetic round-trip and tamper test runs with `--mode self-test`.
To restore, deploy the rules to a new project, then run the same script with `--mode restore --project NEW_PROJECT_ID --file BACKUP_PATH`; it refuses any nonempty target collection and verifies document counts afterward.

## Build

```sh
npm ci
npx tsc --noEmit --pretty false
npm run test:firebase-rules
npm run build:firebase-pages
npm run check:firebase-pages
```

The local Hermes build remains `npm run build` in the complete synced folder.


## Permission and privacy maintenance

`../scripts/permission_catalog.py` in the private workspace is canonical. Run `../scripts/generate_permission_catalog.py` there to regenerate this directory's JSON and rule allowlist, and use `--check` before release. Public CI checks JSON against rules. Contact merges require `contacts.delete` when source records are removed. Photo writes require a canonical chunk ID and a contact that exists after the atomic write; ownership cannot be changed in place.

Message composers disclose the data sent to OpenAI. Saved notes are excluded by default, limited to 2,000 characters when selected, and the notes checkbox resets after each generation request. Regenerating from saved message history excludes notes. Settings explains OpenAI, search services, Firebase, and trusted-device storage.

Search uses a shared search-only normalization across contacts, recipients, meetings, follow-ups, graph tags, canvas selectors, duplicate filtering and OSINT selectors. It supports Azerbaijani/Turkish accent folding and common Cyrillic transliterations, ranks original spellings first in person pickers, and never changes stored names or duplicate identity rules.
