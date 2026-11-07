FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY src ./src
COPY scripts ./scripts
RUN node scripts/build.js && mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/app/data/journal.db UPLOAD_DIR=/app/uploads
EXPOSE 8787
VOLUME ["/app/data", "/app/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server/index.js"]
