// Data source scanners for the ecosystem scanner.
// Each function returns an array of normalized update objects.

import { truncate, isWithinHours, parseXmlItems } from "./helpers.js";

const LOOKBACK_HOURS = 48;
const USER_AGENT = "ecosystem-scanner/1.0 (Cloudflare Worker)";

// ── Tracked repos ──────────────────────────────────────────────────────────

const TRACKED_REPOS = [
  { repo: "anthropics/claude-code", category: "tool", relevance: "high" },
  { repo: "cloudflare/workers-sdk", category: "tool", relevance: "high" },
  { repo: "vitejs/vite", category: "tool", relevance: "medium" },
  { repo: "anthropics/anthropic-sdk-typescript", category: "tool", relevance: "medium" },
  { repo: "modelcontextprotocol/servers", category: "ecosystem", relevance: "high" },
  { repo: "modelcontextprotocol/specification", category: "ecosystem", relevance: "medium" },
];

// Keywords that boost a Cloudflare blog post to "high" relevance
const CF_HIGH_KEYWORDS = ["workers", "kv", "pages", " ai ", "d1", "cron", "durable"];

// ── GitHub Releases ────────────────────────────────────────────────────────

/**
 * Fetch recent releases for all tracked repos in parallel.
 * Uses unauthenticated GitHub API (60 req/hr limit — plenty for ~6 repos).
 * Optional GITHUB_TOKEN env var for higher limits in v2.
 */
export async function scanGitHubReleases(env) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
  };

  // Use token if available (v2)
  const token = env?.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const results = await Promise.allSettled(
    TRACKED_REPOS.map(async ({ repo, category, relevance }) => {
      const url = `https://api.github.com/repos/${repo}/releases?per_page=3`;
      const res = await fetch(url, { headers });

      if (!res.ok) {
        throw new Error(`GitHub ${repo}: ${res.status} ${res.statusText}`);
      }

      const releases = await res.json();

      return releases
        .filter((r) => isWithinHours(r.published_at, LOOKBACK_HOURS))
        .map((r) => ({
          source: "github_release",
          repo,
          title: r.tag_name + (r.name && r.name !== r.tag_name ? ` — ${r.name}` : ""),
          summary: truncate(stripMarkdown(r.body), 250),
          url: r.html_url,
          publishedAt: r.published_at,
          relevance,
          category,
        }));
    })
  );

  const updates = [];
  const warnings = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      updates.push(...result.value);
    } else {
      warnings.push(`GitHub: ${result.reason.message}`);
      console.error(`[ecosystem-scanner] ${result.reason.message}`);
    }
  }

  return { updates, warnings };
}

// ── Cloudflare Blog RSS ────────────────────────────────────────────────────

/**
 * Fetch the Cloudflare blog RSS feed and extract recent posts.
 * Boosts relevance to "high" if the title mentions Workers/KV/Pages/AI/D1.
 */
export async function scanCloudflareBlog() {
  const res = await fetch("https://blog.cloudflare.com/rss/", {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`Cloudflare blog RSS: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  const items = parseXmlItems(xml);

  return items
    .filter((item) => isWithinHours(item.pubDate, LOOKBACK_HOURS))
    .map((item) => {
      const titleLower = (item.title || "").toLowerCase();
      const isHighRelevance = CF_HIGH_KEYWORDS.some((kw) => titleLower.includes(kw));

      return {
        source: "cloudflare_blog",
        repo: null,
        title: item.title,
        summary: truncate(stripHtml(item.description), 250),
        url: item.link,
        publishedAt: new Date(item.pubDate).toISOString(),
        relevance: isHighRelevance ? "high" : "medium",
        category: "platform",
      };
    });
}

// ── GHL Changelog ──────────────────────────────────────────────────────────

/**
 * Fetch the GoHighLevel changelog page and extract recent entries.
 * This is best-effort HTML scraping — degrades gracefully if structure changes.
 */
export async function scanGHLChangelog() {
  const res = await fetch("https://ideas.gohighlevel.com/changelog", {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`GHL changelog: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();

  // GHL changelog uses repeated blocks with dates and titles.
  // Look for patterns like <h3> or date headings followed by content.
  // This regex targets common changelog HTML patterns.
  const entries = [];

  // Pattern 1: Look for changelog entry containers with dates
  const entryPattern = /<article[^>]*>[\s\S]*?<\/article>/gi;
  const articleMatches = html.match(entryPattern) || [];

  for (const article of articleMatches.slice(0, 10)) {
    const title = extractFirstText(article, "h2", "h3", "h4", "a");
    const dateStr = extractDate(article);

    if (!title || !dateStr) continue;
    if (!isWithinHours(dateStr, LOOKBACK_HOURS)) continue;

    entries.push({
      source: "ghl_changelog",
      repo: null,
      title: title.trim(),
      summary: truncate(stripHtml(article), 250),
      url: "https://ideas.gohighlevel.com/changelog",
      publishedAt: new Date(dateStr).toISOString(),
      relevance: "medium",
      category: "platform",
    });
  }

  // Pattern 2: fallback — look for time/date elements with nearby headings
  if (entries.length === 0) {
    const dateHeadingPattern = /<(?:h[2-4]|div[^>]*class="[^"]*date[^"]*")[^>]*>([\s\S]*?)<\/(?:h[2-4]|div)>/gi;
    let match;
    while ((match = dateHeadingPattern.exec(html)) !== null) {
      const text = stripHtml(match[1]).trim();
      const parsed = new Date(text);
      if (!isNaN(parsed.getTime()) && isWithinHours(parsed.toISOString(), LOOKBACK_HOURS)) {
        // Get the next heading after this date
        const afterDate = html.slice(match.index + match[0].length, match.index + match[0].length + 500);
        const nextTitle = extractFirstText(afterDate, "h2", "h3", "h4", "p");
        if (nextTitle) {
          entries.push({
            source: "ghl_changelog",
            repo: null,
            title: nextTitle.trim(),
            summary: "",
            url: "https://ideas.gohighlevel.com/changelog",
            publishedAt: parsed.toISOString(),
            relevance: "medium",
            category: "platform",
          });
        }
      }
    }
  }

  return entries;
}

// ── Helpers (private) ──────────────────────────────────────────────────────

/** Strip markdown formatting for cleaner summaries. */
function stripMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/#{1,6}\s+/g, "")       // headings
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1")     // Strip emphasis markup.
    .replace(/`([^`]+)`/g, "$1")       // inline code
    .replace(/```[\s\S]*?```/g, "")    // code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/\n{2,}/g, " ")          // collapse newlines
    .trim();
}

/** Strip HTML tags for plain text extraction. */
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract text content from the first matching tag in an HTML string. */
function extractFirstText(html, ...tags) {
  for (const tag of tags) {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = html.match(regex);
    if (match) {
      const text = stripHtml(match[1]).trim();
      if (text.length > 0) return text;
    }
  }
  return null;
}

/** Try to extract a parseable date from an HTML block. */
function extractDate(html) {
  // Look for <time> element first (most reliable)
  const timeMatch = html.match(/<time[^>]*datetime="([^"]+)"/i);
  if (timeMatch) return timeMatch[1];

  // Look for ISO-ish date strings in the text
  const isoMatch = html.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  // Look for natural date patterns like "March 30, 2026"
  const naturalMatch = html.match(
    /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}/i
  );
  if (naturalMatch) {
    const parsed = new Date(naturalMatch[0]);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return null;
}
