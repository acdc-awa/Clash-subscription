# Stage 1: Build the React frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/front
COPY front/package.json front/package-lock.json ./
RUN npm install
COPY front/ ./
RUN npm run build

# Stage 2: Build backend dependencies
FROM node:20-slim AS backend-builder
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm install --omit=dev

# Stage 3: Final lightweight runtime image
FROM node:20-slim
WORKDIR /app/backend
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY backend/ .
COPY --from=frontend-builder /app/front/dist /app/front/dist

# Default environment variables
ENV PORT=3000
ENV DB_PATH=/app/data/data.db
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "server.js"]
