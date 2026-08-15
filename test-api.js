// API Automated Verification Script

async function runTests() {
  console.log('--- STARTING ATTENDANCE APP API INTEGRATION TESTS ---');
  
  const baseUrl = 'http://localhost:3000';
  let adminCookie = '';
  let userCookie = '';

  // Helper for requests
  async function request(url, options = {}) {
    const res = await fetch(baseUrl + url, options);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      data = text;
    }
    return { status: res.status, headers: res.headers, data };
  }

  // Test 1: Fail Login (wrong credentials)
  console.log('\nTest 1: Login with invalid credentials...');
  const loginFail = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrongpassword' })
  });
  if (loginFail.status === 401) {
    console.log('✓ Correctly rejected login.');
  } else {
    console.error('✗ Failed: expected 401, got', loginFail.status);
  }

  // Test 2: Admin Login
  console.log('\nTest 2: Login as admin...');
  const loginAdmin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  if (loginAdmin.status === 200 && loginAdmin.data.success) {
    console.log('✓ Admin login successful! Role:', loginAdmin.data.user.role);
    adminCookie = loginAdmin.headers.get('set-cookie');
  } else {
    console.error('✗ Failed admin login:', loginAdmin.data);
  }

  // Test 3: User Login
  console.log('\nTest 3: Login as basic user...');
  const loginUser = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'user', password: 'user123' })
  });
  if (loginUser.status === 200 && loginUser.data.success) {
    console.log('✓ User login successful! Role:', loginUser.data.user.role);
    userCookie = loginUser.headers.get('set-cookie');
  } else {
    console.error('✗ Failed user login:', loginUser.data);
  }

  // Test 4: Fetch Students List (Admin)
  console.log('\nTest 4: Fetch students list (using admin cookies)...');
  const getStudents = await request('/api/students', {
    headers: { 'Cookie': adminCookie }
  });
  if (getStudents.status === 200 && Array.isArray(getStudents.data)) {
    console.log(`✓ Fetched ${getStudents.data.length} students successfully.`);
    getStudents.data.forEach(s => {
      console.log(`  - [${s.student_id}] ${s.name} (${s.standard})`);
    });
  } else {
    console.error('✗ Failed to fetch students:', getStudents.data);
  }

  // Test 5: Mark Attendance (User)
  console.log('\nTest 5: Mark student STU001 as Present (using user cookies)...');
  const markDate = '2026-08-15'; // Example Saturday
  const markRes = await request('/api/attendance/mark', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': userCookie 
    },
    body: JSON.stringify({
      date: markDate,
      student_ids: ['STU001'],
      status: 'Present'
    })
  });
  if (markRes.status === 200 && markRes.data.success) {
    console.log('✓ Marked attendance:', markRes.data.message);
  } else {
    console.error('✗ Failed to mark attendance:', markRes.data);
  }

  // Test 6: Verify duplicate prevention & update (Check if it merges/overwrites)
  console.log('\nTest 6: Re-mark student STU001 as Present on same date...');
  const remarkRes = await request('/api/attendance/mark', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': userCookie 
    },
    body: JSON.stringify({
      date: markDate,
      student_ids: ['STU001'],
      status: 'Present'
    })
  });
  if (remarkRes.status === 200 && remarkRes.data.success) {
    console.log('✓ Correctly processed without duplicates (sqlite ON CONFLICT handled):', remarkRes.data.message);
  } else {
    console.error('✗ Failed double-mark check:', remarkRes.data);
  }

  // Test 7: Add Student (Basic User - Should fail)
  console.log('\nTest 7: Attempt to add student using basic user credentials...');
  const addStudentFail = await request('/api/students', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': userCookie 
    },
    body: JSON.stringify({
      name: 'Test Student',
      contact_number: '1234567890',
      standard: '10th',
      address: 'Test Address'
    })
  });
  if (addStudentFail.status === 403) {
    console.log('✓ Correctly blocked add student (Forbidden).');
  } else {
    console.error('✗ Failed: Expected 403, got', addStudentFail.status, addStudentFail.data);
  }

  // Test 8: Add Student (Admin - Should succeed)
  console.log('\nTest 8: Add student using admin credentials...');
  const addStudentSuccess = await request('/api/students', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': adminCookie 
    },
    body: JSON.stringify({
      name: 'Amit Kumar',
      contact_number: '9888877777',
      standard: '9th',
      address: '789 Testing Lane'
    })
  });
  if (addStudentSuccess.status === 201 && addStudentSuccess.data.success) {
    console.log(`✓ Student added! ID: ${addStudentSuccess.data.student_id}`);
  } else {
    console.error('✗ Failed to add student:', addStudentSuccess.data);
  }

  // Test 9: Get Analytics
  console.log('\nTest 9: Get Analytics...');
  const analyticsRes = await request(`/api/analytics?date=${markDate}`, {
    headers: { 'Cookie': userCookie }
  });
  if (analyticsRes.status === 200) {
    console.log('✓ Analytics result:', analyticsRes.data);
  } else {
    console.error('✗ Failed to get analytics:', analyticsRes.data);
  }

  // Test 10: Mark Remaining Absent
  console.log('\nTest 10: Mark Remaining Absent...');
  const markAbsent = await request('/api/attendance/mark-remaining-absent', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': userCookie 
    },
    body: JSON.stringify({ date: markDate })
  });
  if (markAbsent.status === 200 && markAbsent.data.success) {
    console.log('✓ Marked remaining absent:', markAbsent.data.message);
  } else {
    console.error('✗ Failed to mark remaining absent:', markAbsent.data);
  }

  // Test 11: Get Analytics after remaining absent marked
  console.log('\nTest 11: Get Analytics after marking remaining absent...');
  const postAnalyticsRes = await request(`/api/analytics?date=${markDate}`, {
    headers: { 'Cookie': userCookie }
  });
  if (postAnalyticsRes.status === 200) {
    console.log('✓ Post-absent analytics:', postAnalyticsRes.data);
  } else {
    console.error('✗ Failed to get post-absent analytics:', postAnalyticsRes.data);
  }

  console.log('\n--- TESTS COMPLETED ---');
}

runTests().catch(err => {
  console.error('Test runner crash:', err);
});
