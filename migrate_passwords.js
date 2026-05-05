/**
 * migrate_passwords.js
 *
 * One-time migration script to hash all plaintext passwords in users.json
 * Usage: node migrate_passwords.js
 *
 * This script:
 * 1. Reads users.json with plaintext passwords
 * 2. Hashes each password using bcrypt
 * 3. Saves updated users.json with passwordHash field
 * 4. Keeps a backup of the original file
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const USERS_JSON_PATH = path.join(__dirname, 'users.json');
const BACKUP_PATH = path.join(__dirname, 'users.json.backup');

async function migratePasswords() {
  try {
    console.log('🔐 Starting password migration...\n');

    // Check if users.json exists
    if (!fs.existsSync(USERS_JSON_PATH)) {
      console.error('❌ users.json not found!');
      process.exit(1);
    }

    // Read current users.json
    const data = JSON.parse(fs.readFileSync(USERS_JSON_PATH, 'utf8'));
    console.log(`📋 Found ${data.users.length} user(s) to migrate\n`);

    // Create backup
    fs.copyFileSync(USERS_JSON_PATH, BACKUP_PATH);
    console.log(`✅ Backup created: users.json.backup\n`);

    // Hash each password
    const migratedUsers = [];
    for (const user of data.users) {
      try {
        // Check if already hashed (starts with $2b$)
        if (user.passwordHash && user.passwordHash.startsWith('$2b$')) {
          console.log(`⏭️  ${user.username}: already hashed, skipping`);
          migratedUsers.push(user);
          continue;
        }

        // Hash the plaintext password
        const password = user.password;
        if (!password) {
          console.error(`❌ ${user.username}: no password found!`);
          process.exit(1);
        }

        const passwordHash = await bcrypt.hash(password, 10);
        console.log(`✅ ${user.username}: password hashed`);

        migratedUsers.push({
          username: user.username,
          passwordHash,
          role: user.role || 'user',
          cong_doan: user.cong_doan || '',
        });
      } catch (err) {
        console.error(`❌ Error hashing password for ${user.username}: ${err.message}`);
        process.exit(1);
      }
    }

    // Write updated users.json
    fs.writeFileSync(
      USERS_JSON_PATH,
      JSON.stringify({ users: migratedUsers }, null, 2)
    );

    console.log(`\n✅ Migration complete! users.json updated with hashed passwords`);
    console.log(`⚠️  Old passwords are no longer stored (this is good for security!)`);
    console.log(`📦 Backup saved as: users.json.backup`);
    console.log(`\n🚀 Server is ready to use with bcrypt password verification`);
  } catch (err) {
    console.error(`❌ Migration failed: ${err.message}`);
    process.exit(1);
  }
}

migratePasswords();
