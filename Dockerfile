FROM node:20-alpine

# Chromium za Puppeteer (PDF render). Alpine paket je manjsi od puppeteer-jevega
# bundled Chromium-a (~300MB → ~150MB), zato uporabimo puppeteer-core in pokazemo
# na sistemski binary.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Najprej samo package.json — Docker cache trik, da se npm install
# ne pozene vsakic, ko spremenis src/*.js
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Zdaj kopiraj se ostalo
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
