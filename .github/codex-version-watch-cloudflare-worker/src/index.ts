interface Env {
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_STATE_PATH: string;
  GITHUB_WORKFLOW_ID: string;
  SPARKLE_FEED_URL: string;
  READY_TIMEOUT_SECONDS: string;
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
  dispatched: boolean;
  version: string;
  recordedVersion: string | null;
  workflowUrl?: string;
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

    const result = await check(env);
    return Response.json(result);
  },
};

async function check(env: Env): Promise<CheckResult> {
  const latest = await readSparkleFeed(env.SPARKLE_FEED_URL);
  const state = await readState(env);
  const recordedVersion = state.latestVersion ?? null;

  if (recordedVersion === latest.version) {
    return { dispatched: false, version: latest.version, recordedVersion };
  }

  await dispatchWorkflow(env, latest);
  await writeState(env, state.sha, latest);

  return {
    dispatched: true,
    version: latest.version,
    recordedVersion,
    workflowUrl: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_ID}`,
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

async function writeState(env: Env, sha: string | undefined, latest: SparkleVersion): Promise<void> {
  const detectedAt = new Date();
  const publishedAt = new Date(latest.publishedAt);
  const state = {
    latestVersion: latest.version,
    publishedRaw: latest.publishedRaw,
    publishedAt: latest.publishedAt,
    detectedAt: detectedAt.toISOString(),
    detectionLagSeconds: Math.floor((detectedAt.getTime() - publishedAt.getTime()) / 1000),
    feedUrl: env.SPARKLE_FEED_URL,
    downloadUrl: latest.downloadUrl,
    dispatchedWorkflow: env.GITHUB_WORKFLOW_ID,
    dispatchedAt: detectedAt.toISOString(),
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

async function dispatchWorkflow(env: Env, latest: SparkleVersion): Promise<void> {
  const response = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(env.GITHUB_WORKFLOW_ID)}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({
        ref: env.GITHUB_BRANCH,
        inputs: {
          codex_app_url: latest.downloadUrl,
          codex_version: latest.version,
          timeout_seconds: env.READY_TIMEOUT_SECONDS,
        },
      }),
    },
  );

  if (response.status !== 204) {
    throw new Error(`Workflow dispatch failed: ${response.status} ${await response.text()}`);
  }
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

