# Domain Docs

This project uses a single-context domain documentation layout.

## Before exploring

- Read `GLOSSARY.md` at the repository root when it exists.
- Read relevant architectural decision records in `docs/adr/`.

If these files do not exist, proceed silently. Do not flag their absence or create empty placeholders. Domain-modeling workflows create them when terminology or decisions are actually resolved.

## File structure

- `GLOSSARY.md`: shared project terms.
- `docs/adr/NNNN-<decision-slug>.md`: architectural decisions, numbered from `0001`.

## Use the glossary's vocabulary

Use the terms defined in `GLOSSARY.md` in issue titles, proposals, hypotheses, tests, and explanations. Avoid synonyms the glossary explicitly rejects.

If a concept is missing, first reconsider whether it belongs to this project. Record genuine vocabulary gaps for the domain-modeling workflow.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, identify the conflicting decision and explain why it may need to be revisited. Do not silently override it.
