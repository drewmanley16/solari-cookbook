# Creator Growth Dashboard (TypeScript)

Turn Solari into a creator dashboard for a builder's public social media journey:

1. A Solari cloud browser opens public social, profile, project, and docs pages.
2. The script extracts titles, metadata, headings, post-like text, and useful snippets.
3. A Solari sandbox receives the evidence bundle and runs an isolated Python scoring job.
4. The app writes creator growth assets to `out/`.

It does **not** post anything. It turns public proof into a practical dashboard:
what story is visible, what to publish next, what scripts to use, and who to
approach for partnerships.

## Run With Solari

```bash
cd examples/creator-growth-dashboard-ts
npm install
export SOLARI_API_KEY=slr_live_...
npm start -- \
  --subject "Drew's social media journey toward shipping with Solari" \
  --targets https://www.linkedin.com/posts/harry-chow1_were-hiring-a-swe-intern-for-pinetree-research-activity-7500203701882527746-mZal https://github.com/drewmanley16/solari-cookbook/tree/main/examples/creator-growth-dashboard-ts https://docs.getsolari.com https://getsolari.com
```

Pass your own public X, LinkedIn, GitHub, blog, YouTube, newsletter, or project
URLs in `--targets` to make the dashboard about your actual public footprint.

## Try The Shape Locally

No API key needed:

```bash
npm run sample
```

Generated files:

- `out/evidence.json` — normalized public evidence.
- `out/creator-growth-brief.md` — sandbox-generated strategy brief.
- `out/creator-growth-dashboard.html` — public-review friendly dashboard.
- `out/content-calendar.md` — 14-day content plan.
- `out/script-studio.md` — X thread, LinkedIn post, and short-form video script.
- `out/partnership-outreach.md` — partnership radar, DM, and follow-up.
- `out/linkedin-post-draft.md` — challenge post draft with the required tags.
- `out/x-post-draft.md` — short X draft with the required tags.

## Why This Can Win

This is a real use case for Solari because creator growth work depends on messy
public web context:

- Solari browsers read pages that plain HTTP fetches often miss or flatten badly.
- Solari sandboxes turn collected evidence into reproducible strategy artifacts.
- The output is useful to creators, founders, developer advocates, students, and
  anyone building in public.
- The app creates shareable assets but never posts without human consent.

Source: [`src/index.ts`](src/index.ts)
