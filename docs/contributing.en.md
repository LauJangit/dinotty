# Contributing

PRs are welcome! Please follow these guidelines.

## Branch Strategy

- **PRs must target the `dev` branch** — do not submit PRs directly to `main`
- `main` is always kept in a stable, releasable state
- Create your feature branch from `dev`:

```bash
git checkout dev
git pull origin dev
git checkout -b feat/your-feature
```

## Branch Naming

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feat/` | New feature | `feat/plugin-api` |
| `fix/` | Bug fix | `fix/resize-crash` |
| `docs/` | Documentation | `docs/contributing` |
| `refactor/` | Refactor (no behavior change) | `refactor/session-manager` |
| `chore/` | Build, deps, CI, etc. | `chore/update-deps` |

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>: <short description>

[optional body]
```

Common types: `feat` / `fix` / `docs` / `refactor` / `chore` / `style` / `test`

```
feat: add plugin hot-reload support
fix: fix mobile landscape layout crash
docs: update plugin development guide
```

## Pre-submission Checklist

Make sure these pass before submitting a PR:

```bash
# Backend build
cargo build

# Frontend type check
cd frontend && npx vue-tsc --noEmit
```

## Code Style

- **Rust**: Format with `rustfmt` (`cargo fmt`)
- **Frontend**: Follow the project's existing ESLint / Prettier config

## Issues

Bug reports and feature requests are welcome via GitHub Issues, in either Chinese or English.
