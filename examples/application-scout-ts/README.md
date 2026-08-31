# Application Scout (TypeScript)

Turn Solari into a tiny recruiting/intel analyst:

1. A Solari cloud browser opens public company, jobs, and docs pages.
2. The script extracts titles, metadata, headings, and useful body snippets.
3. A Solari sandbox receives the evidence bundle and runs an isolated Python scoring job.
4. The app writes a ranked Markdown brief, evidence JSON, shareable HTML
   dashboard, and social post draft to `out/`.

This is intentionally more than a quickstart. It shows a real pattern: use the
browser for messy web state, then hand clean evidence to a sandbox for repeatable
analysis.

## Run With Solari

```bash
cd examples/application-scout-ts
npm install
export SOLARI_API_KEY=slr_live_...
npm start -- \
  --candidate "AI automation intern" \
  --targets https://www.ycombinator.com/companies/pinetree https://docs.getsolari.com
```

## Try The Shape Locally

No API key needed:

```bash
npm run sample
```

The sample mode uses fixture evidence and the same output contract, which makes
it easy to review the project shape before using Solari minutes.

Generated files:

- `out/evidence.json` — normalized browser evidence.
- `out/application-scout-report.md` — sandbox-generated fit brief.
- `out/application-scout-dashboard.html` — public-review friendly dashboard.
- `out/linkedin-post-draft.md` — longer LinkedIn draft with the required tags.
- `out/x-post-draft.md` — short X draft with the required tags.

Optional GitHub Pages files are included under `/docs`. To publish the dashboard
as a live page, enable GitHub Actions for the account and run the
`Deploy Application Scout` workflow.


## Why This Is Useful

For an internship application, this produces the kind of brief a builder would
actually want before reaching out:

- Which pages contain strong evidence of fit.
- What themes appeared across sources.
- Specific source-backed bullets to reuse in an outreach post.
- A short “next build” suggestion based on the company/docs signals.

Source: [`src/index.ts`](src/index.ts)
