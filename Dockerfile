# Targets:
#   docker build .              -> full image (API + built frontend served at /)
#   docker build --target api . -> API-only image (no Node build, no frontend)
FROM node:22-slim AS web
WORKDIR /web
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack pnpm@10.20.0 install --frozen-lockfile
COPY frontend/ ./
RUN corepack pnpm@10.20.0 build

FROM python:3.12-slim AS api
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
RUN useradd --create-home parkiq
USER parkiq
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]

FROM api AS full
COPY --from=web /web/dist ./frontend/dist
