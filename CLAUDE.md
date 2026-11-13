# Claude instructions for this repository

## Git workflow

- Commit directly to `main` and push there (`git push origin main`). Don't open pull requests or work on feature branches unless asked.
- Every push to `main` deploys the hosted extension to GitHub Pages (`.github/workflows/pages.yml`), so a push goes live to players within minutes. Before pushing, run:

  ```sh
  npm run typecheck && npm test && npm run build
  ```

  Push only when all three pass. In your report, say what couldn't be checked without a live Owlbear room.
