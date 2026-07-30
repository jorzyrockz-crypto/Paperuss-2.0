<div align="center">
  <img src="assets/icons/paperuss-192.png" width="96" height="96" alt="PapeRuss logo">
  <h1>PapeRuss</h1>
  <p>An offline-first workspace for notes, tasks, planning, and media.</p>
  <p>
    <a href="https://paperuss-2.jorzyrockz.workers.dev/"><strong>Open PapeRuss</strong></a>
  </p>
</div>

## About

PapeRuss is a responsive Progressive Web App that combines rich-text notes, tasks, reminders, calendar planning, and media organization. It works locally as a guest and can synchronize a signed-in user's complete workspace through Firebase.

The frontend is a lightweight static application built with HTML, CSS, and JavaScript. It is hosted by Cloudflare and uses Firebase as its managed backend.

## Features

- Rich-text notes with formatting, tags, pinning, archiving, and search
- Checklists, standalone tasks, due dates, reminders, and notifications
- Calendar views and event metadata
- Images, video, audio recordings, file attachments, and rich links
- Responsive desktop, tablet, and phone interfaces
- Offline support and installable PWA behavior
- Guest mode with device-local storage
- Google and email/password authentication
- Cross-device synchronization for signed-in users
- Portable settings, theme, calendar position, activity, and custom avatar
- Deletion tracking to prevent removed records from returning during sync

## Architecture

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | HTML, CSS, JavaScript | Application interface and local behavior |
| Hosting | Cloudflare Worker + static assets | HTTPS delivery and GitHub-based deployment |
| Authentication | Firebase Authentication | Google and email/password accounts |
| Data | Cloud Firestore | Notes, tasks, settings, and sync metadata |
| Media | Firebase Storage | Images, video, audio, and attachments |
| Offline storage | localStorage and IndexedDB | Guest data, local cache, and media blobs |
| PWA | Web App Manifest and Service Worker | Installation, app shell, and offline loading |

## Data behavior

### Guest mode

Guest data stays inside the current browser. It is not uploaded and will not automatically appear on another browser, device, or domain.

### Signed-in mode

Signed-in work is synchronized under the user's Firebase UID. Notes and structured workspace data are stored in Firestore, while attachment blobs are stored in Firebase Storage.

Browser permissions, PWA installation state, and browser cache remain device-specific.

## Run locally

Do not open `index.html` directly through a `file://` URL. Authentication and service-worker features require localhost or HTTPS.

From the repository root:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8765/
```

## Firebase setup

The checked-in configuration targets Firebase project `paperuss-2`.

Enable these Firebase products:

1. Authentication
   - Google
   - Email/Password
2. Cloud Firestore
3. Cloud Storage

Under **Authentication → Settings → Authorized domains**, include every production hostname:

```text
paperuss-2.jorzyrockz.workers.dev
paperuss-2.web.app
paperuss-2.firebaseapp.com
localhost
```

Publish the owner-only rules included in:

- `firestore.rules`
- `storage.rules`

The Firebase web API key in the frontend identifies the Firebase project; it is not a server secret. Access control depends on Firebase Authentication and correctly deployed Security Rules.

## Deployment

### Cloudflare

The production application is available at:

```text
https://paperuss-2.jorzyrockz.workers.dev/
```

The `Deploy Cloudflare Worker` GitHub Actions workflow publishes `main` using a Worker with static assets. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets before enabling deployment.

Published GitHub Releases are automatically converted into `CHANGELOG.md` and `changelog.json`. The app serves the JSON document at `/changelog.json` and displays it from the profile menu’s **What’s new** action.

### Firebase Hosting

Firebase Hosting remains configured as an alternative:

```powershell
npx firebase-tools login
npx firebase-tools deploy --only "hosting,firestore:rules,storage"
```

## Project structure

```text
.
├── assets/
│   ├── css/
│   └── icons/
├── js/
├── tools/
├── index.html
├── manifest.webmanifest
├── sw.js
├── firebase.json
├── firestore.rules
└── storage.rules
```

## Development workflow

1. Make changes locally.
2. Test through localhost.
3. Check JavaScript syntax and PWA behavior.
4. Commit changes to Git.
5. Push `main` to GitHub.
6. Let Cloudflare publish the new commit.

Never commit Firebase service-account JSON files, private API credentials, or downloaded account keys.
