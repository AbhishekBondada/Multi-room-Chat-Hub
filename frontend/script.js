/**
 * Multi-room Chat Hub Client Script
 * Implements client-side state, UI interactions, and continuous polling (no WebSockets).
 */

// Dynamic API Base URL Discovery helper
let API_BASE = '/api';

async function discoverApiBase() {
  // 1. Try relative path first (covers same-origin deployments like http://localhost:5002)
  try {
    const relativeUrl = '/api/rooms';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600); // 600ms limit
    const res = await fetch(relativeUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      console.log('Same-origin backend detected.');
      API_BASE = '/api';
      return;
    }
  } catch (e) {
    // Relative path failed, proceed to probe localhost ports
  }

  // 2. Probe common fallback ports (covers cross-origin file:// or custom dev ports)
  const candidatePorts = [5000, 5001, 5002, 5003];
  for (const port of candidatePorts) {
    try {
      const testUrl = `http://127.0.0.1:${port}/api/rooms`; // Use 127.0.0.1 to bypass slow DNS lookup on Windows
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600); // 600ms limit
      
      const res = await fetch(testUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        console.log(`Backend API discovered successfully on port ${port}.`);
        API_BASE = `http://127.0.0.1:${port}/api`;
        return;
      }
    } catch (e) {
      // Closed/occupied port, continue probing
    }
  }

  // 3. Ultimate fallback
  API_BASE = 'http://127.0.0.1:5000/api';
}

// Application State
let state = {
  currentUser: null, // { id, username }
  rooms: [],
  activeRoomId: null,
  renderedMessageIds: new Set(),
  lastPolledMessageTime: null,
  theme: 'dark',
  searchQuery: '',
  searchTimeout: null,
  isMobileSidebarActive: false,
  isMobileUsersActive: false,
  isInitialLoad: true
};

// DOM Elements
const elements = {
  loginOverlay: document.getElementById('login-overlay'),
  loginForm: document.getElementById('login-form'),
  usernameInput: document.getElementById('username-input'),
  loginError: document.getElementById('login-error'),
  appContainer: document.getElementById('app-container'),
  themeToggle: document.getElementById('theme-toggle'),
  currentUsername: document.getElementById('current-username'),
  userAvatar: document.getElementById('user-avatar'),
  logoutBtn: document.getElementById('logout-btn'),
  roomList: document.getElementById('room-list'),
  roomListFilter: document.getElementById('room-list-filter'),
  openCreateRoomBtn: document.getElementById('open-create-room-btn'),
  activeRoomName: document.getElementById('active-room-name'),
  activeRoomDesc: document.getElementById('active-room-desc'),
  messageSearchInput: document.getElementById('message-search-input'),
  clearSearchBtn: document.getElementById('clear-search-btn'),
  messagesContainer: document.getElementById('messages-container'),
  messageForm: document.getElementById('message-form'),
  messageInput: document.getElementById('message-input'),
  onlineUserCount: document.getElementById('online-user-count'),
  onlineUsersList: document.getElementById('online-users-list'),
  onlineUsersSidebar: document.getElementById('online-users-sidebar'),
  createRoomModal: document.getElementById('create-room-modal'),
  createRoomForm: document.getElementById('create-room-form'),
  newRoomName: document.getElementById('new-room-name'),
  newRoomDesc: document.getElementById('new-room-desc'),
  createRoomError: document.getElementById('create-room-error'),
  closeModalBtn: document.getElementById('close-modal-btn'),
  cancelCreateBtn: document.getElementById('cancel-create-btn'),
  sidebarMobileToggle: document.getElementById('sidebar-mobile-toggle'),
  usersMobileToggle: document.getElementById('users-mobile-toggle'),
  closeUsersSidebar: document.getElementById('close-users-sidebar'),
  typingIndicator: document.getElementById('typing-indicator')
};

/* ==========================================================================
   Initialization & Event Listeners
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  setupEventListeners();
  
  // Probe and discover active API port before initializing session queries
  await discoverApiBase();
  
  initUser();
  
  // Start background polling loops (only run if user is logged in)
  if (state.currentUser) {
    startPolling();
  }
});

function setupEventListeners() {
  // Theme Toggle
  elements.themeToggle.addEventListener('click', toggleTheme);

  // Login Form
  elements.loginForm.addEventListener('submit', handleLogin);

  // Logout Button
  elements.logoutBtn.addEventListener('click', handleLogout);

  // Room Creation Modal
  elements.openCreateRoomBtn.addEventListener('click', showCreateRoomModal);
  elements.closeModalBtn.addEventListener('click', hideCreateRoomModal);
  elements.cancelCreateBtn.addEventListener('click', hideCreateRoomModal);
  elements.createRoomForm.addEventListener('submit', handleCreateRoom);

  // Message Form Submit
  elements.messageForm.addEventListener('submit', handleSendMessage);

  // Room List Local Filtering
  elements.roomListFilter.addEventListener('input', filterRoomsList);

  // In-room Message Search (Debounced)
  elements.messageSearchInput.addEventListener('input', handleMessageSearch);
  elements.clearSearchBtn.addEventListener('click', clearMessageSearch);

  // Mobile Navigation Toggles
  elements.sidebarMobileToggle.addEventListener('click', toggleMobileSidebar);
  elements.usersMobileToggle.addEventListener('click', toggleMobileUsers);
  elements.closeUsersSidebar.addEventListener('click', toggleMobileUsers);

  // Close menus when clicking backdrop/messages
  elements.messagesContainer.addEventListener('click', () => {
    closeMobileMenus();
  });
}

/* ==========================================================================
   Theme Management
   ========================================================================== */
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  
  const icon = elements.themeToggle.querySelector('i');
  if (theme === 'dark') {
    icon.className = 'fa-solid fa-sun';
  } else {
    icon.className = 'fa-solid fa-moon';
  }
}

function toggleTheme() {
  setTheme(state.theme === 'dark' ? 'light' : 'dark');
}

/* ==========================================================================
   User Authentication
   ========================================================================== */
function initUser() {
  const savedUser = localStorage.getItem('currentUser');
  if (savedUser) {
    try {
      state.currentUser = JSON.parse(savedUser);
      enterApp();
    } catch (e) {
      localStorage.removeItem('currentUser');
    }
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = elements.usernameInput.value.trim();
  
  showError(elements.loginError, null);

  try {
    const res = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(elements.loginError, data.error || 'Login failed');
      return;
    }

    state.currentUser = data.user;
    localStorage.setItem('currentUser', JSON.stringify(data.user));
    
    enterApp();
    startPolling();
  } catch (err) {
    console.error('Login error:', err);
    showError(elements.loginError, 'Network error, please verify if server is running.');
  }
}

function handleLogout() {
  localStorage.removeItem('currentUser');
  state.currentUser = null;
  state.activeRoomId = null;
  stopPolling();
  
  elements.appContainer.classList.add('hidden');
  elements.loginOverlay.classList.remove('hidden');
  elements.loginOverlay.classList.add('active');
  elements.usernameInput.value = '';
}

function enterApp() {
  elements.loginOverlay.classList.remove('active');
  elements.loginOverlay.classList.add('hidden');
  elements.appContainer.classList.remove('hidden');
  
  // Set profile info
  elements.currentUsername.textContent = state.currentUser.username;
  elements.userAvatar.textContent = state.currentUser.username.substring(0, 2).toUpperCase();
}

function showError(element, message) {
  if (message) {
    element.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${message}`;
    element.classList.remove('hidden');
  } else {
    element.classList.add('hidden');
  }
}

/* ==========================================================================
   Room Management
   ========================================================================== */
async function loadRooms(selectFirst = false) {
  try {
    const res = await fetch(`${API_BASE}/rooms`);
    if (!res.ok) throw new Error('Failed to fetch rooms');
    
    const rooms = await res.json();
    state.rooms = rooms;
    
    renderRoomsList();
    
    if (selectFirst && rooms.length > 0 && !state.activeRoomId) {
      selectRoom(rooms[0]._id);
    }
  } catch (err) {
    console.error('Error fetching rooms:', err);
  }
}

function renderRoomsList() {
  const filterVal = elements.roomListFilter.value.toLowerCase().trim();
  const filtered = state.rooms.filter(r => 
    r.roomName.toLowerCase().includes(filterVal) ||
    (r.description || '').toLowerCase().includes(filterVal)
  );

  if (filtered.length === 0) {
    elements.roomList.innerHTML = `<div class="no-results">No rooms found</div>`;
    return;
  }

  elements.roomList.innerHTML = filtered.map(room => {
    const isActive = room._id === state.activeRoomId;
    return `
      <div class="room-item ${isActive ? 'active' : ''}" onclick="selectRoom('${room._id}')">
        <div class="room-item-left">
          <div class="room-icon-wrapper">
            <i class="fa-solid fa-hashtag"></i>
          </div>
          <div class="room-text-info">
            <h4>${escapeHTML(room.roomName)}</h4>
            <p>${escapeHTML(room.description || 'No description')}</p>
          </div>
        </div>
        ${room.messageCount > 0 ? `<span class="room-badge">${room.messageCount}</span>` : ''}
      </div>
    `;
  }).join('');
}

function filterRoomsList() {
  renderRoomsList();
}

function selectRoom(roomId) {
  if (state.activeRoomId === roomId) {
    closeMobileMenus();
    return;
  }
  
  state.activeRoomId = roomId;
  state.renderedMessageIds.clear();
  state.lastPolledMessageTime = null;
  state.isInitialLoad = true;
  
  // Clear search field when changing rooms
  elements.messageSearchInput.value = '';
  state.searchQuery = '';
  elements.clearSearchBtn.classList.add('hidden');

  // Render active selection in list
  renderRoomsList();
  
  // Find room details
  const room = state.rooms.find(r => r._id === roomId);
  if (room) {
    elements.activeRoomName.textContent = `# ${room.roomName}`;
    elements.activeRoomDesc.textContent = room.description || '';
  }

  // Show loading indicator in messages container
  elements.messagesContainer.innerHTML = `
    <div class="empty-chat">
      <i class="fa-solid fa-spinner fa-spin"></i>
      <p>Fetching messages...</p>
    </div>
  `;

  // Fetch messages immediately
  pollMessages();
  pollOnlineUsers();
  
  closeMobileMenus();
}

// Modal handling
function showCreateRoomModal() {
  elements.createRoomModal.classList.remove('hidden');
  elements.newRoomName.focus();
}

function hideCreateRoomModal() {
  elements.createRoomModal.classList.add('hidden');
  elements.createRoomForm.reset();
  showError(elements.createRoomError, null);
}

async function handleCreateRoom(e) {
  e.preventDefault();
  const roomName = elements.newRoomName.value.trim();
  const description = elements.newRoomDesc.value.trim();
  
  showError(elements.createRoomError, null);

  try {
    const res = await fetch(`${API_BASE}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName, description })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(elements.createRoomError, data.error || 'Failed to create room');
      return;
    }

    hideCreateRoomModal();
    
    // Select the newly created room
    await loadRooms();
    selectRoom(data.room._id);
  } catch (err) {
    console.error('Error creating room:', err);
    showError(elements.createRoomError, 'Network error. Please try again.');
  }
}

/* ==========================================================================
   Message Operations & Rendering
   ========================================================================== */
async function pollMessages() {
  if (!state.activeRoomId || !state.currentUser) return;

  try {
    let url = `${API_BASE}/messages/${state.activeRoomId}`;
    const params = [];
    
    // Optimisation: poll only updates if we already have history and aren't searching
    if (state.lastPolledMessageTime && !state.searchQuery) {
      params.push(`after=${encodeURIComponent(state.lastPolledMessageTime)}`);
    }
    
    if (state.searchQuery) {
      params.push(`search=${encodeURIComponent(state.searchQuery)}`);
    }

    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }

    const res = await fetch(url);
    if (res.status === 404) {
      console.warn(`Active room ${state.activeRoomId} not found (likely database switch/reset). Resetting active room...`);
      state.activeRoomId = null;
      loadRooms(true);
      return;
    }
    if (!res.ok) throw new Error('Failed to fetch messages');
    
    const messages = await res.json();
    
    // If we're searching, overwrite the message list. Otherwise, append.
    if (state.searchQuery) {
      elements.messagesContainer.innerHTML = '';
      state.renderedMessageIds.clear();
    } else if (state.isInitialLoad) {
      elements.messagesContainer.innerHTML = '';
      state.isInitialLoad = false;
    }

    if (messages.length === 0 && state.renderedMessageIds.size === 0) {
      elements.messagesContainer.innerHTML = `
        <div class="empty-chat">
          <i class="fa-solid fa-comments"></i>
          <p>${state.searchQuery ? 'No matching messages found.' : 'This room is empty. Send a message to start the conversation!'}</p>
        </div>
      `;
      return;
    }

    let hasNewMessages = false;
    const isNearBottom = elements.messagesContainer.scrollHeight - elements.messagesContainer.scrollTop <= elements.messagesContainer.clientHeight + 150;

    messages.forEach(msg => {
      if (!state.renderedMessageIds.has(msg._id)) {
        renderMessageItem(msg);
        state.renderedMessageIds.add(msg._id);
        hasNewMessages = true;
        
        // Track the latest message timestamp to poll after it
        if (!state.lastPolledMessageTime || new Date(msg.timestamp) > new Date(state.lastPolledMessageTime)) {
          state.lastPolledMessageTime = msg.timestamp;
        }
      }
    });

    // Auto-scroll logic: scroll if it is initial load or if user is already scrolled to bottom
    if (hasNewMessages && (state.renderedMessageIds.size === messages.length || isNearBottom)) {
      scrollToBottom();
    }
  } catch (err) {
    console.error('Error polling messages:', err);
  }
}

function renderMessageItem(msg) {
  const isSelf = msg.username.toLowerCase() === state.currentUser.username.toLowerCase();
  
  // Predefined bots list to show BOT tags
  const botsList = ['codeninja', 'cyberqueen', 'gamerx', 'datasavant', 'pixelartist'];
  const isBot = botsList.includes(msg.username.toLowerCase());
  
  // Format Timestamp
  const date = new Date(msg.timestamp);
  const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const msgWrapper = document.createElement('div');
  msgWrapper.className = `message-wrapper ${isSelf ? 'self' : ''}`;
  msgWrapper.setAttribute('data-id', msg._id);
  
  msgWrapper.innerHTML = `
    <div class="message-meta">
      <span class="message-username">
        ${escapeHTML(msg.username)}
        ${isBot ? '<span class="bot-badge">BOT</span>' : ''}
      </span>
      <span class="message-timestamp">${timeString}</span>
    </div>
    <div class="message-bubble">
      ${escapeHTML(msg.message)}
    </div>
  `;

  // Remove empty chat state placeholder if visible
  const emptyPlaceholder = elements.messagesContainer.querySelector('.empty-chat');
  if (emptyPlaceholder) {
    emptyPlaceholder.remove();
  }

  // DOM performance guard: limit rendering to last 150 messages
  const maxMessages = 150;
  while (elements.messagesContainer.children.length >= maxMessages) {
    const oldestMsg = elements.messagesContainer.children[0];
    const msgId = oldestMsg.getAttribute('data-id');
    if (msgId) {
      state.renderedMessageIds.delete(msgId);
    }
    elements.messagesContainer.removeChild(oldestMsg);
  }

  elements.messagesContainer.appendChild(msgWrapper);
}

async function handleSendMessage(e) {
  e.preventDefault();
  const message = elements.messageInput.value.trim();
  if (!message || !state.activeRoomId) return;

  elements.messageInput.value = '';

  try {
    const res = await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: state.activeRoomId,
        username: state.currentUser.username,
        message
      })
    });

    if (!res.ok) {
      const errData = await res.json();
      alert(errData.error || 'Failed to send message');
      return;
    }

    // Immediately fetch messages to show the user's message right away
    await pollMessages();
    await loadRooms(); // refresh counts
  } catch (err) {
    console.error('Error sending message:', err);
    alert('Network error sending message. Please try again.');
  }
}

function scrollToBottom() {
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

/* ==========================================================================
   Message Search inside Room
   ========================================================================== */
function handleMessageSearch() {
  const query = elements.messageSearchInput.value.trim();
  
  if (query.length > 0) {
    elements.clearSearchBtn.classList.remove('hidden');
  } else {
    elements.clearSearchBtn.classList.add('hidden');
  }

  // Debounce search requests
  clearTimeout(state.searchTimeout);
  state.searchTimeout = setTimeout(() => {
    state.searchQuery = query;
    // Reset polling cursor for search
    state.lastPolledMessageTime = null;
    pollMessages();
  }, 350);
}

function clearMessageSearch() {
  elements.messageSearchInput.value = '';
  elements.clearSearchBtn.classList.add('hidden');
  state.searchQuery = '';
  state.lastPolledMessageTime = null;
  state.isInitialLoad = true;
  elements.messagesContainer.innerHTML = '';
  state.renderedMessageIds.clear();
  pollMessages();
}

/* ==========================================================================
   Online Users Simulation
   ========================================================================== */
async function pollOnlineUsers() {
  if (!state.activeRoomId || !state.currentUser) return;

  try {
    const url = `${API_BASE}/users/online/${state.activeRoomId}?username=${encodeURIComponent(state.currentUser.username)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch online users');
    
    const users = await res.json();
    
    elements.onlineUserCount.textContent = users.length;
    renderOnlineUsersList(users);

    // Simulate Typing Indicator based on bot typing status
    const typingBots = users.filter(u => u.typing && u.username.toLowerCase() !== state.currentUser.username.toLowerCase());
    if (typingBots.length > 0) {
      const names = typingBots.map(u => u.username).join(', ');
      elements.typingIndicator.querySelector('.typing-text').textContent = `${names} ${typingBots.length === 1 ? 'is' : 'are'} typing...`;
      elements.typingIndicator.classList.remove('hidden');
    } else {
      elements.typingIndicator.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error fetching online users:', err);
  }
}

function renderOnlineUsersList(users) {
  elements.onlineUsersList.innerHTML = users.map(user => {
    const isSelf = user.username.toLowerCase() === state.currentUser.username.toLowerCase();
    const initials = user.username.substring(0, 2).toUpperCase();
    return `
      <div class="user-list-item">
        <div class="user-list-avatar" style="${isSelf ? 'background: var(--primary);' : ''}">
          ${initials}
        </div>
        <div class="user-list-details">
          <span class="user-list-name">${escapeHTML(user.username)} ${isSelf ? '(You)' : ''}</span>
          <span class="user-list-bio">${escapeHTML(user.bio || 'Co-chatter')}</span>
        </div>
      </div>
    `;
  }).join('');
}

/* ==========================================================================
   Polling Schedules
   ========================================================================== */
let pollingIntervals = {
  messages: null,
  users: null,
  rooms: null
};

function startPolling() {
  stopPolling(); // Safety clear

  // Initial load
  loadRooms(true);

  // Poll messages and online users every 3 seconds
  pollingIntervals.messages = setInterval(pollMessages, 3000);
  pollingIntervals.users = setInterval(pollOnlineUsers, 3000);
  
  // Poll rooms list every 6 seconds to update unread counts and catch new rooms
  pollingIntervals.rooms = setInterval(loadRooms, 6000);
}

function stopPolling() {
  if (pollingIntervals.messages) clearInterval(pollingIntervals.messages);
  if (pollingIntervals.users) clearInterval(pollingIntervals.users);
  if (pollingIntervals.rooms) clearInterval(pollingIntervals.rooms);
  
  pollingIntervals.messages = null;
  pollingIntervals.users = null;
  pollingIntervals.rooms = null;
}

/* ==========================================================================
   Mobile Nav Behaviors
   ========================================================================== */
function toggleMobileSidebar() {
  state.isMobileSidebarActive = !state.isMobileSidebarActive;
  const sidebar = document.querySelector('.sidebar');
  if (state.isMobileSidebarActive) {
    sidebar.classList.add('active');
    // Hide other sidebar
    elements.onlineUsersSidebar.classList.remove('active');
    state.isMobileUsersActive = false;
  } else {
    sidebar.classList.remove('active');
  }
}

function toggleMobileUsers() {
  state.isMobileUsersActive = !state.isMobileUsersActive;
  if (state.isMobileUsersActive) {
    elements.onlineUsersSidebar.classList.add('active');
    // Hide other sidebar
    document.querySelector('.sidebar').classList.remove('active');
    state.isMobileSidebarActive = false;
  } else {
    elements.onlineUsersSidebar.classList.remove('active');
  }
}

function closeMobileMenus() {
  document.querySelector('.sidebar').classList.remove('active');
  elements.onlineUsersSidebar.classList.remove('active');
  state.isMobileSidebarActive = false;
  state.isMobileUsersActive = false;
}

/* ==========================================================================
   Utilities
   ========================================================================== */
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}
