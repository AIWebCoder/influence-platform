# 📚 Influence Platform — Documentation

> All docs use **kebab-case** naming. Keep it consistent.

---

## 📁 Structure

```
docs/
├── README.md                              ← You are here
│
├── architecture/                          ← Technical design & infra
│   ├── dark-mode-implementation.md        — Dashboard light/dark theme system
│   └── monitoring-setup.md                — Prometheus + Grafana setup
│
├── project-status/                        ← Reports & delivery tracking
│   ├── project-report.md                  — Full project report (v3.1.2, Mar 2026)
│   ├── project-review-report.md           — AI handoff review report
│   └── delivery-status.md                 — Delivery vs. original PDF specs
│
├── planning/                              ← Roadmaps, sprints, task lists
│   ├── implementation-phases.md           — Phase-by-phase implementation plan
│   ├── phases-6-12-plan.md                — Detailed phases 6–12 spec
│   ├── next-phase-dev.md                  — Post-MVP development priorities
│   ├── sprint-tasks.md                    — 25-day sprint task breakdown
│   └── antigravity-tasks.md               — AI agent task prompts (24 tasks)
│
└── guides/                                ← User-facing documentation
    └── user-guide.md                      — Complete user guide (EN/FR)
```

---

## 🏷️ Naming Convention

|                 Rule                 |                        Example                        |
| :----------------------------------: | :---------------------------------------------------: |
| Use **kebab-case** for all filenames |             `dark-mode-implementation.md`             |
|          No SCREAMING_CASE           |           ~~`DARK_MODE_IMPLEMENTATION.md`~~           |
|        No PascalCase or mixed        |      ~~`Influence_Platform_Next_Phase_Dev.md`~~       |
|   Keep names short but descriptive   | `delivery-status.md` not `PROJECT_DELIVERY_STATUS.md` |
|  Group by purpose in subdirectories  |          `architecture/`, `planning/`, etc.           |

---

## 📝 Adding New Docs

1. Pick the right subdirectory (or create one if none fits)
2. Name the file in `kebab-case.md`
3. Update this README with a one-liner description
