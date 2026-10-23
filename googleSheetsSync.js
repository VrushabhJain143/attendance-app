const https = require('https');

// Read webhook URL from environment variable or fallback
const GOOGLE_SHEET_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';

/**
 * Send payload to Google Apps Script Webhook
 * @param {Object} payload 
 */
function sendToGoogleSheets(payload) {
  if (!GOOGLE_SHEET_WEBHOOK_URL) {
    console.log('[GoogleSheets] No GOOGLE_SHEETS_WEBHOOK_URL set. Skipping sheet sync.');
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const dataString = JSON.stringify(payload);
      const url = new URL(GOOGLE_SHEET_WEBHOOK_URL);

      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(dataString)
        }
      };

      // Follow redirect if Google Apps Script responds with 302
      function makeRequest(reqOptions, postData) {
        const req = https.request(reqOptions, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location);
            const redirectOptions = {
              hostname: redirectUrl.hostname,
              path: redirectUrl.pathname + redirectUrl.search,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
              }
            };
            makeRequest(redirectOptions, postData);
            return;
          }

          let responseData = '';
          res.on('data', chunk => responseData += chunk);
          res.on('end', () => {
            console.log('[GoogleSheets] Synced successfully to Google Sheets.');
            resolve({ success: true, response: responseData });
          });
        });

        req.on('error', (err) => {
          console.error('[GoogleSheets] Webhook error:', err.message);
          resolve({ success: false, error: err.message });
        });

        req.write(postData);
        req.end();
      }

      makeRequest(options, dataString);
    } catch (err) {
      console.error('[GoogleSheets] Error preparing webhook request:', err.message);
      resolve({ success: false, error: err.message });
    }
  });
}

/**
 * Sync marked attendance records to Google Sheets
 */
function syncAttendanceToGoogleSheets(records) {
  if (!records || records.length === 0) return;
  return sendToGoogleSheets({
    type: 'attendance',
    records: records
  });
}

/**
 * Sync newly registered student to Google Sheets
 */
function syncStudentToGoogleSheets(student) {
  if (!student) return;
  return sendToGoogleSheets({
    type: 'student',
    ...student
  });
}

/**
 * Pull attendance records from Google Sheets and restore into SQLite database
 * @param {Object} db - SQLite database instance
 */
function restoreAttendanceFromGoogleSheets(db) {
  if (!GOOGLE_SHEET_WEBHOOK_URL) {
    return Promise.resolve(false);
  }

  console.log('[GoogleSheets] Fetching existing attendance records from Google Sheets...');

  return new Promise((resolve) => {
    function fetchUrl(targetUrl) {
      https.get(targetUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchUrl(res.headers.location);
          return;
        }

        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.records && Array.isArray(data.records) && data.records.length > 0) {
              const insertStmt = db.prepare(`
                INSERT INTO attendance (attendance_date, student_id, status, marked_by)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(attendance_date, student_id) DO UPDATE SET
                  status = excluded.status,
                  marked_by = excluded.marked_by,
                  marked_at = CURRENT_TIMESTAMP
              `);

              db.exec('BEGIN TRANSACTION');
              let restoredCount = 0;
              for (const r of data.records) {
                if (r.date && r.student_id && r.status) {
                  insertStmt.run(r.date, r.student_id, r.status, r.marked_by || 'admin');
                  restoredCount++;
                }
              }
              db.exec('COMMIT');
              console.log(`[GoogleSheets] Successfully restored ${restoredCount} attendance records from Google Sheets!`);
              resolve(true);
            } else {
              console.log('[GoogleSheets] No existing attendance records to restore.');
              resolve(false);
            }
          } catch (e) {
            console.error('[GoogleSheets] Error parsing records from Google Sheets:', e.message);
            resolve(false);
          }
        });
      }).on('error', (err) => {
        console.error('[GoogleSheets] Error fetching from Google Sheets:', err.message);
        resolve(false);
      });
    }

    fetchUrl(GOOGLE_SHEET_WEBHOOK_URL);
  });
}

module.exports = {
  syncAttendanceToGoogleSheets,
  syncStudentToGoogleSheets,
  restoreAttendanceFromGoogleSheets
};
