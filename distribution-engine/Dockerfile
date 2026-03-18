FROM node:20-alpine

WORKDIR /app

# Dépendances système pour Playwright/Chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    curl \
    dbus \
    libx11 \
    libxcomposite \
    libxdamage \
    libxext \
    libxfixes \
    libxi \
    libxrender \
    libxtst \
    glib \
    pango \
    at-spi2-core \
    libdrm \
    mesa-gbm

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]
