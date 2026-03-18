# 🚀 Influence Platform — Sprint 25 Jours
> **HAVET DIGITAL** | Confidentiel | Février 2026  
> Stack : Next.js 14 · FastAPI · Node.js · PostgreSQL · Redis · Docker

---

## Vue d'ensemble

| Phase | Jours | Focus | Statut |
|-------|-------|-------|--------|
| Phase 0 — Setup & Contrat | J1 → J3 | Infrastructure + Contrat JSON | ✅ Terminé |
| Phase 1 — Développement | J4 → J18 | 3 tracks parallèles | ⏳ À venir |
| Phase 2 — Intégration | J19 → J22 | Tests E2E & Branchement | ⏳ À venir |
| Phase 3 — Livraison | J23 → J25 | Stabilisation & Démo MVP | ⏳ À venir |

---

## PHASE 0 — Setup & Contrat d'Interface `J1 → J3`

> Fondations critiques. Le contrat d'interface défini ici conditionne tout le développement parallèle. **Ne pas modifier après J3.**

### Jour 1 — Infrastructure

- [x] Setup monorepo Git + Docker Desktop config
- [x] CI/CD GitHub Actions basique
- [x] PostgreSQL + Redis via docker-compose
- [x] Vérification health checks tous services

### Jour 2 — Contrat & Schema

- [x] Contrat JSON `content-packet.schema.json` : id, type, caption, hashtags, target_accounts, scheduled_at, niche, status
- [x] Schema PostgreSQL complet : `niches`, `templates`, `content_packets`, `accounts`, `proxies`, `publications` + triggers `updated_at`
- [x] Authentification JWT : endpoints `/auth/login`, middleware token

### Jour 3 — Mock API & Validation E2E

- [x] Mock Content Factory : `POST /content/generate` → packet JSON valide → push Redis queue
- [x] Mock Distribution Engine : consumer Redis écoute `content:ready`, log les packets
- [x] Test End-to-End du contrat : générer contenu → vérifier réception côté Distribution Engine

---

## PHASE 1 — Développement Parallèle `J4 → J18`

> Cœur du sprint. Les 3 tracks avancent en totale indépendance grâce au contrat d'interface Redis.

---

### 🟢 Track A — Content Factory `Dev A · FastAPI Python`

#### J4 → J6 · Fondation
- [ ] CRUD contenus PostgreSQL : modèles SQLAlchemy, migrations Alembic
- [ ] Endpoints `GET / POST / PUT / DELETE /content`
- [ ] Intégration **Claude API** (Anthropic) : génération captions par niche, retry automatique

#### J7 → J9 · Core IA
- [ ] Intégration **DALL-E 3 / Stable Diffusion** : génération visuels selon prompt + niche
- [ ] Stockage URL visuels, gestion erreurs API
- [ ] Système de templates par niche : CRUD templates, variables dynamiques, prévisualisation

#### J10 → J12 · Scheduling
- [ ] Calendrier éditorial : scheduling posts, vue agenda, gestion fuseaux horaires
- [ ] Queue de contenus prêts : gestion priorités, statuts `pending / queued / published`
- [ ] Recherche hashtags optimisée par niche

#### J13 → J15 · UI
- [ ] Interface dashboard création : éditeur visuel drag & drop
- [ ] Prévisualisation mobile Instagram (format 1080x1080)
- [ ] Bulk generation : créer N contenus d'un coup

#### J16 → J18 · Finalisation
- [ ] Anti-duplication contenu
- [ ] A/B testing basique (variant A / variant B)
- [ ] API export finalisée vers Distribution Engine

---

### 🔴 Track B — Distribution Engine `Dev B · Node.js + Playwright`

#### J4 → J6 · Fondation
- [ ] Account Manager : CRUD comptes PostgreSQL, chiffrement passwords
- [ ] Intégration proxy pool (Bright Data / IPRoyal)
- [ ] Sessions isolées : chaque compte = proxy dédié + cookies séparés + fingerprint unique

#### J7 → J9 · Anti-détection
- [ ] Playwright stealth : fingerprinting navigateur unique par compte
- [ ] Simulation comportement humain : délais aléatoires, patterns d'activité
- [ ] Anti-détection Instagram : rotation user-agent, gestion headers

#### J10 → J12 · Publishing
- [ ] Publisher : consommation queue Redis `content:ready`
- [ ] Publication posts / stories / reels sur Instagram
- [ ] Rate limiting dynamique : max posts/jour par compte

#### J13 → J15 · Sécurité
- [ ] Warm-up automatisé : progression profils sur 7-14 jours
- [ ] Détection shadowban : monitoring engagement, alerte automatique
- [ ] Ajustement fréquence selon santé du compte

#### J16 → J18 · Finalisation
- [ ] Health score par compte (0-100)
- [ ] Alertes bans : détection + notification dashboard
- [ ] Pool de comptes backup + retry automatique en cas d'échec

---

### 🟣 Track C — Dashboard + Intégration `Dev C · Next.js 14`

#### J4 → J6 · Fondation
- [ ] Layout principal Next.js 14 : authentification NextAuth
- [ ] Navigation sidebar, design system shadcn/ui + Tailwind
- [ ] Connexion API Content Factory + Distribution Engine

#### J7 → J9 · Dashboard Comptes
- [ ] Vue comptes : statuts temps réel, health score par compte
- [ ] Indicateurs santé visuels, filtrage et recherche
- [ ] Alertes visuelles (ban, shadowban, erreur)

#### J10 → J12 · Campagnes
- [ ] Vue campagnes : lancement, suivi métriques
- [ ] Métriques de base : engagement, reach, impressions
- [ ] Timeline publications par compte

#### J13 → J15 · Analytics
- [ ] Graphiques performance (Recharts) : courbes engagement, comparatif comptes
- [ ] Top contenus par niche
- [ ] Tendances et recommandations basiques

#### J16 → J18 · Intégration End-to-End
- [ ] Flux complet Content Factory ↔ Distribution Engine via dashboard
- [ ] Gestion erreurs bout-en-bout
- [ ] Tests intégration sur vrais comptes

---

## PHASE 2 — Intégration & Tests `J19 → J22`

> Les 3 tracks convergent. Branchement complet. Tests en conditions réelles.

### J19 → J20 · Branchement

- [ ] Connexion Content Factory → Distribution Engine via API commune
- [ ] Tests sur 10-20 vrais comptes Instagram
- [ ] Validation flux complet : génération → queue → publication

### J21 · Tests de Charge

- [ ] Tests 50-100 comptes simultanés
- [ ] Identification goulots d'étranglement (Redis queue, DB connections)
- [ ] Optimisation performances

### J22 · Stabilisation

- [ ] Correction bugs critiques d'intégration
- [ ] Stabilisation des flux
- [ ] Documentation endpoints API (Swagger auto-généré)

---

## PHASE 3 — Stabilisation & Livraison `J23 → J25`

### J23 · Régression & Fix

- [ ] Tests de régression complets
- [ ] Fix derniers bugs critiques
- [ ] Optimisation : index DB, cache Redis, lazy loading

### J24 · Déploiement Production

- [ ] Déploiement Docker en production
- [ ] Monitoring Grafana basique (CPU, mémoire, queue size)
- [ ] Documentation technique minimale

### J25 · Démo & Handover

- [ ] Démo fonctionnelle bout-en-bout
- [ ] Handover documentation
- [ ] Définition roadmap V2

---

## 📦 Livrables MVP (Jour 25)

### ✅ Ce qui sera livré

- **Content Factory** : génération IA (textes + visuels), templates par niche, calendrier éditorial, file de contenus prêts
- **Distribution Engine** : gestion 50-100 comptes isolés avec proxies dédiés, publication automatisée, warm-up, monitoring
- **Dashboard** : vue comptes, lancement campagnes, métriques de base, alertes
- **Pipeline complet** : flux end-to-end création → publication Instagram
- **Infrastructure** : Docker, CI/CD, monitoring basique

### 🔜 Ce qui sera en V2

- Scale à 500+ comptes (Kubernetes)
- Analytics avancée avec modèles prédictifs
- A/B testing automatisé à grande échelle
- Rapports PDF/Excel automatisés
- Support multi-plateformes (TikTok, Twitter/X)
- Interface multi-utilisateurs

---

## ⚠️ Risques

| Risque                        | Niveau   | Impact               | Mitigation                                        |
|-------------------------------|--------  |-------------------   |---------------------                              |
| Dérive du scope               | 🔴 ÉLEVÉ | Dépassement J25      | Scope figé au J3 — tout ajout → V2                |
| Intégration tardive           | 🟡 MOYEN | Bugs majeurs J19+    | Mock API dès J3, tests continus                   |
| Anti-détection Instagram      | 🔴 ÉLEVÉ | Bans en série        | Warm-up conservateur, peu de comptes d'abord      |
| Qualité code IA               | 🟡 MOYEN | Dette technique      | Code review, tests auto, pas de merge sans review |
| **Dev solo (1 au lieu de 3)** | 🔴 ÉLEVÉ | Retard toutes tracks | Prioriser Track B + C — Track A simplifiable      |

---

## 🛠️ Stack Technologique

| Domaine         | Technologie                                    |
|-----------------|------------------------------------------------|
| Frontend        | Next.js 14 + React 18 + Tailwind + shadcn/ui   |
| Backend Content | Python FastAPI + SQLAlchemy + Alembic          |
| Backend Distrib | Node.js + Playwright (stealth)                 |
| Queue / Cache   | Redis 7                                        |
| Base de données | PostgreSQL 16                                  |
| Proxy Layer     | Bright Data / IPRoyal                          |
| IA Texte        | Claude API (Anthropic)                         |
| IA Visuel       | DALL-E 3 / Stable Diffusion                    |
| Infrastructure  | Docker + docker-compose                        |
| CI/CD           | GitHub Actions                                 |
| Monitoring      | Grafana + Sentry                               |

---

*Document préparé par HAVET DIGITAL — Confidentiel — Ne pas diffuser sans autorisation*
