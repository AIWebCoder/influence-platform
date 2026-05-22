# Influence Platform — Rapport de pré-release

**Date :** 20 mai 2026  
**Public :** Direction, produit, équipe technique  
**Objectif :** Fonctionnalités, avancement, blocages avant mise en production  
**Périmètre V1 :** Instagram via API Graph (priorité)

---

## 1. Synthèse exécutive

| Indicateur | Valeur |
|------------|--------|
| **Avancement livrable MVP** | **~68 %** (checklist client, 18 mai 2026) |
| **Readiness production** (audit 30/04/2026) | **Partiellement prêt** — release immédiate **non recommandée** sans sprint de durcissement |
| **Stack déployée** | Dashboard :3000, Content Factory :8000, Distribution Engine :3001, PostgreSQL, Redis |

**Message clé :** L'architecture et le parcours « créer → publier → suivre » sont en place pour un **pilote**. L'engagement commentaires, les métriques business et la montée à 50–100 comptes restent des zones à risque avant une production large.

> **Note :** Le document `project-report.md` affiche « 100 % » — inventaire technique. Pour la release, se baser sur la **checklist livrable (~68 %)** et cet audit.

---

## 2. Fonctionnalités principales (P0)

### 2.1 Studio de génération (`/generation-studio`)

| | |
|---|---|
| **Rôle** | Produire textes, images et vidéos par IA et déclencher la publication. |
| **Technique** | Content Factory : jobs `POST /generation-jobs`, orchestrateur, Gemini/Claude (texte), Kie.ai / AliveAI / Seedance (visuel/vidéo). |
| **État** | **Partiel ~80 %** — utilisable avec clés API valides. |
| **Limites** | Médias en URL publique pour Instagram Graph ; pas d'auto-gestion complète post-publication. |

### 2.2 Publication Instagram automatisée

| | |
|---|---|
| **Rôle** | Publier reels/posts sans action manuelle dans l'application Instagram. |
| **Chemin** | Studio → `publication_intents` / `publication_targets` → `publish_outbox` → Redis `publish:commands` → `PublishingWorker` → `graph.instagram.com`. |
| **État** | **Partiel ~75 %** — publication réelle si `PUBLISH_DRY_RUN=false` + `ig_user_id` + `ig_access_token`. |
| **Limites** | Preuve reel récurrente en prod ; sync DB `publications` vs post déjà live sur Instagram. |

### 2.3 Comptes (`/accounts`)

| | |
|---|---|
| **Rôle** | Gérer la flotte : statut, credentials Instagram, proxy dédié. |
| **État** | **Partiel ~85 %** — CRUD, import bulk, proxy 1:1 strict, mise à jour jeton IG. |
| **Limites** | Jeton collé manuellement ; scopes Meta critiques pour l'engagement. |

### 2.4 Proxies (`/proxies`)

| | |
|---|---|
| **Rôle** | Isoler chaque compte (IP dédiée, rotation, health check). |
| **État** | **Partiel ~75 %** |
| **Limites** | Tests de charge 50–100 comptes non réalisés. |

### 2.5 Personas (`/personas`)

| | |
|---|---|
| **Rôle** | Regrouper compte + proxy + device émulateur pour une identité cohérente. |
| **État** | **Partiel ~70 %** — hors chemin critique V1 Graph. |

### 2.6 Publications (`/publications`)

| | |
|---|---|
| **Rôle** | Suivi opérationnel : publié / échec / retry, diagnostics, retry manuel. |
| **État** | **Partiel ~80 %** |
| **Limites** | La **légende (caption)** n'est pas un **commentaire** Instagram ; métriques parfois **simulées**. |

### 2.7 Engagement social (`/engagement`)

| | |
|---|---|
| **Rôle** | Charger posts IG, lire commentaires API, file d'actions (réponse, like ; DM prévu). |
| **Technique** | DE : `GET /engagement/posts`, `GET /engagement/posts/:mediaId/comments` ; CF : `engagement_intents` + worker Redis. |
| **État** | **Partiel ~60 %** |
| **Blocage** | `comments_count: 1` côté Instagram mais `data: []` sur `/comments` → jeton sans `instagram_business_manage_comments`. |

### 2.8 File prête à publier (`/queue`)

| | |
|---|---|
| **Rôle** | Voir le contenu `ready` avant dispatch vers la file de publication. |
| **État** | **Partiel ~80 %** |

### 2.9 Authentification

| | |
|---|---|
| **Rôle** | Connexion dashboard (NextAuth + JWT), rôles admin / operator / viewer (Content Factory). |
| **État** | **Partiel ~75 %** — certaines routes dashboard hors `middleware`. |

---

## 3. Fonctionnalités secondaires (P2–P3)

| Module | Explication | État |
|--------|-------------|------|
| **Templates** (`/templates`) | Modèles de prompts par niche injectés dans la génération | ~70 % |
| **Calendrier** (`/calendar`) | Planification éditoriale (API + UI) | ~75 % |
| **Campagnes** (`/campaigns`) | Regroupement de jobs ; UI V1 minimale | ~55 % |
| **Analytics** (`/analytics`) | KPI, croissance — **données partiellement simulées** | ~65 % |
| **A/B Lab** (`/ab-tests`) | Variantes et évaluation | Bientôt / partiel |
| **Émulateurs** (`/emulators`) | Contrôle Android (tap, swipe) | Partiel — hors flux V1 Graph |
| **Warm-up / shadowban** | Limites posts, détection shadowban | ~45–65 % |
| **Utilisateurs** (`/users`) | Admin utilisateurs plateforme | Partiel |
| **Alertes / rapports** | Webhooks Slack/Discord, export hebdo | Partiel |
| **TikTok, X, etc.** | Multi-réseaux | **Hors périmètre V1** |

---

## 4. Infrastructure

| Composant | État | Commentaire |
|-----------|------|-------------|
| PostgreSQL + PgBouncer | ~85 % livré | Schéma publications, intents, engagement |
| Redis | ~80 % | `publish:commands`, `engagement:commands` |
| Docker Compose | ~85 % | dev / staging / prod |
| CI GitHub Actions | ~75 % | pytest CF, build dashboard — pas deploy auto SSH |
| Prometheus / Grafana | ~52 % | Peu intégré au dashboard produit |

---

## 5. Tableau « prêt pour pilote ? »

| Priorité | Module | % | Pilote ? |
|----------|--------|---|----------|
| **P0** | Génération + Studio | 80 | Oui |
| **P0** | Publication IG | 75 | Oui (token + dry-run off) |
| **P0** | Comptes + proxies | 80 | Oui |
| **P0** | Publications + queue | 80 | Oui |
| **P1** | Engagement (commentaires) | 60 | **Non** sans scope Meta |
| **P2** | Calendrier, templates | 75 | Oui |
| **P3** | Analytics | 65 | Prudence (simulation) |
| **P3** | 50–100 comptes | 35 | **Non prouvé** |

---

## 6. Problèmes et points bloquants

### 6.1 Bloquants produit

1. **Jeton Instagram incomplet** — sans `instagram_business_manage_comments`, commentaires invisibles dans Engagement.
2. **Métriques simulées** — `MetricsCollector` génère likes/commentaires aléatoires ; ne pas les présenter comme analytics réels.
3. **Publication prod** — smoke : 1 reel → ligne `publications` + `external_post_id`.
4. **Scale 50–100** — load test et runbook manquants.
5. **Tests E2E en CI** — couverture faible sur le pipeline publish.

### 6.2 Bloquants techniques

1. **Encodage UTF-16 (Windows)** — `node scripts/fix-utf8-encoding.cjs` avant build.
2. **Workers / reprise après crash** — audit direction : traitements à durcir.
3. **Sécurité routes dashboard** — étendre `middleware.ts`.
4. **Proxy vs Graph** — `PERSONA_PROXY_REQUIRED` si proxy absent.
5. **Désalignement DB / Instagram** — intent `queued` vs post déjà en ligne.

### 6.3 Limitations acceptées V1

- Token Meta manuel (Explorateur Graph).
- Like commentaire / DM limités par l'API Instagram.
- Pas de multi-réseaux en production.

---

## 7. Plan recommandé avant release

### Semaines 1–2 (bloquant)

- Nouveau token Meta par compte pilote : `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_content_publish`.
- Smoke : Studio → queue → publication → Publications → Engagement (commentaires non vides).
- Deploy : `fix-utf8-encoding` + `docker compose up -d --build`.
- UI : libellé « métriques simulées » ou désactivation en prod.

### Soft launch (semaines 3–4)

- 5–10 comptes max ; monitoring erreurs publish et latence Graph.

### Critères « go » minimal

- [ ] 1 publication réelle tracée en base
- [ ] Commentaires lisibles dans Engagement (Postman : `GET /{media-id}/comments` non vide)
- [ ] CI verte sur `main`
- [ ] Runbook SSH testé

---

## 8. Références internes

| Document | Contenu |
|----------|---------|
| `docs/project-status/livrable-client-checklist.md` | Checklist % par bloc (~68 %) |
| `docs/project-status/integration-plan.md` | Phases P0–P5 |
| `docs/project-status/project-update-boss-fr-2026-04-30.md` | Synthèse direction |
| `distribution-engine/scripts/diagnose-engagement-comments.cjs` | Diagnostic commentaires IG |

---

*Influence Platform — rapport pré-release — HAVET DIGITAL — mai 2026*
