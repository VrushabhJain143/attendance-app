const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.db');
const db = new DatabaseSync(dbPath);

// Initialize DB schema
function initDatabase() {
  console.log('Initializing SQLite database schema...');

  // Create Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Students Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      student_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact_number TEXT NOT NULL,
      address TEXT,
      standard TEXT NOT NULL,
      photo_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Attendance Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      attendance_date TEXT NOT NULL, -- YYYY-MM-DD
      student_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Present', 'Absent')),
      marked_by TEXT,
      marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (attendance_date, student_id),
      FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
    )
  `);

  // Seed default users if users table is empty
  const countUsersStmt = db.prepare('SELECT COUNT(*) as count FROM users');
  const userCount = countUsersStmt.get().count;

  if (userCount === 0) {
    console.log('Seeding default users...');
    seedUser('admin', 'admin123', 'admin');
    seedUser('user', 'user123', 'user');
  }

}

// Password hashing utility
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

// Seed user helper
function seedUser(username, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, salt, role)
    VALUES (?, ?, ?, ?)
  `);
  insertUser.run(username, passwordHash, salt, role);
  console.log(`Seeded user: ${username} (${role})`);
}

// Seed student helper
function seedStudent(id, name, phone, address, standard, photoPath) {
  const insertStudent = db.prepare(`
    INSERT INTO students (student_id, name, contact_number, address, standard, photo_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertStudent.run(id, name, phone, address, standard, photoPath);
}

// Generate next Student ID (e.g. STU001 -> STU002)
function getNextStudentId() {
  const query = db.prepare('SELECT student_id FROM students ORDER BY student_id DESC LIMIT 1');
  const lastRow = query.get();
  
  if (!lastRow) {
    return 'STU001';
  }
  
  const lastId = lastRow.student_id;
  const match = lastId.match(/^STU(\d+)$/);
  if (match) {
    const nextNum = parseInt(match[1], 10) + 1;
    return 'STU' + String(nextNum).padStart(3, '0');
  }
  
  // Fallback if formatting differs
  return 'STU' + Date.now();
}

module.exports = {
  db,
  initDatabase,
  hashPassword,
  getNextStudentId
};
