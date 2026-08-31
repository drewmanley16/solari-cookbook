# Social Journey Scout (TypeScript)

Turn Solari into a public-proof analyst for a builder's social media journey:

1. A Solari cloud browser opens public social, profile, project, and docs pages.
2. The script extracts titles, metadata, headings, post-like text, and useful snippets.
3. A Solari sandbox receives the evidence bundle and runs an isolated Python scoring job.
4. The app writes a journey brief, evidence JSON, shareable HTML dashboard, and platform-specific post drafts to `out/`.

The point is not to automate posting. The point is to help a builder understand
the story their public work already tells, then turn that into a sharper next
post with receipts.

## Run With Solari

```bash
cd examples/social-journey-scout-ts
npm install
export SOLARI_API_KEY=slr_live_...
npm start -- \
  --subject "Drew's social media journey toward shipping with Solari" \
  --targets https://www.linkedin.com/posts/harry-chow1_were-hiring-a-swe-intern-for-pinetree-research-activity-7500203701882527746-mZal https://github.com/drewmanley16/solari-cookbook/tree/main/examples/social-journey-scout-ts https://docs.getsolari.com https://getsolari.com
```

Pass your own public X, LinkedIn, GitHub, blog, or project URLs in `--targets`
to make the brief about your actual social footprint.

## Try The Shape Locally

No API key needed:

```bash
npm run sample
```

Sample mode uses fixture evidence and the same output contract, which makes it
easy to review the project shape before using Solari minutes.

Generated files:

- `out/evidence.json` — normalized public evidence.
- `out/social-journey-brief.md` — sandbox-generated journey brief.
- `out/social-journey-dashboard.html` — public-review friendly dashboard.
- `out/linkedin-post-draft.md` — longer LinkedIn draft with the required tags.
- `out/x-post-draft.md` — short X draft with the required tags.

Optional GitHub Pages files are included under `/docs`. To publish the dashboard
as a live page, enable GitHub Actions for the account and run the
`Deploy Social Journey Scout` workflow.

## Why This Can Win

This fits the actual challenge better than a toy scrape:

- It is about public proof, distribution, and building in the open.
- It uses Solari browser sessions for pages that normal HTTP fetches often miss.
- It uses a Solari sandbox for reproducible scoring and artifact generation.
- It outputs the exact assets needed to share the build without posting automatically.

Source: [`src/index.ts`](src/index.ts)
