# Application Scout Brief

Candidate lens: **SWE intern who ships AI-native tooling**

_Sample mode: generated from fixture evidence. Run without `--sample` to use Solari browser + sandbox._

## Ranked Sources

### 1. Solari

- URL: https://getsolari.com
- Fit score: 42
- Heading: Browsers for agents
- Heading: Sandboxes for code
- Heading: Desktops for computer use
- Evidence: Solari gives developers hosted browser sessions for scraping, testing, and agent workflows.
- Evidence: Sandboxes run untrusted code in isolated Linux VMs and can expose preview URLs.
- Evidence: Desktop sessions add a GUI surface for computer-use agents that need screenshots, clicks, and typing.

### 2. Solari Docs

- URL: https://docs.getsolari.com
- Fit score: 36
- Heading: Quickstarts
- Heading: Browser sessions
- Heading: Sandbox commands
- Heading: Desktop automation
- Evidence: The browser SDK is Playwright-compatible, so existing automation patterns transfer cleanly.
- Evidence: Sandbox commands use argv directly, which keeps execution predictable inside the VM.
- Evidence: A single API key works across browsers, sandboxes, and desktops.

## Next Build Suggestion

Turn this into a public preview: run collection in a Solari browser, analysis in a Solari sandbox, then expose the report as a small dashboard from the sandbox preview URL.