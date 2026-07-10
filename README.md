# PortfolioIQ — Portfolio Manager

This application, including the frontend and backend code, was completely generated using AI (Claude).
Investment Intelligence Platform. Single-developer, production-grade, locally runnable.

---

## First-Time Setup (3 steps)

### Step 1 — Copy the env file
```powershell
cd C:\Users\radkr\OneDrive\Documents\Projects\Portfolio-Manager
Copy-Item .env.example .env
```

### Step 2 — Generate a SECRET_KEY
Run this in PowerShell and copy the output:
```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```
Open `.env` and replace the `SECRET_KEY` line:
```
SECRET_KEY=paste-your-64-character-key-here
```
That is the only value you need to change. Everything else works out of the box.

### Step 3 — Start everything
```powershell
cd infrastructure
docker compose up --build
```

Then open **http://localhost:4200** in your browser.

---

## What's running after startup

| URL | Service |
|-----|---------|
| http://localhost:4200 | Angular frontend (hot reload) |
| http://localhost:8000/docs | FastAPI interactive API docs |
| http://localhost:5555 | Flower — Celery task monitor |
| http://localhost:9001 | MinIO — file storage UI (user: minioadmin / minioadmin) |

---

## Daily Commands

```powershell
# Start everything
cd infrastructure && docker compose up

# View API logs
docker compose logs -f api

# View worker logs (background jobs)
docker compose logs -f worker

# Run database migrations
docker compose exec api alembic upgrade head

# Generate a migration after changing a model
docker compose exec api alembic revision --autogenerate -m "describe your change"

# Run backend tests
docker compose exec api pytest

# Stop (keeps your data)
docker compose down

# Full reset — deletes all data
docker compose down -v
```

---

## Project Structure

```
Portfolio-Manager/
  backend/
    app/
      api/          Route handlers (auth.py, portfolios.py)
      core/         Config, database, Redis, auth utilities
      models/       SQLAlchemy ORM models
      schemas/      Pydantic request/response shapes
      services/     Business logic
      worker/       Celery background tasks
    alembic/        Database migrations
  frontend/
    src/app/
      core/         Auth, HTTP client, NgRx SignalStore, models
      features/     One folder per page/view
      shared/       Reusable components, pipes, directives
  infrastructure/
    docker-compose.yml
  doc/
    PortfolioIQ-Architecture-Blueprint.docx
```

---

## Architecture doc

See `doc/PortfolioIQ-Architecture-Blueprint.docx` for the full design document.
It is updated automatically after every code generation session.

---

## Production (when ready)

Change three values in `.env`:
```
APP_ENV=production
SECRET_KEY=<new-strong-key>
POSTGRES_PASSWORD=<strong-password>
```
Run with `docker compose -f infrastructure/docker-compose.prod.yml up -d`.
