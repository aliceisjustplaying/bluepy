# Issue tracker: Linear

Issues and PRDs for this repo live in **Linear**, in the `Aliceisjustplaying` team under the **Bluepy** project. Linear's officially-recommended integration with Claude is the **Linear MCP server**, so skills should drive Linear through MCP tools rather than a CLI.

## Setup

Add the Linear MCP server to your Claude config once:

- Endpoint: `https://mcp.linear.app/sse`
- Auth: OAuth — Linear prompts the first time a tool is invoked.

Once connected, tools appear in the session as `mcp__linear__*`. Detect them at runtime. If they are absent, **stop and ask the user to connect the Linear MCP server**; do not improvise a different tracker.

## Conventions

- **Create an issue**: call the Linear MCP create-issue tool. Default `team` to `Aliceisjustplaying` and `project` to `Bluepy` unless the user names another.
- **Read an issue**: fetch by identifier (e.g. `BLU-123`) including comments and current state.
- **List issues**: filter by team + project + workflow state. For triage queues, filter on the `Triage` state.
- **Comment**: use the create-comment MCP tool with the issue identifier.
- **Change state**: update the issue's `state` field — see `docs/agents/triage-labels.md` for the role-to-state map.
- **Close**: move to `Done` (resolved) or `Canceled` (wontfix), per the triage map.

If a specific MCP tool name doesn't match what the server actually exposes in this session, enumerate the available `mcp__linear__*` tools and pick the closest semantic match before invoking.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team `Aliceisjustplaying`, project `Bluepy`.

## When a skill says "fetch the relevant ticket"

Fetch the Linear issue by its identifier (e.g. `BLU-123`) including comments and current state.

## Fallback

If the Linear MCP server is not connected, stop and ask the user to connect it. Do not silently fall back to GitHub issues, local markdown, or hand-drafted output.
