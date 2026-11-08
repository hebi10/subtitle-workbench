FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /data && chown node:node /data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY *.mjs ./
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 REVIEW_DB_PATH=/data/usage.sqlite
EXPOSE 8080
CMD ["node", "main.mjs"]
