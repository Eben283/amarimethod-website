#!/bin/bash
# Personal deploy for immergo-italian (Italian practice on Cloud Run)
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="${PROJECT_ID:-immergo-italian}"
SERVICE_NAME="${SERVICE_NAME:-immersive-language-learning}"
REGION="${REGION:-us-central1}"
MODEL="${MODEL:-gemini-live-2.5-flash-native-audio}"
SESSION_TIME_LIMIT="${SESSION_TIME_LIMIT:-600}"
DEV_MODE="${DEV_MODE:-true}"
GLOBAL_RATE_LIMIT="${GLOBAL_RATE_LIMIT:-1000 per hour}"
PER_USER_RATE_LIMIT="${PER_USER_RATE_LIMIT:-30 per minute}"

echo "🔧 Project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

echo "🔌 Enabling required APIs..."
gcloud services enable \
  aiplatform.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="$PROJECT_ID"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "🔐 Granting Vertex AI user to $COMPUTE_SA"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/aiplatform.user" \
  --condition=None \
  --quiet >/dev/null || true

echo "📦 Building frontend..."
npm ci
npm run build

echo "🚀 Deploying $SERVICE_NAME to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --project "$PROJECT_ID" \
  --session-affinity \
  --clear-base-image \
  --set-env-vars "PROJECT_ID=${PROJECT_ID}" \
  --set-env-vars "LOCATION=${REGION}" \
  --set-env-vars "MODEL=${MODEL}" \
  --set-env-vars "SESSION_TIME_LIMIT=${SESSION_TIME_LIMIT}" \
  --set-env-vars "APP_NAME=${SERVICE_NAME}" \
  --set-env-vars "GLOBAL_RATE_LIMIT=${GLOBAL_RATE_LIMIT}" \
  --set-env-vars "PER_USER_RATE_LIMIT=${PER_USER_RATE_LIMIT}" \
  --set-env-vars "DEV_MODE=${DEV_MODE}"

URL="$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')"
echo "✅ Live at: $URL"
echo "Hard-refresh your phone (or clear site data) before testing."
