const API_URL = 'http://127.0.0.1:5000/api/entries';

// State Management
let allEntries = [];
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth(); // 0 - 11
let selectedDate = formatDateString(new Date()); // YYYY-MM-DD (Defaults to Today)
let filterBySelected = false; // By default on initial load, show all entries

let currentUser = JSON.parse(localStorage.getItem('user')) || null;
let isLoginMode = true;

// DOM Elements
const authModal = document.getElementById('auth-modal');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authForm = document.getElementById('auth-form');
const authName = document.getElementById('auth-name');
const authPassword = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const authSubmitBtn = document.getElementById('auth-submit-btn');

const userControls = document.getElementById('user-controls');
const welcomeMsg = document.getElementById('welcome-msg');
const logoutBtn = document.getElementById('logout-btn');
const userView = document.getElementById('user-view');
const adminView = document.getElementById('admin-view');
const adminUsersList = document.getElementById('admin-users-list');

const diaryForm = document.getElementById('diary-form');
const titleInput = document.getElementById('title');
const contentInput = document.getElementById('content');
const entriesList = document.getElementById('entries-list');
const monthYearHeader = document.getElementById('month-year-header');
const calendarDaysContainer = document.getElementById('calendar-days');
const prevMonthBtn = document.getElementById('prev-month');
const nextMonthBtn = document.getElementById('next-month');
const selectedDateLabel = document.getElementById('selected-date-label');
const viewingDateLabel = document.getElementById('viewing-date-label');
const showAllBtn = document.getElementById('show-all-btn');
const aiAgentBtn = document.getElementById('ai-agent-btn');
const aiStatus = document.getElementById('ai-status');

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkAuth();
});

function checkAuth() {
  if (!currentUser) {
    authModal.style.display = 'flex';
    userControls.style.display = 'none';
    userView.style.display = 'none';
    adminView.style.display = 'none';
  } else {
    authModal.style.display = 'none';
    userControls.style.display = 'flex';
    welcomeMsg.innerText = `Welcome, ${currentUser.name}!`;
    
    if (currentUser.role === 'admin') {
      userView.style.display = 'none';
      adminView.style.display = 'block';
    } else {
      userView.style.display = 'grid'; // because it uses grid-template-columns
      adminView.style.display = 'none';
      updateDateUI();
    }
    fetchEntries();
  }
}

function setupEventListeners() {
  // Auth Listeners
  tabLogin.addEventListener('click', () => {
    isLoginMode = true;
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    authSubmitBtn.innerText = 'Login';
    authError.style.display = 'none';
  });

  tabRegister.addEventListener('click', () => {
    isLoginMode = false;
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    authSubmitBtn.innerText = 'Register';
    authError.style.display = 'none';
  });

  authForm.addEventListener('submit', handleAuthSubmit);
  
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('user');
    currentUser = null;
    allEntries = [];
    checkAuth();
  });

  // Calendar Nav Listeners
  prevMonthBtn.addEventListener('click', () => {
    viewMonth--;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear--;
    }
    renderCalendar();
  });

  nextMonthBtn.addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 12 - 1) {
      viewMonth = 0;
      viewYear++;
    }
    renderCalendar();
  });

  showAllBtn.addEventListener('click', () => {
    filterBySelected = false;
    updateDateUI();
    renderEntries();
  });

  diaryForm.addEventListener('submit', handleFormSubmit);
  if (aiAgentBtn) {
    aiAgentBtn.addEventListener('click', handleAiAgentRectify);
  }
}

// Auth Handlers
async function handleAuthSubmit(e) {
  e.preventDefault();
  const name = authName.value.trim();
  const password = authPassword.value;
  
  const endpoint = isLoginMode ? 'http://127.0.0.1:5000/api/login' : 'http://127.0.0.1:5000/api/register';
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      currentUser = data;
      localStorage.setItem('user', JSON.stringify(currentUser));
      authName.value = '';
      authPassword.value = '';
      authError.style.display = 'none';
      checkAuth();
    } else {
      authError.innerText = data.error || 'Authentication failed';
      authError.style.display = 'block';
    }
  } catch (err) {
    console.error('Auth error:', err);
    authError.innerText = 'Network error. Make sure server is running.';
    authError.style.display = 'block';
  }
}

// Helper: Format Date object to YYYY-MM-DD
function formatDateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper: Convert YYYY-MM-DD to human readable string
function getDisplayDateLabel(dateStr) {
  const todayStr = formatDateString(new Date());
  if (dateStr === todayStr) {
    return `Today (${dateStr})`;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  }).format(dateObj);
}

// Update writing target and viewing labels
function updateDateUI() {
  selectedDateLabel.innerText = getDisplayDateLabel(selectedDate);
  
  if (filterBySelected) {
    viewingDateLabel.innerText = getDisplayDateLabel(selectedDate);
    showAllBtn.style.display = 'inline-block';
  } else {
    viewingDateLabel.innerText = 'All Dates';
    showAllBtn.style.display = 'none';
  }
}

// Render Calendar Month & Days
function renderCalendar() {
  const firstDateOfMonth = new Date(viewYear, viewMonth, 1);
  monthYearHeader.innerText = new Intl.DateTimeFormat('en-US', { 
    month: 'long', 
    year: 'numeric' 
  }).format(firstDateOfMonth);

  calendarDaysContainer.innerHTML = '';

  const startDayOfWeek = firstDateOfMonth.getDay(); // 0 is Sun, 6 is Sat
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayStr = formatDateString(new Date());

  // Create set of dates that have entries for O(1) lookup
  const datesWithEntries = new Set(
    (Array.isArray(allEntries) ? allEntries : []).map(e => e.date || (e.created_at && e.created_at.split(' ')[0]))
  );

  // Fill preceding empty slots
  for (let i = 0; i < startDayOfWeek; i++) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'day-cell empty';
    calendarDaysContainer.appendChild(emptyDiv);
  }

  // Populate days of month
  for (let day = 1; day <= daysInMonth; day++) {
    const dayDiv = document.createElement('div');
    dayDiv.className = 'day-cell';
    dayDiv.innerText = day;

    const dateObj = new Date(viewYear, viewMonth, day);
    const dateStr = formatDateString(dateObj);

    if (dateStr === todayStr) {
      dayDiv.classList.add('today');
    }
    if (dateStr === selectedDate) {
      dayDiv.classList.add('active');
    }
    if (datesWithEntries.has(dateStr)) {
      const dot = document.createElement('span');
      dot.className = 'day-dot';
      dayDiv.appendChild(dot);
    }

    // Handle touching/clicking a specific calendar date
    dayDiv.addEventListener('click', () => {
      selectedDate = dateStr;
      filterBySelected = true; // Automatically filter feed to selected day
      renderCalendar(); // Re-render to highlight active cell
      updateDateUI();
      renderEntries();
      
      // Smoothly scroll to writing form on smaller screens
      if (window.innerWidth <= 900) {
        document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth' });
      }
    });

    calendarDaysContainer.appendChild(dayDiv);
  }
}

// API: Fetch Entries from Backend
async function fetchEntries() {
  if (!currentUser) return;
  
  try {
    const response = await fetch(API_URL, {
      headers: { 'X-User-Id': currentUser.id }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 404) {
        // Invalid or deleted user session. Force logout.
        localStorage.removeItem('user');
        currentUser = null;
        allEntries = [];
        checkAuth();
        return;
      }
      throw new Error(data.error || "Server error");
    }
    
    allEntries = data;
    
    if (currentUser.role === 'admin') {
      renderAdminEntries();
    } else {
      renderCalendar();
      renderEntries();
    }
  } catch (err) {
    console.error('Failed to load entries from backend:', err);
    if (currentUser.role === 'admin') {
      adminUsersList.innerHTML = `<div class="empty-state">⚠️ Could not connect to server.</div>`;
    } else {
      entriesList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">⚠️</span>
          <p>Could not connect to the diary server.<br>Please ensure the Flask backend server is running.</p>
        </div>
      `;
    }
  }
}

// Render filtered entries to feed (For regular users)
function renderEntries() {
  entriesList.innerHTML = '';
  
  const displayedEntries = filterBySelected 
    ? allEntries.filter(entry => {
        const entryDate = entry.date || (entry.created_at && entry.created_at.split(' ')[0]);
        return entryDate === selectedDate;
      })
    : allEntries;

  if (displayedEntries.length === 0) {
    const emptyMsg = filterBySelected 
      ? `No diary records written on ${getDisplayDateLabel(selectedDate)} yet.`
      : "No diary entries recorded yet.";
    
    entriesList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📝</span>
        <p>${emptyMsg}<br>Use the form above to capture your thoughts for this day!</p>
      </div>
    `;
    return;
  }

  displayedEntries.forEach(entry => {
    const entryElement = document.createElement('div');
    entryElement.className = 'entry-card';
    entryElement.innerHTML = `
      <h3>${escapeHtml(entry.title)}</h3>
      <p>${escapeHtml(entry.content)}</p>
      <div class="entry-footer">
        <span class="entry-date">📅 ${entry.created_at}</span>
        <button class="delete-btn" onclick="deleteEntry(${entry.id})">Delete</button>
      </div>
    `;
    entriesList.appendChild(entryElement);
  });
}

// Render Admin Dashboard
function renderAdminEntries() {
  adminUsersList.innerHTML = '';
  const countBadge = document.getElementById('admin-user-count');
  
  if (!allEntries || allEntries.length === 0) {
    if (countBadge) countBadge.innerText = '0 Users';
    adminUsersList.innerHTML = `<div class="empty-state"><p>No users found in the system yet.</p></div>`;
    return;
  }
  
  if (countBadge) countBadge.innerText = `${allEntries.length} Users registered`;
  
  allEntries.forEach(userData => {
    const userCard = document.createElement('div');
    userCard.className = 'admin-user-card';
    
    let entriesHtml = '';
    if (userData.entries.length === 0) {
      entriesHtml = `<p style="color: var(--text-muted);">No diary entries recorded by this user.</p>`;
    } else {
      entriesHtml = `<div class="admin-user-entries">`;
      userData.entries.forEach(entry => {
        entriesHtml += `
          <div class="entry-card">
            <h3>${escapeHtml(entry.title)}</h3>
            <p>${escapeHtml(entry.content)}</p>
            <div class="entry-footer">
              <span class="entry-date">📅 ${entry.created_at}</span>
              <button class="delete-btn" onclick="deleteEntry(${entry.id})">Delete</button>
            </div>
          </div>
        `;
      });
      entriesHtml += `</div>`;
    }
    
    userCard.innerHTML = `
      <div class="admin-user-header">
        👤 ${escapeHtml(userData.user.name)}
      </div>
      ${entriesHtml}
    `;
    
    adminUsersList.appendChild(userCard);
  });
}

// API: Save new entry with selected calendar date
async function handleFormSubmit(e) {
  e.preventDefault();

  const newEntry = {
    title: titleInput.value.trim(),
    content: contentInput.value.trim(),
    date: selectedDate // Attach currently selected calendar date!
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-User-Id': currentUser.id
      },
      body: JSON.stringify(newEntry)
    });

    if (response.ok) {
      titleInput.value = '';
      contentInput.value = '';
      await fetchEntries(); // Refresh entries & calendar markers
    } else {
      const data = await response.json();
      alert('Failed to save entry: ' + (data.error || 'Server error'));
    }
  } catch (err) {
    console.error('Failed to save entry:', err);
    alert('Failed to save entry. Make sure backend server is active.');
  }
}

// API: Delete entry
async function deleteEntry(id) {
  if (!confirm("Are you sure you want to delete this diary entry?")) return;

  try {
    const response = await fetch(`${API_URL}/${id}`, { 
      method: 'DELETE',
      headers: { 'X-User-Id': currentUser.id }
    });
    if (response.ok) {
      fetchEntries();
    }
  } catch (err) {
    console.error('Failed to delete entry:', err);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, match => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[match]));
}

// AI Agent: Translate Telugu & Rectify Grammar into Indian English
async function handleAiAgentRectify() {
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();

  if (!title && !content) {
    alert("Please write some reflections in Telugu or English first for the AI Agent to polish!");
    return;
  }

  try {
    aiAgentBtn.disabled = true;
    aiStatus.style.display = 'block';
    aiStatus.innerText = "🤖 AI Agent is translating Telugu & rectifying grammar into Indian English...";

    const response = await fetch('http://127.0.0.1:5000/api/ai-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Server processing failed");
    }

    const data = await response.json();
    if (data.rectified_title !== undefined) titleInput.value = data.rectified_title;
    if (data.rectified_content !== undefined) contentInput.value = data.rectified_content;

    aiStatus.innerText = "✨ " + (data.agent_status || "Successfully translated & rectified into Indian English!");
    setTimeout(() => {
      aiStatus.style.display = 'none';
    }, 6000);

  } catch (err) {
    console.error("AI Agent processing failed:", err);
    aiStatus.innerText = "⚠️ AI Agent connection error: Make sure backend server is active.";
    setTimeout(() => { aiStatus.style.display = 'none'; }, 5000);
  } finally {
    aiAgentBtn.disabled = false;
  }
}