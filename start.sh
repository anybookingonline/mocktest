#!/bin/bash
# Start ExamAI platform (backend + frontend)
set -e

# Install dependencies if missing
[ -d "backend/node_modules" ] || (cd backend && npm install)
[ -d "frontend/node_modules" ] || (cd frontend && npm install)

# Seed database if empty
if [ ! -f "backend/data/examai.db" ]; then
  (cd backend && node src/utils/seed.js)
fi

# Start backend in background
(cd backend && npm run dev) &
BACKEND_PID=$!

# Trap to clean up backend on exit
trap "kill $BACKEND_PID 2>/dev/null" EXIT

# Start frontend (the exposed preview port)
cd frontend && npm run dev
