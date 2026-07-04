interface Env {
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_STATE_PATH: string;
  SPARKLE_FEED_URL: string;
}

interface SparkleVersion {
  version: string;
  publishedRaw: string;
  publishedAt: string;
  downloadUrl: string;
}

interface GitHubState {
  latestVersion?: string;
  sha?: string;
  [key: string]: unknown;
}

interface CheckResult {
  issueOpened: boolean;
  version: string;
  recordedVersion: string | null;
  issueNumber?: number;
  issueUrl?: string;
}

const userAgent = "bibliotheca-codex-version-watch-cloudflare-worker";

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(check(env));
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
      const result = await check(env);
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      return Response.json({ error: "check failed", message }, { status: 500 });
    }
  },
};

async function check(env: Env): Promise<CheckResult> {
  const latest = await readSparkleFeed(env.SPARKLE_FEED_URL);
  const state = await readState(env);
  const recordedVersion = state.latestVersion ?? null;

  if (recordedVersion === latest.version) {
    return { issueOpened: false, version: latest.version, recordedVersion };
  }

  const issue = await openVersionIssue(env, latest);
  await writeState(env, state.sha, latest, issue);

  return {
    issueOpened: issue.created,
    version: latest.version,
    recordedVersion,
    issueNumber: issue.number,
    issueUrl: issue.url,
  };
}

async function readSparkleFeed(feedUrl: string): Promise<SparkleVersion> {
  const response = await fetch(feedUrl, {
    headers: {
      Accept: "application/xml,text/xml,*/*",
      "User-Agent": userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`Sparkle feed failed: ${response.status} ${await response.text()}`);
  }

  const xml = await response.text();
  const item = firstMatch(xml, /<item\b[\s\S]*?<\/item>/);
  const title = decodeXml(firstMatch(item, /<title>([\s\S]*?)<\/title>/).trim());
  const publishedRaw = decodeXml(firstMatch(item, /<pubDate>([\s\S]*?)<\/pubDate>/).trim());
  const downloadUrl = decodeXml(firstMatch(item, /<enclosure\b[^>]*\burl="([^"]+)"/).trim());

  if (!title || !publishedRaw || !downloadUrl) {
    throw new Error("Sparkle feed latest item is missing title, pubDate, or enclosure url");
  }

  return {
    version: title,
    publishedRaw,
    publishedAt: new Date(publishedRaw).toISOString(),
    downloadUrl,
  };
}

async function readState(env: Env): Promise<GitHubState> {
  const response = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodePath(env.GITHUB_STATE_PATH)}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`,
  );

  if (response.status === 404) {
    return {};
  }

  if (!response.ok) {
    throw new Error(`Read state failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json() as { content: string; sha: string };
  const state = JSON.parse(atob(payload.content.replace(/\n/g, ""))) as GitHubState;
  state.sha = payload.sha;
  return state;
}

async function writeState(env: Env, sha: string | undefined, latest: SparkleVersion, issue: VersionIssue): Promise<void> {
  const detectedAt = new Date();
  const publishedAt = new Date(latest.publishedAt);
  const state = {
    latestVersion: latest.version,
    publishedRaw: latest.publishedRaw,
    publishedAt: latest.publishedAt,
    detectedAt: detectedAt.toISOString(),
    detectionLagSeconds: Math.floor((detectedAt.getTime() - publishedAt.getTime()) / 1000),
    issueNumber: issue.number,
    issueUrl: issue.url,
    issueOpenedAt: issue.openedAt,
    feedUrl: env.SPARKLE_FEED_URL,
    downloadUrl: latest.downloadUrl,
  };

  const body: Record<string, unknown> = {
    message: `Record Codex ${latest.version} version watch state`,
    branch: env.GITHUB_BRANCH,
    content: btoa(`${JSON.stringify(state, null, 2)}\n`),
  };

  if (sha != null) {
    body.sha = sha;
  }

  const response = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodePath(env.GITHUB_STATE_PATH)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`Write state failed: ${response.status} ${await response.text()}`);
  }
}

interface VersionIssue {
  created: boolean;
  number: number;
  openedAt: string;
  url: string;
}

async function openVersionIssue(env: Env, latest: SparkleVersion): Promise<VersionIssue> {
  await ensureLabel(env);

  const title = `Codex ${latest.version} available`;
  const existing = await findIssue(env, title);
  if (existing != null) {
    await addWatchLabel(env, existing.number);
    return { ...existing, created: false };
  }

  const detectedAt = new Date();
  const response = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`,
    {
      method: "POST",
      body: JSON.stringify({
        title,
        body: issueBody({
          feedUrl: env.SPARKLE_FEED_URL,
          latest,
          detectedAt,
          detectionLagSeconds: detectionLagSeconds(detectedAt, latest.publishedAt),
          issueOpenedAt: "pending",
        }),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Create issue failed: ${response.status} ${await response.text()}`);
  }

  const issue = await response.json() as { number: number; html_url: string; created_at: string };
  await updateIssueBody(env, issue.number, issueBody({
    feedUrl: env.SPARKLE_FEED_URL,
    latest,
    detectedAt,
    detectionLagSeconds: detectionLagSeconds(detectedAt, latest.publishedAt),
    issueOpenedAt: issue.created_at,
  }));
  await addWatchLabel(env, issue.number);

  return {
    created: true,
    number: issue.number,
    openedAt: issue.created_at,
    url: issue.html_url,
  };
}

async function ensureLabel(env: Env): Promise<void> {
  const response = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/labels`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "codex-version-watch",
        color: "0969da",
        description: "Issues opened by the Codex version watcher",
      }),
    },
  );

  if (!response.ok && response.status !== 422) {
    throw new Error(`Create label failed: ${response.status} ${await response.text()}`);
  }
}

async function findIssue(env: Env, title: string): Promise<Omit<VersionIssue, "created"> | null> {
  const query = `repo:${env.GITHUB_OWNER}/${env.GITHUB_REPO} type:issue in:title "${title}"`;
  const response = await githubFetch(env, `/search/issues?q=${encodeURIComponent(query)}&per_page=1`);
  if (!response.ok) {
    throw new Error(`Find issue failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json() as { items: Array<{ number: number; html_url: string; created_at: string }> };
  const issue = payload.items[0];
  if (issue == null) {
    return null;
  }

  return {
    number: issue.number,
    openedAt: issue.created_at,
    url: issue.html_url,
  };
}

async function updateIssueBody(env: Env, issueNumber: number, body: string): Promise<void> {
  const response = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`,
    {
      method: "PATCH",
      body: JSON.stringify({ body }),
    },
  );

  if (!response.ok) {
    throw new Error(`Update issue failed: ${response.status} ${await response.text()}`);
  }
}

async function addWatchLabel(env: Env, issueNumber: number): Promise<void> {
  const response = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}/labels`,
    {
      method: "POST",
      body: JSON.stringify({ labels: ["codex-version-watch"] }),
    },
  );

  if (!response.ok) {
    throw new Error(`Add issue label failed: ${response.status} ${await response.text()}`);
  }
}

function issueBody({ feedUrl, latest, detectedAt, detectionLagSeconds, issueOpenedAt }: {
  feedUrl: string;
  latest: SparkleVersion;
  detectedAt: Date;
  detectionLagSeconds: number;
  issueOpenedAt: string;
}): string {
  return [
    "Codex version detected from the Sparkle feed.",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Version | \`${latest.version}\` |`,
    `| Sparkle pubDate | \`${latest.publishedRaw}\` |`,
    `| Published UTC | \`${latest.publishedAt}\` |`,
    `| Detection UTC | \`${detectedAt.toISOString()}\` |`,
    `| Detection lag seconds | \`${detectionLagSeconds}\` |`,
    `| Issue opened UTC | \`${issueOpenedAt}\` |`,
    `| Feed URL | ${feedUrl} |`,
    `| Download URL | ${latest.downloadUrl} |`,
    `| Source | Cloudflare Worker |`,
    "",
  ].join("\n");
}

function detectionLagSeconds(detectedAt: Date, publishedAt: string): number {
  return Math.floor((detectedAt.getTime() - new Date(publishedAt).getTime()) / 1000);
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

function firstMatch(input: string, pattern: RegExp): string {
  const match = pattern.exec(input);
  if (match == null) {
    throw new Error(`Expected pattern missing: ${pattern}`);
  }
  return match[1] ?? match[0];
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
