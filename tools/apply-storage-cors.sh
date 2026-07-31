#!/usr/bin/env bash
# apply-storage-cors.sh
# Run this once to allow Firebase Storage uploads from any origin (Vercel, Cloudflare, localhost, etc.)
# Requires: Google Cloud SDK (gcloud) to be installed and authenticated

BUCKET="paperuss-2.firebasestorage.app"

echo "Applying CORS to gs://$BUCKET ..."
gsutil cors set cors.json "gs://$BUCKET"
echo "Done. CORS is now active on Firebase Storage."
echo ""
echo "Verify with:"
echo "  gsutil cors get gs://$BUCKET"
