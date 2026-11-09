# Cloudflare Containers require linux/amd64 images.
FROM --platform=linux/amd64 oven/bun:1.3
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
ENV NODE_ENV=production
CMD ["bun", "run", "src/index.ts"]
