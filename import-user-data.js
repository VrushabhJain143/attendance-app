const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const XLSX = require('./public/lib/xlsx.full.min.js');

const dbPath = path.join(__dirname, 'database.db');
const db = new DatabaseSync(dbPath);

const excelFile = 'C:\\Users\\VICTUS\\OneDrive\\Desktop\\Vrushabh\\Baal Sabha.xlsx';

console.log('Reading Excel file from Desktop...');
const buf = fs.readFileSync(excelFile);
const wb = XLSX.read(buf, { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

console.log(`Found ${data.length} records in Excel sheet.`);

// Truncate tables first
db.exec('DELETE FROM attendance');
db.exec('DELETE FROM students');
console.log('Cleared existing database tables.');

// Prepare statements
const insertStudent = db.prepare(`
  INSERT INTO students (student_id, name, contact_number, address, standard, photo_path)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let count = 0;
db.exec('BEGIN TRANSACTION');
try {
  data.forEach((row, index) => {
    const name = (row.Name || '').toString().trim();
    if (!name) return; // Skip if no name

    const rawNum = row.Number || '';
    const number = rawNum ? rawNum.toString().trim() : '0000000000'; // Fallback if number missing

    const area = (row.Area || '').toString().trim();
    const subAddress = (row.Address || '').toString().trim();
    const address = subAddress ? `${subAddress}, ${area}` : area;

    const standard = area || 'Baal Sabha'; // Map Area to Standard for filtering!

    const studentId = 'STU' + String(index + 1).padStart(3, '0');

    insertStudent.run(studentId, name, number, address, standard, null);
    count++;
  });
  db.exec('COMMIT');
  console.log(`Successfully imported ${count} students!`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('Error during transaction:', err.message);
}

// Sync back to master Excel file
const { syncDatabaseToExcel } = require('./excelSync');
syncDatabaseToExcel();
console.log('Excel file synced successfully!');
