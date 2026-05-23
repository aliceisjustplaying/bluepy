# Triage Labels

This repo uses Linear and tracks the five canonical triage roles via **workflow states**, not labels. The `triage` skill should change an issue's state when moving it through the flow.

| Skill role        | Linear workflow state            | Meaning                                  |
| ----------------- | -------------------------------- | ---------------------------------------- |
| `needs-triage`    | `Triage`                         | Maintainer needs to evaluate this issue  |
| `needs-info`      | `Triage` + label `needs-info`    | Waiting on reporter for more information |
| `ready-for-agent` | `Backlog`                        | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `Todo`                           | Requires human implementation            |
| `wontfix`         | `Canceled`                       | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), move the issue into the corresponding Linear state from the table.

## The `needs-info` wrinkle

Linear's default workflow has no native "waiting on reporter" state (`In Review` is for code review, not reporter follow-up). Two ways to handle it — pick one and update the table:

- **Label fallback (default above)**: leave the issue in `Triage` and apply a `needs-info` label.
- **Custom state (cleaner)**: add a `Needs Info` workflow state to the `Aliceisjustplaying` team and map `needs-info` to it. One-time admin tweak in Linear settings.

If the team's workflow uses different state names, edit the right-hand column to match what is actually configured.
