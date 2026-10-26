# Project documentation

Start with [project status](status.md) for readiness and the latest verification. Updated 2026-10-26
against commit `08313f3`. No production deployment was performed.

| Document | Purpose |
|---|---|
| [Status](status.md) | Current capabilities, evidence, limitations and next work |
| [Issues](issues.md) | Active findings, priorities, source evidence and closure checks |
| [Change log](changelog.md) | Dated changes, moves, deletions and their replacements |
| [MVP gates](mvp.md) | Acceptance work required before customer traffic |
| [MVP delivery plan](mvp-plan.md) | Milestones, owner decisions and ordering that close the gates |
| [Roadmap](roadmap.md) | Feature inventory and live versus preview portal coverage |
| [Hardware testing](testing-on-real-hardware.md) | Manual media and target-host checks (gates 1 and 6) |
| [Acceptance procedures](acceptance.md) | Pass conditions and steps for gates 2, 3, 4, 5 and 7 |
| [Restoring from a backup](restore.md) | Snapshot contents, `restore.sh`, new-host and in-place restore |
| [Upgrades and rollback](rollback.md) | Pre-upgrade dump, schema rehearsal, data-loss gate, rollback procedure |
| [Regression instructions](../tests/README.md) | Automated checks and disposable fixture boundaries |
| [2026-10-24 review](reviews/2026-10-24.md) | Historical R01–R20 findings and remediation evidence |
| [Dependency audit](reviews/dependencies-2026-10-25.json) | Raw advisory-service results for the three lockfiles |
| [Dependency audit, patched](reviews/dependencies-2026-10-25-patched.json) | Same audits after I15 in-range patching; residuals triaged in issues |
| [Implementation design](design/implementation-plan.md) | Proposed feature architecture; not a release checklist |
| [Reference comparison](research/reference-platforms.md) | Historical comparison; upstream claims need revalidation |
| [FusionPBX research](research/fusionpbx.md) | Pinned upstream source research from 2026-10-24 |
| [v1 retrospective](v1-retrospective.md) | Provenance of retained designs |

Operator setup and configuration live in the [repository README](../README.md). Agent engineering
invariants live in [CLAUDE.md](../CLAUDE.md). Other files under `design/` and its mobile-app assets
are future design references; screens and schemas pictured there do not establish backend support.

## Maintaining this record

- Update `status.md` when readiness or verification changes. Record the date, source revision,
  environment and test boundaries. Keep historical evidence explicitly dated.
- Add findings to `issues.md` with stable IDs, affected source, observed versus inferred behavior,
  and a concrete closure check. Update status after a verified fix; retain the history in the log.
- Record every removal or move in `changelog.md`, including the reason, replacement and source
  revision from which it can be recovered. Update repository and published-site links together.
- Keep feature design in one place. Use links from summaries instead of another implementation plan.
- The site publishes the top-level Markdown documents and `design/*.md`. `reviews/` and `research/`
  remain repository references; published links to them go to GitHub. This is organization, not
  access control: this repository may be public.
