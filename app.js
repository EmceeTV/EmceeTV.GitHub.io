/* ===================================================================
   EmceeTV — app.js
   Handles: (1) YouTube feed loaded from videos.json (refreshed daily by
                a GitHub Action) with a graceful static fallback,
            (2) photo gallery + pure-JS lightbox,
            (3) mobile nav, scroll-spy, contact form, footer year.
   =================================================================== */

/* ===================================================================
   HOW THE FEED STAYS CURRENT
   -------------------------------------------------------------------
   This is a static site, so it can't call YouTube with a secret key at
   request time. Instead, a GitHub Action (see .github/workflows/
   update-feed.yml) runs once a day on GitHub's servers, reads the
   channel's free public RSS feed, and writes the latest videos to
   videos.json in this repo. The browser just loads that file below.

   Result: you upload to YouTube, and within a day the site updates
   itself — no API key in the page, no quota, no manual steps.

   The loader tries three sources in order and uses the first that works:
     1. videos.json         (kept fresh by the daily Action)  <-- primary
     2. the YouTube Data API (only if you paste a key below)  <-- optional
     3. FALLBACK_EPISODES   (hardcoded placeholders)          <-- safety net
   =================================================================== */
const VIDEOS_JSON = "videos.json";                       // written by the Action
const MAX_EPISODES = 6;                                   // how many cards to show
const CHANNEL_URL = "https://www.youtube.com/channel/UCbkiiNUurUSb37QyD-nYZIw";

/* Optional: only used if videos.json is missing AND you paste a key.
   Most people can leave these blank — the Action handles everything.
   If you do use a key, restrict it (YouTube Data API v3 + your domain)
   in the Google Cloud Console, since it's visible in the page source. */
const YT_API_KEY = "";                                   // optional, usually leave blank
const UPLOADS_PLAYLIST_ID = "UUbkiiNUurUSb37QyD-nYZIw";  // channel ID with UC -> UU

/* -------------------------------------------------------------------
   STATIC FALLBACK EPISODES
   Shown when no API key is set, the request fails, or the quota is hit.
   Swap in real video IDs / thumbnails / titles as needed.
   ------------------------------------------------------------------- */
const FALLBACK_EPISODES = [
  {
    title: "The Come-Up: From Basement Bars to Sold-Out Shows",
    date: "2025-06-18",
    videoId: "",
    thumb: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=640&q=70&auto=format&fit=crop"
  },
  {
    title: "Producers' Roundtable: Building the Beat That Broke Through",
    date: "2025-06-04",
    videoId: "",
    thumb: "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=640&q=70&auto=format&fit=crop"
  },
  {
    title: "Freestyle Friday: Cyphers, Punchlines & Pressure",
    date: "2025-05-22",
    videoId: "",
    thumb: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=640&q=70&auto=format&fit=crop"
  },
  {
    title: "The Business of Bars: Publishing, Streams & Ownership",
    date: "2025-05-09",
    videoId: "",
    thumb: "https://images.unsplash.com/photo-1470019693664-1d202d2c0907?w=640&q=70&auto=format&fit=crop"
  },
  {
    title: "Crate Diggers: Sampling, Vinyl & the Sound of the City",
    date: "2025-04-25",
    videoId: "",
    thumb: "https://images.unsplash.com/photo-1461784121038-f088ca1e7714?w=640&q=70&auto=format&fit=crop"
  },
  {
    title: "Behind the Booth: Engineers Who Shape the Records",
    date: "2025-04-11",
    videoId: "",
    thumb: "https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=640&q=70&auto=format&fit=crop"
  }
];

/* -------------------------------------------------------------------
   GALLERY PHOTOS
   ------------------------------------------------------------------- */
const PHOTOS = [
  { src: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=900&q=75&auto=format&fit=crop", cap: "Live set, downtown" },
  { src: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=900&q=75&auto=format&fit=crop", cap: "Crowd, front row" },
  { src: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=900&q=75&auto=format&fit=crop", cap: "In the booth" },
  { src: "https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?w=900&q=75&auto=format&fit=crop", cap: "Backstage" },
  { src: "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=900&q=75&auto=format&fit=crop", cap: "Studio session" },
  { src: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=900&q=75&auto=format&fit=crop", cap: "The cypher" },
  { src: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=900&q=75&auto=format&fit=crop", cap: "On the mic" },
  { src: "https://images.unsplash.com/photo-1508973379184-7517410fb0bc?w=900&q=75&auto=format&fit=crop", cap: "Turntables" },
  { src: "https://images.unsplash.com/photo-1471478331149-c72f17e33c73?w=900&q=75&auto=format&fit=crop", cap: "Sound check" }
];

/* ===================================================================
   1) YOUTUBE FEED
   =================================================================== */

/**
 * Format an ISO date (e.g. "2025-06-18T...") as "Jun 18, 2025".
 */
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric"
    });
  } catch { return ""; }
}

/**
 * Build the HTML for a single episode card.
 * `videoId` may be empty (fallback with no real link) — in that case the
 * card links to the channel instead of a specific video.
 */
function episodeCardHTML({ title, date, thumb, videoId }) {
  const href = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : CHANNEL_URL;

  // If maxresdefault.jpg doesn't exist yet (YouTube generates it a little
  // after upload), swap to hqdefault.jpg, which always exists. The onerror
  // clears itself so it can't loop.
  const fallbackThumb = videoId
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    : thumb;

  return `
    <article class="ep-card">
      <a href="${href}" target="_blank" rel="noopener" aria-label="Watch: ${escapeHTML(title)}">
        <div class="ep-thumb">
          <img src="${thumb}" alt="" loading="lazy" width="640" height="360"
               onerror="this.onerror=null;this.src='${fallbackThumb}'" />
          <div class="ep-play">
            <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></span>
          </div>
        </div>
        <div class="ep-body">
          <h3 class="ep-title">${escapeHTML(title)}</h3>
          <p class="ep-date">${formatDate(date)}</p>
        </div>
      </a>
    </article>`;
}

/** Small helper to avoid injecting raw HTML from titles. */
function escapeHTML(str = "") {
  return str.replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** Render an array of episode objects into the grid. */
function renderEpisodes(list) {
  const grid = document.getElementById("episodeGrid");
  grid.innerHTML = list.slice(0, MAX_EPISODES).map(episodeCardHTML).join("");
}

/**
 * Load the feed. Tries three sources in order and uses the first that
 * returns real videos:
 *   1. videos.json  — refreshed daily by the GitHub Action (primary path)
 *   2. YouTube API  — only if you pasted a key above (optional)
 *   3. static cards — FALLBACK_EPISODES safety net
 */
async function loadYouTubeFeed() {
  // ---- 1. videos.json (the normal path for this static site) ----
  try {
    // cache-bust so visitors get the freshly committed file, not a stale
    // cached copy, right after the daily Action runs.
    const res = await fetch(`${VIDEOS_JSON}?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.videos) && data.videos.length) {
        renderEpisodes(data.videos);
        console.info(`[EmceeTV] Loaded ${data.videos.length} videos from videos.json` +
                     (data.updated ? ` (updated ${data.updated})` : ""));
        return;
      }
    }
  } catch (err) {
    console.warn("[EmceeTV] videos.json not available:", err.message);
  }

  // ---- 2. Optional direct API call (only if a key was set) ----
  if (YT_API_KEY) {
    try {
      const endpoint = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
      endpoint.search = new URLSearchParams({
        part: "snippet",
        maxResults: String(MAX_EPISODES),
        playlistId: UPLOADS_PLAYLIST_ID,
        key: YT_API_KEY
      }).toString();

      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`YouTube API responded ${res.status}`);
      const data = await res.json();
      if (!data.items || !data.items.length) throw new Error("No items returned");

      // Map API shape -> our simple episode shape.
      const episodes = data.items.map(item => {
        const s = item.snippet;
        const thumbs = s.thumbnails || {};
        const thumb = (thumbs.maxres || thumbs.standard || thumbs.high ||
                       thumbs.medium || thumbs.default || {}).url || "";
        return {
          title: s.title,
          date: s.publishedAt,
          videoId: s.resourceId?.videoId || "",
          thumb
        };
      })
      // Private/deleted videos come through with placeholder titles — drop them.
      .filter(e => e.title && e.title !== "Private video" && e.title !== "Deleted video");

      if (!episodes.length) throw new Error("All items filtered out");
      renderEpisodes(episodes);
      console.info("[EmceeTV] Loaded videos from the YouTube Data API.");
      return;
    } catch (err) {
      console.warn("[EmceeTV] YouTube API fetch failed:", err.message);
    }
  }

  // ---- 3. Static safety net ----
  console.info("[EmceeTV] Falling back to static placeholder episodes.");
  renderEpisodes(FALLBACK_EPISODES);
}

/* ===================================================================
   2) PHOTO GALLERY + LIGHTBOX
   =================================================================== */

/** Render gallery tiles and wire each one to open the lightbox. */
function renderPhotos() {
  const grid = document.getElementById("photoGrid");
  grid.innerHTML = PHOTOS.map((p, i) => `
    <button class="photo-item" data-index="${i}" aria-label="Open photo: ${escapeHTML(p.cap)}">
      <img src="${p.src}" alt="${escapeHTML(p.cap)}" loading="lazy" />
      <span class="photo-cap">${escapeHTML(p.cap)}</span>
    </button>
  `).join("");

  grid.querySelectorAll(".photo-item").forEach(el => {
    el.addEventListener("click", () => openLightbox(Number(el.dataset.index)));
  });
}

/* --- Lightbox state + controls --- */
const lb = {
  el:      () => document.getElementById("lightbox"),
  img:     () => document.getElementById("lbImg"),
  caption: () => document.getElementById("lbCaption"),
  index:   0
};

/** Open the overlay at a given photo index and lock body scroll. */
function openLightbox(index) {
  lb.index = index;
  updateLightbox();
  const el = lb.el();
  el.hidden = false;
  // next frame -> add .open so the CSS fade/scale transition runs
  requestAnimationFrame(() => el.classList.add("open"));
  document.body.style.overflow = "hidden";
  document.getElementById("lbClose").focus();
}

/** Fade out, then hide and restore scrolling. */
function closeLightbox() {
  const el = lb.el();
  el.classList.remove("open");
  document.body.style.overflow = "";
  // wait for the fade-out before setting hidden
  setTimeout(() => { el.hidden = true; }, 300);
}

/** Move by +1 / -1 with wrap-around and swap the image. */
function stepLightbox(dir) {
  lb.index = (lb.index + dir + PHOTOS.length) % PHOTOS.length;
  updateLightbox();
}

/** Push the current photo into the <img> + caption. */
function updateLightbox() {
  const p = PHOTOS[lb.index];
  lb.img().src = p.src;
  lb.img().alt = p.cap;
  lb.caption().textContent = p.cap;
}

/** Attach all lightbox event listeners once. */
function initLightbox() {
  document.getElementById("lbClose").addEventListener("click", closeLightbox);
  document.getElementById("lbNext").addEventListener("click", () => stepLightbox(1));
  document.getElementById("lbPrev").addEventListener("click", () => stepLightbox(-1));

  // Click on the dark backdrop (but not the image) closes it.
  lb.el().addEventListener("click", (e) => {
    if (e.target === lb.el()) closeLightbox();
  });

  // Keyboard: Esc to close, arrows to navigate.
  document.addEventListener("keydown", (e) => {
    if (lb.el().hidden) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowRight") stepLightbox(1);
    else if (e.key === "ArrowLeft") stepLightbox(-1);
  });
}

/* ===================================================================
   3) NAV, SCROLL-SPY, FORM, MISC
   =================================================================== */

/** Mobile hamburger toggle. */
function initNav() {
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  // Close the menu after tapping a link (mobile).
  links.querySelectorAll("a").forEach(a =>
    a.addEventListener("click", () => {
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    })
  );
}

/** Highlight the nav link for whichever section is in view. */
function initScrollSpy() {
  const sections = ["top", "episodes", "photos", "contact"]
    .map(id => document.getElementById(id))
    .filter(Boolean);
  const links = [...document.querySelectorAll(".nav-links a")];

  const spy = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const id = entry.target.id;
      links.forEach(l =>
        l.classList.toggle("active", l.getAttribute("href") === `#${id}`)
      );
    });
  }, { rootMargin: "-45% 0px -50% 0px" });

  sections.forEach(s => spy.observe(s));
}

/** Basic client-side contact form validation + friendly status message. */
function initForm() {
  const form = document.getElementById("contactForm");
  const note = document.getElementById("formNote");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email") || "");
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!data.get("name") || !emailOk || !data.get("subject") || !data.get("message")) {
      note.textContent = "Please fill in every field with a valid email.";
      note.className = "form-note err";
      return;
    }
    // No backend here — this is a static site. Hook up your own endpoint
    // (Formspree, Netlify Forms, a serverless function, etc.) to send it.
    note.textContent = "Thanks — your message is ready to send. We'll be in touch!";
    note.className = "form-note ok";
    form.reset();
  });
}

/* ===================================================================
   INIT
   =================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("year").textContent = new Date().getFullYear();
  loadYouTubeFeed();
  renderPhotos();
  initLightbox();
  initNav();
  initScrollSpy();
  initForm();
});
