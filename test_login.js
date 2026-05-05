/**
 * test_login.js
 * Test script to verify bcrypt password verification works
 */

const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

async function testLogins() {
  console.log('🔐 Testing bcrypt password verification...\n');

  // Load users
  const USERS_JSON_PATH = path.join(__dirname, 'users.json');
  const data = JSON.parse(fs.readFileSync(USERS_JSON_PATH, 'utf8'));

  const testCases = [
    { username: 'admin', password: '142536', shouldPass: true },
    { username: 'minhtuan', password: '123456789', shouldPass: true },
    { username: 'vanhuyen', password: '123456', shouldPass: true },
    { username: 'admin', password: 'wrongpassword', shouldPass: false },
    { username: 'minhtuan', password: 'wrongpassword', shouldPass: false },
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const user = data.users.find(u => u.username === testCase.username);
    if (!user) {
      console.log(`❌ User ${testCase.username} not found`);
      failed++;
      continue;
    }

    try {
      const isValid = await bcrypt.compare(testCase.password, user.passwordHash);
      const result = isValid === testCase.shouldPass;

      if (result) {
        console.log(`✅ ${testCase.username} with "${testCase.password}": ${isValid ? 'Login success' : 'Login failed'} (as expected)`);
        passed++;
      } else {
        console.log(`❌ ${testCase.username} with "${testCase.password}": ${isValid ? 'Login success' : 'Login failed'} (NOT expected)`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ Error testing ${testCase.username}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('\n✅ All tests passed! Bcrypt password verification is working correctly.');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  }
}

testLogins();
