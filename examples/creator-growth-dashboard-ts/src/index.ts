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
  "https://drewmanley.xyz",
  "https://github.com/drewmanley16",
  "https://www.linkedin.com/in/drew-manley-89a455231",
  "https://x.com/drewbydoo05",
  "https://www.linkedin.com/posts/harry-chow1_were-hiring-a-swe-intern-for-pinetree-research-activity-7500203701882527746-mZal",
  "https://github.com/drewmanley16/solari-cookbook/tree/main/examples/creator-growth-dashboard-ts",
  "https://docs.getsolari.com",
  "https://getsolari.com",
]

const OUT_DIR = path.join(process.cwd(), "out")
const REPORT_PATH = path.join(OUT_DIR, "creator-growth-brief.md")
const DASHBOARD_PATH = path.join(OUT_DIR, "creator-growth-dashboard.html")
const EVIDENCE_PATH = path.join(OUT_DIR, "evidence.json")
const CALENDAR_PATH = path.join(OUT_DIR, "content-calendar.md")
const SCRIPTS_PATH = path.join(OUT_DIR, "script-studio.md")
const OUTREACH_PATH = path.join(OUT_DIR, "partnership-outreach.md")
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
await writeFile(CALENDAR_PATH, renderContentCalendar(options.subject, evidence), "utf8")
await writeFile(SCRIPTS_PATH, renderScriptStudio(options.subject, evidence), "utf8")
await writeFile(OUTREACH_PATH, renderPartnershipOutreach(options.subject, evidence), "utf8")
await writeFile(LINKEDIN_POST_PATH, renderLinkedInPost(options.subject, evidence), "utf8")
await writeFile(X_POST_PATH, renderXPost(), "utf8")

console.log(`sources : ${evidence.length}`)
console.log(`brief   : ${REPORT_PATH}`)
console.log(`dash    : ${DASHBOARD_PATH}`)
console.log(`calendar: ${CALENDAR_PATH}`)
console.log(`scripts : ${SCRIPTS_PATH}`)
console.log(`outreach: ${OUTREACH_PATH}`)
console.log(`linkedin: ${LINKEDIN_POST_PATH}`)
console.log(`x post  : ${X_POST_PATH}`)

function parseArgs(args: string[]): CliOptions {
  const targets: string[] = []
  let subject = "Drew's creator journey toward shipping with Solari"
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
    "# Creator Growth Dashboard Brief",
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
    "## Dashboard Outputs",
    "",
    "1. Content Calendar: turn the strongest proof into a 14-day publishing plan.",
    "2. Script Studio: convert proof points into X threads, LinkedIn posts, and short-form video scripts.",
    "3. Partnership Radar: identify collaborators, integration partners, and communities implied by the sources.",
    "4. Outreach Desk: draft direct, specific messages that ask for collaboration instead of vague attention.",
    "",
    "## Suggested Positioning",
    "",
    "This is a creator growth dashboard for builders: Solari browses public proof, a sandbox turns it into strategy, and the output becomes a calendar, scripts, and partnership outreach.",
    "",
    "## Next Product Step",
    "",
    "Add scheduled reruns and diffing so a creator can refresh the dashboard weekly and track which proof creates new partnership angles.",
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
    "# Creator Growth Dashboard Brief",
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

  lines.push("## Dashboard Outputs", "")
  lines.push("1. Show the build, not credentials.")
  lines.push("2. Convert proof into a two-week content calendar.")
  lines.push("3. Generate scripts and partnership outreach from the same source evidence.")

  return lines.join("\n")
}

function renderDashboardHtml(evidence: Evidence[], report: string, subject: string): string {
  const calendar = renderContentCalendar(subject, evidence)
  const scripts = renderScriptStudio(subject, evidence)
  const outreach = renderPartnershipOutreach(subject, evidence)
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
  <title>Creator Growth Dashboard</title>
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
    .outputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; margin-bottom: 30px; }
    article { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; min-height: 280px; }
    article a { color: var(--accent); font-weight: 700; text-decoration: none; }
    article h2 { font-size: 1.08rem; margin: 10px 0; }
    article p, li { color: var(--muted); }
    article ul { padding-left: 18px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; }
    .panel h2 { margin-top: 0; font-size: 1.05rem; }
    .panel pre { white-space: pre-wrap; word-break: break-word; margin: 0; color: var(--muted); font: inherit; }
    .brief { background: var(--dark); color: #f7f5ef; border-radius: 8px; padding: 24px; margin-bottom: 40px; }
    .brief h2 { margin-top: 0; }
    .brief pre { white-space: pre-wrap; word-break: break-word; margin: 0; font: inherit; color: #e7e2d6; }
    .rail { height: 6px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
  </style>
</head>
<body>
  <div class="rail"></div>
  <header>
    <h1>Creator Growth Dashboard</h1>
    <p>Solari browses public proof, then a sandbox turns it into a content calendar, script studio, and partnership outreach desk for a builder's next chapter.</p>
    <div class="meta">
      <span>Subject: ${escapeHtml(subject)}</span>
      <span>Sources: ${evidence.length}</span>
      <span>Artifacts: Brief, calendar, scripts, outreach, post drafts</span>
    </div>
  </header>
  <main>
    <section class="grid" aria-label="Captured public sources">${cards}</section>
    <section class="outputs" aria-label="Generated creator outputs">
      <div class="panel"><h2>Content Calendar</h2><pre>${escapeHtml(calendar)}</pre></div>
      <div class="panel"><h2>Script Studio</h2><pre>${escapeHtml(scripts)}</pre></div>
      <div class="panel"><h2>Partnership Outreach</h2><pre>${escapeHtml(outreach)}</pre></div>
    </section>
    <section class="brief">
      <h2>Generated Journey Brief</h2>
      <pre>${escapeHtml(report)}</pre>
    </section>
  </main>
</body>
</html>`
}

function renderContentCalendar(subject: string, evidence: Evidence[]): string {
  const proof = topProof(evidence)
  const days = [
    ["Build reveal", "Show the tool, the source links, and the generated dashboard."],
    ["Problem post", "Explain why public proof is scattered across socials, repos, and docs."],
    ["Behind the scenes", "Walk through Solari browser collection and sandbox analysis."],
    ["Receipt thread", `Quote the strongest proof: ${proof[0] ?? "the public repo and live artifact."}`],
    ["Market angle", "Position the dashboard for creators, founders, job seekers, and developer advocates."],
    ["Mini tutorial", "Show how to pass X, LinkedIn, GitHub, and blog URLs as targets."],
    ["Partnership ask", "Invite creators or communities to test the dashboard on their own journey."],
    ["Failure lesson", "Share one bug from live verification and how it changed the product."],
    ["Use case split", "Show separate outputs: calendar, scripts, outreach, proof library."],
    ["Founder version", "Frame it as distribution infrastructure for technical founders."],
    ["Student version", "Frame it as a public-proof alternative to resume-first applications."],
    ["Devrel version", "Frame it as a content planning tool for product launches and docs."],
    ["Open build ask", "Ask people what source they would add next: newsletter, YouTube, GitHub, or blog."],
    ["Demo recap", "Summarize what shipped, what Solari handled, and what comes next."],
  ]

  return [
    `# 14-Day Content Calendar`,
    ``,
    `Subject: ${subject}`,
    ``,
    ...days.map(([theme, action], index) => `Day ${index + 1}: ${theme}\n- ${action}`),
  ].join("\n")
}

function renderScriptStudio(subject: string, evidence: Evidence[]): string {
  const proof = topProof(evidence)
  return `# Script Studio

Subject: ${subject}

## X Thread
1. I built a creator dashboard that turns public proof into a content calendar and partnership outreach.
2. The messy part is collecting the context: social posts, repos, docs, launch pages, and proof.
3. Solari handles that with cloud browsers.
4. Then a Solari sandbox scores the narrative and generates structured outputs.
5. The output: brief, calendar, scripts, outreach, and share drafts.
6. Strongest proof found: ${proof[0] ?? "the public build itself."}

## LinkedIn Post
I used Solari to build a Creator Growth Dashboard for builders who need distribution, not another blank content doc.

It reads public proof with a cloud browser, analyzes it in a sandbox, then produces a content calendar, post scripts, partnership targets, and outreach drafts.

The point: make your shipped work easier to explain, reuse, and turn into momentum.

## Short-Form Video
Hook: Your best content is probably already hiding in your public work.
Scene 1: Show scattered sources: profile, repo, launch post, docs.
Scene 2: Show Solari browsing those pages.
Scene 3: Show the generated dashboard.
Close: Public proof beats vague personal branding.`
}

function renderPartnershipOutreach(subject: string, evidence: Evidence[]): string {
  const hosts = evidence.map((item) => item.host)
  const partners = Array.from(
    new Set([
      "creator communities",
      "developer tools teams",
      "student founder groups",
      "AI founder communities",
      hosts.includes("getsolari.com") ? "Solari ecosystem builders" : "",
      hosts.includes("github.com") ? "open-source maintainers" : "",
    ].filter(Boolean)),
  )

  return `# Partnership Outreach

Subject: ${subject}

## Partnership Radar
${partners.map((partner) => `- ${partner}: invite them to run the dashboard on a public launch or creator journey.`).join("\n")}

## DM Draft
Hey, I built a Solari-powered Creator Growth Dashboard that turns public proof into a content calendar, scripts, and partnership outreach.

I think it could be useful for your community because it starts from actual shipped work, not generic content prompts. Want me to run it on a public launch/profile and send back the dashboard?

## Follow-Up
Quick follow-up: the useful part is that the same browser-collected evidence powers the content calendar, scripts, and outreach. Happy to run it on one public URL so you can judge the output directly.`
}

function renderLinkedInPost(subject: string, evidence: Evidence[]): string {
  const hosts = evidence.map((item) => item.host).join(", ")
  const repoUrl = "https://github.com/drewmanley16/solari-cookbook"
  const exampleUrl = `${repoUrl}/tree/main/examples/creator-growth-dashboard-ts`

  return `I built Creator Growth Dashboard with Solari for the Pinetree Research SWE intern challenge.

It turns a public social media journey into creator growth assets:
- Solari browser collects public profile/post evidence
- Solari sandbox scores the narrative arc, proof, and content pillars
- the app outputs a content calendar, scripts, partnership outreach, evidence JSON, and a dashboard

Repo: ${repoUrl}
Example: ${exampleUrl}

Subject lens: ${subject}
Sources tested: ${hosts}

Built with AI, because the assignment explicitly rewards shipping faster with AI.

@harrychow_ @getsolari
`
}

function renderXPost(): string {
  return `Built Creator Growth Dashboard for the Pinetree SWE intern challenge: Solari browsers collect public social proof, then a sandbox turns it into a calendar, scripts, and outreach.

https://github.com/drewmanley16/solari-cookbook/tree/main/examples/creator-growth-dashboard-ts

@harrychow_ @getsolari
`
}

function topProof(evidence: Evidence[]): string[] {
  return evidence
    .flatMap((item) => [...item.postLikeTexts, ...item.snippets])
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 40)
    .filter((text) => !/report this post|cookie policy|sign in to/i.test(text))
    .map((text) => (text.length > 220 ? `${text.slice(0, 217)}...` : text))
    .slice(0, 3)
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
