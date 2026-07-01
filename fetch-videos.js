#!/usr/bin/env node
/* ===================================================================
   fetch-videos.js — EmceeTV
   -------------------------------------------------------------------
   Runs on GitHub's servers (via GitHub Actions), NOT in the browser.
   It reads YouTube's free public RSS feed for the channel — no API key,
   no Google Cloud project, no quota — and writes the latest videos to
   videos.json, which the website reads.

   YouTube publishes an RSS feed for every channel at:
     https://www.youtube.com/feeds/videos.xml?channel_id=<CHANNEL_ID>
   It always contains the ~15 most recent uploads with title, video ID,
   publish date, and thumbnail. That's everything the site needs.

   No external npm packages are required — this uses only Node's built-in
   modules, so the Action has nothing to install and runs fast.
   =================================================================== */

const https = require("https");
const fs = require("fs");
const path = require("path");

// ---- CONFIG ---------------------------------------------------------
const CHANNEL_ID = "UCbkiiNUurUSb37QyD-nYZIw"; // EmceeTV channel
const MAX_VIDEOS = 6;                           // how many to publish
const OUTPUT = path.join(__dirname, "videos.json");
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
// --------------------------------------------------------------------

/** Fetch a URL and resolve with the response body as a string. */
function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "EmceeTV-feed-bot" } }, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

/**
 * Parse the RSS/Atom XML with small, dependency-free regexes.
 * The feed is well-formed and predictable, so we don't need a full XML
 * library. Each <entry> maps to one video.
 */
function parseFeed(xml) {
  const entries = xml.split("<entry>").slice(1); // drop the channel header
  const videos = [];

  for (const entry of entries) {
    const videoId = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
    // Title may contain escaped characters; grab it raw then unescape.
    let title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const published = (entry.match(/<published>(.*?)<\/published>/) || [])[1];

    if (!videoId) continue;

    // Decode the handful of XML entities that appear in titles.
    title = title
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .trim();

    videos.push({
      title,
      date: published,
      videoId,
      // maxresdefault is the crisp 1280x720 thumbnail; the site falls back
      // to hqdefault automatically at runtime if maxres doesn't exist yet.
      thumb: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    });
  }

  return videos.slice(0, MAX_VIDEOS);
}

async function main() {
  try {
    console.log(`Fetching feed: ${FEED_URL}`);
    const xml = await get(FEED_URL);
    const videos = parseFeed(xml);

    if (!videos.length) {
      throw new Error("Feed parsed but contained no videos");
    }

    const payload = {
      updated: new Date().toISOString(),
      channelId: CHANNEL_ID,
      videos,
    };

    fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + "\n");
    console.log(`Wrote ${videos.length} videos to ${OUTPUT}`);
    videos.forEach((v, i) => console.log(`  ${i + 1}. ${v.title}`));
  } catch (err) {
    // Exit non-zero so the Action logs a visible failure, but DON'T
    // overwrite a good existing videos.json with nothing — the site keeps
    // showing the last successful fetch (or its static fallback).
    console.error("Feed update failed:", err.message);
    process.exit(1);
  }
}

main();
