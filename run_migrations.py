"""
Run database migrations for ASIA LAB
Usage: python run_migrations.py
"""
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "labo_data.db"
MIGRATIONS_DIR = BASE_DIR / "db_migrations"

def run_migrations():
    conn = sqlite3.connect(DB_PATH)

    # Get all .sql files in migrations directory
    migrations = sorted(MIGRATIONS_DIR.glob("*.sql"))

    for migration_file in migrations:
        print(f"Running migration: {migration_file.name}")
        sql = migration_file.read_text(encoding='utf-8')
        conn.executescript(sql)
        print(f"  [OK] {migration_file.name} completed")

    conn.commit()
    conn.close()

    print("\n[SUCCESS] All migrations completed successfully")

    # Verify
    conn = sqlite3.connect(DB_PATH)
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()]
    print(f"\nTables in database: {', '.join(tables)}")

    # Check feedback_types seed data
    count = conn.execute("SELECT COUNT(*) FROM feedback_types").fetchone()[0]
    print(f"Feedback types seeded: {count} types")
    conn.close()

if __name__ == "__main__":
    run_migrations()
