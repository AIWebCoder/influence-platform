# Checklist livraison — Influence Platform

**Date :** 18 mai 2026 (ré-estimation post-intégration P0 / P2 / P3)  
**Périmètre :** livrable MVP tel que défini dans « Ce qui sera livré »  
**Référence :** audit technique du dépôt `influence-platform` + [integration-plan.md](./integration-plan.md)

---

## Légende

| Symbole | Signification |
|--------|----------------|
| **Livré** | Fonctionnel et utilisable en conditions réelles |
| **Partiel** | Brique technique présente ; intégration incomplète |
| **À faire** | Absent, non branché ou hors périmètre V1 |

**Avancement global estimé : ~68 %** (était ~55 % au 15 mai 2026)

**Dernière livraison code :** commit `61cf8bd` sur `main` — operator UI (calendrier, file, templates, comptes), proxies 1:1, runbook publish, réparation schéma `visual_type`.

---

## 1. Content Factory fonctionnelle

| # | Livrable | Statut | Avancement | Commentaire |
|---|----------|--------|------------|-------------|
| 1.1 | Génération IA (textes) | **Partiel** | ~80 % | Gemini / Claude ; jobs + messages d'erreur studio |
| 1.2 | Génération IA (visuels / vidéo) | **Partiel** | ~75 % | Kie.ai, AliveAI, Seedance ; validation média publish |
| 1.3 | Templates par niche | **Partiel** | ~70 % | CRUD API + UI ; `template_id` → `resolve_template_payload` dans generation-jobs |
| 1.4 | Calendrier éditorial | **Partiel** | ~75 % | API + page `/calendar` ; `PATCH` planification ; smoke opérateur à valider |
| 1.5 | File prêts à publier | **Partiel** | ~80 % | `GET /ready-queue` + page `/queue` ; outbox + `publish:commands` |

**Synthèse bloc 1 : Partiel — ~76 %**

---

## 2. Distribution Engine fonctionnel

| # | Livrable | Statut | Avancement | Commentaire |
|---|----------|--------|------------|-------------|
| 2.1 | Gestion 50–100 comptes | **À faire** | ~35 % | Import bulk + CRUD ; **pas** de preuve charge 50/100 (P3.12) |
| 2.2 | Comptes isolés + proxies | **Partiel** | ~75 % | **1:1 strict** (`PROXY_STRICT_ONE_TO_ONE`) ; assign/rotate ; schéma proxy au démarrage |
| 2.3 | Publication automatisée | **Partiel** | ~75 % | Chemin Studio → intents → Graph API ; dry-run documenté hors prod |
| 2.4 | Warm-up basique | **Partiel** | ~45 % | Limites posts ; pas d'engagement automate complet |
| 2.5 | Monitoring de santé | **Partiel** | ~65 % | Token expiry cron ; shadowban sweep ; métriques partiellement simulées |

**Synthèse bloc 2 : Partiel — ~59 %**

---

## 3. Dashboard centralisé

| # | Livrable | Statut | Avancement | Commentaire |
|---|----------|--------|------------|-------------|
| 3.1 | Vue comptes | **Partiel** | ~85 % | Data table, édition compte/proxy/IG, KPI, studio, publications |
| 3.2 | Campagnes | **Partiel** | ~55 % | Page V1 minimale (création + jobs) ; pas campagne « marketing complète » |
| 3.3 | Métriques de base | **Partiel** | ~65 % | KPI ops home ; `/analytics` toujours placeholder V1 |
| 3.4 | Alertes | **Partiel** | ~60 % | Cloche ; auth users/CF ; routes `/users`, `/proxies`, etc. hors `middleware` matcher |

**Synthèse bloc 3 : Partiel — ~66 %**

---

## 4. Pipeline (création → Instagram)

| # | Livrable | Statut | Avancement | Commentaire |
|---|----------|--------|------------|-------------|
| 4.1 | Flux architecturé | **Partiel** | ~72 % | Chemin unique documenté (runbook) ; studio → CF → DE |
| 4.2 | Publication IG prod | **Partiel** | ~55 % | Tokens + champs IG requis ; reel réel à re-valider en prod |
| 4.3 | Tests E2E CI | **À faire** | ~35 % | Specs Playwright locales ; pas job CI obligatoire sur PR |

**Synthèse bloc 4 : Partiel — ~54 %**

---

## 5. Infrastructure

| # | Livrable | Statut | Avancement | Commentaire |
|---|----------|--------|------------|-------------|
| 5.1 | Docker | **Livré** | ~85 % | Compose dev/staging/prod ; volumes dashboard documentés |
| 5.2 | CI/CD | **Partiel** | ~75 % | pytest CF, tests DE, build dashboard ; pas deploy auto SSH |
| 5.3 | Monitoring | **Partiel** | ~52 % | Prometheus/Grafana dans compose ; peu intégré au dashboard |

**Synthèse bloc 5 : Partiel — ~71 %**

---

## Tableau récapitulatif

| Bloc | % (15 mai) | % (18 mai) | Δ |
|------|------------|------------|---|
| Content Factory | ~53 % | **~76 %** | +23 |
| Distribution Engine | ~46 % | **~59 %** | +13 |
| Dashboard | ~58 % | **~66 %** | +8 |
| Pipeline E2E | ~50 % | **~54 %** | +4 |
| Infrastructure | ~68 % | **~71 %** | +3 |
| **TOTAL** | **~55 %** | **~68 %** | **+13** |

---

## Avancement par phase (integration-plan)

| Phase | Focus | Est. complété | Reste principal |
|-------|--------|---------------|-----------------|
| P0 | Publication foundations | **~95 %** | Preuve reel IG prod récurrente |
| P1 | CI + tests | **~50 %** | E2E CI ; [test-failures-backlog.md](./test-failures-backlog.md) |
| P2 | Operator product (CF + UI) | **~75 %** | Smoke bout-en-bout ; fermer dette tests |
| P3 | Scale + proxies | **~58 %** | Load test 50/100 ; runbook scale |
| P4 | Dashboard ops loop | **~55 %** | Analytics ; middleware routes ; alertes JWT |
| P5 | Runbooks + CI dur | **~45 %** | `scale-50-accounts.md` ; checklist à chaque milestone |

**Objectif plan :** ~90 % checklist (M5) — il reste environ **~22 points** sur l'échelle livrable.

---

## Prochaines étapes (priorisées)

| Priorité | Action | Phase |
|----------|--------|-------|
| P0 | Smoke : Studio → file → publication → calendrier | P2 |
| P0 | 1 reel Instagram réel + ligne `publications` | P0 |
| P1 | Corriger backlog pytest CF ; optionnel E2E en CI | P1 |
| P1 | Étendre `middleware.ts` (`/users`, `/calendar`, `/queue`, `/templates`, `/proxies`) | P4 |
| P2 | Load test 50 comptes + doc `docs/runbooks/scale-50-accounts.md` | P3 |
| P2 | Mettre à jour ce checklist après M3/M4 | P5 |

Plan détaillé : [integration-plan.md](./integration-plan.md)

---

*Influence Platform / HAVET DIGITAL — ré-estimation 18 mai 2026*
