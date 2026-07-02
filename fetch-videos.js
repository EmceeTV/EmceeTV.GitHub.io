#!/usr/bin/env node
/* ===================================================================
   fetch-videos.js — EmceeTV
   -------------------------------------------------------------------
   Runs on GitHub's servers (via GitHub Actions), NOT in the browser.
   Writes the latest REAL EPISODES (Shorts filtered out) to videos.json,
   which the website reads.

   TWO SOURCES, tried in order:
     1. YouTube Data API v3  (PRIMARY) — authoritative and fresh (new
        uploads show within a minute), and it returns each video's exact
        duration, which is how we reliably detect and skip Shorts.
        The API key comes from the YT_API_KEY environment variable, which
        the GitHub Action supplies from an encrypted repo Secret. The key
        NEVER appears in the site, in videos.json, or in the page source.
     2. RSS feed  (FALLBACK) — used only if no API key is set or the API
        call fails. RSS has no duration data, so Shorts can only be
        filtered heuristically (by #shorts tags) in that mode.

   The API key is read-only for PUBLIC data. It cannot log in, post,
   delete, or read anything private — those require OAuth, not a key.
   Worst case if leaked: someone burns your daily quota. Storing it as a
   Secret (not in the page) avoids even that.

   No external npm packages — only Node's built-in modules.
   =================================================================== */

const https = require("https");
const fs = require("fs");
const path = require("path");

// ---- CONFIG ---------------------------------------------------------
const CHANNEL_ID = "UCbkiiNUurUSb37QyD-nYZIw"; // EmceeTV channel
const MAX_VIDEOS = 6;                           // how many episodes to publish
const SHORT_MAX_SECONDS = 180;                  // <= 3 min counts as a Short
const FETCH_POOL = 25;                          // pull extra, then filter Shorts
const OUTPUT = path.join(__dirname, "videos.json");

// The uploads playlist is the channel ID with "UC" swapped to "UU".
const UPLOADS_PLAYLIST_ID = "UU" + CHANNEL_ID.slice(2);
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

// Key comes from the environment (GitHub Secret), never hardcoded.
const YT_API_KEY = process.env.YT_API_KEY || "";
// --------------------------------------------------------------------

/**
 * GET a URL, following redirects, with no-cache headers. Resolves to the
 * response body string.
 */
function get(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "EmceeTV-feed-bot",
        "Cache-Control": "no-cache, no-store, max-age=0",
        "Pragma": "no-cache",
        "Accept": "application/json, application/atom+xml, application/xml, text/xml",
      },
    };
    https
      .get(url, options, (res) => {
        const { statusCode, headers } = res;
        if ([301, 302, 307, 308].includes(statusCode) && headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error("Too many redirects"));
          const next = new URL(headers.location, url).toString();
          return resolve(get(next, redirectsLeft - 1));
        }
        if (statusCode !== 200) {
          // Capture the API's error body so failures are debuggable in logs.
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (body += c));
          res.on("end", () =>
            reject(new Error(`HTTP ${statusCode} from ${url.split("?")[0]} :: ${body.slice(0, 300)}`))
          );
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

/** Decode the handful of XML/HTML entities that appear in titles. */
function decodeEntities(s = "") {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

/** Parse an ISO 8601 duration like "PT1H2M30S" into total seconds. */
function isoDurationToSeconds(iso = "") {
  const m = iso.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => (x ? parseInt(x, 10) : 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

/**
 * Heuristic Short detector for when we DON'T have duration (RSS mode) or as
 * a secondary signal: an explicit #shorts / #short tag in the text.
 */
function looksLikeShortByText(title = "", description = "") {
  return /#shorts?\b/i.test(title) || /#shorts?\b/i.test(description);
}

/* ===================================================================
   PRIMARY: YouTube Data API v3
   =================================================================== */
async function fetchViaApi() {
  // Step 1: newest uploads (IDs + snippets) from the uploads playlist.
  const listUrl =
    "https://www.googleapis.com/youtube/v3/playlistItems?" +
    new URLSearchParams({
      part: "snippet,contentDetails",
      maxResults: String(FETCH_POOL),
      playlistId: UPLOADS_PLAYLIST_ID,
      key: YT_API_KEY,
    });
  const listRaw = await get(listUrl);
  const list = JSON.parse(listRaw);
  if (!list.items || !list.items.length) throw new Error("API returned no playlist items");

  // Preserve upload order; collect video IDs to look up durations.
  const ids = list.items
    .map((it) => it.contentDetails && it.contentDetails.videoId)
    .filter(Boolean);

  // Step 2: durations + details for those IDs (one batched call).
  const vidUrl =
    "https://www.googleapis.com/youtube/v3/videos?" +
    new URLSearchParams({
      part: "snippet,contentDetails",
      id: ids.join(","),
      maxResults: String(ids.length),
      key: YT_API_KEY,
    });
  const vidRaw = await get(vidUrl);
  const vids = JSON.parse(vidRaw);
  if (!vids.items) throw new Error("API returned no video details");

  // Build a lookup so we can keep newest-first order from the playlist.
  const byId = new Map(vids.items.map((v) => [v.id, v]));

  const episodes = [];
  for (const id of ids) {
    const v = byId.get(id);
    if (!v) continue;
    const sn = v.snippet || {};
    const cd = v.contentDetails || {};
    const seconds = isoDurationToSeconds(cd.duration || "");
    const title = decodeEntities(sn.title || "");
    const desc = sn.description || "";

    // --- Shorts filter (automatic) ---
    // Primary signal: duration <= 3 min. Secondary: explicit #shorts tag.
    const isShort =
      (seconds > 0 && seconds <= SHORT_MAX_SECONDS) ||
      looksLikeShortByText(title, desc);
    if (isShort) continue;

    // Skip private/deleted placeholders.
    if (!title || title === "Private video" || title === "Deleted video") continue;

    const thumbs = sn.thumbnails || {};
    const thumb =
      (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {})
        .url || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;

    episodes.push({
      title,
      date: sn.publishedAt || cd.videoPublishedAt || "",
      videoId: id,
      thumb,
      durationSeconds: seconds, // handy for debugging; harmless to the site
    });

    if (episodes.length >= MAX_VIDEOS) break;
  }

  if (!episodes.length) throw new Error("All API videos were filtered out as Shorts/invalid");
  return episodes;
}

/* ===================================================================
   FALLBACK: RSS feed (no key, no duration data)
   =================================================================== */
async function fetchViaRss() {
  const xml = await get(FEED_URL);
  const entries = xml.split("<entry>").slice(1);
  const seen = new Set();
  const out = [];

  for (const entry of entries) {
    const videoId = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);

    const title = decodeEntities((entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
    const description = (entry.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || "";
    const published = (entry.match(/<published>(.*?)<\/published>/) || [])[1] || "";

    // RSS has no duration, so we can only drop obvious #shorts-tagged ones.
    if (looksLikeShortByText(title, description)) continue;
    if (!title) continue;

    out.push({
      title,
      date: published,
      videoId,
      thumb: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    });
  }

  out.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  return out.slice(0, MAX_VIDEOS);
}

/* ===================================================================
   MAIN
   =================================================================== */
async function main() {
  let videos = null;
  let source = "";

  // 1) Try the API first (fresh + real Shorts filtering) if a key exists.
  if (YT_API_KEY) {
    try {
      console.log("Fetching via YouTube Data API…");
      videos = await fetchViaApi();
      source = "api";
    } catch (err) {
      console.warn("API fetch failed, falling back to RSS:", err.message);
    }
  } else {
    console.log("No YT_API_KEY set — using RSS feed (Shorts filtered by tag only).");
  }

  // 2) Fall back to RSS if the API didn't produce results.
  if (!videos) {
    try {
      console.log("Fetching via RSS feed…");
      videos = await fetchViaRss();
      source = "rss";
    } catch (err) {
      console.error("RSS fetch also failed:", err.message);
    }
  }

  // 3) If BOTH sources failed, exit non-zero WITHOUT overwriting a good
  //    existing videos.json — the site keeps showing the last good data.
  if (!videos || !videos.length) {
    console.error("Feed update failed: no videos from any source. Keeping existing videos.json.");
    process.exit(1);
  }

  const payload = {
    updated: new Date().toISOString(),
    source,
    channelId: CHANNEL_ID,
    videos,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Wrote ${videos.length} episodes to ${OUTPUT} (source: ${source})`);
  videos.forEach((v, i) =>
    console.log(`  ${i + 1}. ${v.title}${v.durationSeconds ? ` [${v.durationSeconds}s]` : ""}`)
  );
}

main();
