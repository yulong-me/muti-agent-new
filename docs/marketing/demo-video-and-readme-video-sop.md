---
feature_ids: []
topics: [marketing, demo-video, remotion, github, readme]
doc_kind: sop
created: 2026-04-24
---

# Demo Video and README Video SOP

This is the lightweight workflow used for the OpenCouncil short product demo.

## Goal

Make a short demo that lets a new visitor understand the product before reading the setup docs:

- Start from the pain: one agent is often not enough.
- Show the product answer: custom Teams, custom agents, explicit routing, and `@mention` collaboration.
- Keep the video short enough to watch inside the README.

Target output:

- Around 45 seconds
- 1920x1080
- H.264 MP4
- Prefer under 10MB for GitHub user-attachment compatibility

## Script Shape

The demo should explain the product through a concrete workflow, not a feature tour.

Recommended sequence:

1. Show the problem:
   - "一个 agent 实现总是差一点。"
   - "这个 agent 说得对吗？最好有另一个 agent 校验。"
   - "我希望多个 agent 帮我做调研、质疑、收敛，并能继续推进到执行。"
2. Show OpenCouncil:
   - Create or select a custom Team.
   - Put multiple specialized Agents into the room.
   - Send a concrete request.
3. Show collaboration:
   - One agent proposes.
   - Another agent challenges or verifies.
   - Agents use `@mention` to pull each other into the thread.
4. End on the value:
   - The user gets a clearer plan, not just one model's answer.

Avoid vague GTM examples unless the target audience is specifically founders or marketers. For a developer-facing README, prefer code review, architecture decision, feature planning, or project research.

## Local Remotion Workspace

Keep the Remotion project local-only:

```bash
mkdir -p .remotion
printf "\\n# Local Remotion video workspace\\n.remotion/\\n" >> .git/info/exclude
```

Use Remotion for a controlled product demo when a real screen recording is too slow or hard to frame. The UI can be recreated in React, but it should match the actual OpenCouncil interface closely enough that it does not misrepresent the product.

Common commands:

```bash
cd .remotion
pnpm install
pnpm dev
pnpm render
pnpm still
```

For this repo, Remotion Studio should use port `7003` so it does not collide with OpenCouncil frontend `7002` or API `7001`.

Expected local outputs:

```text
.remotion/out/opencouncil-product-demo.mp4
.remotion/out/poster.png
```

Do not commit `.remotion/`, rendered videos, frame exports, or Remotion `node_modules/`.

## Review Gate

Before publishing:

1. Check rhythm: the first 3 seconds must make the problem obvious.
2. Check layout: input stays anchored at the bottom if the real app behaves that way.
3. Check emphasis: zoom real chat bubbles or UI regions, not unrelated floating callouts.
4. Check truthfulness: do not show capabilities the product cannot do.
5. Check privacy: no tokens, private workspace names, private prompts, or personal data.
6. Check file size and codec.

Useful checks:

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,r_frame_rate \
  -show_entries format=duration,size \
  -of default=noprint_wrappers=1 \
  .remotion/out/opencouncil-product-demo.mp4
```

## Upload Options

There are three different hosting patterns. They behave differently in GitHub README rendering.

### Option A: GitHub Release Asset

Good for stable downloads and poster images.

Example:

```text
https://github.com/yulong-me/OpenCouncil/releases/download/demo-assets-2026-04-24/opencouncil-product-demo.mp4
```

Latest demo asset:

```text
https://github.com/yulong-me/OpenCouncil/releases/download/demo-assets-2026-05-06/opencouncil-product-demo.mp4
```

Tradeoff: a naked Release `.mp4` URL usually renders as a normal link in README, not an inline video player.

### Option B: GitHub Issue or Discussion Attachment

Best for an inline README video player.

Steps:

1. Open a GitHub Issue or Discussion comment box.
2. Drag the `.mp4` into the box, or use "Paste, drop, or click to add files".
3. Wait for GitHub to upload the file.
4. Copy the generated URL:

```text
https://github.com/user-attachments/assets/<asset-id>
```

The comment does not need to be submitted after the URL is generated. Clear the draft comment if it was only used as an upload surface.

For the current OpenCouncil demo:

```text
https://github.com/user-attachments/assets/8ad8797a-482b-48b6-a13d-a17b2d858481
```

### Option C: Commit the Video

Avoid this for README demos. Video revisions make git history heavy, and normal diffs are not useful for binary files.

## Embed in README

To render a video player in GitHub README, put the GitHub user-attachment URL on its own line:

```markdown
https://github.com/user-attachments/assets/8ad8797a-482b-48b6-a13d-a17b2d858481
```

Do not use these if the goal is an inline player:

```markdown
<video src="..."></video>
```

GitHub strips raw `<video>` tags in README markdown.

```markdown
[![Watch the demo](poster.png)](demo.mp4)
```

That creates a clickable poster image, not an inline video player.

Also avoid using a Release `.mp4` URL alone if the goal is an inline player; it may render as a link.

## Verify GitHub Rendering

Use the GitHub Markdown API before merging:

```bash
gh api /markdown \
  -f mode=gfm \
  -f context=yulong-me/OpenCouncil \
  -f text=$'https://github.com/user-attachments/assets/8ad8797a-482b-48b6-a13d-a17b2d858481' \
  | rg '<video|user-attachments|details'
```

Expected result: rendered HTML contains `<video controls=...>`.

You can also validate the exact remote branch README:

```bash
remote_readme=$(gh api -H 'Accept: application/vnd.github.raw' \
  '/repos/yulong-me/OpenCouncil/contents/README.md?ref=codex/readme-demo-video-test')

gh api /markdown \
  -f mode=gfm \
  -f context=yulong-me/OpenCouncil \
  -f text="$remote_readme" \
  | rg '<video|user-attachments|details'
```

## Publishing Discipline

Use a branch and PR for README/video changes:

```bash
git switch -c codex/readme-demo-video-test
git add README.md assets/*.svg docs/marketing/demo-video-and-readme-video-sop.md
git commit -m "docs: add README demo video"
git push -u origin codex/readme-demo-video-test
```

After main branch protection is enabled, do not push directly to `main`. Open a PR and merge only after review.
