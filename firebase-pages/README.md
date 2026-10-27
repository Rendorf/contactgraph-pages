# ContactGraph on GitHub Pages and Firebase

The Pages build is a static Vite app. GitHub Actions publishes only HTML, CSS, JavaScript, the app shell, and icons. Private CRM records live in Cloud Firestore under Google sign-in and the rules in `firestore.rules`.

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
5. Test sign-in using the bound Owner and Assistant accounts, the role permissions, all core modules, one edit on each device, and offline conflict review. Once satisfied, make Firestore the editing source of truth. Keep Hermes and the local DuckDB read-only until their remaining changes are reconciled. There is no automatic bidirectional DuckDB ↔ Firestore sync in this release.

## Offline and permissions

Each approved person opts in to persistent caching on a trusted device from **Settings → Account**. The service worker caches only the static app shell. An IndexedDB outbox holds offline routine edits and syncs them on reconnect. If the shared record changed, the Sync status panel asks whether to keep the local edit or the shared version. Bulk actions, merges, account changes, and contact deletion require a connection. Browser storage on a trusted device contains private data; use the account setting to clear it after syncing pending edits.

Firestore rules are the authorization boundary. Google sign-in alone is insufficient: an active `members/{email}` record with an allowed role is required. The Owner and Assistant role documents are migrated from DuckDB. The API adapter is for compatibility with the existing screens; it is not an authorization boundary. Run `npm run test:firebase-rules` with Java available when changing permissions.

AI generation and live OSINT collection need a private server and are unavailable in this static release. Saved messages and OSINT records are kept privately in Firestore; the saved OSINT screens remain unavailable until a private backend is added. The existing Hermes app continues to run with DuckDB in the meantime.

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
