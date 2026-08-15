const fs = require('fs');
const path = require('path');
const XLSX = require('./public/lib/xlsx.full.min.js');
const { db, getNextStudentId } = require('./db');

const excelPath = path.join(__dirname, 'students_attendance.xlsx');

// Sync SQLite database tables to Excel file
function syncDatabaseToExcel() {
  console.log('Syncing database to Excel file: students_attendance.xlsx...');
  try {
    // 1. Fetch Students
    const studentsQuery = db.prepare('SELECT * FROM students ORDER BY student_id ASC');
    const studentsList = studentsQuery.all();
    
    const studentRows = studentsList.map(s => ({
      'Student ID': s.student_id,
      'Name': s.name,
      'Contact Number': s.contact_number,
      'Address': s.address || '',
      'Standard': s.standard,
      'Photo': s.photo_path || ''
    }));

    // 2. Fetch Attendance (join with students to get metadata)
    const attendanceQuery = db.prepare(`
      SELECT 
        a.attendance_date, 
        a.student_id, 
        s.name, 
        s.contact_number, 
        s.standard, 
        a.status
      FROM attendance a
      JOIN students s ON a.student_id = s.student_id
      ORDER BY a.attendance_date DESC, s.student_id ASC
    `);
    const attendanceList = attendanceQuery.all();
    
    const attendanceRows = attendanceList.map(a => ({
      'Date': a.attendance_date,
      'Student ID': a.student_id,
      'Name': a.name,
      'Contact Number': a.contact_number,
      'Standard': a.standard,
      'Attendance': a.status
    }));

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Student Master sheet
    const wsStudents = XLSX.utils.json_to_sheet(studentRows);
    XLSX.utils.book_append_sheet(wb, wsStudents, 'Student Master');

    // Attendance sheet
    const wsAttendance = XLSX.utils.json_to_sheet(attendanceRows);
    XLSX.utils.book_append_sheet(wb, wsAttendance, 'Attendance');

    // Write file
    const excelBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    fs.writeFileSync(excelPath, Buffer.from(excelBuf));
    console.log('Excel sync successful!');
    return true;
  } catch (error) {
    console.error('Error syncing database to Excel:', error.message);
    return false;
  }
}

// Import students from an uploaded Excel/CSV file (buffer-based)
function importStudentsFromExcelBuffer(fileBuffer) {
  console.log('Parsing imported Excel file buffer...');
  try {
    const wb = XLSX.read(fileBuffer, { type: 'buffer' });
    
    // Find Student sheet or default to first sheet
    const sheetName = wb.SheetNames.find(name => name.toLowerCase().includes('student')) || wb.SheetNames[0];
    if (!sheetName) throw new Error('No sheets found in Excel file.');
    
    const ws = wb.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(ws);
    
    if (rawData.length === 0) throw new Error('Excel sheet is empty.');

    // Map column names flexibly (case-insensitive and partial matches)
    const headers = Object.keys(rawData[0]);
    const nameKey = headers.find(h => h.toLowerCase() === 'name' || h.toLowerCase().includes('student name'));
    const phoneKey = headers.find(h => h.toLowerCase().includes('contact') || h.toLowerCase().includes('phone') || h.toLowerCase().includes('number'));
    const addressKey = headers.find(h => h.toLowerCase().includes('address'));
    const standardKey = headers.find(h => h.toLowerCase().includes('standard') || h.toLowerCase().includes('class'));
    
    if (!nameKey || !phoneKey) {
      throw new Error(`Invalid columns. Required columns: "Name" and "Contact Number". Found: ${headers.join(', ')}`);
    }

    let importedCount = 0;
    let duplicateCount = 0;

    // Start transaction for speed and safety
    db.exec('BEGIN TRANSACTION');
    
    try {
      const checkExists = db.prepare('SELECT student_id FROM students WHERE name = ? AND contact_number = ?');
      const insertStudent = db.prepare(`
        INSERT INTO students (student_id, name, contact_number, address, standard, photo_path)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const row of rawData) {
        const name = (row[nameKey] || '').toString().trim();
        const contact = (row[phoneKey] || '').toString().trim();
        const address = addressKey ? (row[addressKey] || '').toString().trim() : '';
        const standard = standardKey ? (row[standardKey] || 'Nursery').toString().trim() : 'Nursery';

        if (!name || !contact) continue; // Skip incomplete records

        // Check if student already exists with this exact name and phone
        const existing = checkExists.get(name, contact);
        if (existing) {
          duplicateCount++;
          continue;
        }

        const studentId = getNextStudentId();
        insertStudent.run(studentId, name, contact, address, standard, null);
        importedCount++;
      }
      
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    console.log(`Excel import successful! Imported: ${importedCount}, Duplicates skipped: ${duplicateCount}`);
    
    // Sync database back to Excel to update the workbook
    syncDatabaseToExcel();

    return { success: true, importedCount, duplicateCount };
  } catch (error) {
    console.error('Error importing Excel file:', error.message);
    return { success: false, error: error.message };
  }
}

// Generate a binary Excel buffer from filtered records
function generateFilteredExcelBuffer(records) {
  const ws = XLSX.utils.json_to_sheet(records);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Exported Logs');
  const excelBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return Buffer.from(excelBuf);
}

module.exports = {
  syncDatabaseToExcel,
  importStudentsFromExcelBuffer,
  generateFilteredExcelBuffer
};
