# Deploy Parla (Immergo) from Cloud Shell

Live app:
https://immersive-language-learning-823674477838.us-central1.run.app

## One-shot update

Paste this in **Google Cloud Shell** (already logged in as `eben@ebenforrest.com`):

```bash
cd ~
curl -L https://codeload.github.com/Eben283/amarimethod-website/tar.gz/refs/heads/cursor/immergo-ui-vertex-fix-bdfc \
  | tar -xz --strip-components=2 '*/immergo-italian'
cd ~/immergo-italian
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

Then hard-refresh the phone (or clear site data) and try a mission again.

## What this fixes

- Removes top **Source** badge and bottom **developer_mode.sh / Deploy your own** card
- Hides Simple Mode banner
- Defaults to Italian + Teacher Mode, longer sessions
- Skips empty Vertex tool configs that can cause **Invalid document** errors
- Enables Vertex AI + grants `roles/aiplatform.user` to the Cloud Run service account
- Shows the **full** Gemini/Vertex error in the browser if something still fails
