# Stage 1: Build dependencies and compile better-sqlite3
FROM node:20-slim AS builder

# Install build tools for native SQLite bindings compilation
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./

RUN npm install --omit=dev

# Stage 2: Final lightweight runtime image
FROM node:20-slim

WORKDIR /app

# Copy compiled node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Default environment variables
ENV PORT=3000
ENV DB_PATH=/app/data/data.db
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
