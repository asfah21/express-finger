#!/bin/sh
# ============================================================
# Utility untuk reset password user PostgreSQL
# Pakai sh (compatible dengan Alpine Linux di Docker)
# ============================================================
#
# Cara pakai dari HOST:
#   docker exec -it express-finger sh reset-password.sh <username> <new-password>
#
# Contoh:
#   docker exec -it express-finger sh reset-password.sh superadmin 9510Asfah210
# ============================================================

# Baca dari environment variables container
DB_USER="${PGUSER:-admin}"
DB_HOST="${PGHOST:-db}"
DB_NAME="${PGDATABASE:-gsi-finger}"
DB_PASS="${PGPASSWORD:-Gsi651admin}"
DB_PORT="${PGPORT:-5432}"

echo "Database: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

if [ $# -lt 2 ]; then
    echo ""
    echo "Usage: sh reset-password.sh <username> <new-password>"
    echo "Example: sh reset-password.sh superadmin admin123"
    echo ""
    echo "Quick run from HOST:"
    echo "  docker exec -it express-finger sh reset-password.sh superadmin newpass"
    exit 1
fi

USERNAME="$1"
NEW_PASSWORD="$2"

# Check password length
LEN=$(printf "%s" "$NEW_PASSWORD" | wc -c)
if [ "$LEN" -lt 6 ]; then
    echo "Password must be at least 6 characters"
    exit 1
fi

# Generate SHA256 hash
SHA_HASH=$(printf "%s" "$NEW_PASSWORD" | sha256sum | cut -d' ' -f1)

echo "Checking user '$USERNAME'..."

# Cek apakah psql tersedia
if command -v psql > /dev/null 2>&1; then
    echo "Using psql..."
    
    # Test koneksi
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        # Check user
        USER_EXISTS=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT username FROM users WHERE username = '$USERNAME'" 2>/dev/null)
        
        if [ -z "$USER_EXISTS" ]; then
            echo "User '$USERNAME' not found"
            echo ""
            echo "Available users:"
            PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT id, username, role FROM users ORDER BY id" 2>/dev/null
            exit 1
        fi
        
        # Update password
        echo "Resetting password for '$USERNAME'..."
        PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "UPDATE users SET password = '$SHA_HASH' WHERE username = '$USERNAME'" 2>/dev/null
        
        if [ $? -eq 0 ]; then
            echo "Password for '$USERNAME' has been reset successfully!"
            echo "New password: $NEW_PASSWORD"
            echo "Note: Password will be auto-upgraded to bcrypt on next login."
            exit 0
        fi
    fi
    
    echo "psql failed, trying Node.js fallback..."
fi

# Fallback: panggil reset-password.js (ESM) langsung
echo "Using Node.js (reset-password.js)..."
node reset-password.js "$USERNAME" "$NEW_PASSWORD"
