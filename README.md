# agency-app

A full-stack TypeScript monorepo with:
- apps/web: React + Vite frontend
- apps/api: Fastify API backend
- packages/shared: Shared types for both apps

## Prerequisites
- Node.js 20+
- npm 10+

## Quick Start
1. Install dependencies:
   npm install
2. Copy env files:
   - apps/api/.env.example -> apps/api/.env
   - apps/web/.env.example -> apps/web/.env
3. Run both apps:
   npm run dev

## Admin Access
- Admin dashboard route: /admin
- Admin API base: /api/admin/*
- Required admin header: x-admin-key
- Configure key with environment variable:
   - ADMIN_DASHBOARD_KEY=your_secure_key

If ADMIN_DASHBOARD_KEY is not set, the app falls back to a local default key for development only.

## Scripts
- npm run dev: start web and api in parallel
- npm run build: build all workspaces
- npm run lint: run lint placeholders
- npm run test: run test placeholders

## Default URLs
- Web: http://localhost:5173
- API: http://localhost:3001/api/agency

## Deploy To Vercel
1. Import this repository into Vercel.
2. Keep the project root at the repository root.
3. Vercel will use vercel.json for build and routing.
4. For local development with split frontend/backend, set apps/web/.env:
   - VITE_API_URL=http://localhost:3001
5. For Vercel production, do not set VITE_API_URL so the app uses same-origin /api.

### Important Note
This project now persists offers and chats in Vercel Postgres.

### Vercel Postgres Setup
1. In Vercel, open your project.
2. Go to Storage and add a Postgres database (or Neon integration via Vercel).
3. Connect that database to this project.
4. Redeploy so Vercel injects the required environment variables.
5. Add ADMIN_DASHBOARD_KEY in Vercel Project Environment Variables.

Expected environment variables (managed by Vercel):
- POSTGRES_URL
- POSTGRES_PRISMA_URL
- POSTGRES_URL_NON_POOLING
- POSTGRES_USER
- POSTGRES_HOST
- POSTGRES_PASSWORD
- POSTGRES_DATABASE

### Local API Development With Database
If you run the Vercel function locally, add the Postgres environment values to a local env file used by your local runtime.
Without those variables, database-backed API routes will fail.