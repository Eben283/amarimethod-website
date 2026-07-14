# Deploy Parla (Immergo) from Cloud Shell

Your live app:
https://immersive-language-learning-823674477838.us-central1.run.app

## One-shot update (Cloud Shell)

```bash
cd ~
git clone --depth 1 -b cursor/immergo-ui-vertex-fix-bdfc https://github.com/eben283/amarimethod-website.git amari-immergo-tmp \
  || (cd amari-immergo-tmp && git fetch origin cursor/immergo-ui-vertex-fix-bdfc && git checkout cursor/immergo-ui-vertex-fix-bdfc)
cd ~/amari-immergo-tmp/immergo-italian
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

If the website repo is private, authenticate GitHub in Cloud Shell first, or copy this folder into `~/immersive-language-learning-with-live-api` and run `./scripts/deploy.sh` from there.

## What this fixes

- Removes top **Source** badge and bottom **developer_mode.sh / Deploy your own** card
- Hides Simple Mode banner
- Defaults to Italian + Teacher Mode, longer sessions
- Skips empty Vertex tool configs that can cause **Invalid document** errors
- Enables Vertex AI + grants `roles/aiplatform.user` to the Cloud Run service account
- Forwards full Gemini/Vertex errors to the browser alert (no more truncated mystery toasts)
