# Bluepy

Bluepy is an ATProto and Bluesky web client forked from Phanpy.

## Features

- Multiple Bluesky accounts
- OAuth login
- Home, list, profile, search, hashtag, and notification views
- Compose, reply, quote, like, bookmark, repost, and report flows
- Grouped notifications
- Nested reply threads
- Reposts carousel
- Multi-column shortcuts
- Light, dark, and automatic themes

## Development

Prerequisites: Node.js 20+ and Bun 1.3+.

- `bun install` installs dependencies.
- `bun run dev` starts the Vite development server.
- `bun run typecheck` runs TypeScript checking.
- `bun run build` builds the production app.
- `bun run preview` previews the production build.
- `bun run messages:extract` updates locale catalogs.
- `bun run git:po-filter` configures cleaner `.po` diffs.

## Tech Stack

- Vite
- React
- React Router
- Valtio
- ATProto API
- Lingui
- Iconify with MingCute icons
- Vanilla CSS

## Internationalization

Translations live in `src/locales` as gettext `.po` files. English is the source locale.
