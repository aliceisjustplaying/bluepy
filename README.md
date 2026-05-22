# Bluepy

Bluepy is a web client for Bluesky and ATProto.

## Development

Use Bun for local development:

```sh
bun install
bun run dev
```

Useful checks:

```sh
bun run typecheck
bun run test
bun run build
bunx oxlint <changed files>
```

## Configuration

OAuth client metadata is served from `/oauth-client-metadata.json`.
Preview and production deployment are handled by the Cloudflare Workers
configuration in this repository.

## Credits

Bluepy began as a fork of Phanpy and now targets Bluesky/ATProto only.
