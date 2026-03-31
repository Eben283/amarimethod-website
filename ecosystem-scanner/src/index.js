// Ecosystem Scanner — runs at 2 AM Pacific via cron trigger.
// Checks GitHub releases, Cloudflare blog, and GHL changelog for recent updates.
// Results are read by /api/ecosystem-scan Pages Function → consumed by /day skill.

import { scanGitHubReleases, scanCloudflareBlog, scanGHLChangelog } from "./sources.js";
import { todayPacific, jsonResponse } from "./helpers.js";

const SCAN_KV_PREFIX = "ops:ecosystem-scan:";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScan(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/__scheduled" || url.pathname === "/run") {
      const result = await runScan(env);
      return jsonResponse(result);
    }

    if (url.pathname === "/latest") {
      const date = url.searchParams.get("date") || todayPacific();
      const data = await env.PORTAL_KV.get(`${SCAN_KV_PREFIX}${date}`, "json");
      if (!data) return jsonResponse({ error: "No scan for this date" }, 404);
      return jsonResponse(data);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function runScan(env) {
  const today = todayPacific();
  console.log(`[ecosystem-scanner] Starting scan for ${today}`);

  // Run all three sources in parallel — each handles its own errors
  const [githubResult, cfResult, ghlResult] = await Promise.allSettled([
    scanGitHubReleases(env),
    scanCloudflareBlog(),
    scanGHLChangelog(),
  ]);

  const allUpdates = [];
  const allWarnings = [];

  // GitHub releases (returns { updates, warnings })
  if (githubResult.status === "fulfilled") {
    allUpdates.push(...githubResult.value.updates);
    allWarnings.push(...githubResult.value.warnings);
  } else {
    allWarnings.push(`GitHub scanner failed: ${githubResult.reason.message}`);
    console.error(`[ecosystem-scanner] GitHub: ${githubResult.reason.message}`);
  }

  // Cloudflare blog (returns array of updates)
  if (cfResult.status === "fulfilled") {
    allUpdates.push(...cfResult.value);
  } else {
    allWarnings.push(`Cloudflare blog scanner failed: ${cfResult.reason.message}`);
    console.error(`[ecosystem-scanner] Cloudflare: ${cfResult.reason.message}`);
  }

  // GHL changelog (returns array of updates)
  if (ghlResult.status === "fulfilled") {
    allUpdates.push(...ghlResult.value);
  } else {
    allWarnings.push(`GHL changelog scanner failed: ${ghlResult.reason.message}`);
    console.error(`[ecosystem-scanner] GHL: ${ghlResult.reason.message}`);
  }

  // Sort by publishedAt descending (newest first)
  allUpdates.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const result = {
    scanDate: today,
    ranAt: new Date().toISOString(),
    updates: allUpdates,
    warnings: allWarnings,
    summary: {
      totalUpdates: allUpdates.length,
      highRelevance: allUpdates.filter((u) => u.relevance === "high").length,
      mediumRelevance: allUpdates.filter((u) => u.relevance === "medium").length,
      newReleases: allUpdates.filter((u) => u.source === "github_release").length,
      blogPosts: allUpdates.filter((u) => u.source === "cloudflare_blog").length,
      changelogEntries: allUpdates.filter((u) => u.source === "ghl_changelog").length,
    },
  };

  // Write to KV with 7-day TTL
  await env.PORTAL_KV.put(
    `${SCAN_KV_PREFIX}${today}`,
    JSON.stringify(result),
    { expirationTtl: 7 * 86400 }
  );

  console.log(
    `[ecosystem-scanner] Done: ${allUpdates.length} updates (${result.summary.highRelevance} high, ${result.summary.mediumRelevance} medium)`
  );

  return result;
}
