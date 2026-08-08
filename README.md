<div align="center">
  <img src="assets/icons/paperuss-192.png" width="96" height="96" alt="Paperuss 2.0 logo">
  <h1>Paperuss 2.0</h1>
  <p>An offline-first workspace for notes, tasks, planning, and rich media grid embeds.</p>
  <p>
    <a href="https://my-paperuss-database-2.jorzyrockz.workers.dev/"><strong>Open Paperuss 2.0</strong></a>
  </p>
</div>

## About

**Paperuss 2.0** is a responsive Progressive Web App combining rich-text notes, tasks, reminders, calendar planning, and advanced media card organization. It works locally in offline guest mode and synchronizes a signed-in user's workspace via Firebase.

The frontend is a lightweight static application built with HTML5, Vanilla CSS, and JavaScript. It is deployed via Cloudflare Workers and uses Firebase as its backend.

## Features

- **Rich-text notes**: Complete formatting, tags, pinning, archiving, inline search, and slash commands.
- **Redesigned 3-Zone File Attachments**: Notion/Linear style tall glass cards with category badges, pastel hero banners, file size specs, and direct download buttons.
- **Redesigned 16:9 Video Cards**: Cinema video hero player with compact single-row mode and master editor toolbar.
- **Animated Audio Waveforms**: Real-time 20-bar glass equalizer pulse visualizer synchronized to voice memo playback.
- **Universal Multi-Card Grid Reflow**: Auto-stretches cards to equal row heights and snaps 2, 3, or 4 columns side-by-side.
- **Checklists & Tasks**: Standalone tasks, due dates, reminders, and browser notifications.
- **Calendar & Planning**: Multi-view calendar grid with event metadata.
- **Offline PWA Support**: Installable Web App Manifest with Service Worker app-shell caching.
- **Firebase Sync & Security**: Owner-only Firestore rules, Storage buckets, Google and email/password authentication.

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

The checked-in configuration targets Firebase project `my-paperuss-database-2`.

Enable these Firebase products:

1. Authentication
   - Google
   - Email/Password
2. Cloud Firestore
3. Cloud Storage

Under **Authentication → Settings → Authorized domains**, include every production hostname:

```text
my-paperuss-database-2.jorzyrockz.workers.dev
my-paperuss-database-2.web.app
my-paperuss-database-2.firebaseapp.com
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
https://my-paperuss-database-2.jorzyrockz.workers.dev/
```

The `Deploy Cloudflare Worker` GitHub Actions workflow publishes `main` using a Worker with static assets. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets before enabling deployment.

Published GitHub Releases are automatically converted into [`CHANGELOG.md`](CHANGELOG.md) and `changelog.json`. The product roadmap, future release schedule, and **Canopy Spatial Canvas Engine** milestones are detailed in [`ROADMAP.md`](ROADMAP.md).

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
