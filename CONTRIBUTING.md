# Contributing to OpenCouncil

OpenCouncil is a local-first workspace for creating, running, and evolving reusable AI teams. Contributions are welcome when they keep that product path clear: goal -> Team -> run record -> reviewed Team improvement.

## Good First Issues

Start with issues labeled `good first issue` or `documentation`. These should be scoped enough to finish without needing deep knowledge of the runtime.

If you want to take an issue, leave a short comment describing the change you plan to make.

## Local Setup

```bash
pnpm install:all
pnpm dev
```

Default development services:

| Service | URL |
|---------|-----|
| Backend API | http://localhost:7001 |
| Frontend UI | http://localhost:7002 |

Production-style gateway mode is available with:

```bash
pnpm dev:gateway
```

## Before Opening a PR

Run the checks that match your change:

```bash
pnpm build
pnpm --dir backend test
pnpm test:node-version
```

For frontend-only changes, also run the focused regression script that covers the touched UI when one exists under `frontend/tests/`.

## Contribution Guidelines

- Keep pull requests focused on one behavior, bug fix, or documentation improvement.
- Preserve the user-facing model: goal, reusable Team, run record, and reviewed Team evolution.
- Add or update tests when changing backend behavior, prompt assembly, routing, persistence, or user-facing UI flows.
- Do not commit local runtime data such as `backend/data/`, `backend/logs/`, `backend/workspaces/`, or archived workspaces.
- Use the public local defaults: frontend `7002` and backend `7001`.
- If Redis is needed for local experiments, use development port `6398`; do not connect external project work to production Redis `6399`.

## Bug Reports

Please include:

- What you tried to do
- What happened instead
- Your OS, Node version, and pnpm version
- Relevant terminal output or browser console errors
- Whether you were using development mode (`7002` / `7001`) or gateway mode (`7000`)

## Pull Request Checklist

- The change is narrowly scoped.
- Relevant tests or checks were run.
- Documentation was updated when behavior changed.
- No local runtime data or generated workspace files are included.
