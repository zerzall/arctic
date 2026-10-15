# Blast Party keeps every room in one process's memory: run exactly ONE container of this image.
FROM node:22-alpine

# HOST is not set on purpose: the server defaults to 0.0.0.0, which is what a container needs.
ENV NODE_ENV=production PORT=3000
WORKDIR /app

# Dependencies first so this layer is cached until package.json / the lockfile change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY client ./client
COPY server ./server
COPY shared ./shared

# The official image ships an unprivileged `node` user; nothing is written to disk at runtime.
USER node
EXPOSE 3000

# busybox wget is already in alpine. sh -c so ${PORT} is read at run time, in case the platform overrides it.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD sh -c 'wget -qO- http://127.0.0.1:${PORT:-3000}/healthz >/dev/null || exit 1'

# Exec form: node is PID 1 and receives SIGTERM itself, which starts the server's graceful shutdown.
CMD ["node","server/index.js"]
