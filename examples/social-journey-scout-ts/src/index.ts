import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Solari } from "@solarisdk/browser"
import { SolariClient } from "@solarisdk/sdk"

type Evidence = {
  url: string
  host: string
  title: string
  description: string
  headings: string[]
  snippets: string[]
  postLikeTexts: string[]
}

type CliOptions = {
  subject: string
  targets: string[]
  sample: boolean
}

const DEFAULT_TARGETS = [
  "https://www.linkedin.com/posts/harry-chow1_were-hiring-a-swe-intern-for-pinetree-research-activity-7500203701882527746-mZal",
  "https://github.com/drewmanley16/solari-cookbook/tree/main/examples/social-journey-scout-ts",
  "https://docs.getsolari.com",
  "https://getsolari.com",
]

const OUT_DIR = path.join(process.cwd(), "out")
const REPORT_PATH = path.join(OUT_DIR, "social-journey-brief.md")
const DASHBOARD_PATH = path.join(OUT_DIR, "social-journey-dashboard.html")
const EVIDENCE_PATH = path.join(OUT_DIR, "evidence.json")
const LINKEDIN_POST_PATH = path.join(OUT_DIR, "linkedin-post-draft.md")
const X_POST_PATH = path.join(OUT_DIR, "x-post-draft.md")

const options = parseArgs(process.argv.slice(2))
const evidence = options.sample ? sampleEvidence() : await collectEvidence(options.targets)
const report = options.sample
  ? renderLocalReport(evidence, options.subject)
  : await analyzeInSandbox(evidence, options.subject)

await mkdir(OUT_DIR, { recursive: true })
await writeFile(REPORT_PATH, report, "utf8")
await writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2), "utf8")
await writeFile(DASHBOARD_PATH, renderDashboardHtml(evidence, report, options.subject), "utf8")
await writeFile(LINKEDIN_POST_PATH, renderLinkedInPost(options.subject, evidence), "utf8")
await writeFile(X_POST_PATH, renderXPost(), "utf8")

console.log(`sources : ${evidence.length}`)
console.log(`brief   : ${REPORT_PATH}`)
console.log(`dash    : ${DASHBOARD_PATH}`)
console.log(`linkedin: ${LINKEDIN_POST_PATH}`)
console.log(`x post  : ${X_POST_PATH}`)

function parseArgs(args: string[]): CliOptions {
  const targets: string[] = []
  let subject = "a builder turning public proof into a social media journey"
  let sample = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--sample") {
      sample = true
      continue
    }

    if (arg === "--subject") {
      subject = requireValue(args[++i], "--subject")
      continue
    }

    if (arg === "--targets") {
      while (args[i + 1] && !args[i + 1].startsWith("--")) {
        targets.push(args[++i])
      }
      continue
    }

    if (arg.startsWith("http")) {
      targets.push(arg)
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return {
    sample,
    subject,
    targets: targets.length > 0 ? targets : DEFAULT_TARGETS,
  }
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

async function collectEvidence(targets: string[]): Promise<Evidence[]> {
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) {
    throw new Error("SOLARI_API_KEY is required unless you pass --sample")
  }

  const solari = new Solari({ apiKey })
  const browser = await solari.launch()

  try {
    const page = await browser.newPage()
    const evidence: Evidence[] = []

    for (const url of targets) {
      console.log(`browse  : ${url}`)
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined)
      evidence.push(await extractEvidence(page, url))
    }

    console.log(`browser : ${browser.id}`)
    return evidence
  } finally {
    await browser.close()
    await solari.close()
  }
}

async function extractEvidence(page: {
  title(): Promise<string>
  evaluate<T>(fn: string): Promise<T>
}, url: string): Promise<Evidence> {
  const title = await page.title()
  const extracted = await page.evaluate<{
    description: string
    headings: string[]
    snippets: string[]
    postLikeTexts: string[]
  }>(`(() => {
    const clean = (value) => (value ?? "").replace(/\\s+/g, " ").trim()
    const unique = (values) => Array.from(new Set(values.map(clean).filter(Boolean)))
    const textOf = (selector) => unique(
      Array.from(document.querySelectorAll(selector)).map((element) => element.textContent)
    )

    const description = clean(
      document.querySelector('meta[name="description"]')?.content ??
      document.querySelector('meta[property="og:description"]')?.content ??
      ""
    )

    const headings = textOf("h1, h2").slice(0, 16)
    const snippets = textOf("p, li")
      .filter((text) => text.length > 50)
      .slice(0, 32)
    const postLikeTexts = textOf("article, [data-testid='tweetText'], [dir='auto']")
      .filter((text) => text.length > 80)
      .slice(0, 18)

    return { description, headings, snippets, postLikeTexts }
  })()`)

  const host = new URL(url).hostname
  return {
    url,
    host,
    title: redactSecrets(title),
    description: redactSecrets(extracted.description),
    headings: extracted.headings.map(redactSecrets),
    snippets: extracted.snippets.map(redactSecrets),
    postLikeTexts: extracted.postLikeTexts.map(redactSecrets),
  }
}

async function analyzeInSandbox(evidence: Evidence[], subject: string): Promise<string> {
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) {
    throw new Error("SOLARI_API_KEY is required unless you pass --sample")
  }

  const client = new SolariClient({ apiKey })
  const sandbox = await client.sandboxes.create({ template: "base", timeoutMs: 5 * 60_000 })

  console.log(`sandbox : ${sandbox.sandboxId}`)

  try {
    await sandbox.connect()
    await sandbox.files.write("/tmp/evidence.json", JSON.stringify({ subject, evidence }))
    await sandbox.files.write("/tmp/analyze.py", analysisPython())

    const out = await sandbox.commands.run("python3", {
      args: ["/tmp/analyze.py", "/tmp/evidence.json", "/tmp/report.md"],
    })

    if (out.exitCode !== 0) {
      throw new Error(`Sandbox analysis failed:\n${out.stderr || out.stdout}`)
    }

    return await sandbox.files.readText("/tmp/report.md")
  } finally {
    await sandbox.kill()
  }
}

function analysisPython(): string {
  return String.raw`import json
import re
import sys
from collections import Counter

source_path, report_path = sys.argv[1], sys.argv[2]
payload = json.load(open(source_path))
subject = payload["subject"]
evidence = payload["evidence"]

PILLARS = {
    "builder proof": ["built", "build", "ship", "shipping", "demo", "github", "repo", "project"],
    "ai-native workflow": ["ai", "agent", "automation", "browser", "sandbox", "desktop", "workflow"],
    "market pull": ["customer", "market", "pricing", "sales", "lead", "growth", "demand", "use case"],
    "technical depth": ["api", "sdk", "code", "typescript", "python", "testing", "benchmark", "infra"],
    "personal narrative": ["journey", "learned", "challenge", "intern", "research", "career", "story"],
}

def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()

def tokens(text):
    return re.findall(r"[a-zA-Z][a-zA-Z0-9_+-]{2,}", text.lower())

def score_pillars(corpus):
    lower = corpus.lower()
    scores = {}
    for pillar, words in PILLARS.items():
        scores[pillar] = sum(lower.count(word) for word in words)
    return scores

source_rows = []
theme_counter = Counter()
for item in evidence:
    texts = [item.get("title", ""), item.get("description", "")]
    texts += item.get("headings", [])
    texts += item.get("snippets", [])
    texts += item.get("postLikeTexts", [])
    corpus = " ".join(texts)
    pillar_scores = score_pillars(corpus)
    useful_tokens = [t for t in tokens(corpus) if t not in {"https", "www", "com", "the", "and", "you", "your", "with", "for", "that"}]
    theme_counter.update(useful_tokens)
    source_rows.append((sum(pillar_scores.values()), pillar_scores, item))

source_rows.sort(reverse=True, key=lambda row: row[0])
top_pillars = Counter()
for _, pillar_scores, _ in source_rows:
    top_pillars.update(pillar_scores)

lines = [
    "# Social Journey Scout Brief",
    "",
    f"Subject lens: **{subject}**",
    "",
    "## What Story Is Already Visible",
    "",
]

if source_rows:
    strongest = source_rows[0][2]
    lines.append(f"- The strongest public signal is **{clean(strongest.get('title')) or strongest['host']}**.")
else:
    lines.append("- No public sources were captured.")

for pillar, count in top_pillars.most_common():
    if count:
        lines.append(f"- {pillar.title()}: {count} signals")

lines.extend(["", "## Source Readout"])
for idx, (score, pillar_scores, item) in enumerate(source_rows, 1):
    lines.extend([
        "",
        f"### {idx}. {clean(item.get('title')) or item['url']}",
        "",
        f"- URL: {item['url']}",
        f"- Journey score: {score}",
        f"- Pillars: {', '.join(f'{k} x{v}' for k, v in pillar_scores.items() if v) or 'none'}",
    ])
    if clean(item.get("description")):
        lines.append(f"- Profile/meta: {clean(item['description'])[:420]}")
    for snippet in (item.get("postLikeTexts") or item.get("snippets") or [])[:3]:
        lines.append(f"- Public proof: {clean(snippet)[:260]}")

lines.extend([
    "",
    "## Content Moves To Make Next",
    "",
    "1. Post the build as a before/after story: the problem, the Solari primitives used, and the generated artifact.",
    "2. Show receipts: link the repo, include the live-run brief, and name the browser plus sandbox handoff.",
    "3. Turn the build into a reusable workflow for creators, founders, and job seekers tracking their public proof.",
    "4. Ask for usage, not validation: invite people to send two profile URLs and get a journey readout.",
    "",
    "## Suggested Positioning",
    "",
    "This is not a resume replacement. It is a public-proof compiler: Solari browses the visible internet, a sandbox scores the narrative, and the output becomes a sharper next post.",
    "",
    "## Next Product Step",
    "",
    "Add scheduled reruns and diffing so a creator can watch their public story evolve week by week.",
    "",
])

open(report_path, "w").write("\n".join(lines))
`
}

function renderLocalReport(evidence: Evidence[], subject: string): string {
  const rows = evidence
    .map((item) => ({
      item,
      score: scoreText([item.title, item.description, ...item.headings, ...item.snippets].join(" ")),
    }))
    .sort((a, b) => b.score - a.score)

  const lines = [
    "# Social Journey Scout Brief",
    "",
    `Subject lens: **${subject}**`,
    "",
    "_Sample mode: generated from fixture evidence. Run without `--sample` to use Solari browser + sandbox._",
    "",
    "## Source Readout",
    "",
  ]

  rows.forEach(({ item, score }, index) => {
    lines.push(`### ${index + 1}. ${item.title}`, "")
    lines.push(`- URL: ${item.url}`)
    lines.push(`- Journey score: ${score}`)
    item.snippets.slice(0, 3).forEach((snippet) => lines.push(`- Public proof: ${snippet}`))
    lines.push("")
  })

  lines.push("## Content Moves To Make Next", "")
  lines.push("1. Show the build, not credentials.")
  lines.push("2. Explain what changed because Solari handled browsers and sandboxes.")
  lines.push("3. Invite people to try it on their own public journey.")

  return lines.join("\n")
}

function renderDashboardHtml(evidence: Evidence[], report: string, subject: string): string {
  const cards = evidence
    .map(
      (item) => `<article>
        <a href="${escapeHtml(item.url)}">${escapeHtml(item.host)}</a>
        <h2>${escapeHtml(item.title || item.url)}</h2>
        <p>${escapeHtml(item.description || item.snippets[0] || "No description captured.")}</p>
        <ul>
          ${[...item.headings, ...item.postLikeTexts]
            .slice(0, 5)
            .map((text) => `<li>${escapeHtml(text)}</li>`)
            .join("")}
        </ul>
      </article>`,
    )
    .join("")

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Social Journey Scout</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #171412;
      --muted: #665f58;
      --line: #d6d1ca;
      --paper: #f6f4ef;
      --panel: #ffffff;
      --accent: #006d77;
      --accent-2: #b23a48;
      --dark: #111a21;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--paper);
      color: var(--ink);
    }
    header, main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; }
    header { padding: 42px 0 24px; }
    h1 { margin: 0; font-size: clamp(2.4rem, 6vw, 5.8rem); line-height: 0.94; letter-spacing: 0; max-width: 900px; }
    header p { max-width: 740px; color: var(--muted); font-size: 1.08rem; }
    .meta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
    .meta span { border: 1px solid var(--line); background: rgba(255,255,255,0.7); padding: 8px 10px; border-radius: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin: 20px 0 30px; }
    article { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; min-height: 280px; }
    article a { color: var(--accent); font-weight: 700; text-decoration: none; }
    article h2 { font-size: 1.08rem; margin: 10px 0; }
    article p, li { color: var(--muted); }
    article ul { padding-left: 18px; }
    .brief { background: var(--dark); color: #f7f5ef; border-radius: 8px; padding: 24px; margin-bottom: 40px; }
    .brief h2 { margin-top: 0; }
    .brief pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: inherit; color: #e7e2d6; }
    .rail { height: 6px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
  </style>
</head>
<body>
  <div class="rail"></div>
  <header>
    <h1>Social Journey Scout</h1>
    <p>Solari browses public proof, then a sandbox turns it into a content strategy brief for the next chapter of a builder's social media journey.</p>
    <div class="meta">
      <span>Subject: ${escapeHtml(subject)}</span>
      <span>Sources: ${evidence.length}</span>
      <span>Artifacts: Brief, JSON, dashboard, post drafts</span>
    </div>
  </header>
  <main>
    <section class="grid" aria-label="Captured public sources">${cards}</section>
    <section class="brief">
      <h2>Generated Journey Brief</h2>
      <pre>${escapeHtml(report)}</pre>
    </section>
  </main>
</body>
</html>`
}

function renderLinkedInPost(subject: string, evidence: Evidence[]): string {
  const hosts = evidence.map((item) => item.host).join(", ")
  const repoUrl = "https://github.com/drewmanley16/solari-cookbook"
  const exampleUrl = `${repoUrl}/tree/main/examples/social-journey-scout-ts`

  return `I built Social Journey Scout with Solari for the Pinetree Research SWE intern challenge.

It turns a public social media journey into a strategy brief:
- Solari browser collects public profile/post evidence
- Solari sandbox scores the narrative arc and content pillars
- the app outputs a brief, evidence JSON, dashboard, and post drafts

Repo: ${repoUrl}
Example: ${exampleUrl}

Subject lens: ${subject}
Sources tested: ${hosts}

Built with AI, because the assignment explicitly rewards shipping faster with AI.

@harrychow_ @getsolari
`
}

function renderXPost(): string {
  return `Built Social Journey Scout for the Pinetree SWE intern challenge: Solari browsers collect public social proof, then a Solari sandbox turns it into a content strategy brief.

https://github.com/drewmanley16/solari-cookbook/tree/main/examples/social-journey-scout-ts

@harrychow_ @getsolari
`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function redactSecrets(value: string): string {
  return value.replace(/slr_live_[A-Za-z0-9_-]*/g, "slr_live_[redacted]")
}

function scoreText(text: string): number {
  const corpus = text.toLowerCase()
  return [
    "built",
    "build",
    "ship",
    "journey",
    "story",
    "social",
    "agent",
    "browser",
    "sandbox",
  ].reduce((score, word) => score + (corpus.match(new RegExp(word, "g"))?.length ?? 0) * 3, 0)
}

function sampleEvidence(): Evidence[] {
  return [
    {
      url: "https://x.com/example-builder",
      host: "x.com",
      title: "Example Builder on X",
      description: "Building in public with AI agents, browser automation, and shipping notes.",
      headings: ["Posts", "Replies", "Highlights"],
      snippets: [
        "I stopped polishing private demos and started shipping public experiments every week.",
        "The best feedback came after I showed the messy browser automation trace, not the final screenshot.",
        "This week I am turning my job search into a series of useful tools people can actually try.",
      ],
      postLikeTexts: [
        "Built a tiny agent that watches product pages and turns changes into a customer-ready digest.",
        "Lesson from shipping in public: proof beats promises, especially when the repo is open.",
      ],
    },
    {
      url: "https://www.linkedin.com/in/example-builder",
      host: "www.linkedin.com",
      title: "Example Builder | LinkedIn",
      description: "Student builder documenting AI-native software experiments.",
      headings: ["Experience", "Projects", "Activity"],
      snippets: [
        "I use public posts as a forcing function: every build needs a story, a user, and a next step.",
        "Recent work includes agent QA, social listening, and sandboxed code execution.",
        "My goal is to make each project useful enough that someone else asks to run it.",
      ],
      postLikeTexts: [
        "A good project post should show the before state, the thing you built, and the proof that it ran.",
        "I am learning that distribution is a product skill, not a garnish after engineering.",
      ],
    },
  ]
}
