# Gunakan image Node.js ringan
FROM node:22-alpine AS base

WORKDIR /app

# Salin file package.json & lock dan folder patches
COPY package*.json ./
COPY patches ./patches

# Install dependencies (hanya production)
# patch-package akan otomatis jalan di postinstall mencari folder ./patches
RUN npm install --omit=dev

# Salin seluruh source code (server.js, dsb)
COPY . .

# Buka port listener
EXPOSE 8080

# Jalankan server
CMD ["node", "server.js"]
