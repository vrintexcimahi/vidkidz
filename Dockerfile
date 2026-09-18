# ─── VIDKIDZ — Dockerfile ──────────────────────────────────────────────────
FROM node:20-alpine

# Set timezone Indonesia
ENV TZ=Asia/Jakarta

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY server.js ./
COPY public/ ./public/

# Create data directory for JSON state
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Start server
CMD ["node", "server.js"]
