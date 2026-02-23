# ─────────────────────────────────────────
# Stage 1: Build TypeScript
# ─────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files first (for better Docker cache)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript → dist/
RUN npx tsc

# ─────────────────────────────────────────
# Stage 2: Production runtime
# ─────────────────────────────────────────
FROM node:20-slim

# Install Chromium for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

# Configure Puppeteer to use system Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# Copy built output from builder
COPY --from=builder /app/dist/ ./dist/

# Copy admin frontend
COPY admin/dist/ ./admin/dist/

# Copy template example files (needed for template base HTML loading)
COPY .explicações/ ./.explicações/

# Expose port (default 3000, configurable via PORT env)
EXPOSE 3000

# Mount data volume for SQLite persistence
VOLUME ["/app/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const port = process.env.PORT || 3000; fetch('http://localhost:' + port + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the application
CMD ["node", "dist/index.js"]
