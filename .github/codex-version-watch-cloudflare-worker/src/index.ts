interface Env {
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_WORKFLOW_ID: string;
}

interface DispatchResult {
  dispatched: true;
  workflow: string;
}

const userAgent = "bibliotheca-codex-version-watch-cloudflare-worker";

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatchVersionWatch(env));
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
      const result = await dispatchVersionWatch(env);
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      return Response.json({ error: "check failed", message }, { status: 500 });
    }
  },
};

async function dispatchVersionWatch(env: Env): Promise<DispatchResult> {
  const response = await githubFetch(
    env,
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(env.GITHUB_WORKFLOW_ID)}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({ ref: env.GITHUB_BRANCH }),
    },
  );

  if (response.status !== 204) {
    throw new Error(`Workflow dispatch failed: ${response.status} ${await response.text()}`);
  }

  return {
    dispatched: true,
    workflow: env.GITHUB_WORKFLOW_ID,
  };
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

