# Tail Spend Consolidation Planner

Tail Spend Consolidation Planner is a buy-side procurement analytics platform that exposes the long-tail, maverick, and duplicate-supplier spend hiding inside an enterprise's purchasing data, and builds a defensible, dollar-quantified business case to consolidate that spend onto fewer contracts and fewer suppliers.

It ingests transaction-level purchase, invoice, PO, supplier, and contract data (CSV upload, API, or a built-in sample dataset), runs deterministic analyses (Pareto tail segmentation, fuzzy supplier de-duplication, contract-coverage maverick detection, price-dispersion statistics, transaction-cost modeling), and turns the findings into trackable consolidation initiatives with target-versus-realized savings reporting.

See [`docs/idea.md`](docs/idea.md) for the full product specification, data model, and feature list.

## Stack

- **Backend:** Node + TypeScript, run with `tsx` (`node --import tsx/esm`). Postgres for persistence.
- **Frontend:** Next.js 15+ / React 19+ (App Router, TypeScript strict, Tailwind), located at `web/`.
- **Package manager:** pnpm (always).
- **Deploy:** Backend on Render (`render.yaml`), frontend on Vercel.

## Repository Layout

```
backend/   TypeScript API server (src/index.ts entrypoint)
web/        Next.js frontend (App Router)
docs/       Product spec (idea.md) and audit notes
```

## Local Development

Prerequisites: Node 22.x, pnpm, and a Postgres database.

### Backend

```bash
cd backend
pnpm install
# create backend/.env (see Environment Variables below)
node --import tsx/esm src/index.ts
```

The backend listens on `PORT` (defaults to `3001` locally).

### Frontend

```bash
cd web
pnpm install
# create web/.env.local with NEXT_PUBLIC_API_URL
pnpm dev
```

The frontend runs on `http://localhost:3000` and talks to the backend via `NEXT_PUBLIC_API_URL`.

### Docker Compose

To bring backend and web up together:

```bash
docker compose up --build
```

## Environment Variables

### Backend

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `PORT` | Port the backend listens on (`10000` on Render, `3001` locally). |
| `FRONTEND_URL` | Public URL of the frontend, used for CORS. |
| `NODE_ENV` | `production` in deployed environments. |

### Frontend

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL of the backend API. |

## Access Model

All features are free for signed-in users. There are no paid tiers or feature gates: once a user is signed in, every capability (data ingestion, tail segmentation, supplier de-duplication, maverick detection, price-dispersion analysis, consolidation business-case modeling, and initiative tracking) is fully available.
