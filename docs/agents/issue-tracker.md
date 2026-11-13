# Issue tracker: GitHub

Issues and specs for this project live in https://github.com/Kercy-kim/tripsketch-ai/issues.

Repository: `Kercy-kim/tripsketch-ai`.
Git remote: `https://github.com/Kercy-kim/tripsketch-ai.git`.

## Access

Use the connected GitHub tools when they support the operation. Pass `Kercy-kim/tripsketch-ai` as the repository explicitly.

The GitHub CLI (`gh`) is installed and authenticated as `Kercy-kim` in the setup environment. Use it for operations the connected GitHub tools do not support. Include `--repo Kercy-kim/tripsketch-ai` on issue commands.

Before the first issue write in a session, verify the target repository through the connected GitHub repository tool or `gh repo view Kercy-kim/tripsketch-ai --json nameWithOwner`. If the configured repository and `origin` disagree, resolve that discrepancy with the user.

## Conventions

- Create specs as GitHub issues. Create one implementation issue per ticket.
- Read the issue body, labels, state, and comments before acting on a ticket.
- List open issues with the relevant filters. Follow pagination when a complete set is needed.
- Link a child ticket to its parent using GitHub sub-issues when supported. Otherwise, put `Part of #<parent>` at the top of the child body and add the child to a task list in the parent.
- Record blocking edges with GitHub native issue dependencies when supported. Otherwise, put `Blocked by: #<number>, #<number>` near the top of the child body.
- A ticket is unblocked when every blocker is closed. When reading native dependencies, count open blockers only.
- Append discussion as issue comments. Preserve existing body content, labels, and assignees when updating unrelated fields.
- To close a ticket, first post the result or explanation as a comment, then close the issue.
- Triage labels are not configured because the `triage` skill was not installed during setup.

When using `gh`, put multiline issue bodies and comments in UTF-8 temporary files and pass `--body-file`.

File issues only in the configured project repository. Never use `mattpocock/skills` as the target merely because these skills came from there.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests; resolve the resource type before acting on a bare `#<number>`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `Kercy-kim/tripsketch-ai`.

## When a skill says "fetch the relevant ticket"

Read the GitHub issue and its comments from the configured repository.

## Wayfinding operations

Used by `/wayfinder`. The map is a single GitHub issue with child issues as tickets.

- Map: one issue labelled `wayfinder:map`, holding Notes, Decisions-so-far, and Fog.
- Child ticket: link it to the map as a sub-issue, or use the parent/task-list fallback above. Use `wayfinder:<type>` labels for `research`, `prototype`, `grilling`, or `task`.
- Blocking: use the dependency convention above.
- Frontier: list the map's open children, exclude tickets with an open blocker or an assignee, and select the first remaining ticket in map order.
- Claim: assign the ticket to the driving developer before doing its work.
- Resolve: append the answer as a comment, close the child ticket, and add a gist plus link to the map's Decisions-so-far section.
