# PapeRuss

PapeRuss is an offline-first notes, tasks, calendar, and media organizer that can sync a signed-in user's workspace across devices.

## Features

- Rich-text notes with tags, pinning, archiving, checklists, and media
- Tasks, reminders, notifications, and calendar views
- Responsive desktop, tablet, and phone layouts
- Installable Progressive Web App with offline support
- Google and email/password authentication
- Firestore workspace synchronization
- Firebase Storage synchronization for attachments
- Guest mode that stays entirely on the current device

## Run locally

Serve the repository root through a local web server. Opening `index.html` directly with a `file://` URL will prevent some authentication and PWA features from working.

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/`.

## Firebase

This project is configured for the Firebase project `paperuss-2`.

```powershell
npx firebase-tools login
npx firebase-tools deploy --only "hosting,firestore:rules,storage"
```

Deploy the included Firestore and Storage rules before testing complete workspace synchronization.

## Repository workflow

Use `main` as the production branch. Changes pushed to GitHub can later be connected to Firebase Hosting through Firebase's official GitHub integration:

```powershell
npx firebase-tools init hosting:github
```

Do not commit Firebase service-account JSON files or other private credentials.
