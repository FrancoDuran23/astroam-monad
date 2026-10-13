# API image for Render (or any container host). No secrets are baked in:
# set the MONAD_* and CITRUS_* values at runtime. See docs/deploy.md.
# Node 22 (>= 22.18, what package.json requires) runs the .ts server directly.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

# Missions and vouchers are JSON files under DATA_DIR; the node user must own it.
RUN mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATA_DIR=/app/data

USER node

EXPOSE 8080

CMD ["npm", "run", "server"]
