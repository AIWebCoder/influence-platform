FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# LF-only script (avoid Windows CRLF on copied .sh breaking exec)
RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -e' \
  'mkdir -p /app/.next/cache /app/.next/static /app/.next/server' \
  'exec "$@"' \
  > /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "dev"]
