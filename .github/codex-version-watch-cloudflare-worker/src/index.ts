interface Env {
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  SMOKE_WORKFLOW_ID: string;
  VERSION_WATCH_STATE: KVNamespace;
}

interface CheckResult {
  changed: boolean;
  version: string;
  issueNumber?: number;
  smokeDispatched: boolean;
}

const userAgent = "bibliotheca-codex-version-watch-cloudflare-worker";
const feedUrl = "https://persistent.oaistatic.com/codex-app-prod/appcast.xml";
const stateKey = "state";
const watchLabel = "codex-version-watch";
const smokeLabels = new Set(["codex-smoke-running", "codex-smoke-passed", "codex-smoke-failed"]);

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkCodexVersion(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/check") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    try {
      const result = await checkCodexVersion(env);
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      return Response.json({ error: "check failed", message }, { status: 500 });
    }
  },
};

async function checkCodexVersion(env: Env): Promise<CheckResult> {
  const latest = await readSparkleFeed();
  const state = await readState(env);

  if (state?.latestVersion === latest.version) {
    if (state.issueNumber && !(await issueHasSmokeStatus(env, state.issueNumber))) {
      await dispatchSmoke(env, state.issueNumber);
      return {
        changed: false,
        version: latest.version,
        issueNumber: state.issueNumber,
        smokeDispatched: true,
      };
    }

    return {
      changed: false,
      version: latest.version,
      issueNumber: state?.issueNumber,
      smokeDispatched: false,
    };
  }

  await ensureLabel(env, watchLabel, "0969da", "Issues opened by the Codex version watcher");

  const title = `Codex ${latest.version} available`;
  const existingIssueNumber = await findIssueByTitle(env, title);
  const issueNumber = existingIssueNumber ?? (await createIssue(env, title, issueBody(latest, "pending")));
  const issueOpenedAt = await readIssueCreatedAt(env, issueNumber);

  await updateIssueBody(env, issueNumber, issueBody(latest, issueOpenedAt));
  await dispatchSmoke(env, issueNumber);

  await writeState(env, {
    latestVersion: latest.version,
    publishedRaw: latest.publishedRaw,
    publishedAt: latest.publishedAt,
    detectedAt: latest.detectedAt,
    detectionLagSeconds: latest.detectionLagSeconds,
    issueNumber,
    issueOpenedAt,
    feedUrl,
    downloadUrl: latest.downloadUrl,
  });

  return {
    changed: true,
    version: latest.version,
    issueNumber,
    smokeDispatched: true,
  };
}

async function readSparkleFeed(): Promise<LatestCodexVersion> {
  const response = await fetch(feedUrl, {
    headers: {
      Accept: "application/xml,text/xml,*/*",
      "User-Agent": "Mozilla/5.0 (compatible; CodexVersionWatch/1.0; +https://github.com/zats/bibliotheca)",
    },
  });

  if (!response.ok) {
    throw new Error(`Sparkle feed failed: ${response.status} ${await response.text()}`);
  }

  const xml = await response.text();
  const item = matchFirst(xml, /<item\b[^>]*>([\s\S]*?)<\/item>/i, "Sparkle feed has no items");
  const enclosure = matchFirst(item, /<enclosure\b[^>]*>/i, "Latest Sparkle item has no enclosure", 0);
  const version = xmlDecode(matchFirst(item, /<title\b[^>]*>([\s\S]*?)<\/title>/i, "Latest Sparkle item has no title").trim());
  const publishedRaw = xmlDecode(matchFirst(item, /<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i, "Latest Sparkle item has no pubDate").trim());
  const downloadUrl = xmlDecode(matchFirst(enclosure, /\burl=(["'])(.*?)\1/i, "Latest Sparkle item has no enclosure url", 2).trim());
  const published = new Date(publishedRaw);

  if (!version || !publishedRaw || !downloadUrl || Number.isNaN(published.getTime())) {
    throw new Error("Latest Sparkle item is missing title, pubDate, or enclosure url");
  }

  const detected = new Date();
  return {
    version,
    publishedRaw,
    publishedAt: published.toISOString(),
    detectedAt: detected.toISOString(),
    detectionLagSeconds: Math.trunc((detected.getTime() - published.getTime()) / 1000),
    downloadUrl,
  };
}

async function readState(env: Env): Promise<VersionWatchState | null> {
  return env.VERSION_WATCH_STATE.get<VersionWatchState>(stateKey, "json");
}

function writeState(env: Env, state: VersionWatchState): Promise<void> {
  return env.VERSION_WATCH_STATE.put(stateKey, JSON.stringify(state, null, 2));
}

async function ensureLabel(env: Env, name: string, color: string, description: string): Promise<void> {
  const response = await githubFetch(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/labels`, {
    method: "POST",
    body: JSON.stringify({ name, color, description }),
  });

  if (response.ok || response.status === 422) {
    return;
  }

  throw new Error(`Label create failed: ${response.status} ${await response.text()}`);
}

async function findIssueByTitle(env: Env, title: string): Promise<number | null> {
  const query = encodeURIComponent(`repo:${env.GITHUB_OWNER}/${env.GITHUB_REPO} is:issue in:title "${title}"`);
  const result = await githubJson<{ items: Array<{ number: number }> }>(env, `/search/issues?q=${query}&per_page=1`);
  return result.items[0]?.number ?? null;
}

async function createIssue(env: Env, title: string, body: string): Promise<number> {
  const issue = await githubJson<{ number: number }>(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, labels: [watchLabel] }),
  });
  return issue.number;
}

async function readIssueCreatedAt(env: Env, issueNumber: number): Promise<string> {
  const issue = await githubJson<{ created_at: string }>(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`,
  );
  return issue.created_at;
}

async function updateIssueBody(env: Env, issueNumber: number, body: string): Promise<void> {
  await githubJson(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

async function issueHasSmokeStatus(env: Env, issueNumber: number): Promise<boolean> {
  const issue = await githubJson<{ labels: Array<{ name: string }> }>(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`,
  );
  return issue.labels.some((label) => smokeLabels.has(label.name));
}

async function dispatchSmoke(env: Env, issueNumber: number): Promise<void> {
  const response = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(env.SMOKE_WORKFLOW_ID)}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({ ref: env.GITHUB_BRANCH, inputs: { issue_number: String(issueNumber) } }),
    },
  );

  if (response.status !== 204) {
    throw new Error(`Smoke workflow dispatch failed: ${response.status} ${await response.text()}`);
  }
}

async function githubJson<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await githubFetch(env, path, init);
  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function githubFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
}

function issueBody(latest: LatestCodexVersion, issueOpenedAt: string): string {
  return `Codex version detected from the Sparkle feed.

| Field | Value |
| --- | --- |
| Version | \`${latest.version}\` |
| Sparkle pubDate | \`${latest.publishedRaw}\` |
| Published UTC | \`${latest.publishedAt}\` |
| Detection UTC | \`${latest.detectedAt}\` |
| Detection lag seconds | \`${latest.detectionLagSeconds}\` |
| Issue opened UTC | ${issueOpenedAt === "pending" ? "pending" : `\`${issueOpenedAt}\``} |
| Feed URL | ${feedUrl} |
| Download URL | ${latest.downloadUrl} |
| Version watch | Cloudflare Worker |
`;
}

function matchFirst(value: string, pattern: RegExp, error: string, group = 1): string {
  const match = value.match(pattern);
  if (!match?.[group]) {
    throw new Error(error);
  }
  return match[group];
}

function xmlDecode(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

interface LatestCodexVersion {
  version: string;
  publishedRaw: string;
  publishedAt: string;
  detectedAt: string;
  detectionLagSeconds: number;
  downloadUrl: string;
}

interface VersionWatchState {
  latestVersion: string;
  publishedRaw: string;
  publishedAt: string;
  detectedAt: string;
  detectionLagSeconds: number;
  issueNumber: number;
  issueOpenedAt: string;
  feedUrl: string;
  downloadUrl: string;
}
