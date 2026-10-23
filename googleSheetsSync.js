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

module.exports = {
  syncAttendanceToGoogleSheets,
  syncStudentToGoogleSheets
};
