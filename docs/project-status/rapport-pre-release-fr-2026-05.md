# Influence Platform — Rapport de pré-release

**Date :** 22 mai 2026 (révision)  
**Public :** Direction, produit, équipe technique  
**Objectif :** Fonctionnalités, avancement, blocages avant mise en production  
**Périmètre V1 :** Instagram via API Graph (priorité)

---

## 1. Synthèse exécutive

| Indicateur | Valeur |
|------------|--------|
| **Avancement livrable MVP** | **~70 %** (checklist client + livraisons mai 2026) |
| **Readiness production** (audit 30/04/2026) | **Partiellement prêt** — release large **non recommandée** sans durcissement |
| **Stack déployée** | Dashboard :3000, Content Factory :8000, Distribution Engine :3001, Emulator Controller :9102, PostgreSQL, Redis |
| **Dépôt Git** | `main` + branches `feat/restore-emulator-launch`, `server/ops-backup-20260522` |

**Message clé :** Le parcours « créer → publier → suivre → engager » est **utilisable en pilote** côté Graph API. Les **commentaires Instagram** restent bloqués par les **scopes Meta** du jeton. Les **émulateurs Android** sont opérationnels en local / serveur avec **host-agent** et UI dashboard revue, hors chemin critique publication Graph.

> **Note :** `project-report.md` peut afficher « 100 % » (inventaire technique). Pour la release, se baser sur la **checklist livrable (~68–70 %)** et cet audit.

### Livraisons depuis le 20 mai 2026

| Domaine | Livraison |
|---------|-----------|
| **Engagement** | Page `/engagement`, API DE/CF, worker Redis, résolution média par légende, alertes scope token |
| **Émulateurs** | Host-agent Windows (WHPX), lancement AVD, prévisualisation live, tap/swipe, bouton tiroir apps (swipe plein écran), ouverture Instagram |
| **Ops / déploiement** | Branche sauvegarde serveur, migrations SQL V021–V027, proxy Uvicorn CF, encodage UTF-8 Windows |
| **Documentation** | Rapport pré-release FR (MD + PDF), scripts génération PDF |

---

## 2. Fonctionnalités principales (P0)

### 2.1 Studio de génération (`/generation-studio`)

| | |
|---|---|
| **Rôle** | Produire textes, images et vidéos par IA et déclencher la publication. |
| **Technique** | Content Factory : `POST /generation-jobs`, orchestrateur, Gemini/Claude, Kie.ai / AliveAI / Seedance. |
| **État** | **Partiel ~80 %** — utilisable avec clés API valides. |
| **Limites** | Médias en URL publique pour Instagram Graph. |

### 2.2 Publication Instagram automatisée

| | |
|---|---|
| **Rôle** | Publier reels/posts sans action manuelle dans l'app Instagram. |
| **Chemin** | Studio → `publication_intents` / `publication_targets` → `publish_outbox` → Redis → `PublishingWorker` → Graph API. |
| **État** | **Partiel ~75 %** — si `PUBLISH_DRY_RUN=false` + `ig_user_id` + `ig_access_token`. |
| **Limites** | Sync DB `publications` vs post déjà live ; intents parfois `queued` alors que le post existe sur IG. |

### 2.3 Comptes (`/accounts`)

| | |
|---|---|
| **Rôle** | Flotte : statut, credentials Instagram, proxy dédié. |
| **État** | **Partiel ~85 %** — CRUD, import bulk, proxy 1:1, mise à jour jeton IG. |
| **Limites** | Jeton collé manuellement ; scopes Meta pour engagement. |

### 2.4 Proxies (`/proxies`)

| | |
|---|---|
| **Rôle** | Isolation IP par compte (rotation, health check). |
| **État** | **Partiel ~75 %** |
| **Limites** | Charge 50–100 comptes non prouvée. |

### 2.5 Personas (`/personas`)

| | |
|---|---|
| **Rôle** | Compte + proxy + device émulateur pour une identité cohérente. |
| **État** | **Partiel ~70 %** — hors chemin critique V1 Graph. |

### 2.6 Publications (`/publications`)

| | |
|---|---|
| **Rôle** | Suivi : publié / échec / retry, diagnostics. |
| **État** | **Partiel ~80 %** |
| **Limites** | **Caption ≠ commentaire** ; métriques parfois **simulées** dans Analytics. |

### 2.7 Engagement social (`/engagement`)

| | |
|---|---|
| **Rôle** | Posts IG, commentaires via API, file d'actions (réponse, like ; DM en scaffold). |
| **Technique** | DE : `GET /engagement/posts`, `GET /engagement/posts/:mediaId/comments` ; CF : `engagement_intents` + worker. |
| **État** | **Partiel ~65 %** — UI et pipeline livrés ; **lecture commentaires bloquée par jeton**. |
| **Blocage** | `comments_count: 1` sur le média mais `GET /{media-id}/comments` → `data: []` sans scope `instagram_business_manage_comments`. |
| **Action** | Régénérer le jeton dans l'Explorateur Graph avec les scopes business + manage comments ; vérifier Postman avant pilote. |

### 2.8 File prête à publier (`/queue`)

| | |
|---|---|
| **Rôle** | Contenu `ready` avant dispatch publication. |
| **État** | **Partiel ~80 %** |

### 2.9 Authentification

| | |
|---|---|
| **Rôle** | NextAuth + JWT ; rôles admin / operator / viewer. |
| **État** | **Partiel ~78 %** — `CONTENT_FACTORY_URL` / proxy headers CF sur serveur. |
| **Limites** | Étendre `middleware.ts` sur routes dashboard sensibles. |

### 2.10 Émulateurs Android (`/emulators`)

| | |
|---|---|
| **Rôle** | Prévisualisation et contrôle d'émulateurs ADB (warm-up, tests app, pas le flux publish Graph). |
| **Technique** | Emulator Controller :9102, host-agent :19200 (Windows), ADB `host.docker.internal:5037`, routes dashboard proxy. |
| **État** | **Partiel ~72 %** — **nouveau depuis mai 2026**. |
| **Fonctionnel** | Liste AVD, lancement (headless optionnel), frames PNG, tap/swipe, **tiroir applications** (swipe vertical calibré Pixel Launcher), Instagram via ADB, redémarrage. |
| **Limites** | ADB `unauthorized` si lancement headless sans accepter USB debugging ; précision tap/swipe moindre que boutons dédiés ; 2+ émulateurs = charge CPU serveur. |
| **Config serveur** | `.env` : `EMULATOR_AGENT_URL`, `EMULATOR_AGENT_TOKEN` ; script `scripts/setup-emulator-host.sh`. |

---

## 3. Fonctionnalités secondaires (P2–P3)

| Module | Explication | État |
|--------|-------------|------|
| **Templates** (`/templates`) | Prompts par niche | ~70 % |
| **Calendrier** (`/calendar`) | Planification éditoriale | ~75 % |
| **Campagnes** (`/campaigns`) | Regroupement jobs | ~55 % |
| **Analytics** (`/analytics`) | KPI — **données partiellement simulées** | ~65 % |
| **A/B Lab** (`/ab-tests`) | Variantes | Bientôt / partiel |
| **Warm-up / shadowban** | Limites, détection | ~45–65 % |
| **Utilisateurs** (`/users`) | Admin plateforme | Partiel |
| **Alertes** (`AlertBell`) | Compteur + liste alertes API | ~75 % |
| **TikTok, X, etc.** | Multi-réseaux | **Hors V1** |

---

## 4. Infrastructure et déploiement

| Composant | État | Commentaire |
|-----------|------|-------------|
| PostgreSQL + PgBouncer | ~85 % | Schéma + migrations V021–V027 (serveur) |
| Redis | ~80 % | `publish:commands`, `engagement:commands` |
| Docker Compose | ~88 % | dev / staging / prod ; variables emulator-agent |
| Host-agent émulateur | ~70 % | Processus **hors Docker** sur hôte Windows/Linux |
| CI GitHub Actions | ~75 % | pytest CF, build dashboard — pas deploy auto SSH |
| Prometheus / Grafana | ~52 % | Peu intégré au dashboard produit |
| **Sync Git serveur** | En cours | `feat/restore-emulator-launch` fusionné avec `server/ops-backup-20260522` |

**Runbook deploy SSH (rappel) :**

```bash
git fetch origin && git pull
# préserver .env local — ne jamais committer
docker compose build && docker compose up -d
node scripts/fix-utf8-encoding.cjs   # si build dashboard sur Windows
```

---

## 5. Tableau « prêt pour pilote ? »

| Priorité | Module | % | Pilote ? |
|----------|--------|---|----------|
| **P0** | Génération + Studio | 80 | Oui |
| **P0** | Publication IG | 75 | Oui (token + dry-run off) |
| **P0** | Comptes + proxies | 80 | Oui |
| **P0** | Publications + queue | 80 | Oui |
| **P1** | Engagement (commentaires) | 65 | **Non** sans scope Meta |
| **P1** | Émulateurs (contrôle UI) | 72 | Oui (ops / warm-up, pas publish) |
| **P2** | Calendrier, templates | 75 | Oui |
| **P3** | Analytics | 65 | Prudence (simulation) |
| **P3** | 50–100 comptes | 35 | **Non prouvé** |

---

## 6. Problèmes et points bloquants

### 6.1 Bloquants produit

1. **Jeton Instagram incomplet** — scope `instagram_business_manage_comments` requis pour Engagement.
2. **Métriques simulées** — ne pas présenter Analytics comme données réelles IG.
3. **Publication prod** — smoke : 1 reel → `publications.external_post_id` renseigné.
4. **Scale 50–100** — load test et runbook manquants.
5. **Alignement DB / IG** — intents `queued` vs contenu déjà publié.

### 6.2 Bloquants techniques

1. **Encodage UTF-16 (Windows)** — `node scripts/fix-utf8-encoding.cjs` avant `npm run build`.
2. **Workers / reprise crash** — à durcir (audit avril 2026).
3. **Routes dashboard** — middleware à étendre.
4. **Émulateur ADB unauthorized** — lancer AVD **avec fenêtre**, accepter USB debugging.
5. **Merge Git serveur** — résoudre conflits `docker-compose.yml` / routes avant `docker compose up`.

### 6.3 Limitations acceptées V1

- Token Meta manuel.
- Like commentaire / DM limités par API Instagram.
- Pas de multi-réseaux en production.
- Publication Graph **sans** émulateur (émulateur = parcours parallèle).

---

## 7. Plan recommandé avant release

### Semaines 1–2 (bloquant)

- Token Meta pilote : `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_content_publish`.
- Smoke : Studio → queue → publication → Publications → Engagement (comments non vides en Postman).
- Serveur : merge `feat/restore-emulator-launch` + backup ops ; `docker compose up -d --build`.
- UI : libellé « métriques simulées » ou masquage en prod.

### Soft launch (semaines 3–4)

- 5–10 comptes max ; monitoring publish + Graph + alertes.

### Critères « go » minimal

- [ ] 1 publication réelle tracée en base
- [ ] `GET /{media-id}/comments` non vide (Postman)
- [ ] CI verte sur `main`
- [ ] Runbook SSH testé (stash `.env`, pull, compose)
- [ ] 1 émulateur en statut ADB `device` sur serveur pilote (optionnel ops)

---

## 8. Références internes

| Document | Contenu |
|----------|---------|
| `docs/project-status/livrable-client-checklist.md` | Checklist % par bloc |
| `docs/project-status/integration-plan.md` | Phases P0–P5 |
| `docs/project-status/project-update-boss-fr-2026-04-30.md` | Synthèse direction |
| `emulator-controller/host_agent/README.md` | Host-agent AVD (Windows WHPX) |
| `distribution-engine/scripts/diagnose-engagement-comments.cjs` | Diagnostic commentaires IG |
| `scripts/fix-utf8-encoding.cjs` | Correction UTF-16 avant build Node |

---

*Influence Platform — rapport pré-release — HAVET DIGITAL — mai 2026 (rév. 22/05/2026)*
