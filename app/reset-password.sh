#!/bin/bash
# ============================================================
# Utility untuk reset password user PostgreSQL
# Tidak perlu Node.js modules - langsung pakai psql
# ============================================================
#
# Cara pakai:
#   1. Masuk ke container dulu:
#      docker exec -it express-finger bash
#
#   2. Jalankan script:
#      bash reset-password.sh <username> <new-password>
#
#   Atau langsung dari host:
#      docker exec -it express-finger bash reset-password.sh superadmin admin123
#
# Contoh:
#   docker exec -it express-finger bash reset-password.sh superadmin 9510Asfah210
#
# Script ini otomatis membaca environment variables dari container.
# ============================================================

# Baca dari environment variables (sama seperti yang dipakai aplikasi di container)
DB_USER="${PGUSER:-admin}"
DB_HOST="${PGHOST:-db}"
DB_NAME="${PGDATABASE:-gsi-finger}"
DB_PASS="${PGPASSWORD:-Gsi651admin}"
DB_PORT="${PGPORT:-5432}"

echo "🔍 Database: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

if [ $# -lt 2 ]; then
    echo ""
    echo "Usage: bash reset-password.sh <username> <new-password>"
    echo "Example: bash reset-password.sh superadmin admin123"
    echo ""
    echo "Current database config (from container environment):"
    echo "  PGUSER=$DB_USER"
    echo "  PGPASSWORD=****"
    echo "  PGHOST=$DB_HOST"
    echo "  PGDATABASE=$DB_NAME"
    echo "  PGPORT=$DB_PORT"
    echo ""
    echo "Quick run from host:"
    echo "  docker exec -it express-finger bash reset-password.sh superadmin newpass"
    exit 1
fi

USERNAME="$1"
NEW_PASSWORD="$2"

if [ ${#NEW_PASSWORD} -lt 6 ]; then
    echo "❌ Password must be at least 6 characters"
    exit 1
fi

# Generate SHA256 hash (sama seperti di reset-password.js)
SHA_HASH=$(echo -n "$NEW_PASSWORD" | sha256sum | cut -d' ' -f1)

echo "🔍 Checking user '$USERNAME'..."

# Test koneksi dulu
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Cannot connect to database!"
    echo ""
    echo "Make sure you are running this INSIDE the container:"
    echo "  docker exec -it express-finger bash"
    echo "  bash reset-password.sh $USERNAME $NEW_PASSWORD"
    exit 1
fi

# Check if user exists
USER_EXISTS=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT username FROM users WHERE username = '$USERNAME'" 2>/dev/null)

if [ -z "$USER_EXISTS" ]; then
    echo "❌ User '$USERNAME' not found"
    echo ""
    echo "Available users:"
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT id, username, role FROM users ORDER BY id" 2>/dev/null
    exit 1
fi

# Update password
echo "🔄 Resetting password for '$USERNAME'..."
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "UPDATE users SET password = '$SHA_HASH' WHERE username = '$USERNAME'" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Password for '$USERNAME' has been reset successfully!"
    echo "   New password: $NEW_PASSWORD"
    echo ""
    echo "⚠️  Note: Password will be auto-upgraded to bcrypt on next login."
else
    echo "❌ Failed to reset password."
    exit 1
fi
