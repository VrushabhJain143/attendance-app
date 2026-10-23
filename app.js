// Client Side JavaScript Logic - Student Attendance Manager

// Global State
const state = {
  user: null, // { username, role }
  students: [], // Full list of students
  markedAttendance: {}, // { student_id: status } for the selected date
  currentDate: '', // YYYY-MM-DD
  selectedStudents: new Set(), // Set of selected student IDs
  currentScreen: 'screen-login',
  activeProfileStudentId: null,
  activeUserEditId: null
};

// --- DOM ELEMENTS ---
const screens = {
  'screen-login': document.getElementById('screen-login'),
  'screen-dashboard': document.getElementById('screen-dashboard'),
  'screen-student-form': document.getElementById('screen-student-form'),
  'screen-student-profile': document.getElementById('screen-student-profile'),
  'screen-history': document.getElementById('screen-history'),
  'screen-settings': document.getElementById('screen-settings'),
  'screen-users': document.getElementById('screen-users')
};

const bottomNavBar = document.getElementById('bottom-nav-bar');
const toastContainer = document.getElementById('toast-container');

// Confirm Modal elements
const confirmModal = document.getElementById('confirm-modal');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');

// --- HELPER FUNCTIONS ---

// Toast Notifications
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
  `;
  toastContainer.appendChild(toast);
  
  // Auto remove after 3.5s
  setTimeout(() => {
    toast.style.animation = 'fadeIn 0.3s ease-out reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Confirmation Dialog Modal
let activeConfirmCallback = null;
function showConfirm(title, message, onConfirm, isDanger = false) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  
  // Styling for danger actions
  if (isDanger) {
    modalConfirmBtn.className = 'btn-modal confirm danger';
  } else {
    modalConfirmBtn.className = 'btn-modal confirm';
  }
  
  activeConfirmCallback = onConfirm;
  confirmModal.classList.add('active');
}

function hideConfirm() {
  confirmModal.classList.remove('active');
  activeConfirmCallback = null;
}

modalCancelBtn.addEventListener('click', hideConfirm);
modalConfirmBtn.addEventListener('click', () => {
  if (activeConfirmCallback) {
    activeConfirmCallback();
  }
  hideConfirm();
});

// Switch Screen SPA Router
function showScreen(screenId) {
  // Hide all screens
  Object.values(screens).forEach(screen => {
    screen.classList.remove('active');
  });
  
  // Show target screen
  screens[screenId].classList.add('active');
  state.currentScreen = screenId;
  
  // Bottom navbar visibility (hide on login screen)
  if (screenId === 'screen-login') {
    bottomNavBar.style.display = 'none';
  } else {
    bottomNavBar.style.display = 'flex';
    
    // Highlight correct nav button
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    if (screenId === 'screen-dashboard' || screenId === 'screen-student-form' || screenId === 'screen-student-profile') {
      document.getElementById('nav-dashboard').classList.add('active');
    } else if (screenId === 'screen-history') {
      document.getElementById('nav-history').classList.add('active');
    } else if (screenId === 'screen-settings' || screenId === 'screen-users') {
      document.getElementById('nav-settings').classList.add('active');
    }
  }

  // Adjust role-based elements visibility
  applyRoleAccess();
}

// Check role permissions and show/hide administrative elements
function applyRoleAccess() {
  const isAdmin = state.user && state.user.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    if (isAdmin) {
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });
}

// API Fetch wrapper with auto JSON parse and authentication check
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, options);
    
    // Auto redirect to login on 401 Unauthorized
    if (res.status === 401) {
      if (state.currentScreen !== 'screen-login') {
        state.user = null;
        showScreen('screen-login');
        showToast('Session expired. Please login again.', 'error');
      }
      return { error: 'Unauthorized' };
    }
    
    const data = await res.json();
    if (!res.ok) {
      return { error: data.error || 'Server error' };
    }
    return data;
  } catch (error) {
    console.error('API Fetch error:', error);
    showToast('Network error. Unable to connect to the server.', 'error');
    return { error: 'Network Error' };
  }
}

// Format Date as "Saturday, 9 August 2026"
function formatDateLong(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

// Format date to short readable YYYY-MM-DD
function getTodayDateStr() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Set up attendance date on startup
function initDate() {
  state.currentDate = getTodayDateStr();
  document.getElementById('hidden-date-picker').value = state.currentDate;
  document.getElementById('display-date').textContent = formatDateLong(state.currentDate);
}

// --- DATA FETCHING & RENDERING ---

// Load stats cards for the dashboard
async function loadAnalytics() {
  const analytics = await apiFetch(`/api/analytics?date=${state.currentDate}`);
  if (analytics && !analytics.error) {
    document.getElementById('stat-total').textContent = analytics.totalStudents;
    document.getElementById('stat-present').textContent = analytics.presentToday;
    document.getElementById('stat-absent').textContent = analytics.absentToday;
    document.getElementById('stat-remaining').textContent = analytics.notMarked;
  }
}

// Fetch students list and current date marked status
async function loadDashboardData() {
  // Load students list
  const students = await apiFetch('/api/students');
  if (students && !students.error) {
    state.students = students;
  }

  // Load marked records
  const marked = await apiFetch(`/api/attendance?date=${state.currentDate}`);
  if (marked && !marked.error) {
    state.markedAttendance = marked;
  }

  // Render stats and lists
  loadAnalytics();
  renderStudentChecklist();
}

// Render student checklist on Dashboard
function renderStudentChecklist() {
  const searchVal = document.getElementById('search-students').value.toLowerCase().trim();
  const listContainer = document.getElementById('student-list');
  listContainer.innerHTML = '';
  
  // Filter students based on search string
  const filteredStudents = state.students.filter(student => {
    return student.name.toLowerCase().includes(searchVal) ||
           student.contact_number.toLowerCase().includes(searchVal) ||
           student.standard.toLowerCase().includes(searchVal) ||
           student.student_id.toLowerCase().includes(searchVal);
  });

  if (filteredStudents.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align:center; padding: 32px 16px; color: var(--text-light); font-size:14px;">
        No students found matching your search.
      </div>
    `;
    return;
  }

  filteredStudents.forEach(student => {
    const isChecked = state.selectedStudents.has(student.student_id);
    const markedStatus = state.markedAttendance[student.student_id]; // 'Present', 'Absent' or undefined

    const card = document.createElement('div');
    card.className = 'student-card';
    
    // Student avatar/photo thumbnail
    const photoSrc = student.photo_path || '/public/icon.svg'; // Fallback if no photo
    
    let checkboxOrStatusHtml = '';

    if (markedStatus === 'Present') {
      checkboxOrStatusHtml = `
        <span class="student-status-badge present">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Present ✓
        </span>
      `;
    } else if (markedStatus === 'Absent') {
      checkboxOrStatusHtml = `
        <span class="student-status-badge absent">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          Absent ✗
        </span>
      `;
    } else {
      checkboxOrStatusHtml = `
        <div class="student-checkbox-wrap">
          <div class="custom-checkbox ${isChecked ? 'checked' : ''}" data-id="${student.student_id}"></div>
        </div>
      `;
    }

    card.innerHTML = `
      ${checkboxOrStatusHtml}
      <img src="${photoSrc}" class="student-photo-thumbnail" alt="${student.name}" onerror="this.src='/icon.svg'">
      <div class="student-info-wrap" data-id="${student.student_id}">
        <span class="student-name">${student.name}</span>
        <div class="student-meta">
          <span class="student-meta-item">Std: ${student.standard}</span>
          <span class="student-meta-item">Phone: ${student.contact_number}</span>
        </div>
      </div>
    `;

    // Click checkbox to toggle selection
    const checkboxEl = card.querySelector('.custom-checkbox');
    if (checkboxEl) {
      checkboxEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = checkboxEl.getAttribute('data-id');
        if (state.selectedStudents.has(id)) {
          state.selectedStudents.delete(id);
          checkboxEl.classList.remove('checked');
        } else {
          state.selectedStudents.add(id);
          checkboxEl.classList.add('checked');
        }
      });
    }

    // Tap card body to open Student Profile
    card.querySelector('.student-info-wrap').addEventListener('click', () => {
      openStudentProfile(student.student_id);
    });

    listContainer.appendChild(card);
  });
}

// Open Student Profile Screen
async function openStudentProfile(studentId) {
  state.activeProfileStudentId = studentId;
  const data = await apiFetch(`/api/students/profile?student_id=${studentId}`);
  if (data && !data.error) {
    const student = data.student;
    const summary = data.summary;
    const history = data.history;

    // Fill UI fields
    document.getElementById('profile-img').src = student.photo_path || '/icon.svg';
    document.getElementById('profile-name').textContent = student.name;
    document.getElementById('profile-student-id').textContent = student.student_id;
    document.getElementById('profile-class').textContent = student.standard;
    document.getElementById('profile-phone').textContent = student.contact_number;
    document.getElementById('profile-phone-link').href = `tel:${student.contact_number}`;
    document.getElementById('profile-address').textContent = student.address || 'Not Provided';
    
    document.getElementById('profile-stat-percentage').textContent = `${summary.percentage}%`;
    document.getElementById('profile-stat-total').textContent = summary.totalClasses;
    document.getElementById('profile-stat-present').textContent = summary.present;
    document.getElementById('profile-stat-absent').textContent = summary.absent;

    // History table
    const tableBody = document.getElementById('profile-history-rows');
    tableBody.innerHTML = '';
    
    if (history.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:var(--text-muted);">No attendance history found.</td></tr>`;
    } else {
      history.forEach(row => {
        const tr = document.createElement('tr');
        const badgeClass = row.status === 'Present' ? 'present' : 'absent';
        tr.innerHTML = `
          <td>${formatDateLong(row.attendance_date)}</td>
          <td><span class="student-status-badge ${badgeClass}">${row.status}</span></td>
        `;
        tableBody.appendChild(tr);
      });
    }

    showScreen('screen-student-profile');
  } else {
    showToast(data.error || 'Failed to load profile', 'error');
  }
}

// Fetch and Render Attendance History Report Screen
// Debounce timer to avoid double-firing when both 'input' and 'change' events
// fire together (which happens with native date pickers in most browsers)
let _historyDebounceTimer = null;
function loadHistoryReport() {
  clearTimeout(_historyDebounceTimer);
  _historyDebounceTimer = setTimeout(_doLoadHistoryReport, 80);
}
async function _doLoadHistoryReport() {
  const dateInputVal = document.getElementById('history-filter-date').value;
  const standardVal = document.getElementById('history-filter-standard').value;
  const searchVal = document.getElementById('history-search-input').value.toLowerCase().trim();
  
  if (!dateInputVal) return;

  const data = await apiFetch(`/api/attendance/history-report?date=${dateInputVal}&standard=${standardVal}`);
  if (data && !data.error) {
    const summary = data.summary;
    const records = data.records;

    // Update Report Stats
    document.getElementById('history-summary-total').textContent = summary.total;
    document.getElementById('history-summary-present').textContent = summary.present;
    document.getElementById('history-summary-absent').textContent = summary.absent;
    document.getElementById('history-summary-pct').textContent = `${summary.percentage}%`;

    // Populate Report List
    const listBody = document.getElementById('history-table-rows');
    listBody.innerHTML = '';

    // Filter list based on search text box
    const filteredRecords = records.filter(r => r.name.toLowerCase().includes(searchVal) || r.student_id.toLowerCase().includes(searchVal));

    if (filteredRecords.length === 0) {
      listBody.innerHTML = `
        <tr>
          <td colspan="3" style="text-align:center; padding: 24px; color:var(--text-muted);">No students found.</td>
        </tr>
      `;
      return;
    }

    filteredRecords.forEach(record => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      
      let badgeClass = 'remaining';
      let badgeLabel = 'Not Marked';

      if (record.status === 'Present') {
        badgeClass = 'present';
        badgeLabel = 'Present ✓';
      } else if (record.status === 'Absent') {
        badgeClass = 'absent';
        badgeLabel = 'Absent ✗';
      }

      tr.innerHTML = `
        <td>
          <div style="font-weight:600;">${record.name}</div>
          <div style="font-size:10px; color:var(--text-muted); font-weight:700;">${record.student_id}</div>
        </td>
        <td>${record.standard}</td>
        <td><span class="student-status-badge ${badgeClass}">${badgeLabel}</span></td>
      `;

      tr.addEventListener('click', () => {
        openStudentProfile(record.student_id);
      });
      listBody.appendChild(tr);
    });
  }
}

// Load and Render Users Account Management Screen (Admin Only)
async function loadUsersList() {
  const users = await apiFetch('/api/users');
  if (users && !users.error) {
    const listContainer = document.getElementById('users-list-container');
    listContainer.innerHTML = '';

    users.forEach(u => {
      const item = document.createElement('div');
      item.className = 'user-item';
      item.innerHTML = `
        <div class="user-details">
          <span class="user-name">${u.username}</span>
          <span class="user-role">${u.role}</span>
        </div>
        <div style="display:flex; gap:6px;">
          <!-- Edit Button -->
          <button class="user-delete-btn edit-user" data-id="${u.id}" data-username="${u.username}" data-role="${u.role}" style="color:var(--primary);">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <!-- Delete Button -->
          <button class="user-delete-btn delete-user" data-id="${u.id}">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      `;

      // Hook up Edit User
      item.querySelector('.edit-user').addEventListener('click', () => {
        const id = u.id;
        const name = u.username;
        const role = u.role;
        
        state.activeUserEditId = id;
        document.getElementById('form-user-id').value = id;
        document.getElementById('form-user-username').value = name;
        document.getElementById('form-user-password').value = '';
        document.getElementById('form-user-password').required = false;
        document.getElementById('user-password-label').textContent = 'Password (leave blank to keep)';
        document.getElementById('form-user-role').value = role;
        
        document.getElementById('user-form-title').textContent = `Edit User: ${name}`;
        document.getElementById('form-user-cancel').style.display = 'block';
      });

      // Hook up Delete User
      item.querySelector('.delete-user').addEventListener('click', () => {
        const id = u.id;
        showConfirm('Delete User Account', `Are you sure you want to delete user account "${u.username}"?`, async () => {
          const res = await apiFetch(`/api/users?id=${id}`, { method: 'DELETE' });
          if (res && !res.error) {
            showToast('User account deleted successfully.');
            loadUsersList();
          } else {
            showToast(res.error || 'Failed to delete user account.', 'error');
          }
        }, true);
      });

      listContainer.appendChild(item);
    });
  }
}

// Reset User form fields back to new mode
function resetUserForm() {
  state.activeUserEditId = null;
  document.getElementById('form-user-id').value = '';
  document.getElementById('form-user-username').value = '';
  document.getElementById('form-user-password').value = '';
  document.getElementById('form-user-password').required = true;
  document.getElementById('user-password-label').textContent = 'Password *';
  document.getElementById('form-user-role').value = 'user';
  
  document.getElementById('user-form-title').textContent = 'Add New User';
  document.getElementById('form-user-cancel').style.display = 'none';
}

// --- EVENT HANDLERS ---

// Auth Session check on load
async function checkAuthSession() {
  const session = await apiFetch('/api/auth/session');
  if (session && session.loggedIn) {
    state.user = session.user;
    
    // Fill Username settings fields
    document.getElementById('settings-username-display').textContent = state.user.username;
    document.getElementById('settings-role-display').textContent = `Role: ${state.user.role === 'admin' ? 'Administrator' : 'Basic User'}`;

    initDate();
    loadDashboardData();
    showScreen('screen-dashboard');
  } else {
    showScreen('screen-login');
  }
}

// Login form submit
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (res && !res.error) {
    state.user = res.user;
    
    document.getElementById('settings-username-display').textContent = state.user.username;
    document.getElementById('settings-role-display').textContent = `Role: ${state.user.role === 'admin' ? 'Administrator' : 'Basic User'}`;
    
    showToast('Logged in successfully!');
    initDate();
    loadDashboardData();
    showScreen('screen-dashboard');
  } else {
    showToast(res.error || 'Invalid credentials.', 'error');
  }
});

// Forgot password click trigger
document.getElementById('forgot-password').addEventListener('click', (e) => {
  e.preventDefault();
  showToast('Please contact system administrator to reset your password.', 'info');
});

// Logout click trigger
document.getElementById('settings-logout-btn').addEventListener('click', async () => {
  showConfirm('Logout', 'Are you sure you want to log out from the application?', async () => {
    const res = await apiFetch('/api/auth/logout', { method: 'POST' });
    if (res && !res.error) {
      state.user = null;
      document.getElementById('login-password').value = '';
      showScreen('screen-login');
      showToast('Logged out successfully.');
    }
  });
});

// Date bar change picker triggers
document.getElementById('date-picker-btn').addEventListener('click', () => {
  document.getElementById('hidden-date-picker').showPicker();
});

document.getElementById('hidden-date-picker').addEventListener('change', (e) => {
  const newDate = e.target.value;
  if (newDate) {
    state.currentDate = newDate;
    state.selectedStudents.clear(); // Clear selections on date change
    document.getElementById('display-date').textContent = formatDateLong(state.currentDate);
    loadDashboardData();
  }
});

// Instant Search inputs listener
document.getElementById('search-students').addEventListener('input', renderStudentChecklist);

// Mark Present Trigger
document.getElementById('dash-mark-btn').addEventListener('click', async () => {
  if (state.selectedStudents.size === 0) {
    showToast('Please select at least one student.', 'error');
    return;
  }

  const ids = Array.from(state.selectedStudents);
  
  showConfirm('Mark Present', `Mark ${ids.length} selected students as Present for today?`, async () => {
    const res = await apiFetch('/api/attendance/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: state.currentDate,
        student_ids: ids,
        status: 'Present'
      })
    });

    if (res && !res.error) {
      showToast(res.message);
      state.selectedStudents.clear();
      loadDashboardData();
    } else {
      showToast(res.error || 'Failed to submit attendance.', 'error');
    }
  });
});

// Mark Remaining Absent Trigger
document.getElementById('dash-absent-remaining-btn').addEventListener('click', () => {
  showConfirm(
    'Confirm Action',
    `Are you sure you want to mark all remaining unmarked students as Absent for ${formatDateLong(state.currentDate)}?`,
    async () => {
      const res = await apiFetch('/api/attendance/mark-remaining-absent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: state.currentDate })
      });

      if (res && !res.error) {
        showToast(res.message);
        loadDashboardData();
      } else {
        showToast(res.error || 'Failed to process.', 'error');
      }
    }
  );
});

// Nav item routing triggers
document.getElementById('nav-dashboard').addEventListener('click', () => {
  loadDashboardData();
  showScreen('screen-dashboard');
});

document.getElementById('nav-history').addEventListener('click', () => {
  document.getElementById('history-filter-date').value = state.currentDate;
  loadHistoryReport();
  showScreen('screen-history');
});

document.getElementById('nav-settings').addEventListener('click', () => {
  showScreen('screen-settings');
});

// History filter listeners
// Use both 'input' and 'change' events on the date field:
// - 'input' fires immediately when the value changes via date picker (most browsers)
// - 'change' fires on blur / keyboard entry commit — catches remaining edge cases
document.getElementById('history-filter-date').addEventListener('input', loadHistoryReport);
document.getElementById('history-filter-date').addEventListener('change', loadHistoryReport);
document.getElementById('history-filter-standard').addEventListener('change', loadHistoryReport);
document.getElementById('history-search-input').addEventListener('input', loadHistoryReport);

// Admin Student Form triggers
document.getElementById('dash-add-btn').addEventListener('click', () => {
  // Clear form
  document.getElementById('form-student-id').value = '';
  document.getElementById('form-name').value = '';
  document.getElementById('form-contact').value = '';
  document.getElementById('form-address').value = '';
  document.getElementById('form-standard').value = '';
  document.getElementById('student-photo-input').value = '';
  
  // Set default blank avatar in preview
  document.getElementById('photo-preview').innerHTML = `
    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
  `;

  document.getElementById('student-form-title').textContent = 'Add New Student';
  document.getElementById('form-submit-btn').querySelector('span').textContent = 'SAVE STUDENT';

  showScreen('screen-student-form');
});

document.getElementById('student-form-back').addEventListener('click', () => {
  showScreen('screen-dashboard');
});

// Photo upload preview base64 helper
let base64PhotoStr = null;
document.getElementById('student-photo-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // Validate format
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  if (!validTypes.includes(file.type)) {
    showToast('Invalid file format. Upload JPG, JPEG, or PNG.', 'error');
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    base64PhotoStr = event.target.result;
    document.getElementById('photo-preview').innerHTML = `
      <img src="${base64PhotoStr}" alt="Preview">
    `;
  };
  reader.readAsDataURL(file);
});

// Handle photo preview tap to open file selector
document.getElementById('photo-preview').addEventListener('click', () => {
  document.getElementById('student-photo-input').click();
});

// Save Student Submit
document.getElementById('student-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('form-student-id').value;
  const name = document.getElementById('form-name').value.trim();
  const contact = document.getElementById('form-contact').value.trim();
  const standard = document.getElementById('form-standard').value;
  const address = document.getElementById('form-address').value.trim();

  // Validate fields
  if (!name || !contact || !standard || !address) {
    showToast('All fields marked * are required.', 'error');
    return;
  }

  // Validate Phone format
  const phoneRegex = /^[0-9+\s\-()]{8,15}$/;
  if (!phoneRegex.test(contact)) {
    showToast('Please enter a valid phone number (8 to 15 digits).', 'error');
    return;
  }

  const payload = {
    name,
    contact_number: contact,
    standard,
    address,
    photo_base64: base64PhotoStr
  };

  let res;
  if (id) {
    // Edit existing
    payload.student_id = id;
    res = await apiFetch('/api/students', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } else {
    // Add new student
    res = await apiFetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  if (res && !res.error) {
    showToast(res.message || 'Student saved successfully.');
    base64PhotoStr = null;
    loadDashboardData();
    showScreen('screen-dashboard');
  } else {
    showToast(res.error || 'Failed to save student.', 'error');
  }
});

// Back from profile to dashboard
document.getElementById('profile-back').addEventListener('click', () => {
  showScreen('screen-dashboard');
});

// Edit student from profile screen
document.getElementById('profile-edit-btn').addEventListener('click', () => {
  const studentId = state.activeProfileStudentId;
  const student = state.students.find(s => s.student_id === studentId);
  if (!student) return;

  // Pre-fill form fields
  document.getElementById('form-student-id').value = student.student_id;
  document.getElementById('form-name').value = student.name;
  document.getElementById('form-contact').value = student.contact_number;
  document.getElementById('form-standard').value = student.standard;
  document.getElementById('form-address').value = student.address || '';
  
  if (student.photo_path) {
    document.getElementById('photo-preview').innerHTML = `
      <img src="${student.photo_path}" alt="Preview" onerror="this.src='/icon.svg'">
    `;
    base64PhotoStr = null; // Do not overwrite unless changed
  } else {
    document.getElementById('photo-preview').innerHTML = `
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
    `;
    base64PhotoStr = null;
  }

  document.getElementById('student-form-title').textContent = 'Edit Student Details';
  document.getElementById('form-submit-btn').querySelector('span').textContent = 'UPDATE STUDENT';

  showScreen('screen-student-form');
});

// Delete student from profile screen
document.getElementById('profile-delete-btn').addEventListener('click', () => {
  const studentId = state.activeProfileStudentId;
  const student = state.students.find(s => s.student_id === studentId);
  if (!student) return;

  showConfirm(
    'Delete Student',
    `Are you sure you want to permanently delete student "${student.name}" (ID: ${student.student_id}) and all of their attendance records? This action cannot be undone.`,
    async () => {
      const res = await apiFetch(`/api/students?student_id=${studentId}`, {
        method: 'DELETE'
      });

      if (res && !res.error) {
        showToast('Student deleted successfully.');
        loadDashboardData();
        showScreen('screen-dashboard');
      } else {
        showToast(res.error || 'Failed to delete student.', 'error');
      }
    },
    true
  );
});

// --- EXCEL IMPORT / EXPORT TRIGGERS (ADMIN ONLY) ---

// Excel Export Trigger (history page)
document.getElementById('history-export-btn').addEventListener('click', () => {
  const dateVal = document.getElementById('history-filter-date').value;
  const standardVal = document.getElementById('history-filter-standard').value;

  let exportUrl = `/api/attendance/export?`;
  if (dateVal) exportUrl += `startDate=${dateVal}&endDate=${dateVal}&`;
  if (standardVal) exportUrl += `standard=${standardVal}&`;

  showToast('Downloading Excel report...', 'info');
  
  // Trigger native browser file download
  window.location.href = exportUrl;
});

// Trigger Excel Upload browse button
document.getElementById('settings-import-btn').addEventListener('click', () => {
  document.getElementById('settings-import-file-input').click();
});

// Read and upload Excel file to Import Students
document.getElementById('settings-import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const validTypes = ['.xlsx', '.xls', '.csv'];
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!validTypes.includes(ext)) {
    showToast('Invalid file type. Please upload an Excel (.xlsx/.xls) or CSV file.', 'error');
    e.target.value = '';
    return;
  }

  showToast('Reading spreadsheet file...', 'info');

  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const dataBytes = evt.target.result;
      const base64Str = btoa(
        new Uint8Array(dataBytes)
          .reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      showToast('Uploading and parsing file...', 'info');

      // POST to backend API
      const res = await apiFetch('/api/students/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64: base64Str,
          filename: file.name
        })
      });

      // Clear input
      e.target.value = '';

      if (res && !res.error) {
        showConfirm(
          'Import Complete',
          `Import successful!\nStudents Added: ${res.importedCount}\nDuplicate Students Skipped: ${res.duplicateCount}`,
          () => {
            loadDashboardData();
            showScreen('screen-dashboard');
          }
        );
      } else {
        showToast(res.error || 'Excel parsing error. Please check structure.', 'error');
      }
    } catch (error) {
      console.error('File reading failed:', error);
      showToast('Error reading Excel spreadsheet.', 'error');
      e.target.value = '';
    }
  };
  
  reader.readAsArrayBuffer(file);
});

// --- ADMIN USER ACCOUNTS MANAGEMENT TRIGGERS ---

// Open User management screen
document.getElementById('settings-users-btn').addEventListener('click', () => {
  resetUserForm();
  loadUsersList();
  showScreen('screen-users');
});

document.getElementById('users-back').addEventListener('click', () => {
  showScreen('screen-settings');
});

// Reset Edit user form cancellation
document.getElementById('form-user-cancel').addEventListener('click', resetUserForm);

// Submit User Form (Add or Edit)
document.getElementById('user-admin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('form-user-id').value;
  const username = document.getElementById('form-user-username').value.trim();
  const password = document.getElementById('form-user-password').value;
  const role = document.getElementById('form-user-role').value;

  const payload = { username, role };
  if (id) {
    payload.id = id;
    if (password) payload.password = password; // Only update password if provided
  } else {
    payload.password = password;
  }

  const res = await apiFetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res && !res.error) {
    showToast(res.message || 'User saved.');
    resetUserForm();
    loadUsersList();
  } else {
    showToast(res.error || 'Failed to save user account.', 'error');
  }
});

// --- PWA AND INSTALLATION HANDLING ---
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  
  // Show install button in settings menu
  const installBtn = document.getElementById('pwa-install-btn');
  if (installBtn) {
    installBtn.style.display = 'block';
  }
  document.getElementById('pwa-status-text').textContent = 'App is installable! Tap below to add to your Home Screen.';
});

document.getElementById('pwa-install-btn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  
  // Show prompt
  deferredPrompt.prompt();
  // Wait for user choices
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`User response to install prompt: ${outcome}`);
  
  if (outcome === 'accepted') {
    document.getElementById('pwa-install-btn').style.display = 'none';
    document.getElementById('pwa-status-text').textContent = 'App installed successfully!';
    showToast('App added to home screen!');
  }
  deferredPrompt = null;
});

// Check online/offline status
window.addEventListener('online', () => {
  showToast('Network restored. Sync active.', 'info');
  loadDashboardData();
});
window.addEventListener('offline', () => {
  showToast('Lost network connection. Running in offline/cache mode.', 'error');
  document.getElementById('pwa-status-text').textContent = 'Running offline. Changes will sync when online.';
});

// --- STARTUP ---
window.addEventListener('DOMContentLoaded', () => {
  checkAuthSession();
});

