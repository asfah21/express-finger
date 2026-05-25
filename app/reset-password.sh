#!/bin/bash
# ============================================================
# Utility untuk reset password user PostgreSQL
# Tidak perlu Node.js modules - langsung pakai psql
# ============================================================
#
# Cara pakai:
#   sudo bash reset-password.sh <username> <new-password>
#
# Contoh:
#   sudo bash reset-password.sh superadmin admin123
#
# Environment variables (atau edit langsung di bawah):
#   PGUSER, PGHOST, PGDATABASE, PGPASSWORD, PGPORT
# ============================================================

# Konfigurasi database (bisa di-override via environment)
DB_USER="${PGUSER:-postgres}"
DB_HOST="${PGHOST:-localhost}"
DB_NAME="${PGDATABASE:-express_finger}"
DB_PASS="${PGPASSWORD:-postgres}"
DB_PORT="${PGPORT:-5432}"

if [ $# -lt 2 ]; then
    echo "Usage: bash reset-password.sh <username> <new-password>"
    echo "Example: bash reset-password.sh superadmin admin123"
    echo ""
    echo "Environment variables:"
    echo "  PGUSER, PGHOST, PGDATABASE, PGPASSWORD, PGPORT"
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

# Check if user exists
USER_EXISTS=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT username FROM users WHERE username = '$USERNAME'" 2>/dev/null | tr -d ' ')

if [ -z "$USER_EXISTS" ]; then
    echo "❌ User '$USERNAME' not found"
    echo ""
    echo "Available users:"
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT username, role FROM users ORDER BY id" 2>/dev/null
    exit 1
fi

# Update password
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "UPDATE users SET password = '$SHA_HASH' WHERE username = '$USERNAME'" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Password for '$USERNAME' has been reset successfully!"
    echo "   New password: $NEW_PASSWORD"
    echo ""
    echo "⚠️  Note: Password will be auto-upgraded to bcrypt on next login."
else
    echo "❌ Failed to reset password. Check database connection."
    exit 1
fi
