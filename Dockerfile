# Gunakan image Node.js ringan
FROM node:22-alpine AS base

WORKDIR /app

# Salin file package.json & lock
COPY package*.json ./

# Install dependencies (hanya production)
RUN npm install --omit=dev

# Salin seluruh source code (server.js, dsb)
COPY . .

# Buka port listener
EXPOSE 8080

# Jalankan server
CMD ["node", "server.js"]
