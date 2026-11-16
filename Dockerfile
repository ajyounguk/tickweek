# Build stage: install prod deps (build tools only as a fallback if better-sqlite3 has no prebuilt binary).
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || (apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev --build-from-source)

FROM node:26-slim
ENV NODE_ENV=production \
    TZ=Europe/London \
    APP_TZ=Europe/London \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
