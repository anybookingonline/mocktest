#!/bin/sh
# Start ExamAI (backend + frontend) — PORT = the exposed preview port.
# Requires a Postgres DATABASE_URL (see backend/.env.example).
set -e

# Install dependencies if missing
[ -d "backend/node_modules" ] || (cd backend && npm install)
[ -d "frontend/node_modules" ] || (cd frontend && npm install)

# Seed database (idempotent — ON CONFLICT DO NOTHING throughout)
(cd backend && node src/utils/seed.js)

# Start backend in background (port 3001 or BACKEND_PORT)
(cd backend && BACKEND_PORT="${BACKEND_PORT:-3001}" PORT="${BACKEND_PORT:-3001}" node src/index.js) &
BACKEND_PID=$!
trap "kill $BACKEND_PID 2>/dev/null" EXIT

# Frontend on the exposed port ($PORT), proxies /api + /uploads to the backend
cd frontend && exec npm run dev
