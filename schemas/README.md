# schemas

Schemas (JSON Schema) for the data files in [`../content/`](../content/) and
for other language-neutral formats.

- **Content:** one schema per file in `content/` (`buildings`, `economy`,
  `events`, `mapgen`, `presentation`, `resources`, `sim`, `terrain`,
  `threats`, `units`). `pnpm validate:content` checks every content file
  against its schema and the core loaders.
- **Saved and exchanged formats:** `run-state`, `save`, `ghost-snapshot`,
  `team-state`, `map`, `neutral-zone`, `threat-profile` and `sim-event`.
  Changing one of these follows "Versions and saved formats" in
  `CONTRIBUTING.md`.
- **Tests:** `golden-vector`, the shape of the files in `golden/`.

A schema covers the shape only. Rules that need the whole state, such as
placement legality or ghost validation, are checked in code and described in
`docs/rules-reference.md`.
