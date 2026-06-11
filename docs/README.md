# Influence Platform — Documentation

All doc filenames use **kebab-case** (`my-doc-name.md`). Group by purpose in subdirectories.

## Layout

```
docs/
├── README.md                          ← You are here
├── architecture/                      Technical design, infra, observability
│   ├── content-api-report.md
│   ├── dark-mode-implementation.md
│   ├── monitoring-setup.md
│   └── v1-observability-alert-thresholds.md
├── audits/                            Reviews, readiness, deep dives
│   ├── campaigns-module-audit.md
│   ├── generation-studio-full-audit.md
│   ├── instagram-launch-frontend-audit-2026-04-30.md
│   ├── production-readiness-audit-2026-04-30.md
│   ├── staff-deep-audit.md
│   └── technical-audit.md
├── guides/                            User-facing
│   └── user-guide.md
├── planning/                          Roadmaps, sprints, rollout
│   ├── antigravity-tasks.md
│   ├── campaigns-implementation-plan.md
│   ├── dynamic-rollout-gates.md
│   ├── implementation-phases.md
│   ├── next-phase-dev.md
│   ├── phases-6-12-plan.md
│   └── sprint-tasks.md
├── project-status/                    Delivery and stakeholder reports
│   ├── delivery-status.md
│   ├── project-report.md
│   ├── project-review-report.md
│   └── project-update-boss-fr-2026-04-30.md
├── releases/                          Version notes
│   └── v1-release-notes-2026-04-30.md
├── runbooks/                          Operational procedures
│   ├── generation-studio-manual.md
│   ├── v1-launch-execution-checklist-day-by-day.md
│   ├── v1-publish-failure-triage.md
│   ├── v1-rollback-checklist.md
│   └── v1-worker-restart-and-stuck-job-recovery.md
├── fixes/                             Production incident fixes (mymultiflow / scm-101)
│   ├── README.md
│   ├── content-security-policy-aliveai.md
│   ├── nginx-api-routing.md
│   ├── dashboard-auth-login.md
│   ├── generated-assets-schema.md
│   ├── generation-failed-with-video.md
│   └── troubleshooting-checklist.md
└── suggestions/                       Conception / future (non-binding)
    └── conception-plan-v2.md
```

## Naming rules

| Rule | Good | Avoid |
|------|------|--------|
| Filenames | `dark-mode-implementation.md` | `DARK_MODE_IMPLEMENTATION.md` |
| | `v1-release-notes-2026-04-30.md` | `V1_RELEASE_NOTES_2026-04-30.md` |
| | `technical-audit.md` | `Influence_Platform_Audit.md` |
| Dates in name | suffix `-2026-04-30` when needed | random casing |

## Adding a new doc

1. Choose the folder (or propose a new top-level category if nothing fits).
2. Use **kebab-case** and `.md`.
3. Add one line to the tree above.

## Removed duplicates (canonical path only)

These topics existed both at `docs/` root and in a folder; only the **folder copy** remains:

- Dark mode → `architecture/dark-mode-implementation.md`
- User guide → `guides/user-guide.md`
- Implementation phases → `planning/implementation-phases.md`
- Monitoring → `architecture/monitoring-setup.md`
- Sprint tasks → `planning/sprint-tasks.md`
- Project report → `project-status/project-report.md`
- Next phase / Antigravity / Phases 6–12 / delivery status → under `planning/` or `project-status/`
