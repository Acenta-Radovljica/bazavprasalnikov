FROM node:20-alpine

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
