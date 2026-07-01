# EmceeTV website — setup guide

Your site auto-updates with your latest YouTube videos. Here's how it works
and how to get it live on GitHub Pages. No API keys, no cost.

## How the auto-updating feed works (the short version)

1. A **GitHub Action** runs a few times a day on GitHub's own servers.
2. It reads your channel's free public YouTube RSS feed (no key needed).
3. It saves your latest videos into `videos.json` and commits it.
4. Your website reads `videos.json` and shows those videos.

So: **you upload to YouTube → within a few hours the site updates itself.**
Until the first run (or if anything ever fails), the site shows the built-in
placeholder episodes, so it never looks broken.

---

## One-time setup (about 5 minutes)

### 1. Put these files in a GitHub repository
Upload everything in this folder to a new repo, keeping the structure:

```
your-repo/
├── index.html
├── style.css
├── app.js
├── videos.json
├── fetch-videos.js
├── emceetv-logo-5a.png
├── emceetv-logo-5a.jpg
└── .github/
    └── workflows/
        └── update-feed.yml
```

> The `.github` folder is important — GitHub looks there for the Action.
> If uploading through the GitHub website, create the folders by typing
> `.github/workflows/update-feed.yml` as the filename when adding that file.

### 2. Turn on GitHub Pages
In your repo: **Settings → Pages → Build and deployment → Source: "Deploy
from a branch"**, pick the `main` branch and `/ (root)`, then **Save**.
After a minute your site is live at
`https://YOUR-USERNAME.github.io/YOUR-REPO/`.

### 3. Let the Action update the feed
The Action needs permission to commit `videos.json` back to your repo:
**Settings → Actions → General → Workflow permissions →
"Read and write permissions" → Save.**

### 4. Run it once to fill in your real videos
Go to the **Actions** tab → **"Update YouTube feed"** → **"Run workflow"**.
It fetches your latest uploads and commits them. Refresh your site — your
real videos are now showing. From here on it runs automatically every day.

That's it. You never have to touch it again.

---

## Common questions

**Do I need a Google account or API key?**
No. The daily Action uses YouTube's free public RSS feed. Zero setup, no
quota, nothing to expose.

**How fresh is the feed?**
Updated three times a day — 06:00, 14:00, and 22:00 UTC. To change the
times or add more, edit the `cron` lines in
`.github/workflows/update-feed.yml`. To refresh right now, use the "Run
workflow" button in the Actions tab.

**A thumbnail is missing right after I upload.**
YouTube takes a few minutes to generate the high-res thumbnail. The site
automatically falls back to the standard thumbnail in the meantime, so a
card is never blank.

**Can I show more or fewer than 6 videos?**
Change `MAX_VIDEOS` in `fetch-videos.js` (how many get saved) and
`MAX_EPISODES` in `app.js` (how many get shown).

**The `emceetv-standalone.html` file — what's that?**
A single-file copy of the whole site with everything embedded, handy for
quick previews. Note: it does **not** auto-update (it has no `videos.json`
to read). Use the regular multi-file version for the live site.

---

## Editing content

- **Photos:** edit the `PHOTOS` list near the top of `app.js`.
- **Placeholder episodes** (shown before the first Action run): the
  `FALLBACK_EPISODES` list in `app.js`.
- **Contact email / location:** in `index.html`, in the Contact section.
- **Social links:** in `index.html`, in the header and footer.

## Contact form note
The form validates input but needs a backend to actually send mail (GitHub
Pages can't send email). Free options that work with a static site:
[Formspree](https://formspree.io) or [Web3Forms](https://web3forms.com).
Both give you a form endpoint you drop into the form — takes a few minutes.
