# Built from the repository root: docker build -f server/Dockerfile .
FROM node:22-alpine
WORKDIR /app
# The game engine is the plugin's own
COPY poke-idle-cc/hooks/game ./engine
COPY poke-idle-cc/hooks/data ./data-gen
RUN sed -i "s#'../data/#'../data-gen/#g" engine/*.js
COPY server/server.js server/package.json ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_NO_WARNINGS=1 DB_PATH=/app/data/pokeidle.db PORT=8090
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8090/health || exit 1
CMD ["node", "server.js"]
