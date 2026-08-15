const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, initDatabase, hashPassword, getNextStudentId } = require('./db');
const { syncDatabaseToExcel, importStudentsFromExcelBuffer } = require('./excelSync');

// Initialize SQLite DB
initDatabase();
// Initial Sync to ensure students_attendance.xlsx is up-to-date
syncDatabaseToExcel();

const PORT = 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Active sessions: token -> { username, role, expires }
const sessions = new Map();

// Helper to parse cookies
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
}

// Helper to check authentication and roles
function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.session_token;
  if (!token) return null;
  
  const session = sessions.get(token);
  if (!session) return null;
  
  if (Date.now() > session.expires) {
    sessions.delete(token);
    return null;
  }
  
  // Extend session expiry
  session.expires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  return session;
}

// Helper to read JSON request body
function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

// Helper to respond with JSON
function sendJSON(res, data, statusCode = 200, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...headers
  });
  res.end(JSON.stringify(data));
}

// Server Request Handler
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  console.log(`${method} ${pathname}`);

  // Serve master Excel file directly from root directory
  if (pathname === '/students_attendance.xlsx') {
    const filePath = path.join(__dirname, 'students_attendance.xlsx');
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Excel file not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="students_attendance.xlsx"',
        'Content-Length': stats.size
      });
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  // 1. Static Files Serving
  if (!pathname.startsWith('/api/')) {
    // Determine path
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    
    // Check if it's an uploaded photo
    if (pathname.startsWith('/uploads/')) {
      filePath = path.join(__dirname, pathname);
    }

    // Security check: ensure path is within allowed directories
    const relativePublic = path.relative(PUBLIC_DIR, filePath);
    const relativeUploads = path.relative(UPLOADS_DIR, filePath);
    const isSafe = !relativePublic.startsWith('..') || !relativeUploads.startsWith('..');

    if (!isSafe) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // Check if file exists, if not fallback to index.html for SPA routing
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // If file doesn't exist and is not a request for a resource, serve index.html (SPA Fallback)
        if (!pathname.includes('.')) {
          filePath = path.join(PUBLIC_DIR, 'index.html');
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }
      }

      // Content-type mapping
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
      };

      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  // 2. API Endpoints
  
  // -- AUTH ENDPOINTS --
  
  // POST /api/auth/login
  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      const { username, password } = await getRequestBody(req);
      if (!username || !password) {
        return sendJSON(res, { error: 'Username and password required' }, 400);
      }

      const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
      const user = stmt.get(username);

      if (!user) {
        return sendJSON(res, { error: 'Invalid username or password' }, 401);
      }

      const hash = hashPassword(password, user.salt);
      if (hash !== user.password_hash) {
        return sendJSON(res, { error: 'Invalid username or password' }, 401);
      }

      // Create Session
      const token = crypto.randomBytes(32).toString('hex');
      const expires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
      sessions.set(token, { username: user.username, role: user.role, expires });

      const cookie = `session_token=${token}; HttpOnly; Path=/; Max-Age=${24 * 60 * 60}; SameSite=Strict`;
      return sendJSON(res, { success: true, user: { username: user.username, role: user.role } }, 200, {
        'Set-Cookie': cookie
      });
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // POST /api/auth/logout
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.session_token;
    if (token) {
      sessions.delete(token);
    }
    const expiredCookie = `session_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`;
    return sendJSON(res, { success: true }, 200, { 'Set-Cookie': expiredCookie });
  }

  // GET /api/auth/session
  if (pathname === '/api/auth/session' && method === 'GET') {
    const session = getSession(req);
    if (!session) {
      return sendJSON(res, { loggedIn: false }, 200);
    }
    return sendJSON(res, { loggedIn: true, user: { username: session.username, role: session.role } }, 200);
  }

  // -- PROTECTED API CHECK --
  const session = getSession(req);
  if (!session) {
    return sendJSON(res, { error: 'Unauthorized. Please login.' }, 401);
  }
  const isAdmin = session.role === 'admin';

  // -- STUDENTS API --

  // GET /api/students
  if (pathname === '/api/students' && method === 'GET') {
    try {
      const search = parsedUrl.searchParams.get('search') || '';
      const standard = parsedUrl.searchParams.get('standard') || '';
      
      let queryStr = 'SELECT * FROM students WHERE 1=1';
      const params = [];

      if (search) {
        queryStr += ' AND (name LIKE ? OR contact_number LIKE ? OR student_id LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (standard) {
        queryStr += ' AND standard = ?';
        params.push(standard);
      }
      queryStr += ' ORDER BY student_id ASC';

      const stmt = db.prepare(queryStr);
      const students = stmt.all(...params);
      return sendJSON(res, students, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // POST /api/students (Admin Only)
  if (pathname === '/api/students' && method === 'POST') {
    if (!isAdmin) return sendJSON(res, { error: 'Forbidden. Admin privileges required.' }, 403);
    try {
      const { name, contact_number, address, standard, photo_base64 } = await getRequestBody(req);
      if (!name || !contact_number || !standard) {
        return sendJSON(res, { error: 'Name, contact number and standard are required' }, 400);
      }

      // Validate phone number format (must be numeric/spaces/symbols, min 8 chars)
      const phoneRegex = /^[0-9+\s\-()]{8,15}$/;
      if (!phoneRegex.test(contact_number.trim())) {
        return sendJSON(res, { error: 'Invalid contact number format. Use 8-15 digits.' }, 400);
      }

      // Check for duplicates
      const checkExists = db.prepare('SELECT student_id FROM students WHERE name = ? AND contact_number = ?');
      if (checkExists.get(name.trim(), contact_number.trim())) {
        return sendJSON(res, { error: 'Student with this name and contact number already exists.' }, 400);
      }

      const studentId = getNextStudentId();
      let photoPath = null;

      // Handle photo uploading (base64 string to file)
      if (photo_base64) {
        const matches = photo_base64.match(/^data:image\/([A-Za-z+]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const dataBuffer = Buffer.from(matches[2], 'base64');
          const photoName = `${studentId}_${Date.now()}.${ext}`;
          photoPath = `/uploads/${photoName}`;
          fs.writeFileSync(path.join(UPLOADS_DIR, photoName), dataBuffer);
        }
      }

      const insert = db.prepare(`
        INSERT INTO students (student_id, name, contact_number, address, standard, photo_path)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insert.run(studentId, name.trim(), contact_number.trim(), (address || '').trim(), standard, photoPath);

      // Sync to Excel
      syncDatabaseToExcel();

      return sendJSON(res, { success: true, student_id: studentId, message: 'Student added successfully.' }, 201);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // PUT /api/students (Admin Only)
  if (pathname === '/api/students' && method === 'PUT') {
    if (!isAdmin) return sendJSON(res, { error: 'Forbidden. Admin privileges required.' }, 403);
    try {
      const { student_id, name, contact_number, address, standard, photo_base64 } = await getRequestBody(req);
      if (!student_id || !name || !contact_number || !standard) {
        return sendJSON(res, { error: 'Missing required student details.' }, 400);
      }

      // Validate phone number format
      const phoneRegex = /^[0-9+\s\-()]{8,15}$/;
      if (!phoneRegex.test(contact_number.trim())) {
        return sendJSON(res, { error: 'Invalid contact number format.' }, 400);
      }

      // Fetch existing student details
      const fetchStmt = db.prepare('SELECT photo_path FROM students WHERE student_id = ?');
      const student = fetchStmt.get(student_id);
      if (!student) {
        return sendJSON(res, { error: 'Student not found.' }, 404);
      }

      let photoPath = student.photo_path;

      // Handle new photo upload if provided
      if (photo_base64) {
        const matches = photo_base64.match(/^data:image\/([A-Za-z+]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const dataBuffer = Buffer.from(matches[2], 'base64');
          const photoName = `${student_id}_${Date.now()}.${ext}`;
          
          // Delete old photo file if it exists
          if (student.photo_path) {
            const oldPath = path.join(__dirname, student.photo_path);
            if (fs.existsSync(oldPath)) {
              try { fs.unlinkSync(oldPath); } catch(e) {}
            }
          }

          photoPath = `/uploads/${photoName}`;
          fs.writeFileSync(path.join(UPLOADS_DIR, photoName), dataBuffer);
        }
      }

      const update = db.prepare(`
        UPDATE students 
        SET name = ?, contact_number = ?, address = ?, standard = ?, photo_path = ?
        WHERE student_id = ?
      `);
      update.run(name.trim(), contact_number.trim(), (address || '').trim(), standard, photoPath, student_id);

      // Sync to Excel
      syncDatabaseToExcel();

      return sendJSON(res, { success: true, message: 'Student updated successfully.' }, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // DELETE /api/students (Admin Only)
  if (pathname === '/api/students' && method === 'DELETE') {
    if (!isAdmin) return sendJSON(res, { error: 'Forbidden. Admin privileges required.' }, 403);
    try {
      const studentId = parsedUrl.searchParams.get('student_id');
      if (!studentId) {
        return sendJSON(res, { error: 'Student ID required.' }, 400);
      }

      // Fetch photo details to delete file
      const fetchStmt = db.prepare('SELECT photo_path FROM students WHERE student_id = ?');
      const student = fetchStmt.get(studentId);
      if (!student) {
        return sendJSON(res, { error: 'Student not found.' }, 404);
      }

      // Delete student photo file
      if (student.photo_path) {
        const photoPath = path.join(__dirname, student.photo_path);
        if (fs.existsSync(photoPath)) {
          try { fs.unlinkSync(photoPath); } catch (e) {}
        }
      }

      // Delete student from DB (cascades to attendance)
      const deleteStmt = db.prepare('DELETE FROM students WHERE student_id = ?');
      deleteStmt.run(studentId);

      // Sync to Excel
      syncDatabaseToExcel();

      return sendJSON(res, { success: true, message: 'Student and attendance records deleted.' }, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // GET /api/students/profile
  if (pathname === '/api/students/profile' && method === 'GET') {
    try {
      const studentId = parsedUrl.searchParams.get('student_id');
      if (!studentId) return sendJSON(res, { error: 'Student ID required' }, 400);

      const studentStmt = db.prepare('SELECT * FROM students WHERE student_id = ?');
      const student = studentStmt.get(studentId);

      if (!student) return sendJSON(res, { error: 'Student not found' }, 404);

      // Attendance history
      const historyStmt = db.prepare(`
        SELECT attendance_date, status, marked_at
        FROM attendance
        WHERE student_id = ?
        ORDER BY attendance_date DESC
      `);
      const history = historyStmt.all(studentId);

      // Calculate totals
      const totalClasses = history.length;
      const present = history.filter(h => h.status === 'Present').length;
      const absent = history.filter(h => h.status === 'Absent').length;
      const pct = totalClasses > 0 ? Math.round((present / totalClasses) * 100) : 100;

      return sendJSON(res, {
        student,
        summary: {
          totalClasses,
          present,
          absent,
          percentage: pct
        },
        history
      }, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // -- ATTENDANCE API --

  // GET /api/attendance
  // Returns marked attendance list for a specific date
  if (pathname === '/api/attendance' && method === 'GET') {
    try {
      const date = parsedUrl.searchParams.get('date');
      if (!date) return sendJSON(res, { error: 'Date is required (YYYY-MM-DD)' }, 400);

      const stmt = db.prepare(`
        SELECT student_id, status 
        FROM attendance 
        WHERE attendance_date = ?
      `);
      const marked = stmt.all(date);
      
      // Convert to map { student_id: status }
      const markedMap = {};
      marked.forEach(m => {
        markedMap[m.student_id] = m.status;
      });

      return sendJSON(res, markedMap, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // POST /api/attendance/mark
  if (pathname === '/api/attendance/mark' && method === 'POST') {
    try {
      const { date, student_ids, status } = await getRequestBody(req);
      if (!date || !student_ids || !Array.isArray(student_ids) || !status) {
        return sendJSON(res, { error: 'Date, student IDs, and status are required' }, 400);
      }
      if (student_ids.length === 0) {
        return sendJSON(res, { error: 'Please select at least one student.' }, 400);
      }

      // Check if student_ids exist
      const checkStmt = db.prepare('SELECT name FROM students WHERE student_id = ?');
      for (const id of student_ids) {
        if (!checkStmt.get(id)) {
          return sendJSON(res, { error: `Student with ID ${id} does not exist.` }, 400);
        }
      }

      // Insert/replace attendance
      db.exec('BEGIN TRANSACTION');
      let successCount = 0;
      try {
        const insertStmt = db.prepare(`
          INSERT INTO attendance (attendance_date, student_id, status, marked_by)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(attendance_date, student_id) DO UPDATE SET
            status = excluded.status,
            marked_by = excluded.marked_by,
            marked_at = CURRENT_TIMESTAMP
        `);
        for (const id of student_ids) {
          insertStmt.run(date, id, status, session.username);
          successCount++;
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      // Sync to Excel
      syncDatabaseToExcel();

      return sendJSON(res, {
        success: true,
        message: `${successCount} students marked ${status} for ${date}.`
      }, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // POST /api/attendance/mark-remaining-absent
  if (pathname === '/api/attendance/mark-remaining-absent' && method === 'POST') {
    try {
      const { date } = await getRequestBody(req);
      if (!date) return sendJSON(res, { error: 'Date is required.' }, 400);

      // Find all students not marked on this date
      const unmarkedQuery = db.prepare(`
        SELECT student_id FROM students 
        WHERE student_id NOT IN (
          SELECT student_id FROM attendance WHERE attendance_date = ?
        )
      `);
      const unmarkedStudents = unmarkedQuery.all(date);

      if (unmarkedStudents.length === 0) {
        return sendJSON(res, { success: true, message: 'All students are already marked for this date.', count: 0 }, 200);
      }

      db.exec('BEGIN TRANSACTION');
      let count = 0;
      try {
        const insertStmt = db.prepare(`
          INSERT INTO attendance (attendance_date, student_id, status, marked_by)
          VALUES (?, ?, 'Absent', ?)
        `);
        for (const s of unmarkedStudents) {
          insertStmt.run(date, s.student_id, session.username);
          count++;
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      // Sync to Excel
      syncDatabaseToExcel();

      return sendJSON(res, {
        success: true,
        message: `Marked remaining ${count} students as Absent for ${date}.`,
        count
      }, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // DELETE /api/attendance (Admin Only)
  if (pathname === '/api/attendance' && method === 'DELETE') {
    if (!isAdmin) return sendJSON(res, { error: 'Forbidden. Admin privileges required.' }, 403);
    try {
      const studentId = parsedUrl.searchParams.get('student_id');
      const date = parsedUrl.searchParams.get('date');
      if (!studentId || !date) {
        return sendJSON(res, { error: 'student_id and date are required.' }, 400);
      }

      db.prepare('DELETE FROM attendance WHERE student_id = ? AND attendance_date = ?').run(studentId, date);
      
      // Sync to Excel
      syncDatabaseToExcel();

      return sendJSON(res, { success: true, message: 'Attendance record cleared.' }, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // GET /api/analytics
  if (pathname === '/api/analytics' && method === 'GET') {
    try {
      const date = parsedUrl.searchParams.get('date');
      if (!date) return sendJSON(res, { error: 'Date required' }, 400);

      // Total Students
      const totalStudents = db.prepare('SELECT COUNT(*) as count FROM students').get().count;

      // Present Today
      const presentToday = db.prepare(`
        SELECT COUNT(*) as count FROM attendance 
        WHERE attendance_date = ? AND status = 'Present'
      `).get(date).count;

      // Absent Today
      const absentToday = db.prepare(`
        SELECT COUNT(*) as count FROM attendance 
        WHERE attendance_date = ? AND status = 'Absent'
      `).get(date).count;

      const notMarked = totalStudents - (presentToday + absentToday);

      return sendJSON(res, {
        totalStudents,
        presentToday,
        absentToday,
        notMarked
      }, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // GET /api/attendance/history-report
  // Admin-only history dashboard endpoint
  if (pathname === '/api/attendance/history-report' && method === 'GET') {
    if (!isAdmin) return sendJSON(res, { error: 'Forbidden' }, 403);
    try {
      const date = parsedUrl.searchParams.get('date');
      const standard = parsedUrl.searchParams.get('standard') || '';
      if (!date) return sendJSON(res, { error: 'Date is required.' }, 400);

      // Query database for all students and join their attendance status on that date
      let queryStr = `
        SELECT 
          s.student_id, 
          s.name, 
          s.contact_number, 
          s.standard, 
          COALESCE(a.status, 'Not Marked') as status
        FROM students s
        LEFT JOIN attendance a ON s.student_id = a.student_id AND a.attendance_date = ?
        WHERE 1=1
      `;
      const params = [date];

      if (standard) {
        queryStr += ' AND s.standard = ?';
        params.push(standard);
      }
      queryStr += ' ORDER BY s.student_id ASC';

      const records = db.prepare(queryStr).all(...params);

      // Summarize
      const total = records.length;
      const present = records.filter(r => r.status === 'Present').length;
      const absent = records.filter(r => r.status === 'Absent').length;
      const notMarked = records.filter(r => r.status === 'Not Marked').length;
      const pct = total > 0 ? Math.round((present / (present + absent || 1)) * 100) : 100;

      return sendJSON(res, {
        summary: {
          total,
          present,
          absent,
          notMarked,
          percentage: pct
        },
        records
      }, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // POST /api/students/import (Admin Only)
  if (pathname === '/api/students/import' && method === 'POST') {
    if (!isAdmin) return sendJSON(res, { error: 'Forbidden. Admin privileges required.' }, 403);
    try {
      const { base64, filename } = await getRequestBody(req);
      if (!base64) {
        return sendJSON(res, { error: 'Excel file base64 data required' }, 400);
      }

      const fileBuffer = Buffer.from(base64, 'base64');
      const result = importStudentsFromExcelBuffer(fileBuffer);

      if (result.success) {
        return sendJSON(res, result, 200);
      } else {
        return sendJSON(res, { error: result.error }, 400);
      }
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // GET /api/attendance/export-data (Admin Only)
  // Fetches filtered raw attendance logs to download as Excel
  if (pathname === '/api/attendance/export-data' && method === 'GET') {
    if (!isAdmin) return sendJSON(res, { error: 'Forbidden' }, 403);
    try {
      const startDate = parsedUrl.searchParams.get('startDate') || '';
      const endDate = parsedUrl.searchParams.get('endDate') || '';
      const standard = parsedUrl.searchParams.get('standard') || '';
      const status = parsedUrl.searchParams.get('status') || '';
      const studentId = parsedUrl.searchParams.get('studentId') || '';

      let queryStr = `
        SELECT 
          a.attendance_date as Date,
          a.student_id as [Student ID],
          s.name as Name,
          s.contact_number as [Contact Number],
          s.standard as Standard,
          a.status as Attendance
        FROM attendance a
        JOIN students s ON a.student_id = s.student_id
        WHERE 1=1
      `;
      const params = [];

      if (startDate) {
        queryStr += ' AND a.attendance_date >= ?';
        params.push(startDate);
      }
      if (endDate) {
        queryStr += ' AND a.attendance_date <= ?';
        params.push(endDate);
      }
      if (standard) {
        queryStr += ' AND s.standard = ?';
        params.push(standard);
      }
      if (status) {
        queryStr += ' AND a.status = ?';
        params.push(status);
      }
      if (studentId) {
        queryStr += ' AND a.student_id = ?';
        params.push(studentId);
      }

      queryStr += ' ORDER BY a.attendance_date DESC, s.student_id ASC';

      const data = db.prepare(queryStr).all(...params);
      return sendJSON(res, data, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // GET /api/attendance/export (Admin Only)
  // Generates and downloads the filtered Excel report directly on the server
  if (pathname === '/api/attendance/export' && method === 'GET') {
    if (!isAdmin) return sendJSON(res, { error: 'Forbidden' }, 403);
    try {
      const startDate = parsedUrl.searchParams.get('startDate') || '';
      const endDate = parsedUrl.searchParams.get('endDate') || '';
      const standard = parsedUrl.searchParams.get('standard') || '';
      const status = parsedUrl.searchParams.get('status') || '';
      const studentId = parsedUrl.searchParams.get('studentId') || '';

      let queryStr = `
        SELECT 
          a.attendance_date as Date,
          a.student_id as [Student ID],
          s.name as Name,
          s.contact_number as [Contact Number],
          s.standard as Standard,
          a.status as Attendance
        FROM attendance a
        JOIN students s ON a.student_id = s.student_id
        WHERE 1=1
      `;
      const params = [];

      if (startDate) {
        queryStr += ' AND a.attendance_date >= ?';
        params.push(startDate);
      }
      if (endDate) {
        queryStr += ' AND a.attendance_date <= ?';
        params.push(endDate);
      }
      if (standard) {
        queryStr += ' AND s.standard = ?';
        params.push(standard);
      }
      if (status) {
        queryStr += ' AND a.status = ?';
        params.push(status);
      }
      if (studentId) {
        queryStr += ' AND a.student_id = ?';
        params.push(studentId);
      }

      queryStr += ' ORDER BY a.attendance_date DESC, s.student_id ASC';

      const data = db.prepare(queryStr).all(...params);
      
      const { generateFilteredExcelBuffer } = require('./excelSync');
      const buffer = generateFilteredExcelBuffer(data);
      
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Attendance_Report_${startDate || 'all'}.xlsx"`,
        'Content-Length': buffer.length
      });
      res.end(buffer);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // -- USER MANAGEMENT API (Admin Only) --
  
  // GET /api/users
  if (pathname === '/api/users' && method === 'GET') {
    if (!isAdmin) return sendJSON(res, { error: 'Forbidden' }, 403);
    try {
      const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username ASC').all();
      return sendJSON(res, users, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // POST /api/users
  if (pathname === '/api/users' && method === 'POST') {
    if (!isAdmin) return sendJSON(res, { error: 'Forbidden' }, 403);
    try {
      const { username, password, role, id } = await getRequestBody(req);
      if (!username || !role) {
        return sendJSON(res, { error: 'Username and role are required' }, 400);
      }

      if (id) {
        // Edit User
        if (password) {
          // Change password
          const salt = crypto.randomBytes(16).toString('hex');
          const hash = hashPassword(password, salt);
          db.prepare('UPDATE users SET username = ?, password_hash = ?, salt = ?, role = ? WHERE id = ?')
            .run(username.trim(), hash, salt, role, id);
        } else {
          // Keep password
          db.prepare('UPDATE users SET username = ?, role = ? WHERE id = ?')
            .run(username.trim(), role, id);
        }
        return sendJSON(res, { success: true, message: 'User updated successfully.' }, 200);
      } else {
        // Add User
        if (!password) return sendJSON(res, { error: 'Password is required for new users.' }, 400);
        
        // Check if exists
        const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
        if (exists) return sendJSON(res, { error: 'Username already exists.' }, 400);

        const salt = crypto.randomBytes(16).toString('hex');
        const hash = hashPassword(password, salt);
        db.prepare('INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, ?)')
          .run(username.trim(), hash, salt, role);

        return sendJSON(res, { success: true, message: 'User added successfully.' }, 201);
      }
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // DELETE /api/users
  if (pathname === '/api/users' && method === 'DELETE') {
    if (!isAdmin) return sendJSON(res, { error: 'Forbidden' }, 403);
    try {
      const id = parsedUrl.searchParams.get('id');
      if (!id) return sendJSON(res, { error: 'User ID is required.' }, 400);

      // Prevent admin deleting themselves
      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
      if (user && user.username === session.username) {
        return sendJSON(res, { error: 'You cannot delete your own account.' }, 400);
      }

      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return sendJSON(res, { success: true, message: 'User deleted.' }, 200);
    } catch (error) {
      return sendJSON(res, { error: error.message }, 500);
    }
  }

  // If no API routes matched
  return sendJSON(res, { error: 'Not Found' }, 404);
});

// Start listening
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser.`);
});
