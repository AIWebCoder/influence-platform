FROM python:3.11-slim

WORKDIR /app

# Dépendances système
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Entrypoint outside /app so dev bind-mount (./content-factory:/app) does not replace it with CRLF host copies.
COPY docker-entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Code source
COPY . .

EXPOSE 8000

# Run Alembic then API so generation_jobs / organizations / etc. exist on fresh DB.
# No --reload in Docker: bind-mounted src triggers the reloader and drops in-flight requests (ERR_EMPTY_RESPONSE).
ENTRYPOINT ["/entrypoint.sh"]
