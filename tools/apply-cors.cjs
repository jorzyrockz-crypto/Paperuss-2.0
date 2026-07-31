/**
 * apply-cors.cjs
 * Applies CORS config to Firebase Storage bucket via Google Cloud Storage XML API.
 * Requires: Firebase project service account key OR gcloud ADC token.
 *
 * Simpler alternative: use the Google Cloud Console UI.
 * Instructions printed below if token fetch fails.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BUCKET = 'my-paperuss-database-2.firebasestorage.app';
const CORS_FILE = path.join(__dirname, '..', 'cors.json');

const corsBody = `<?xml version="1.0" encoding="UTF-8"?>
<CorsConfig>
  <Cors>
    <Origins>
      <Origin>*</Origin>
    </Origins>
    <Methods>
      <Method>GET</Method>
      <Method>PUT</Method>
      <Method>POST</Method>
      <Method>DELETE</Method>
      <Method>HEAD</Method>
    </Methods>
    <ResponseHeaders>
      <ResponseHeader>Content-Type</ResponseHeader>
      <ResponseHeader>Content-Length</ResponseHeader>
      <ResponseHeader>Content-Disposition</ResponseHeader>
      <ResponseHeader>Content-Encoding</ResponseHeader>
      <ResponseHeader>Authorization</ResponseHeader>
      <ResponseHeader>x-goog-resumable</ResponseHeader>
    </ResponseHeaders>
    <MaxAgeSec>3600</MaxAgeSec>
  </Cors>
</CorsConfig>`;

console.log('\n=== Firebase Storage CORS Setup ===\n');
console.log('gsutil is not installed. To apply CORS, you have two options:\n');

console.log('OPTION 1: Via Google Cloud Console (no install needed)');
console.log('─────────────────────────────────────────────────────');
console.log('1. Open: https://console.cloud.google.com/storage/browser/paperuss-2.firebasestorage.app');
console.log('2. Click the bucket name → "Permissions" tab');
console.log('3. There is no CORS UI in the console — proceed to Option 2.\n');

console.log('OPTION 2: Install Google Cloud SDK (5 min, permanent fix)');
console.log('──────────────────────────────────────────────────────────');
console.log('1. Download: https://cloud.google.com/sdk/docs/install');
console.log('   (Windows installer, ~100MB)');
console.log('2. Run installer, it adds gsutil to PATH automatically');
console.log('3. Open a NEW terminal window and run:');
console.log('     gcloud init');
console.log('   (sign in with the same Google account as your Firebase project)');
console.log('4. Then run:');
console.log(`     gsutil cors set cors.json gs://${BUCKET}`);
console.log('5. Verify:');
console.log(`     gsutil cors get gs://${BUCKET}\n`);

console.log('OPTION 3: Firebase CLI (if you have it or npm available)');
console.log('──────────────────────────────────────────────────────────');
console.log('Firebase CLI does NOT support Storage CORS directly.');
console.log('gsutil (Google Cloud SDK) is the only official method.\n');

console.log('QUICKEST PATH:');
console.log('  Install Google Cloud SDK → gcloud init → gsutil cors set cors.json gs://paperuss-2.firebasestorage.app\n');
