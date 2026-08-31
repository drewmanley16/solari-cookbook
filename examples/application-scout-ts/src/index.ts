import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Solari } from "@solarisdk/browser"
import { SolariClient } from "@solarisdk/sdk"

type Evidence = {
  url: string
  title: string
  description: string
  headings: string[]
  snippets: string[]
}

type CliOptions = {
  candidate: string
  targets: string[]
  sample: boolean
}

const DEFAULT_TARGETS = [
  "https://www.ycombinator.com/companies/pinetree",
  "https://docs.getsolari.com",
  "https://getsolari.com",
]

const OUT_DIR = path.join(process.cwd(), "out")
const REPORT_PATH = path.join(OUT_DIR, "application-scout-report.md")
const DASHBOARD_PATH = path.join(OUT_DIR, "application-scout-dashboard.html")
const SOCIAL_POST_PATH = path.join(OUT_DIR, "social-post-draft.md")

const options = parseArgs(process.argv.slice(2))

const evidence = options.sample ? sampleEvidence() : await collectEvidence(options.targets)
const report = options.sample
  ? renderLocalReport(evidence, options.candidate)
  : await analyzeInSandbox(evidence, options.candidate)

await mkdir(OUT_DIR, { recursive: true })
await writeFile(REPORT_PATH, report, "utf8")
await writeFile(path.join(OUT_DIR, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8")
await writeFile(DASHBOARD_PATH, renderDashboardHtml(evidence, report, options.candidate), "utf8")
await writeFile(SOCIAL_POST_PATH, renderSocialPost(options.candidate, evidence), "utf8")

console.log(`sources: ${evidence.length}`)
console.log(`report : ${REPORT_PATH}`)
console.log(`dash   : ${DASHBOARD_PATH}`)
console.log(`post   : ${SOCIAL_POST_PATH}`)

function parseArgs(args: string[]): CliOptions {
  const targets: string[] = []
  let candidate = "SWE intern who ships AI-native tooling"
  let sample = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--sample") {
      sample = true
      continue
    }

    if (arg === "--candidate") {
      candidate = requireValue(args[++i], "--candidate")
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
    candidate,
    sample,
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
  if (!process.env.SOLARI_API_KEY) {
    throw new Error("SOLARI_API_KEY is required unless you pass --sample")
  }

  const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY })
  const browser = await solari.launch()

  try {
    const page = await browser.newPage()
    const evidence: Evidence[] = []

    for (const url of targets) {
      console.log(`browse : ${url}`)
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined)
      evidence.push(await extractEvidence(page, url))
    }

    console.log(`browser: ${browser.id}`)
    return evidence
  } finally {
    await browser.close()
    await solari.close()
  }
}

async function extractEvidence(page: {
  title(): Promise<string>
  evaluate<T>(fn: () => T): Promise<T>
}, url: string): Promise<Evidence> {
  const title = await page.title()
  const extracted = await page.evaluate(() => {
    const textOf = (selector: string) =>
      Array.from(document.querySelectorAll(selector))
        .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)

    const description =
      document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ??
      document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content ??
      ""

    const headings = textOf("h1, h2").slice(0, 16)
    const paragraphs = textOf("p, li")
      .filter((text) => text.length > 50)
      .slice(0, 28)

    return { description, headings, snippets: paragraphs }
  })

  return {
    url,
    title,
    description: extracted.description,
    headings: extracted.headings,
    snippets: extracted.snippets,
  }
}

async function analyzeInSandbox(evidence: Evidence[], candidate: string): Promise<string> {
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) {
    throw new Error("SOLARI_API_KEY is required unless you pass --sample")
  }

  const client = new SolariClient({ apiKey })
  const sandbox = await client.sandboxes.create({ template: "base", timeoutMs: 5 * 60_000 })

  console.log(`sandbox: ${sandbox.sandboxId}`)

  try {
    await sandbox.connect()
    await sandbox.files.write("/tmp/evidence.json", JSON.stringify({ candidate, evidence }))
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
candidate = payload["candidate"]
evidence = payload["evidence"]

KEYWORDS = {
    "agent": 4,
    "browser": 5,
    "sandbox": 5,
    "desktop": 5,
    "automation": 4,
    "developer": 3,
    "docs": 2,
    "api": 3,
    "workflow": 3,
    "ship": 3,
    "build": 2,
    "research": 2,
    "security": 2,
    "testing": 2,
}

def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()

def score_source(item):
    corpus = " ".join([
        item.get("title", ""),
        item.get("description", ""),
        " ".join(item.get("headings", [])),
        " ".join(item.get("snippets", [])),
    ]).lower()
    hits = {kw: corpus.count(kw) for kw in KEYWORDS if corpus.count(kw)}
    score = sum(KEYWORDS[kw] * count for kw, count in hits.items())
    return score, hits

rows = []
themes = Counter()
for item in evidence:
    score, hits = score_source(item)
    themes.update(hits)
    rows.append((score, hits, item))

rows.sort(reverse=True, key=lambda row: row[0])

lines = [
    f"# Application Scout Brief",
    "",
    f"Candidate lens: **{candidate}**",
    "",
    "## Ranked Sources",
]

for idx, (score, hits, item) in enumerate(rows, 1):
    lines.extend([
        "",
        f"### {idx}. {clean(item.get('title')) or item['url']}",
        "",
        f"- URL: {item['url']}",
        f"- Fit score: {score}",
        f"- Signal words: {', '.join(f'{k} x{v}' for k, v in sorted(hits.items())) or 'none'}",
    ])
    if clean(item.get("description")):
        lines.append(f"- Meta: {clean(item['description'])}")
    for heading in item.get("headings", [])[:4]:
        lines.append(f"- Heading: {clean(heading)}")
    for snippet in item.get("snippets", [])[:3]:
        lines.append(f"- Evidence: {clean(snippet)[:220]}")

lines.extend([
    "",
    "## Cross-Source Themes",
    "",
])

if themes:
    for word, count in themes.most_common(10):
        lines.append(f"- {word}: {count}")
else:
    lines.append("- No repeated Solari-relevant terms found; add more targeted pages.")

best = rows[0][2] if rows else {"url": "n/a", "title": "n/a"}
lines.extend([
    "",
    "## Outreach Angle",
    "",
    f"Lead with a build that connects the strongest source, {best.get('title') or best['url']}, to a concrete automated workflow. Show the collected evidence, the isolated analysis run, and the final artifact so reviewers can inspect the whole chain.",
    "",
    "## Next Build Suggestion",
    "",
    "Package this as a scheduled scout that watches a target list, reruns browser collection weekly, and serves a Solari sandbox-generated brief at a preview URL.",
    "",
])

open(report_path, "w").write("\n".join(lines))
`
}

function renderLocalReport(evidence: Evidence[], candidate: string): string {
  const rows = evidence
    .map((item) => ({
      item,
      score: scoreText([item.title, item.description, ...item.headings, ...item.snippets].join(" ")),
    }))
    .sort((a, b) => b.score - a.score)

  const lines = [
    "# Application Scout Brief",
    "",
    `Candidate lens: **${candidate}**`,
    "",
    "_Sample mode: generated from fixture evidence. Run without `--sample` to use Solari browser + sandbox._",
    "",
    "## Ranked Sources",
    "",
  ]

  rows.forEach(({ item, score }, index) => {
    lines.push(`### ${index + 1}. ${item.title}`, "")
    lines.push(`- URL: ${item.url}`)
    lines.push(`- Fit score: ${score}`)
    item.headings.slice(0, 4).forEach((heading) => lines.push(`- Heading: ${heading}`))
    item.snippets.slice(0, 3).forEach((snippet) => lines.push(`- Evidence: ${snippet}`))
    lines.push("")
  })

  lines.push("## Next Build Suggestion", "")
  lines.push(
    "Turn this into a public preview: run collection in a Solari browser, analysis in a Solari sandbox, then expose the report as a small dashboard from the sandbox preview URL.",
  )

  return lines.join("\n")
}

function renderDashboardHtml(evidence: Evidence[], report: string, candidate: string): string {
  const cards = evidence
    .map(
      (item) => `<article>
        <a href="${escapeHtml(item.url)}">${escapeHtml(new URL(item.url).hostname)}</a>
        <h2>${escapeHtml(item.title || item.url)}</h2>
        <p>${escapeHtml(item.description || item.snippets[0] || "No description captured.")}</p>
        <ul>
          ${item.headings
            .slice(0, 5)
            .map((heading) => `<li>${escapeHtml(heading)}</li>`)
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
  <title>Application Scout</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #161616;
      --muted: #646464;
      --line: #d8d2c8;
      --paper: #f7f5ef;
      --panel: #ffffff;
      --accent: #006d77;
      --accent-2: #9d4edd;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--paper);
      color: var(--ink);
    }
    header, main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; }
    header { padding: 48px 0 28px; }
    h1 { margin: 0; font-size: clamp(2rem, 5vw, 4.6rem); line-height: 0.96; letter-spacing: 0; max-width: 820px; }
    header p { max-width: 680px; color: var(--muted); font-size: 1.05rem; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 22px; }
    .meta span { border: 1px solid var(--line); background: rgba(255,255,255,0.64); padding: 8px 10px; border-radius: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin: 20px 0 30px; }
    article { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; min-height: 260px; }
    article a { color: var(--accent); font-weight: 700; text-decoration: none; }
    article h2 { font-size: 1.15rem; margin: 10px 0; }
    article p, li { color: var(--muted); }
    article ul { padding-left: 18px; }
    .brief { background: #101820; color: #f7f5ef; border-radius: 8px; padding: 24px; margin-bottom: 40px; }
    .brief h2 { margin-top: 0; }
    .brief pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: inherit; color: #e7e2d6; }
    .rail { height: 6px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
  </style>
</head>
<body>
  <div class="rail"></div>
  <header>
    <h1>Application Scout</h1>
    <p>A Solari browser gathers public evidence, then a Solari sandbox turns it into a reproducible recruiting and company-intel brief.</p>
    <div class="meta">
      <span>Candidate: ${escapeHtml(candidate)}</span>
      <span>Sources: ${evidence.length}</span>
      <span>Artifacts: Markdown, JSON, HTML, post draft</span>
    </div>
  </header>
  <main>
    <section class="grid" aria-label="Captured sources">${cards}</section>
    <section class="brief">
      <h2>Generated Brief</h2>
      <pre>${escapeHtml(report)}</pre>
    </section>
  </main>
</body>
</html>`
}

function renderSocialPost(candidate: string, evidence: Evidence[]): string {
  const hosts = evidence.map((item) => new URL(item.url).hostname).join(", ")
  const repoUrl = "https://github.com/drewmanley16/solari-cookbook"
  const exampleUrl = `${repoUrl}/tree/main/examples/application-scout-ts`

  return `I built Application Scout with Solari for the Pinetree Research SWE intern challenge.

It uses a Solari cloud browser to collect public evidence, then sends the bundle into a Solari sandbox for isolated scoring and report generation.

Repo: ${repoUrl}
Example: ${exampleUrl}

Artifacts included:
- source evidence JSON
- generated Markdown brief
- shareable HTML dashboard
- reproducible TypeScript CLI

Candidate lens: ${candidate}
Sources tested: ${hosts}

Built with AI, because that was part of the assignment and because shipping speed matters.

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

function scoreText(text: string): number {
  const corpus = text.toLowerCase()
  return ["agent", "browser", "sandbox", "desktop", "automation", "api", "research", "ship"].reduce(
    (score, word) => score + (corpus.match(new RegExp(word, "g"))?.length ?? 0) * 3,
    0,
  )
}

function sampleEvidence(): Evidence[] {
  return [
    {
      url: "https://getsolari.com",
      title: "Solari",
      description: "Cloud browsers, sandboxes, and desktops behind one API.",
      headings: ["Browsers for agents", "Sandboxes for code", "Desktops for computer use"],
      snippets: [
        "Solari gives developers hosted browser sessions for scraping, testing, and agent workflows.",
        "Sandboxes run untrusted code in isolated Linux VMs and can expose preview URLs.",
        "Desktop sessions add a GUI surface for computer-use agents that need screenshots, clicks, and typing.",
      ],
    },
    {
      url: "https://docs.getsolari.com",
      title: "Solari Docs",
      description: "Developer documentation for the Solari API.",
      headings: ["Quickstarts", "Browser sessions", "Sandbox commands", "Desktop automation"],
      snippets: [
        "The browser SDK is Playwright-compatible, so existing automation patterns transfer cleanly.",
        "Sandbox commands use argv directly, which keeps execution predictable inside the VM.",
        "A single API key works across browsers, sandboxes, and desktops.",
      ],
    },
  ]
}
