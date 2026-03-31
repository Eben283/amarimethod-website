// Shared utilities for ecosystem scanner.

const PT = "America/Los_Angeles";

/** Today's date as YYYY-MM-DD in Pacific Time. */
export function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PT }).format(new Date());
}

/** Standard JSON response with Content-Type header. */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Truncate a string to maxLen characters, appending "..." if truncated. */
export function truncate(str, maxLen = 200) {
  if (!str || str.length <= maxLen) return str || "";
  return str.slice(0, maxLen).trimEnd() + "...";
}

/** Check if an ISO date string falls within the last `hours` hours. */
export function isWithinHours(isoDate, hours) {
  if (!isoDate) return false;
  const published = new Date(isoDate).getTime();
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return published >= cutoff;
}

/**
 * Extract <item> blocks from RSS XML and return an array of objects
 * with title, link, pubDate, and description fields.
 * Uses simple regex — no DOMParser available in Workers.
 */
export function parseXmlItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      pubDate: extractTag(block, "pubDate"),
      description: extractTag(block, "description"),
    });
  }

  return items;
}

function extractTag(xml, tag) {
  // Handle both <tag>value</tag> and <tag><![CDATA[value]]></tag>
  const regex = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`);
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}
