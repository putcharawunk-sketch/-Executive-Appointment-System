/**
 * Executive Appointment Manager - Real-Time Admin Portal Controller
 */

import { dbManager, auth, useFirebase, initPromise } from './firebase-config.js';
import { formatDate, statusLabel, EXECUTIVE_HOSTS, ADMIN_ACCOUNTS, formatTime } from './utils.js';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

document.addEventListener('DOMContentLoaded', () => {
  
  const loginScreen = document.getElementById('login_screen');
  const loginForm = document.getElementById('admin_login_form');
  const emailInput = document.getElementById('login_email');
  const passwordInput = document.getElementById('login_password');
  const loginErrorMsg = document.getElementById('login_error_msg');
  const btnLoginSubmit = document.getElementById('btn_login_submit');

  const dashboardScreen = document.getElementById('dashboard_screen');
  const loggedAdminEmail = document.getElementById('logged_admin_email');
  const currentThaiDate = document.getElementById('current_thai_date');
  const logoutBtn = document.getElementById('logout_btn');
  const clearAllDataBtn = document.getElementById('clear_all_data_btn');

  const badgeSidebarAll = document.getElementById('badge_sidebar_all');
  const badgeSidebarPending = document.getElementById('badge_sidebar_pending');
  const badgeSidebarApproved = document.getElementById('badge_sidebar_approved');
  const badgeSidebarRejected = document.getElementById('badge_sidebar_rejected');
  const badgeSidebarCalendar = document.getElementById('badge_sidebar_calendar');
  const badgeSidebarWaitingSelection = document.getElementById('badge_sidebar_waiting_selection');
  const badgeSidebarCancellationRequested = document.getElementById('badge_sidebar_cancellation_requested');
  const badgeSidebarRescheduleRequested = document.getElementById('badge_sidebar_reschedule_requested');
  const badgeSidebarCancelledPendingDelete = document.getElementById('badge_sidebar_cancelled_pending_delete');
  const badgeSidebarCancelledCompleted = document.getElementById('badge_sidebar_cancelled_completed');

  const searchInput = document.getElementById('admin_search_input');
  const statusFilterSelect = document.getElementById('admin_status_filter');
  const execFilterSelect = document.getElementById('admin_exec_filter');

  const appointmentsTableBody = document.getElementById('appointments_table_body');

  const statTotal = document.getElementById('stat_total');
  const statPending = document.getElementById('stat_pending');
  const statApproved = document.getElementById('stat_approved');
  const statRescheduled = document.getElementById('stat_rescheduled');

  const editModal = document.getElementById('edit_modal');
  const editForm = document.getElementById('edit_form');
  const editRefCode = document.getElementById('edit_ref_code');
  const editClientInfo = document.getElementById('edit_client_info');
  const editPurpose = document.getElementById('edit_purpose');
  const editStatusSelect = document.getElementById('edit_status');
  const rescheduleFields = document.getElementById('reschedule_fields');
  const editRescheduleDate = document.getElementById('edit_reschedule_date');
  const editRescheduleStartTime = document.getElementById('edit_reschedule_start_time');
  const editRescheduleEndTime = document.getElementById('edit_reschedule_end_time');
  const editAdminNotes = document.getElementById('edit_admin_notes');
  const closeModalBtn = document.getElementById('close_modal_btn');
  const btnCancelModal = document.getElementById('btn_cancel_modal');

  // Timeline DOM Elements
  const timelineSection = document.getElementById('timeline_section');
  const timelineCountBadge = document.getElementById('timeline_count_badge');
  const timelineList = document.getElementById('timeline_list');

  let allAppointments = [];
  let activeStatusFilter = 'all';
  let currentEditingRef = null;
  let currentEditingApp = null;
  let unsubscribeLiveListener = null;
  let currentAdminOwner = 'admin1';

  let allSlots = [];
  let unsubscribeSlotsListener = null;
  let currentCalendarYear = new Date().getFullYear();
  let currentCalendarMonth = new Date().getMonth();
  let activeCalendarExecFilter = 'all';

  const registryViewContainer = document.getElementById('registry_view_container');
  const calendarViewContainer = document.getElementById('calendar_view_container');

  function displayCurrentDate() {
    if (currentThaiDate) {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      currentThaiDate.textContent = new Date().toLocaleDateString('th-TH', options);
    }
  }
  displayCurrentDate();

  // ========================================================
  // 1. AUTHENTICATION
  // ========================================================

  function checkSessionAuth() {
    if (useFirebase && auth) {
      onAuthStateChanged(auth, (user) => {
        if (user) {
          grantAccess(user.email);
        } else {
          showLoginScreen();
        }
      });
    } else {
      const isMockAuth = sessionStorage.getItem('admin_authenticated') === 'true';
      if (isMockAuth) {
        grantAccess('admin@exec.com (Offline Sandbox Mode)');
      } else {
        showLoginScreen();
      }
    }
  }

  function showLoginScreen() {
    loginScreen?.classList.remove('hidden');
    dashboardScreen?.classList.add('hidden');
    if (unsubscribeLiveListener) {
      unsubscribeLiveListener();
      unsubscribeLiveListener = null;
    }
    if (unsubscribeSlotsListener) {
      unsubscribeSlotsListener();
      unsubscribeSlotsListener = null;
    }
  }

  function grantAccess(adminEmail) {
    loginScreen?.classList.add('hidden');
    dashboardScreen?.classList.remove('hidden');
    if (loggedAdminEmail) loggedAdminEmail.textContent = adminEmail;
    
    const cleanedEmail = adminEmail.toLowerCase().split(' ')[0].trim();
    if (ADMIN_ACCOUNTS[cleanedEmail]) {
      currentAdminOwner = ADMIN_ACCOUNTS[cleanedEmail];
    } else {
      currentAdminOwner = 'admin1'; // Fallback
    }
    
    initializeWebhookUrl();
    initLiveSubscription();
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
      if (btnLoginSubmit) {
        btnLoginSubmit.disabled = true;
        btnLoginSubmit.textContent = 'กำลังตรวจสอบ...';
      }

      const matchesStandard = email === 'admin@exec.com' && password === 'admin2026';

      if (useFirebase && auth) {
        try {
          await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
          console.warn("Firebase sign in failed:", err.code);
          if (matchesStandard && (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential')) {
            try {
              await createUserWithEmailAndPassword(auth, email, password);
            } catch (createErr) {
              displayLoginError('❌ บันทึกผิดพลาด: ' + createErr.message);
              resetLoginButton();
            }
          } else {
            let msg = '❌ ไม่สามารถเข้าสู่ระบบได้';
            if (err.code === 'auth/wrong-password') msg = '❌ รหัสผ่านไม่ถูกต้อง';
            else if (err.code === 'auth/user-not-found') msg = '❌ ไม่พบบัญชีผู้ใช้นี้';
            else if (err.code === 'auth/invalid-credential') msg = '❌ ข้อมูลรหัสผ่านไม่ถูกต้อง';
            else if (err.code === 'auth/invalid-email') msg = '❌ รูปแบบอีเมลไม่ถูกต้อง';
            else msg = `❌ ${err.message}`;
            displayLoginError(msg);
            resetLoginButton();
          }
        }
      } else {
        if (matchesStandard) {
          sessionStorage.setItem('admin_authenticated', 'true');
          grantAccess('admin@exec.com (Offline Sandbox Mode)');
        } else {
          displayLoginError('❌ รหัสผ่านไม่ถูกต้อง');
          resetLoginButton();
        }
      }
    });
  }

  function displayLoginError(text) {
    if (loginErrorMsg) {
      loginErrorMsg.textContent = text;
      loginErrorMsg.classList.remove('hidden');
    }
  }

  function resetLoginButton() {
    if (btnLoginSubmit) {
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.textContent = 'ลงชื่อเข้าทำงาน';
    }
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      sessionStorage.removeItem('admin_authenticated');
      if (useFirebase && auth) {
        try { await signOut(auth); } catch (err) { console.error("Sign out fail:", err); }
      }
      window.location.reload();
    });
  }

  if (clearAllDataBtn) {
    clearAllDataBtn.addEventListener('click', async () => {
      if (confirm('⚠️ คำเตือน: คุณต้องการลบข้อมูลคำขอนัดหมายและคิวงานผู้บริหารทั้งหมดออกจากฐานข้อมูลใช่หรือไม่?\n\nการลบนี้จะล้างข้อมูลถาวร ทั้งในระบบคลาวด์ (Firestore) และในเครื่อง (LocalStorage) และไม่สามารถกู้คืนได้!')) {
        try {
          const originalText = clearAllDataBtn.innerHTML;
          clearAllDataBtn.disabled = true;
          clearAllDataBtn.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-red-600 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>กำลังล้างข้อมูล...</span>
          `;
          
          await dbManager.clearAllData();
          
          alert('ล้างข้อมูลนัดหมายและคิวผู้บริหารทั้งหมดออกจากสารระบบสำเร็จเรียบร้อยแล้วค่ะ!');
          window.location.reload();
        } catch (error) {
          alert('เกิดข้อผิดพลาดในการลบข้อมูล: ' + error.message);
          clearAllDataBtn.disabled = false;
          clearAllDataBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
            <span>ล้างข้อมูลทั้งหมด</span>
          `;
        }
      }
    });
  }

  // ========================================================
  // 2. REAL-TIME SUBSCRIPTION
  // ========================================================

  function initLiveSubscription() {
    if (unsubscribeLiveListener) unsubscribeLiveListener();
    unsubscribeLiveListener = dbManager.subscribeAppointments((list) => {
      allAppointments = list.filter(app => {
        const execId = app.executiveId;
        const execName = app.executiveHost;
        const matchedExec = EXECUTIVE_HOSTS.find(e => e.id === execId || e.name === execName);
        if (matchedExec) {
          return matchedExec.adminOwner === currentAdminOwner;
        }
        return false;
      });
      populateExecutiveFilter();
      updateMetricMetrics();
      renderAppointmentsTable();
    });

    if (unsubscribeSlotsListener) unsubscribeSlotsListener();
    unsubscribeSlotsListener = dbManager.subscribeExecutiveSlots((slots) => {
      allSlots = slots.filter(slot => {
        const matchedExec = EXECUTIVE_HOSTS.find(e => e.id === slot.executive || e.name === slot.executive);
        if (matchedExec) {
          return matchedExec.adminOwner === currentAdminOwner;
        }
        return false;
      });
    });
  }

  function populateExecutiveFilter() {
    if (execFilterSelect) {
      while (execFilterSelect.children.length > 1) {
        execFilterSelect.removeChild(execFilterSelect.lastChild);
      }
      EXECUTIVE_HOSTS.forEach(exec => {
        if (exec.adminOwner === currentAdminOwner) {
          const option = document.createElement('option');
          option.value = exec.id;
          option.textContent = exec.name;
          execFilterSelect.appendChild(option);
        }
      });
    }
  }

  // ========================================================
  // 3. STATS & BADGES
  // ========================================================

  function updateMetricMetrics() {
    const stats = allAppointments.reduce((acc, app) => {
      acc.total++;
      if (app.status === 'pending') acc.pending++;
      if (app.status === 'approved' || app.status === 'confirmed_reschedule' || app.status === 'client_selected') acc.approved++;
      if (app.status === 'rescheduled') acc.rescheduled++;
      if (app.status === 'rejected') acc.rejected++;
      if (app.status === 'cancellation_requested') acc.cancellation_requested++;
      if (app.status === 'reschedule_requested') acc.reschedule_requested++;
      if (app.status === 'cancelled') {
        if (app.calendarDeleted === true) {
          acc.cancelled_completed++;
        } else {
          acc.cancelled_pending_delete++;
        }
      }
      if (app.bookingType === 'secretary_allocate' && 
          !['client_selected','rejected','approved','confirmed_reschedule','cancellation_requested','cancelled','reschedule_requested'].includes(app.status)) {
        acc.waiting_selection++;
      }
      return acc;
    }, { total: 0, pending: 0, approved: 0, rescheduled: 0, rejected: 0, waiting_selection: 0, cancellation_requested: 0, reschedule_requested: 0, cancelled_pending_delete: 0, cancelled_completed: 0 });

    if (statTotal) statTotal.textContent = stats.total;
    if (statPending) statPending.textContent = stats.pending;
    if (statApproved) statApproved.textContent = stats.approved;
    if (statRescheduled) statRescheduled.textContent = stats.rescheduled;

    if (badgeSidebarAll) badgeSidebarAll.textContent = stats.total;
    if (badgeSidebarPending) badgeSidebarPending.textContent = stats.pending;
    if (badgeSidebarApproved) badgeSidebarApproved.textContent = stats.approved;
    if (badgeSidebarRejected) badgeSidebarRejected.textContent = stats.rejected;
    if (badgeSidebarCalendar) badgeSidebarCalendar.textContent = stats.approved;
    if (badgeSidebarWaitingSelection) badgeSidebarWaitingSelection.textContent = stats.waiting_selection;
    if (badgeSidebarCancellationRequested) badgeSidebarCancellationRequested.textContent = stats.cancellation_requested;
    if (badgeSidebarRescheduleRequested) badgeSidebarRescheduleRequested.textContent = stats.reschedule_requested;
    if (badgeSidebarCancelledPendingDelete) badgeSidebarCancelledPendingDelete.textContent = stats.cancelled_pending_delete;
    if (badgeSidebarCancelledCompleted) badgeSidebarCancelledCompleted.textContent = stats.cancelled_completed;
  }

  // ========================================================
  // 4. CONFLICT DETECTION
  // ========================================================

  function calculateConflicts() {
    const conflicts = new Set();
    const confirmedList = allAppointments.filter(app =>
      app.status === 'approved' || app.status === 'confirmed_reschedule'
    );

    allAppointments.forEach(app => {
      if (app.status === 'rejected' || app.status === 'cancelled') return;
      const currentDate = app.status === 'confirmed_reschedule' && app.rescheduledDate ? app.rescheduledDate : app.date;
      const currentTime = app.status === 'confirmed_reschedule' && app.rescheduledTime ? app.rescheduledTime : app.timeSlot;
      const currentExec = app.executiveId;
      if (!currentDate || !currentTime || !currentExec) return;

      const hasConflict = confirmedList.some(other => {
        if (other.refCode === app.refCode) return false;
        const otherDate = other.status === 'confirmed_reschedule' && other.rescheduledDate ? other.rescheduledDate : other.date;
        const otherTime = other.status === 'confirmed_reschedule' && other.rescheduledTime ? other.rescheduledTime : other.timeSlot;
        return other.executiveId === currentExec && otherDate === currentDate && otherTime === currentTime;
      });

      if (hasConflict) conflicts.add(app.refCode);
    });

    return conflicts;
  }

  // ========================================================
  // 5. RENDER TABLE
  // ========================================================

  function renderAppointmentsTable() {
    if (!appointmentsTableBody) return;
    appointmentsTableBody.innerHTML = '';

    const queryText = searchInput?.value.toLowerCase().trim() || '';
    const dropDownStatus = statusFilterSelect?.value || 'all';
    const dropDownExec = execFilterSelect?.value || 'all';
    const conflictCodes = calculateConflicts();

    const filtered = allAppointments.filter(app => {
      const matchesSearch =
        app.clientName.toLowerCase().includes(queryText) ||
        app.clientCompany.toLowerCase().includes(queryText) ||
        (app.executiveHost || '').toLowerCase().includes(queryText) ||
        app.refCode.toLowerCase().includes(queryText) ||
        (app.purpose || '').toLowerCase().includes(queryText);

      let matchesNavTab = true;
      if (activeStatusFilter === 'pending') {
        matchesNavTab = app.status === 'pending';
      } else if (activeStatusFilter === 'approved') {
        matchesNavTab = ['approved','confirmed_reschedule','client_selected'].includes(app.status);
      } else if (activeStatusFilter === 'rejected') {
        matchesNavTab = app.status === 'rejected';
      } else if (activeStatusFilter === 'calendar') {
        matchesNavTab = ['approved','confirmed_reschedule','client_selected'].includes(app.status);
      } else if (activeStatusFilter === 'waiting_selection') {
        matchesNavTab = app.bookingType === 'secretary_allocate' &&
          !['client_selected','rejected','approved','confirmed_reschedule','cancellation_requested','cancelled','reschedule_requested'].includes(app.status);
      } else if (activeStatusFilter === 'cancellation_requested') {
        // *** แก้ไข: cancellation_requested ต้องแสดงในแท็บนี้เท่านั้น ไม่ใช่ pending ***
        matchesNavTab = app.status === 'cancellation_requested';
      } else if (activeStatusFilter === 'reschedule_requested') {
        matchesNavTab = app.status === 'reschedule_requested';
      } else if (activeStatusFilter === 'cancelled') {
        matchesNavTab = app.status === 'cancelled';
      } else if (activeStatusFilter === 'cancelled_pending_delete') {
        matchesNavTab = app.status === 'cancelled' && app.calendarDeleted !== true;
      } else if (activeStatusFilter === 'cancelled_completed') {
        matchesNavTab = app.status === 'cancelled' && app.calendarDeleted === true;
      }

      let matchesDropdownStatus = true;
      if (dropDownStatus !== 'all') {
        if (dropDownStatus === 'approved') {
          matchesDropdownStatus = ['approved','confirmed_reschedule','client_selected'].includes(app.status);
        } else {
          matchesDropdownStatus = app.status === dropDownStatus;
        }
      }

      const matchesDropdownExec = (dropDownExec === 'all') || (app.executiveId === dropDownExec);

      return matchesSearch && matchesNavTab && matchesDropdownStatus && matchesDropdownExec;
    });

    updateNavTabsStyling();

    if (filtered.length === 0) {
      appointmentsTableBody.innerHTML = `
        <tr>
          <td colspan="11" class="px-6 py-12 text-center text-sm text-gray-400">
            ไม่พบข้อมูลนัดหมายที่ตรงเกณฑ์
          </td>
        </tr>
      `;
      return;
    }

    filtered.forEach(app => {
      const isConflicted = conflictCodes.has(app.refCode);
      const tr = document.createElement('tr');

      if (isConflicted) {
        tr.className = 'bg-red-50 border-l-4 border-red-500 hover:bg-red-100/70 transition-all duration-150';
      } else {
        tr.className = 'border-b border-gray-100 hover:bg-slate-50/80 transition-colors duration-150';
      }

      let sMeta = statusLabel(app.status);

      if (app.status === 'client_selected') {
        sMeta = {
          key: 'client_selected',
          label: '🔔 ลูกค้าเลือกแล้ว รอยืนยัน',
          badgeClass: 'bg-emerald-800 text-white border border-emerald-900 animate-pulse font-bold',
          color: '#064E3B',
          icon: ''
        };
      }

      // *** แก้ไข: แสดง badge "รอเลือกคิว" เฉพาะกรณีที่ยังไม่ได้จัดการ ***
      if (app.bookingType === 'secretary_allocate' &&
          !['client_selected','rejected','approved','confirmed_reschedule','cancellation_requested','cancelled','pending_client_selection','reschedule_requested'].includes(app.status)) {
        sMeta = {
          key: 'wait_selection',
          label: 'รอเลือกคิว',
          badgeClass: 'bg-purple-100 text-purple-800 border border-purple-200',
          color: '#8B5CF6',
          icon: ''
        };
      }

      let priorityClass = 'bg-gray-100 text-gray-800';
      const prio = (app.priority || 'ทั่วไป').trim();
      if (prio === 'ด่วนมาก' || prio === 'สูง' || prio === 'ด่วน') {
        priorityClass = 'bg-red-100 text-red-800 font-bold';
      }

      let dateDisplay = `<div class="font-semibold text-[13px] text-gray-900">${formatDate(app.date)}</div>`;
      let timeDisplay = `<div class="text-[11px] text-gray-500 font-medium">${formatTime(app.timeSlot)}</div>`;

      if (app.status === 'rescheduled' && app.rescheduledDate) {
        dateDisplay = `
          <div class="text-xs text-gray-400 line-through">${formatDate(app.date)}</div>
          <div class="text-xs font-bold text-blue-600 mt-1">${formatDate(app.rescheduledDate)}</div>`;
        timeDisplay = `
          <div class="text-[11px] text-gray-400 line-through">${formatTime(app.timeSlot)}</div>
          <div class="text-[11px] font-bold text-blue-600">${formatTime(app.rescheduledTime)}</div>`;
      } else if (app.status === 'confirmed_reschedule' && app.rescheduledDate) {
        dateDisplay = `
          <div class="text-xs text-slate-400 line-through">${formatDate(app.date)}</div>
          <div class="text-sm font-bold text-emerald-600 mt-1">${formatDate(app.rescheduledDate)}</div>`;
        timeDisplay = `
          <div class="text-[11px] text-slate-400 line-through">${formatTime(app.timeSlot)}</div>
          <div class="text-[11px] font-bold text-emerald-600">${formatTime(app.rescheduledTime)}</div>`;
      }

      const warningHtml = isConflicted
        ? `<div class="mt-1 flex items-center space-x-1 text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded text-[10px] font-bold w-max">
            ⚠️ <span>เวลาทับซ้อน</span>
           </div>` : '';

      const isHighPrio = prio === 'ด่วนมาก' || prio === 'สูง' || prio === 'ด่วน' || prio.includes('ด่วน');
      const shortPrio = isHighPrio ? 'ด่วน' : 'ทั่วไป';
      const normalizedPriorityClass = isHighPrio ? 'bg-red-100 text-red-800 font-bold border border-red-200' : 'bg-gray-100 text-gray-800 border border-gray-200';

      const execId = app.executiveId || '';
      const execName = app.executiveHost || '';
      const matchedExec = EXECUTIVE_HOSTS.find(e => 
        e.id === execId || 
        execName.includes(e.id) || 
        execName.includes(e.name) || 
        e.name.includes(execName)
      );
      const hostShortTitle = matchedExec ? matchedExec.id : (app.executiveId || app.executiveHost || '-');
      const hostFullTitle = matchedExec ? matchedExec.fullTitle : (app.executiveHost || app.executiveId || '-');

      const clientNameFull = app.clientName || '-';
      const clientPhoneFull = app.clientPhone || app.phone || '-';
      const clientCompanyFull = app.clientCompany || '-';
      const purposeFull = app.purpose || '-';
      const purposeTruncated = purposeFull.length > 20 ? purposeFull.substring(0, 20) + '...' : purposeFull;

      tr.innerHTML = `
        <td class="px-4 py-4 whitespace-nowrap text-xs font-mono font-bold text-gray-500" style="width: 160px; min-width: 160px; max-width: 160px; overflow: hidden;" title="${app.refCode}">${app.refCode}</td>
        
        <td class="px-4 py-4 whitespace-nowrap" style="width: 130px; min-width: 130px; max-width: 130px; overflow: hidden;">
          <div class="text-xs font-bold text-[#1A1A2E] truncate" title="${clientNameFull}">${clientNameFull}</div>
          <div class="text-[10px] text-gray-400 truncate" title="${clientPhoneFull}">โทร: ${clientPhoneFull}</div>
        </td>
        
        <td class="px-4 py-4 whitespace-nowrap text-xs text-gray-600" style="width: 80px; min-width: 80px; max-width: 80px; overflow: hidden;">
          <div class="truncate" title="${clientCompanyFull}">${clientCompanyFull}</div>
        </td>
        
        <td class="px-4 py-4 whitespace-nowrap text-xs font-bold text-gray-700" style="width: 160px; min-width: 160px; max-width: 160px; overflow: hidden;">
          <div class="truncate text-indigo-900" title="${hostFullTitle}">${hostShortTitle}</div>
        </td>
        
        <td class="px-4 py-4 whitespace-nowrap text-center text-xs" style="width: 110px; min-width: 110px; max-width: 110px; overflow: hidden;">
          ${app.bookingType === 'secretary_allocate'
            ? `<span class="bg-purple-50 text-purple-700 px-2 py-0.5 rounded font-bold text-[10px] inline-block border border-purple-100" title="แบบที่ 2 (ให้เลขาจัดสรรคิว)">แบบ 2</span>`
            : `<span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold text-[10px] inline-block border border-blue-100" title="แบบที่ 1 (ระบุช่วงเวลาเอง)">แบบ 1</span>`}
        </td>
        
        <td class="px-4 py-4 text-xs text-gray-600" style="width: 150px; min-width: 150px; max-width: 150px; overflow: hidden;">
          <div class="truncate" title="${purposeFull}">${purposeTruncated}</div>
        </td>
        
        <td class="px-4 py-4 whitespace-nowrap text-center text-xs" style="width: 70px; min-width: 70px; max-width: 70px; overflow: hidden;">
          <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${normalizedPriorityClass}" title="${prio}">${shortPrio}</span>
        </td>
        
        <td class="px-4 py-4 text-xs" style="width: 120px; min-width: 120px; max-width: 120px; overflow: hidden;">
          <div class="leading-tight" title="${app.date ? formatDate(app.date) : ''} ${app.timeSlot || ''}">
            ${dateDisplay}
            ${timeDisplay}
            ${warningHtml}
          </div>
        </td>
        
        <td class="px-4 py-4 whitespace-nowrap text-xs" style="width: 130px; min-width: 130px; max-width: 130px; overflow: hidden;">
          <div class="flex flex-col space-y-0.5 items-start max-w-full">
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${sMeta.badgeClass} max-w-full" title="${sMeta.label}">
              <span class="w-1 h-1 rounded-full bg-current mr-1 flex-shrink-0"></span>
              <span class="truncate">${sMeta.label}</span>
            </span>
            ${app.status === 'cancelled' ? (
              app.calendarDeleted === true ? `
                <span class="truncate text-[9px] bg-emerald-50 text-emerald-700 px-1 py-0.5 rounded border border-emerald-100" title="ลบ Calendar แล้ว">
                  ✅ ลบ Cal แล้ว
                </span>
              ` : `
                <span class="truncate text-[9px] bg-amber-50 text-amber-700 px-1 py-0.5 rounded border border-amber-100" title="ยังไม่ลบ Calendar">
                  📅 ยังไม่ลบ Cal
                </span>
              `
            ) : ''}
          </div>
        </td>
        
        <td class="px-4 py-4 whitespace-nowrap text-right text-xs" style="width: 120px; min-width: 120px; max-width: 120px; overflow: hidden;">
          <button data-edit-ref="${app.refCode}" class="bg-[#1A1A2E] hover:bg-black font-semibold text-white py-1 px-2.5 rounded-lg transition-all cursor-pointer text-[10px] truncate max-w-full" title="จัดการและลงบัญชี">
            จัดการ
          </button>
        </td>
      `;
      appointmentsTableBody.appendChild(tr);
    });

    document.querySelectorAll('[data-edit-ref]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        openEditingModal(e.currentTarget.getAttribute('data-edit-ref'));
      });
    });
  }

  function updateNavTabsStyling() {
    document.querySelectorAll('[data-nav-target]').forEach(btn => {
      const target = btn.getAttribute('data-nav-target');
      if (target === activeStatusFilter) {
        btn.classList.add('bg-white/15', 'text-white', 'border-l-4', 'border-amber-400');
        btn.classList.remove('text-slate-300');
      } else {
        btn.classList.remove('bg-white/15', 'text-white', 'border-l-4', 'border-amber-400');
        btn.classList.add('text-slate-300');
      }
    });

    document.querySelectorAll('[data-tab-status]').forEach(btn => {
      const target = btn.getAttribute('data-tab-status');
      if (target === activeStatusFilter) {
        btn.className = "px-4 py-3 text-xs font-bold rounded-t-lg border-b-2 border-[#1A1A2E] text-[#1A1A2E] cursor-pointer whitespace-nowrap bg-white shadow-sm";
      } else {
        btn.className = "px-4 py-3 text-xs font-semibold rounded-t-lg border-b-2 border-transparent text-gray-500 hover:text-[#1A1A2E] cursor-pointer whitespace-nowrap";
      }
    });
  }

  // ========================================================
  // 6. WEBHOOK URL MANAGEMENT
  // ========================================================

  let GAS_WEBHOOK_URL = '';

  const sidebarWebhookUrl = document.getElementById('sidebar_webhook_url');
  const saveWebhookBtn = document.getElementById('save_webhook_btn');

  async function initializeWebhookUrl() {
    try {
      const url = await dbManager.getWebhookUrlByAdmin(currentAdminOwner);
      if (url) {
        GAS_WEBHOOK_URL = url;
        if (sidebarWebhookUrl) sidebarWebhookUrl.value = url;
      } else {
        const globalUrl = await dbManager.getGasWebhookUrl();
        if (globalUrl) {
          GAS_WEBHOOK_URL = globalUrl;
          if (sidebarWebhookUrl) sidebarWebhookUrl.value = globalUrl;
        } else {
          GAS_WEBHOOK_URL = '';
          if (sidebarWebhookUrl) sidebarWebhookUrl.value = '';
        }
      }
    } catch (err) {
      console.warn("Failed to load GAS webhook url:", err);
    }
  }

  if (saveWebhookBtn) {
    saveWebhookBtn.addEventListener('click', async () => {
      const url = sidebarWebhookUrl.value.trim();
      if (!url) { alert('กรุณากรอก Webhook URL'); return; }
      if (!url.startsWith('https://script.google.com/')) {
        alert('กรุณากรอก URL ของ Google Apps Script ที่ถูกต้อง');
        return;
      }
      saveWebhookBtn.disabled = true;
      saveWebhookBtn.textContent = 'กำลังบันทึก...';
      try {
        const success = await dbManager.setAdminSettings(currentAdminOwner, url, undefined);
        if (success) {
          GAS_WEBHOOK_URL = url;
          showToast('✅ บันทึก Webhook URL เรียบร้อยแล้ว');
        } else {
          alert('ไม่สามารถบันทึก Webhook URL ได้');
        }
      } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
      } finally {
        saveWebhookBtn.disabled = false;
        saveWebhookBtn.textContent = 'บันทึก Webhook URL';
      }
    });
  }

  // ========================================================
  // 7. GAS NOTIFICATION DISPATCHER
  // *** แก้ไขหลัก: ลบ mode:'no-cors' เพื่อให้อ่าน response ได้ ***
  // *** และรับ calendarEventId กลับมาบันทึกใน Firestore ***
  // ========================================================

  async function sendGasNotification(action, appointmentData) {
    let webhookUrl = '';
    
    // 1. ตรวจสอบว่า appointment นี้ผูกกับผู้บริหารคนไหน
    if (appointmentData) {
      const execId = appointmentData.executiveId || '';
      const execName = appointmentData.executiveHost || '';
      
      // 2. ค้นหา adminOwner ของผู้บริหารคนนั้นจาก EXECUTIVE_HOSTS
      const matchedExec = EXECUTIVE_HOSTS.find(e => e.id === execId || e.name === execName);
      const adminOwner = matchedExec ? matchedExec.adminOwner : 'admin1';
      
      // 3. เรียก dbManager.getWebhookUrlByAdmin(adminOwner)
      try {
        const fetchedUrl = await dbManager.getWebhookUrlByAdmin(adminOwner);
        if (fetchedUrl) {
          webhookUrl = fetchedUrl;
        }
      } catch (err) {
        console.warn(`Failed to fetch dynamic webhook URL for ${adminOwner}:`, err);
      }
    }

    // 4. Fallback ไปยัง webhook URL ตัวเดียว (global) หากหาไม่ได้
    if (!webhookUrl || webhookUrl.trim() === '') {
      webhookUrl = GAS_WEBHOOK_URL;
    }

    if (!webhookUrl || webhookUrl.trim() === '') {
      console.log(`[GAS Bypassed - no URL set] Action: ${action}`);
      return null;
    }

    try {
      console.log(`[GAS] Sending action: ${action} for ref: ${appointmentData.refCode} using URL: ${webhookUrl}`);

      // *** ลบ mode: 'no-cors' ออก เพื่อให้อ่าน response JSON ได้ ***
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, appointmentData })
      });

      if (!response.ok) {
        console.error(`[GAS] HTTP error: ${response.status}`);
        return null;
      }

      const result = await response.json().catch(() => ({}));
      console.log(`[GAS] Response for action ${action}:`, result);
      return result;

    } catch (error) {
      // ถ้า CORS error ให้ fallback กลับไปใช้ no-cors (ส่งได้แต่อ่าน response ไม่ได้)
      console.warn(`[GAS] Fetch failed, trying no-cors fallback:`, error.message);
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, appointmentData })
        });
        console.log(`[GAS] Sent via no-cors fallback (cannot read response)`);
      } catch (fallbackErr) {
        console.error('[GAS] Both fetch methods failed:', fallbackErr);
      }
      return null;
    }
  }

  // ========================================================
  // 8. TOAST NOTIFICATIONS
  // ========================================================

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const colorClass = type === 'success'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
      : type === 'warning'
        ? 'bg-amber-50 text-amber-800 border-amber-100'
        : 'bg-red-50 text-red-800 border-red-100';

    toast.className = `fixed bottom-5 right-5 z-[100] transform translate-y-10 opacity-0 transition-all duration-300 flex items-center space-x-2.5 px-4 py-3 rounded-xl shadow-xl border text-xs font-semibold ${colorClass}`;
    toast.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.remove('translate-y-10', 'opacity-0'), 10);
    setTimeout(() => {
      toast.classList.add('translate-y-10', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ========================================================
  // 9. CONFLICT CHECK
  // ========================================================

  async function checkConflict(executiveName, proposedDate, proposedTime, durationHours) {
    const slots = await dbManager.getExecutiveSlots(executiveName);

    let proposedStart, proposedEnd;
    if (proposedTime.includes('-')) {
      const parts = proposedTime.split('-');
      proposedStart = parts[0].trim();
      proposedEnd = parts[1].trim();
    } else {
      proposedStart = proposedTime.trim();
      const [h, m] = proposedStart.split(':').map(Number);
      const dur = parseFloat(durationHours) || 1;
      const endMin = h * 60 + m + Math.round(dur * 60);
      proposedEnd = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    }

    const parseToMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const propStart = parseToMin(proposedStart);
    const propEnd = parseToMin(proposedEnd);
    const now = Date.now();

    for (const slot of slots) {
      if (slot.appointmentRef === currentEditingRef) continue;
      if (slot.date !== proposedDate) continue;

      const slotStatus = slot.status || 'confirmed';
      if (slotStatus === 'pending') {
        if (slot.expiresAt && new Date(slot.expiresAt).getTime() < now) {
          continue;
        }
      }

      const slotStart = parseToMin(slot.startTime);
      const slotEnd = parseToMin(slot.endTime);
      if (propStart < slotEnd && propEnd > slotStart) {
        return { hasConflict: true, conflictWith: slot.appointmentRef };
      }
    }
    return { hasConflict: false, conflictWith: null };
  }

  // ========================================================
  // 10. MODAL
  // ========================================================

  const approvalFields = document.getElementById('approval_fields');
  const editApprovedDate = document.getElementById('edit_approved_date');
  const editApprovedStartTime = document.getElementById('edit_approved_start_time');
  const editApprovedEndTime = document.getElementById('edit_approved_end_time');
  const rejectionFields = document.getElementById('rejection_fields');
  const editRejectionReason = document.getElementById('edit_rejection_reason');
  const optionBProposalsPanel = document.getElementById('option_b_proposals_panel');
  const optionBSlotsList = document.getElementById('option_b_slots_list');
  const optionAInfoPanel = document.getElementById('option_a_info_panel');
  const optionAHoursText = document.getElementById('option_a_hours_text');
  const offerSlotsFields = document.getElementById('offer_slots_fields');
  const offerSlotsHoursText = document.getElementById('offer_slots_hours_text');
  const offerSlotDate1 = document.getElementById('offer_slot_date_1');
  const offerSlotStartTime1 = document.getElementById('offer_slot_start_time_1');
  const offerSlotEndTime1 = document.getElementById('offer_slot_end_time_1');
  const offerSlotDate2 = document.getElementById('offer_slot_date_2');
  const offerSlotStartTime2 = document.getElementById('offer_slot_start_time_2');
  const offerSlotEndTime2 = document.getElementById('offer_slot_end_time_2');
  const offerSlotDate3 = document.getElementById('offer_slot_date_3');
  const offerSlotStartTime3 = document.getElementById('offer_slot_start_time_3');
  const offerSlotEndTime3 = document.getElementById('offer_slot_end_time_3');
  const slot2RequiredLabel = document.getElementById('slot_2_required_label');
  const slot3RequiredLabel = document.getElementById('slot_3_required_label');

  function updateModalDynamicFields(status, app) {
    approvalFields?.classList.add('hidden');
    rejectionFields?.classList.add('hidden');
    rescheduleFields?.classList.add('hidden');
    offerSlotsFields?.classList.add('hidden');

    [editApprovedDate, editApprovedStartTime, editApprovedEndTime, editRejectionReason, editRescheduleDate, editRescheduleStartTime, editRescheduleEndTime,
     offerSlotDate1, offerSlotStartTime1, offerSlotEndTime1, offerSlotDate2, offerSlotStartTime2, offerSlotEndTime2,
     offerSlotDate3, offerSlotStartTime3, offerSlotEndTime3].forEach(el => {
      if (el) el.required = false;
    });

    if (status === 'approved') {
      approvalFields?.classList.remove('hidden');
      if (editApprovedDate) editApprovedDate.required = true;
      if (editApprovedStartTime) editApprovedStartTime.required = true;
      if (editApprovedEndTime) editApprovedEndTime.required = true;

      const isClientPick = app?.bookingType === 'client_pick' || app?.timeOption === 'B';
      const hasProposedDates = (app?.proposedDates && app.proposedDates.length > 0) || (app?.optionBProposedSlots && app.optionBProposedSlots.length > 0);

      if (isClientPick && hasProposedDates) {
        optionBProposalsPanel?.classList.remove('hidden');
        optionAInfoPanel?.classList.add('hidden');
        if (optionBSlotsList) {
          const slotsArray = app.proposedDates || app.optionBProposedSlots;
          optionBSlotsList.innerHTML = slotsArray.map((slot, idx) => {
            const sDate = slot.date;
            let sStartTime = '';
            let sEndTime = '';
            let timeStr = 'ยังไม่ระบุเวลา';

            if (slot.startTime !== undefined) {
              sStartTime = slot.startTime || '';
              sEndTime = slot.endTime || '';
              if (sStartTime && sEndTime) {
                timeStr = `${sStartTime} - ${sEndTime} น.`;
              }
            } else if (slot.time) {
              const tVal = slot.time;
              if (tVal !== 'TBD' && tVal.includes('-')) {
                const parts = tVal.split('-');
                sStartTime = parts[0].trim();
                sEndTime = parts[1].trim();
                timeStr = `${sStartTime} - ${sEndTime} น.`;
              } else {
                timeStr = tVal;
              }
            }

            return `
              <button type="button" class="w-full text-left p-2 hover:bg-emerald-50 border border-gray-100 rounded flex justify-between items-center transition-all cursor-pointer bg-white" data-slot-date="${sDate}" data-slot-start="${sStartTime}" data-slot-end="${sEndTime}">
                <span>ตัวเลือกที่ ${idx + 1}: <strong>${formatDate(sDate)}</strong> เวลา: <strong>${timeStr}</strong></span>
                <span class="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">เลือกเวลานี้</span>
              </button>
            `;
          }).join('');

          optionBSlotsList.querySelectorAll('[data-slot-date]').forEach(btn => {
            btn.addEventListener('click', (e) => {
              const sDate = e.currentTarget.getAttribute('data-slot-date');
              const sStart = e.currentTarget.getAttribute('data-slot-start');
              const sEnd = e.currentTarget.getAttribute('data-slot-end');
              if (editApprovedDate) editApprovedDate.value = sDate;
              if (editApprovedStartTime) editApprovedStartTime.value = sStart;
              if (editApprovedEndTime) editApprovedEndTime.value = sEnd;
            });
          });
        }
      } else {
        optionBProposalsPanel?.classList.add('hidden');
        const isSecAllocate = app?.bookingType === 'secretary_allocate' || app?.timeOption === 'A';
        if (isSecAllocate) {
          optionAInfoPanel?.classList.remove('hidden');
          const rangeText = (app.preferredDateFrom || app.preferredDateTo)
            ? ` (ช่วงวันที่ต้องการ: ${app.preferredDateFrom || 'ไม่จำกัด'} ถึง ${app.preferredDateTo || 'ไม่จำกัด'})`
            : ' (ไม่จำกัดช่วงเวลา)';
          if (optionAHoursText) {
            optionAHoursText.textContent = (app.optionAHours || app.optionHours || '1 ชั่วโมง') + rangeText;
          }
        } else {
          optionAInfoPanel?.classList.add('hidden');
        }
      }
    } else if (status === 'rejected') {
      rejectionFields?.classList.remove('hidden');
      if (editRejectionReason) editRejectionReason.required = true;
    } else if (status === 'rescheduled') {
      rescheduleFields?.classList.remove('hidden');
      if (editRescheduleDate) editRescheduleDate.required = true;
      if (editRescheduleStartTime) editRescheduleStartTime.required = true;
      if (editRescheduleEndTime) editRescheduleEndTime.required = true;
    } else if (status === 'pending_client_selection') {
      offerSlotsFields?.classList.remove('hidden');
      if (offerSlotDate1) offerSlotDate1.required = true;
      if (offerSlotStartTime1) offerSlotStartTime1.required = true;
      if (offerSlotEndTime1) offerSlotEndTime1.required = true;
      if (app) {
        if (offerSlotsHoursText) offerSlotsHoursText.textContent = app.optionAHours || app.optionHours || 1;
        const val = parseInt(app.slotCount || 1);
        if (val >= 2) {
          if (offerSlotDate2) offerSlotDate2.required = true;
          if (offerSlotStartTime2) offerSlotStartTime2.required = true;
          if (offerSlotEndTime2) offerSlotEndTime2.required = true;
          slot2RequiredLabel?.classList.remove('hidden');
        } else {
          slot2RequiredLabel?.classList.add('hidden');
        }

        if (val >= 3) {
          if (offerSlotDate3) offerSlotDate3.required = true;
          if (offerSlotStartTime3) offerSlotStartTime3.required = true;
          if (offerSlotEndTime3) offerSlotEndTime3.required = true;
          slot3RequiredLabel?.classList.remove('hidden');
        } else {
          slot3RequiredLabel?.classList.add('hidden');
        }
      }
    }

    const calendarDeletionSection = document.getElementById('calendar_deletion_section');
    if (calendarDeletionSection) {
      if (status === 'cancelled' && app) {
        calendarDeletionSection.classList.remove('hidden');
        if (app.calendarDeleted === true) {
          calendarDeletionSection.innerHTML = `
            <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:12px; margin-top:16px; font-family: sans-serif;">
              ✅ ลบ Google Calendar เรียบร้อยแล้ว
            </div>
          `;
        } else {
          const clientName = app.clientName || '-';
          const confDate = formatDate(app.confirmedDate || app.date || '');
          calendarDeletionSection.innerHTML = `
            <div style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; padding:16px; margin-top:16px; font-family: sans-serif;">
              <p>⚠️ <strong>กรุณาดำเนินการ:</strong></p>
              <ol class="list-decimal list-inside space-y-1 mt-2 text-gray-700">
                <li>เปิด Google Calendar</li>
                <li>ค้นหา event ชื่อ "${clientName}" วันที่ ${confDate}</li>
                <li>กดลบ event นั้นออก</li>
                <li>กลับมากดปุ่มด้านล่างเพื่อบันทึก</li>
              </ol>
              <button id="btn_confirm_calendar_deleted" type="button" 
                style="background:#10B981; color:white; padding:10px 20px; 
                       border:none; border-radius:8px; cursor:pointer; margin-top:12px; font-weight: 600;">
                ✅ ยืนยันว่าลบ Google Calendar แล้ว
              </button>
            </div>
          `;
          
          const btnConfirmDelete = document.getElementById('btn_confirm_calendar_deleted');
          if (btnConfirmDelete) {
            btnConfirmDelete.addEventListener('click', async () => {
              try {
                btnConfirmDelete.disabled = true;
                btnConfirmDelete.textContent = 'กำลังบันทึก...';
                
                await dbManager.updateAppointment(app.refCode, {
                  calendarDeleted: true,
                  calendarDeletedAt: new Date().toISOString(),
                  calendarDeletedNote: "Admin ยืนยันลบด้วยตนเอง"
                });

                try {
                  await dbManager.appendTimelineEvent(app.refCode, {
                    action: "cancelled",
                    label: "ยืนยันลบใน Google Calendar",
                    detail: "เลขานุการได้ลบรายการนัดหมายนี้ในปฏิทิน Google Calendar เรียบร้อยแล้ว",
                    by: "admin",
                    timestamp: new Date().toISOString()
                  });
                } catch (tlErr) {
                  console.error("Failed to append timeline event for calendar deletion:", tlErr);
                }
                
                app.calendarDeleted = true;
                app.calendarDeletedAt = new Date().toISOString();
                app.calendarDeletedNote = "Admin ยืนยันลบด้วยตนเอง";
                
                showToast("✅ บันทึกสถานะการลบ Calendar แล้ว", "success");
                
                btnConfirmDelete.textContent = 'บันทึกแล้ว';
                btnConfirmDelete.style.background = '#9CA3AF';
                btnConfirmDelete.style.cursor = 'not-allowed';
                btnConfirmDelete.disabled = true;
                
                updateMetricMetrics();
                renderAppointmentsTable();
                
                setTimeout(() => {
                  if (currentEditingApp && currentEditingApp.refCode === app.refCode) {
                    updateModalDynamicFields('cancelled', currentEditingApp);
                  }
                }, 1000);
                
              } catch (err) {
                alert('เกิดข้อผิดพลาด: ' + err.message);
                btnConfirmDelete.disabled = false;
                btnConfirmDelete.textContent = '✅ ยืนยันว่าลบ Google Calendar แล้ว';
              }
            });
          }
        }
      } else {
        calendarDeletionSection.classList.add('hidden');
        calendarDeletionSection.innerHTML = '';
      }
    }

    if (app) {
      renderStepByStep(app, status);
    }
  }

  function renderStepByStep(app, activeStatus) {
    const container = document.getElementById('step_by_step_container');
    if (!container) return;
    container.innerHTML = '';

    const status = activeStatus || app.status;
    const bType = app.bookingType;
    const dateStr = formatDate(app.confirmedDate || app.date || '');
    const timeStr = formatTime(app.confirmedTime || app.timeSlot || '');
    const duration = app.optionAHours || app.optionHours || '1 ชั่วโมง';
    const durationFormatted = duration.includes('ชั่วโมง') || duration.includes('นาที') ? duration : `${duration} ชั่วโมง`;

    let html = '';

    // Case 1: client_pick & pending
    if (bType === 'client_pick' && status === 'pending') {
      html = `
        <div class="bg-sky-50 border border-sky-100 p-4 rounded-xl text-sky-950 space-y-3">
          <p class="font-medium text-xs leading-relaxed">
            📋 <strong>ลูกค้าระบุวันเวลาเองมาแล้ว:</strong> วันที่ ${dateStr} เวลา ${timeStr} (${durationFormatted})<br>
            กรุณาตรวจสอบตารางงานผู้บริหาร แล้วเลือกดำเนินการ:
          </p>
          <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" class="btn-step bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer" data-action="approved">
              ✅ อนุมัติคิวนี้เลย
            </button>
            <button type="button" class="btn-step bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer" data-action="rescheduled">
              📅 เสนอเวลาใหม่
            </button>
            <button type="button" class="btn-step bg-red-600 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer" data-action="rejected">
              ❌ ปฏิเสธ
            </button>
          </div>
        </div>
      `;
    }
    // Case 2: secretary_allocate & pending
    else if (bType === 'secretary_allocate' && status === 'pending') {
      const qCount = app.slotCount || 1;
      html = `
        <div class="bg-purple-50 border border-purple-100 p-4 rounded-xl text-purple-950 space-y-3">
          <p class="font-medium text-xs leading-relaxed">
            📋 <strong>ลูกค้าให้เลขาจัดเวลาให้:</strong> (ต้องการ ${qCount} คิว, ${durationFormatted})<br>
            กรุณาเปิดตารางงานผู้บริหาร แล้วจัดสรรคิวที่ว่าง:
          </p>
          <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" class="btn-step bg-purple-600 hover:bg-purple-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer" data-action="pending_client_selection">
              📋 จัดสรรคิวให้ลูกค้าเลือก
            </button>
            <button type="button" class="btn-step bg-red-600 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer" data-action="rejected">
              ❌ ปฏิเสธ
            </button>
          </div>
        </div>
      `;
    }
    // Case 3: pending_client_selection
    else if (status === 'pending_client_selection') {
      const pSlots = app.proposedSlots || [];
      const slotsListHtml = pSlots.map((s, i) => `<li>ช่วงที่ ${i+1}: วันที่ ${formatDate(s.date)} เวลา ${s.time}</li>`).join('');
      html = `
        <div class="bg-amber-50 border border-amber-200 p-4 rounded-xl text-amber-950 space-y-3">
          <p class="font-medium text-xs leading-relaxed">
            ⏳ <strong>รอลูกค้าเลือกคิว</strong> — ได้เสนอ ${pSlots.length} คิวไปแล้ว<br>
            <strong>คิวที่เสนอ:</strong>
            <ul class="list-disc list-inside mt-1 text-[11px] text-amber-800 space-y-0.5 font-sans font-semibold">
              ${slotsListHtml || '<li>ไม่มีรายการคิวเสนอ</li>'}
            </ul>
            <span class="block mt-1.5 text-amber-700">ยังไม่ต้องดำเนินการใด รอลูกค้าเลือกก่อน</span>
          </p>
          <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" class="btn-step bg-red-600 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer" data-action="rejected">
              ❌ ยกเลิกและปฏิเสธ
            </button>
          </div>
        </div>
      `;
    }
    // Case 4: client_selected
    else if (status === 'client_selected') {
      const selectedDate = app.confirmedDate || app.selectedSlotDate || app.date || '';
      const selectedTime = app.confirmedTime || app.selectedSlotTime || app.timeSlot || '';
      html = `
        <div class="bg-emerald-50 border border-emerald-100 p-4 rounded-xl text-emerald-950 space-y-3">
          <p class="font-medium text-xs leading-relaxed">
            ✅ <strong>ลูกค้าเลือกคิวแล้ว รอการยืนยันจากเลขาฯ</strong><br>
            คิวที่ลูกค้าเลือก: <strong>วันที่ ${formatDate(selectedDate)} เวลา ${selectedTime}</strong>
          </p>
          <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" class="btn-step bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer font-bold" data-action="approved" data-auto-date="${selectedDate}" data-auto-time="${selectedTime}">
              ✅ ยืนยันอนุมัติคิวที่ลูกค้าเลือก
            </button>
            <button type="button" class="btn-step bg-red-600 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer font-bold" data-action="rejected">
              ❌ ปฏิเสธ
            </button>
          </div>
        </div>
      `;
    }
    // Case 5: cancellation_requested
    else if (status === 'cancellation_requested') {
      html = `
        <div class="bg-rose-50 border border-rose-100 p-4 rounded-xl text-rose-950 space-y-3">
          <p class="font-medium text-xs leading-relaxed">
            ⚠️ <strong>ลูกค้าขอยกเลิกนัดหมายนี้</strong><br>
            กรุณาตรวจสอบและดำเนินการ:
          </p>
          <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" class="btn-step bg-red-600 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer" data-action="cancelled">
              ✅ ยืนยันยกเลิก
            </button>
            <button type="button" class="btn-step bg-gray-600 hover:bg-gray-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer" data-action="approved">
              ↩️ ไม่ยกเลิก คืนสถานะ approved
            </button>
          </div>
        </div>
      `;
    }
    // Case 5.5: reschedule_requested
    else if (status === 'reschedule_requested') {
      const isFromOffer = app.rescheduleContext === 'from_offer_slots';
      if (isFromOffer) {
        html = `
          <div class="bg-blue-50 border border-blue-100 p-4 rounded-xl text-blue-950 space-y-3 font-sans">
            <p class="font-bold text-xs leading-relaxed text-blue-900">
              ⚠️ <strong>ลูกค้าไม่ต้องการคิวที่เสนอ ขอให้จัดสรรคิวใหม่</strong>
            </p>
            <div class="flex flex-wrap gap-2.5 pt-1 font-sans">
              <button type="button" class="btn-step bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer font-bold flex items-center space-x-1" data-action="rescheduled">
                📋 จัดสรรคิวใหม่ให้ลูกค้าเลือก
              </button>
              <button type="button" class="btn-step bg-red-600 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer font-bold flex items-center space-x-1" data-action="rejected">
                ❌ ปฏิเสธ
              </button>
            </div>
          </div>
        `;
      } else {
        html = `
          <div class="bg-blue-50 border border-blue-100 p-4 rounded-xl text-blue-950 space-y-3 font-sans">
            <p class="font-bold text-xs leading-relaxed">
              🔵 <strong>กรุณาตรวจสอบข้อเสนอเลื่อนวันนัดหมายและกดเลือกวิธีการตอบรับ:</strong>
            </p>
            <div class="flex flex-wrap gap-2.5 pt-1 font-sans">
              <button type="button" class="btn-step bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer font-bold flex items-center space-x-1" data-action="rescheduled">
                📅 เสนอวันใหม่ให้ลูกค้า
              </button>
              <button type="button" class="btn-step bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer font-bold flex items-center space-x-1" data-action="approved">
                ✅ อนุมัติวันที่ลูกค้าขอ
              </button>
              <button type="button" class="btn-step bg-red-600 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer font-bold flex items-center space-x-1" data-action="rejected">
                ❌ ปฏิเสธ
              </button>
            </div>
          </div>
        `;
      }
    }
    // Case 5.7: rescheduled
    else if (status === 'rescheduled') {
      const resDate = app.rescheduledDate || '';
      const resTime = app.rescheduledTime || '';
      html = `
        <div class="bg-blue-50 border border-blue-100 p-4 rounded-xl text-blue-950 space-y-3 font-sans">
          <p class="font-medium text-xs leading-relaxed text-blue-900">
            ⏳ <strong>เสนอเลื่อนนัดหมายแล้ว (Rescheduled)</strong><br>
            ได้ส่งข้อเสนอเลื่อนวันนัดหมายใหม่ไปยังลูกค้าแล้ว รอลูกค้าดำเนินการตอบรับผ่านระบบ<br>
            <strong>เวลาเลื่อนนัดที่เสนอ:</strong> วันที่ ${formatDate(resDate)} เวลา ${resTime} น.
          </p>
          <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" class="btn-step bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer font-bold flex items-center space-x-1" data-action="approved">
              ✅ เปลี่ยนใจอนุมัติคิวเดิมแทน
            </button>
            <button type="button" class="btn-step bg-red-600 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer font-bold flex items-center space-x-1" data-action="rejected">
              ❌ ยกเลิกและปฏิเสธนัดหมาย
            </button>
          </div>
        </div>
      `;
    }
    // Case 6: approved or confirmed_reschedule
    else if (status === 'approved' || status === 'confirmed_reschedule') {
      const confDate = app.confirmedDate || app.date || '';
      const confTime = app.confirmedTime || app.timeSlot || '';
      html = `
        <div class="bg-emerald-50 border border-emerald-100 p-4 rounded-xl text-emerald-900 space-y-3">
          <p class="font-medium text-xs leading-relaxed">
            ✅ <strong>อนุมัติแล้ว:</strong> วันที่ ${formatDate(confDate)} เวลา ${confTime}<br>
            นัดหมายนี้ได้รับการยืนยันแล้ว
          </p>
          <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" class="btn-step bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer" data-action="rescheduled">
              📅 เลื่อนนัด
            </button>
            <button type="button" class="btn-step bg-red-600 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer" data-action="cancelled">
              🚫 ยกเลิกนัดหมาย
            </button>
          </div>
        </div>
      `;
    }
    // Catch-all (e.g., cancelled or rejected)
    else {
      const isRej = status === 'rejected';
      html = `
        <div class="${isRej ? 'bg-red-50 border-red-100 text-red-900' : 'bg-gray-50 border-gray-200 text-gray-700'} p-4 border rounded-xl">
          <p class="font-medium text-xs leading-relaxed">
            🏁 <strong>นัดหมายได้รับการดำเนินการเสร็จสิ้นแล้ว</strong><br>
            สถานะปัจจุบัน: <strong>${isRej ? '❌ ปฏิเสธนัดหมายเรียบร้อย' : '🚫 ยกเลิกนัดหมายเรียบร้อย'}</strong>
          </p>
        </div>
      `;
    }

    container.innerHTML = html;

    // Attach click events on the buttons to trigger status selection change!
    container.querySelectorAll('.btn-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.getAttribute('data-action');
        const autoDate = btn.getAttribute('data-auto-date');
        const autoTime = btn.getAttribute('data-auto-time');

        if (editStatusSelect) {
          editStatusSelect.value = action;
          editStatusSelect.dispatchEvent(new Event('change'));
        }

        if (autoDate && editApprovedDate) editApprovedDate.value = autoDate;
        if (autoTime) {
          if (autoTime.includes('-')) {
            const parts = autoTime.split('-');
            if (editApprovedStartTime) editApprovedStartTime.value = parts[0].trim();
            if (editApprovedEndTime) editApprovedEndTime.value = parts[1].trim();
          } else {
            if (editApprovedStartTime) editApprovedStartTime.value = autoTime;
            if (editApprovedEndTime) editApprovedEndTime.value = '';
          }
        }

        // Programmatic instant submit for client_selected approval!
        if (status === 'client_selected' && action === 'approved') {
          if (editForm) {
            editForm.dispatchEvent(new Event('submit'));
          }
        }
      });
    });
  }

  function openEditingModal(refCode) {
    currentEditingRef = refCode;
    const app = allAppointments.find(item => item.refCode === refCode);
    if (!app) return;
    currentEditingApp = app;

    if (editRefCode) editRefCode.textContent = app.refCode;

    if (editClientInfo) {
      let attendeesHtml = '';
      if (app.additionalAttendees?.length > 0) {
        attendeesHtml = `
          <div class="col-span-2 mt-2 pt-2 border-t border-gray-100">
            <strong class="text-gray-400 uppercase block text-[10px] mb-1.5">ผู้เข้าร่วม (${app.additionalAttendees.length} คน)</strong>
            <table class="min-w-full divide-y divide-gray-150 border border-gray-100 rounded-lg overflow-hidden">
              <thead class="bg-gray-50 text-left text-[10px] font-bold text-gray-500 uppercase">
                <tr>
                  <th class="px-3 py-1.5">#</th>
                  <th class="px-3 py-1.5">ชื่อ-นามสกุล</th>
                  <th class="px-3 py-1.5">ตำแหน่ง</th>
                  <th class="px-3 py-1.5">อีเมล</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-100 text-[11px] text-gray-700">
                ${app.additionalAttendees.map((att, i) => `
                  <tr>
                    <td class="px-3 py-2 font-bold text-gray-500">${i + 1}</td>
                    <td class="px-3 py-2 font-semibold">${att.name || '-'}</td>
                    <td class="px-3 py-2 text-gray-600">${att.position || '-'}</td>
                    <td class="px-3 py-2 font-mono text-gray-500">${att.email || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`;
      }

      let rescheduleHighlightHtml = '';
      if (app.status === 'reschedule_requested' || app.rescheduleReason) {
        const rType = app.rescheduleType || 'specific_dates';
        let typeHtml = '';

        if (rType === 'specific_dates') {
          const proposedList = app.proposedRescheduleDates || [];
          let slotsHtml = '';
          if (proposedList.length > 0) {
            slotsHtml = proposedList.map((slot, index) => {
              const hasTime = slot.startTime && slot.startTime !== 'TBD' && slot.endTime && slot.endTime !== 'TBD';
              const timeString = hasTime ? `เวลา ${slot.startTime} - ${slot.endTime} น.` : 'ยังไม่ระบุเวลา';
              return `
                <div class="flex items-center justify-between p-2.5 bg-white border border-blue-100 rounded-lg hover:border-blue-300 transition-all">
                  <span class="text-xs font-medium text-gray-700">
                    📅 วันที่ ${index + 1}: <strong class="text-blue-950 font-bold font-sans">${formatDate(slot.date)}</strong> ${timeString}
                  </span>
                  <button type="button" class="btn-select-reschedule-slot bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 py-1 rounded text-[11px] transition-all cursor-pointer" 
                    data-date="${slot.date}" 
                    data-start="${hasTime ? slot.startTime : ''}" 
                    data-end="${hasTime ? slot.endTime : ''}">
                    เลือก
                  </button>
                </div>
              `;
            }).join('');
          } else {
            slotsHtml = '<div class="text-xs text-gray-400">ไม่พบข้อมูลวันที่เสนอ</div>';
          }

          typeHtml = `
            <div class="space-y-1.5 mt-2">
              <strong class="text-xs font-bold text-blue-900 block font-sans">วันที่ลูกค้าเสนอ:</strong>
              <div class="space-y-1.5">${slotsHtml}</div>
            </div>
          `;
        } else if (rType === 'date_range') {
          const fromDateStr = app.rescheduleRangeDateFrom ? formatDate(app.rescheduleRangeDateFrom) : 'ไม่ระบุ';
          const toDateStr = app.rescheduleRangeDateTo ? formatDate(app.rescheduleRangeDateTo) : 'เป็นต้นไป';
          typeHtml = `
            <div class="mt-2 space-y-1 text-xs">
              <div>
                <strong class="text-gray-500 font-sans block">ช่วงวันที่ลูกค้าต้องการ:</strong>
                <span class="text-sm font-bold text-blue-700 font-sans">${fromDateStr} ถึง ${toDateStr}</span>
              </div>
              <div class="text-[11px] text-gray-400 font-sans italic mt-1 block">
                *(เลขาฯ เป็นผู้จัดสรรวันและเวลาให้)
              </div>
            </div>
          `;
        }

        const isFromOffer = app.rescheduleContext === 'from_offer_slots';
        rescheduleHighlightHtml = `
          <div class="col-span-2 bg-blue-50/70 border border-blue-200 p-4 rounded-xl text-blue-950 space-y-3 mt-2 font-sans">
            <div class="flex items-center space-x-1.5 text-xs font-bold text-blue-800 uppercase tracking-wider">
              <span>${isFromOffer ? '⚠️ ลูกค้าไม่ต้องการคิวที่เสนอ ขอให้จัดสรรคิวใหม่' : '🔵 ลูกค้าส่งคำขอเลื่อนวันนัดหมาย'}</span>
            </div>
            
            ${typeHtml}

            <div class="text-xs pt-1 border-t border-blue-100">
              <strong class="text-gray-500 block">${isFromOffer ? 'เหตุผล / รายละเอียดความสะดวกเพิ่มเติม:' : 'เหตุผลในการขอเลื่อน:'}</strong>
              <span class="text-sm font-semibold text-gray-800">${app.rescheduleReason || '-'}</span>
            </div>
          </div>
        `;
      }

      let cancellationHighlightHtml = '';
      if (app.status === 'cancellation_requested' || app.cancellationReason) {
        cancellationHighlightHtml = `
          <div class="col-span-2 bg-rose-50 border border-rose-200 p-4 rounded-xl text-rose-950 space-y-2 mt-2 font-sans">
            <div class="flex items-center space-x-1 text-xs font-bold text-rose-800 uppercase tracking-wider">
              <span>⚠️ ลูกค้าส่งคำขอเลิกนัดหมาย</span>
            </div>
            <div class="text-xs">
              <strong class="text-gray-500 block">เหตุผลในการขอยกเลิก:</strong>
              <span class="text-sm font-semibold text-rose-900">${app.cancellationReason || '-'}</span>
            </div>
          </div>
        `;
      }

      editClientInfo.innerHTML = `
        <div class="grid grid-cols-2 gap-3.5 text-xs">
          <div>
            <strong class="text-gray-400 uppercase block text-[10px]">ผู้ขอเข้าพบ</strong>
            <span class="text-sm font-bold text-[#1A1A2E] block mt-0.5">${app.clientName}</span>
            <span class="text-[11px] text-gray-500 block">${app.clientCompany}</span>
            <span class="text-[11px] text-gray-400 block">ตำแหน่ง: ${app.position || '-'}</span>
          </div>
          <div>
            <strong class="text-gray-400 uppercase block text-[10px]">ผู้บริหาร</strong>
            <span class="text-sm font-semibold text-[#2C3E50] block mt-0.5">${app.executiveHost || app.executiveId}</span>
            <span class="text-[11px] text-gray-500 block mt-1">วัตถุประสงค์:</span>
            <span class="text-[11px] font-bold text-gray-700 block">${app.purposeMain || 'ทั่วไป'}</span>
          </div>
          <div>
            <strong class="text-gray-400 uppercase block text-[10px]">ข้อมูลติดต่อ</strong>
            <span class="font-mono text-gray-600 block mt-0.5">${app.clientEmail}</span>
            <span class="text-gray-500 block mt-0.5">โทร: ${app.clientPhone || app.phone || '-'}</span>
          </div>
          <div>
            <strong class="text-gray-400 uppercase block text-[10px] text-indigo-600">วันเวลาที่ระบุมาเบื้องต้น</strong>
            ${app.bookingType === 'client_pick' || app.timeOption === 'B' ? `
              <div class="text-[11px] text-gray-700 mt-1 space-y-0.5 leading-relaxed">
                ${(app.proposedDates || (app.optionBProposedSlots ? app.optionBProposedSlots.map(s => ({date: s.date, startTime: s.time?.split('-')?.[0]?.trim() || '', endTime: s.time?.split('-')?.[1]?.trim() || ''})) : [{date: app.date, startTime: app.startTime, endTime: app.endTime}])).map((slot, i) => {
                  const tStr = (slot.startTime && slot.endTime) ? `เวลา ${slot.startTime} - ${slot.endTime} น.` : 'ยังไม่ระบุเวลา';
                  return `<div>• วันที่ ${formatDate(slot.date)} ${tStr}</div>`;
                }).join('')}
              </div>
            ` : `
              <span class="text-gray-700 block mt-0.5 font-sans">
                ${(app.preferredDateFrom || app.preferredDateTo) ? `ช่วงวันที่: ${app.preferredDateFrom || 'ไม่จำกัด'} ถึง ${app.preferredDateTo || 'ไม่จำกัด'}` : 'ไม่จำกัดช่วงเวลา'}
              </span>
              <span class="text-[10px] text-gray-400 block mt-0.5">
                ให้เลขาจัดเวลา (จำนวน ${app.slotCount || 1} คิว, ${app.optionAHours || app.optionHours || '1'} ชม.)
              </span>
            `}
          </div>
          <div class="col-span-2 bg-slate-50 p-2.5 rounded border border-slate-100">
            <strong class="text-gray-400 uppercase block text-[10px] mb-1">รูปแบบและสถานที่</strong>
            <span class="text-[11px] text-gray-800">
              ${app.meetingFormat === 'online' ? '🟢 ออนไลน์' : '🏢 ออนไซต์'}
              ${app.meetingFormat === 'onsite' ? ` — ${app.meetingLocation || '-'}` : ''}
            </span>
          </div>
          ${app.additionalDetails ? `
          <div class="col-span-2">
            <strong class="text-gray-400 uppercase block text-[10px]">รายละเอียดเพิ่มเติม</strong>
            <p class="text-[11px] text-gray-600 bg-amber-50/40 p-2 rounded border border-amber-100 mt-0.5 whitespace-pre-line">${app.additionalDetails}</p>
          </div>` : ''}
          ${rescheduleHighlightHtml}
          ${cancellationHighlightHtml}
          ${attendeesHtml}
        </div>
      `;

      // Attach click listeners to select buttons inside the reschedule specific_dates slots
      editClientInfo.querySelectorAll('.btn-select-reschedule-slot').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const sDate = e.currentTarget.getAttribute('data-date');
          const sStart = e.currentTarget.getAttribute('data-start');
          const sEnd = e.currentTarget.getAttribute('data-end');

          // Auto-fill both approval and reschedule inputs
          if (editApprovedDate) editApprovedDate.value = sDate;
          if (editApprovedStartTime) editApprovedStartTime.value = sStart;
          if (editApprovedEndTime) editApprovedEndTime.value = sEnd;

          if (editRescheduleDate) editRescheduleDate.value = sDate;
          if (editRescheduleStartTime) editRescheduleStartTime.value = sStart;
          if (editRescheduleEndTime) editRescheduleEndTime.value = sEnd;

          if (!sStart || !sEnd) {
            showToast("✅ เลือกวันสำเร็จ! โปรดระบุเวลาเข้าพบในส่วนข้อมูลด้านล่างด้วยตนเอง", "warning");
            // Automatically switch status option to Approved & focus start time input
            if (editStatusSelect) {
              editStatusSelect.value = 'approved';
              editStatusSelect.dispatchEvent(new Event('change'));
            }
            if (editApprovedStartTime) editApprovedStartTime.focus();
          } else {
            showToast("✅ นำเข้าข้อมูลคิวที่เลือกเรียบร้อยแล้ว", "success");
          }
        });
      });
    }

    if (editPurpose) editPurpose.textContent = app.purpose || '-';

    // Render Timeline History
    if (timelineSection && timelineList) {
      const history = app.timeline || [];
      if (history.length > 0) {
        timelineSection.classList.remove('hidden');
        if (timelineCountBadge) {
          timelineCountBadge.textContent = `${history.length} รายการ`;
        }
        
        // Sort timeline events oldest to newest (ascending) for chronological storytelling
        const sortedHistory = [...history].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        timelineList.innerHTML = sortedHistory.map((event, index) => {
          let badgeColor = 'bg-gray-100 text-gray-700';
          let icon = '•';
          if (event.by === 'client') {
            badgeColor = 'bg-blue-100 text-blue-800';
          } else if (event.by === 'admin') {
            badgeColor = 'bg-purple-100 text-purple-800';
          } else {
            badgeColor = 'bg-emerald-100 text-emerald-800';
          }

          // Custom colors/icons based on action
          let dotColor = 'bg-gray-400';
          if (event.action === 'created') {
            dotColor = 'bg-cyan-500';
            icon = '✍️';
          } else if (event.action === 'approved') {
            dotColor = 'bg-emerald-500';
            icon = '✅';
          } else if (event.action === 'pending_client_selection') {
            dotColor = 'bg-purple-500';
            icon = '✉️';
          } else if (event.action === 'client_selected') {
            dotColor = 'bg-indigo-500';
            icon = '🎯';
          } else if (event.action === 'rescheduled') {
            dotColor = 'bg-amber-500';
            icon = '⏳';
          } else if (event.action === 'reschedule_requested') {
            dotColor = 'bg-orange-500';
            icon = '🔄';
          } else if (event.action === 'confirmed_reschedule') {
            dotColor = 'bg-teal-500';
            icon = '🤝';
          } else if (event.action === 'decline_reschedule') {
            dotColor = 'bg-rose-500';
            icon = '🙅';
          } else if (event.action === 'cancellation_requested') {
            dotColor = 'bg-red-400';
            icon = '⚠️';
          } else if (event.action === 'cancelled') {
            dotColor = 'bg-red-600';
            icon = '🚫';
          } else if (event.action === 'rejected') {
            dotColor = 'bg-rose-600';
            icon = '❌';
          }

          const formattedTime = new Date(event.timestamp).toLocaleString('th-TH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

          const actorName = event.by === 'client' ? 'ลูกค้า' : (event.by === 'admin' ? 'เลขานุการ' : 'ระบบ');

          return `
            <div class="flex items-start space-x-3 text-xs relative ${index < sortedHistory.length - 1 ? 'pb-3' : ''}">
              <!-- Vertical Line -->
              ${index < sortedHistory.length - 1 ? `<div class="absolute left-[9px] top-5 bottom-0 w-[1.5px] bg-gray-200"></div>` : ''}
              
              <!-- Icon Indicator -->
              <div class="w-5 h-5 flex items-center justify-center rounded-full ${dotColor} text-white text-[10px] z-10 flex-shrink-0">
                ${icon}
              </div>
              
              <!-- Content -->
              <div class="flex-grow space-y-1">
                <div class="flex items-center justify-between">
                  <span class="font-bold text-slate-800">${event.label || 'ดำเนินการอัปเดต'}</span>
                  <div class="flex items-center space-x-1.5">
                    <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${badgeColor}">${actorName}</span>
                    <span class="text-[10px] text-gray-400 font-mono">${formattedTime}</span>
                  </div>
                </div>
                ${event.detail ? `<p class="text-gray-600 bg-white p-2 rounded border border-gray-100 font-sans whitespace-pre-line leading-relaxed text-[11px]">${event.detail}</p>` : ''}
              </div>
            </div>
          `;
        }).join('');
      } else {
        timelineSection.classList.add('hidden');
      }
    }
    if (editStatusSelect) editStatusSelect.value = app.status;
    if (editAdminNotes) editAdminNotes.value = app.adminNotes || '';
    if (editRescheduleDate) editRescheduleDate.value = app.rescheduledDate || '';
    if (editRescheduleStartTime && editRescheduleEndTime) {
      const resTime = app.rescheduledTime || '';
      if (resTime.includes('-')) {
        const parts = resTime.split('-');
        editRescheduleStartTime.value = parts[0].trim();
        editRescheduleEndTime.value = parts[1].trim();
      } else {
        editRescheduleStartTime.value = resTime;
        editRescheduleEndTime.value = '';
      }
    }

    if (editApprovedDate) editApprovedDate.value = app.confirmedDate || app.date || '';
    const timeVal = app.confirmedTime || app.timeSlot || '';
    if (editApprovedStartTime && editApprovedEndTime) {
      if (timeVal.includes('-')) {
        const parts = timeVal.split('-');
        editApprovedStartTime.value = parts[0].trim();
        editApprovedEndTime.value = parts[1].trim();
      } else {
        editApprovedStartTime.value = timeVal;
        editApprovedEndTime.value = '';
      }
    }

    if (editRejectionReason) editRejectionReason.value = app.rejectionReason || '';
    if (offerSlotDate1) offerSlotDate1.value = app.proposedSlots?.[0]?.date || '';
    if (offerSlotDate2) offerSlotDate2.value = app.proposedSlots?.[1]?.date || '';
    if (offerSlotDate3) offerSlotDate3.value = app.proposedSlots?.[2]?.date || '';

    const setOfferSlotTimes = (idx, startEl, endEl) => {
      const pSlot = app.proposedSlots?.[idx]?.time || '';
      if (startEl && endEl) {
        if (pSlot.includes('-')) {
          const parts = pSlot.split('-');
          startEl.value = parts[0].trim();
          endEl.value = parts[1].trim();
        } else {
          startEl.value = pSlot;
          endEl.value = '';
        }
      }
    };
    setOfferSlotTimes(0, offerSlotStartTime1, offerSlotEndTime1);
    setOfferSlotTimes(1, offerSlotStartTime2, offerSlotEndTime2);
    setOfferSlotTimes(2, offerSlotStartTime3, offerSlotEndTime3);

    updateModalDynamicFields(app.status, app);
    renderStepByStep(app);
    editModal?.classList.remove('hidden');
    editModal?.classList.add('flex');
  }

  if (editStatusSelect) {
    editStatusSelect.addEventListener('change', (e) => {
      updateModalDynamicFields(e.target.value, currentEditingApp);
    });
  }

  function closeModal() {
    editModal?.classList.add('hidden');
    editModal?.classList.remove('flex');
    currentEditingRef = null;
    currentEditingApp = null;
  }

  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
  if (btnCancelModal) btnCancelModal.addEventListener('click', closeModal);

  // ========================================================
  // 11. FORM SUBMIT — SAVE & DISPATCH
  // ========================================================

  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentEditingRef || !currentEditingApp) return;

      const updatedStatus = editStatusSelect.value;
      const notesValue = editAdminNotes.value.trim();
      const app = currentEditingApp;

      const updates = {
        status: updatedStatus,
        adminNotes: notesValue,
        updatedAt: new Date().toISOString()
      };

      if (updatedStatus === 'approved') {
        updates.approvedAt = new Date().toISOString();
      } else if (updatedStatus === 'rescheduled') {
        updates.rescheduledAt = new Date().toISOString();
      } else if (updatedStatus === 'rejected') {
        updates.rejectedAt = new Date().toISOString();
      } else if (updatedStatus === 'pending_client_selection') {
        updates.proposedAt = new Date().toISOString();
      } else if (updatedStatus === 'cancelled') {
        updates.cancelledAt = new Date().toISOString();
      }

      const saveBtn = editForm.querySelector('button[type="submit"]');
      const origText = saveBtn ? saveBtn.innerHTML : '';

      function calculateDuration(start, end) {
        if (!start || !end) return '1 ชั่วโมง';
        const [startH, startM] = start.split(':').map(Number);
        const [endH, endM] = end.split(':').map(Number);
        const diffMins = (endH * 60 + endM) - (startH * 60 + startM);
        if (diffMins <= 0) return '1 ชั่วโมง';
        const hrs = diffMins / 60;
        return `${hrs} ชั่วโมง`;
      }

      // --- APPROVED ---
      if (updatedStatus === 'approved') {
        const approvedDate = editApprovedDate.value;
        const appStart = editApprovedStartTime.value;
        const appEnd = editApprovedEndTime.value;

        if (!approvedDate || !appStart || !appEnd) {
          alert('กรุณาระบุวันและเวลาที่อนุมัติ');
          return;
        }

        if (appEnd <= appStart) {
          alert('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มเสมอ');
          return;
        }

        const approvedTime = `${appStart} - ${appEnd}`;

        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'กำลังตรวจสอบคิว...'; }

        try {
          const conflictResult = await checkConflict(
            app.executiveHost || app.executiveId,
            approvedDate, approvedTime,
            calculateDuration(appStart, appEnd)
          );

          if (conflictResult.hasConflict) {
            const proceed = confirm(`⚠️ เวลานี้ชนกับนัดหมาย ${conflictResult.conflictWith} ยืนยันอนุมัติซ้อนทับหรือไม่?`);
            if (!proceed) {
              if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origText; }
              return;
            }
          }

          updates.confirmedDate = approvedDate;
          updates.confirmedTime = approvedTime;
          updates.date = approvedDate;
          updates.timeSlot = approvedTime;

          if (saveBtn) saveBtn.textContent = 'กำลังลงตารางปฏิทิน...';
          // Clear any existing slots for this appointment first
          await dbManager.deleteExecutiveSlotsForAppointment(currentEditingRef);

          await dbManager.addExecutiveSlot({
            executive: app.executiveHost || app.executiveId,
            date: approvedDate,
            startTime: appStart,
            endTime: appEnd,
            appointmentRef: currentEditingRef,
            status: 'confirmed',
            clientName: app.clientName || ''
          });

        } catch (err) {
          alert('เกิดข้อผิดพลาดตรวจสอบคิว: ' + err.message);
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origText; }
          return;
        }

      // --- RESCHEDULED ---
      } else if (updatedStatus === 'rescheduled') {
        const resDate = editRescheduleDate.value;
        const resStart = editRescheduleStartTime.value;
        const resEnd = editRescheduleEndTime.value;
        if (!resDate || !resStart || !resEnd) {
          alert('กรุณาระบุวันและเวลาใหม่');
          return;
        }
        if (resEnd <= resStart) {
          alert('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มเสมอ');
          return;
        }
        const resTime = `${resStart} - ${resEnd}`;
        updates.rescheduledDate = resDate;
        updates.rescheduledTime = resTime;

      // --- REJECTED ---
      } else if (updatedStatus === 'rejected') {
        const rejReason = editRejectionReason.value.trim();
        if (!rejReason) {
          alert('กรุณาระบุเหตุผลการปฏิเสธ');
          return;
        }
        updates.rejectionReason = rejReason;
        if (!updates.adminNotes) updates.adminNotes = rejReason;

        try {
          await dbManager.deleteExecutiveSlotsForAppointment(currentEditingRef);
        } catch (err) {
          console.error("Failed to release slots for rejected appointment:", err);
        }

      // --- OFFER SLOTS ---
      } else if (updatedStatus === 'pending_client_selection') {
        const slotsToSave = [];

        const validateAndGetSlot = (d, s, e, idxName) => {
          if (!d?.value && !s?.value && !e?.value) return null;
          if (!d?.value || !s?.value || !e?.value) {
            throw new Error(`กรุณากรอกข้อมูล วันที่ เวลาเริ่ม และเวลาสิ้นสุดของคิวที่ ${idxName} ให้ครบถ้วน`);
          }
          if (e.value <= s.value) {
            throw new Error(`เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มในคิวที่ ${idxName}`);
          }
          const durationStr = calculateDuration(s.value, e.value);
          return { date: d.value, time: `${s.value} - ${e.value}`, duration: durationStr };
        };

        try {
          const s1 = validateAndGetSlot(offerSlotDate1, offerSlotStartTime1, offerSlotEndTime1, '1');
          const s2 = validateAndGetSlot(offerSlotDate2, offerSlotStartTime2, offerSlotEndTime2, '2');
          const s3 = validateAndGetSlot(offerSlotDate3, offerSlotStartTime3, offerSlotEndTime3, '3');

          if (s1) slotsToSave.push(s1);
          if (s2) slotsToSave.push(s2);
          if (s3) slotsToSave.push(s3);
        } catch (err) {
          alert(err.message);
          return;
        }

        if (slotsToSave.length === 0) {
          alert('กรุณากรอกอย่างน้อย 1 คิว');
          return;
        }

        const reqSlots = parseInt(app.slotCount || 1);
        if (slotsToSave.length < reqSlots) {
          alert(`ลูกค้าต้องการ ${reqSlots} คิว กรุณากรอกอย่างน้อย ${reqSlots} คิว`);
          return;
        }

        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'กำลังตรวจสอบคิว...'; }

        try {
          const execName = app.executiveHost || app.executiveId;
          for (let i = 0; i < slotsToSave.length; i++) {
            const cr = await checkConflict(execName, slotsToSave[i].date, slotsToSave[i].time, slotsToSave[i].duration);
            if (cr.hasConflict) {
              const proceed = confirm(`⚠️ คิวที่ ${i + 1} ซ้อนทับกับ ${cr.conflictWith} ยืนยันเสนอคิวนี้หรือไม่?`);
              if (!proceed) {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origText; }
                return;
              }
            }
          }
          updates.proposedSlots = slotsToSave;

          // Soft Lock: Save pending slots to executive_slots
          await dbManager.deleteExecutiveSlotsForAppointment(currentEditingRef);

          for (const slot of slotsToSave) {
            await dbManager.addExecutiveSlot({
              executive: app.executiveHost || app.executiveId,
              date: slot.date,
              startTime: slot.time.split(' - ')[0],
              endTime: slot.time.split(' - ')[1],
              appointmentRef: currentEditingRef,
              status: 'pending',  // ← ล็อคชั่วคราว
              expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
              clientName: app.clientName || ''
            });
          }

        } catch (err) {
          alert('เกิดข้อผิดพลาดตรวจสอบคิว: ' + err.message);
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origText; }
          return;
        }

      // --- CANCELLED ---
      } else if (updatedStatus === 'cancelled') {
        try {
          if (saveBtn) saveBtn.textContent = 'กำลังยกเลิก...';
          await dbManager.deleteExecutiveSlotsForAppointment(currentEditingRef);
        } catch (err) {
          console.error("Failed to release slots:", err);
        }
        updates.calendarEventId = app.calendarEventId || '';
      }

      if (updatedStatus !== 'rescheduled' && updatedStatus !== 'confirmed_reschedule') {
        updates.rescheduledDate = '';
        updates.rescheduledTime = '';
      }

      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึกและส่งอีเมล...'; }

      try {
        // 1. บันทึก Firestore
        await dbManager.updateAppointment(currentEditingRef, updates);

        // Append Timeline Event based on the updatedStatus
        try {
          let timelineEvent = null;
          if (updatedStatus === 'approved') {
            const approvedDate = editApprovedDate.value;
            const appStart = editApprovedStartTime.value;
            const appEnd = editApprovedEndTime.value;
            const approvedTime = `${appStart} - ${appEnd}`;
            timelineEvent = {
              action: "approved",
              label: "เลขานุการอนุมัตินัดหมาย",
              detail: `อนุมัติวันเข้าพบวันที่ ${formatDate(approvedDate)} เวลา ${approvedTime} น.${notesValue ? ' (บันทึก: ' + notesValue + ')' : ''}`,
              by: "admin",
              timestamp: new Date().toISOString()
            };
          } else if (updatedStatus === 'pending_client_selection') {
            const slotDetails = slotsToSave.map((s, idx) => `คิวที่ ${idx + 1}: วันที่ ${formatDate(s.date)} เวลา ${s.time} น.`).join('\n');
            timelineEvent = {
              action: "pending_client_selection",
              label: "เลขานุการเสนอคิวให้เลือก",
              detail: `เสนอตัวเลือกคิวงานจำนวน ${slotsToSave.length} คิวดังนี้:\n${slotDetails}${notesValue ? '\n(บันทึก: ' + notesValue + ')' : ''}`,
              by: "admin",
              timestamp: new Date().toISOString()
            };
          } else if (updatedStatus === 'rescheduled') {
            const resDate = editRescheduleDate.value;
            const resStart = editRescheduleStartTime.value;
            const resEnd = editRescheduleEndTime.value;
            const resTime = `${resStart} - ${resEnd}`;
            timelineEvent = {
              action: "rescheduled",
              label: "ผู้บริหารเสนอเลื่อนนัดหมาย",
              detail: `ยื่นเสนอเลื่อนเวลาเข้าพบเป็นวันที่ ${formatDate(resDate)} เวลา ${resTime} น.${notesValue ? ' (บันทึก: ' + notesValue + ')' : ''}`,
              by: "admin",
              timestamp: new Date().toISOString()
            };
          } else if (updatedStatus === 'rejected') {
            const rejReason = editRejectionReason.value.trim();
            timelineEvent = {
              action: "rejected",
              label: "เลขานุการปฏิเสธคำขอเข้าพบ",
              detail: `ปฏิเสธเนื่องจาก: ${rejReason}`,
              by: "admin",
              timestamp: new Date().toISOString()
            };
          } else if (updatedStatus === 'cancelled') {
            timelineEvent = {
              action: "cancelled",
              label: "เลขานุการยกเลิกนัดหมาย",
              detail: `ยกเลิกนัดหมายสำเร็จและนำชื่อออกจากระบบวาระนัดหมาย${notesValue ? ' เนื่องจาก: ' + notesValue : ''}`,
              by: "admin",
              timestamp: new Date().toISOString()
            };
          } else {
            timelineEvent = {
              action: "updated",
              label: "เลขานุการแก้ไขข้อมูล",
              detail: `ปรับปรุงข้อมูลสถานะนัดหมายเป็น: ${statusLabel(updatedStatus)}${notesValue ? ' (บันทึก: ' + notesValue + ')' : ''}`,
              by: "admin",
              timestamp: new Date().toISOString()
            };
          }

          if (timelineEvent) {
            await dbManager.appendTimelineEvent(currentEditingRef, timelineEvent);
          }
        } catch (tlErr) {
          console.error("Failed to append timeline event:", tlErr);
        }

        // 2. ส่ง GAS และรับ response
        const gasResult = await sendGasNotification(updatedStatus, { ...app, ...updates });

        // *** แก้ไขหลัก: บันทึก event IDs และข้อมูลอื่น ๆ ที่ตอบกลับจาก GAS กลับสู่ Firestore ***
        if (updatedStatus === 'approved' && gasResult?.calendarEventId) {
          await dbManager.updateAppointment(currentEditingRef, {
            calendarEventId: gasResult.calendarEventId
          });
          console.log('[Calendar] Saved calendarEventId:', gasResult.calendarEventId);
        }

        if (updatedStatus === 'pending_client_selection' && gasResult?.pendingEventIds) {
          await dbManager.updateAppointment(currentEditingRef, {
            pendingEventIds: gasResult.pendingEventIds
          });
          console.log('[Calendar] Saved pendingEventIds:', gasResult.pendingEventIds);
        }

        if (updatedStatus === 'rescheduled' && gasResult?.selectedSlotEventId) {
          await dbManager.updateAppointment(currentEditingRef, {
            selectedSlotEventId: gasResult.selectedSlotEventId
          });
          console.log('[Calendar] Saved selectedSlotEventId:', gasResult.selectedSlotEventId);
        }

        // บันทึก emailThreadId ที่ได้จาก GAS กลับลง Firestore
        if (gasResult?.emailThreadId) {
          // ตรวจสอบว่ายังไม่มี emailThreadId อยู่ก่อน (บันทึกเฉพาะครั้งแรก)
          const currentApp = allAppointments.find(a => a.refCode === currentEditingRef);
          if (!currentApp?.emailThreadId) {
            await dbManager.updateAppointment(currentEditingRef, {
              emailThreadId: gasResult.emailThreadId,
              lastMessageId: gasResult.lastMessageId || ''
            });
            console.log('Saved emailThreadId from GAS response: ' + gasResult.emailThreadId);
          }
        }

        // 3. แสดง Toast
        const toastMessages = {
          approved: '✅ อนุมัติและลงปฏิทินเรียบร้อยแล้ว',
          rejected: '❌ ปฏิเสธและส่งอีเมลแจ้งลูกค้าแล้ว',
          pending_client_selection: '✉️ ส่งตัวเลือกคิวให้ลูกค้าเลือกแล้ว',
          cancelled: '🚫 ยกเลิกนัดหมายและลบปฏิทินแล้ว',
          rescheduled: '⏳ ส่งข้อเสนอเวลาใหม่ให้ลูกค้าแล้ว'
        };
        const toastTypes = { approved: 'success', rejected: 'error', cancelled: 'error', pending_client_selection: 'success', rescheduled: 'warning' };

        showToast(
          toastMessages[updatedStatus] || '✅ บันทึกเรียบร้อยแล้ว',
          toastTypes[updatedStatus] || 'success'
        );

        closeModal();

      } catch (err) {
        alert('เกิดข้อผิดพลาดขณะบันทึก: ' + err.message);
      } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origText; }
      }
    });
  }

  // ========================================================
  // 11.5. CALENDAR VIEW IMPLEMENTATION (REMOVED)
  // ========================================================

  // ========================================================
  // 12. FILTER & NAV EVENTS
  // ========================================================

  [searchInput, statusFilterSelect, execFilterSelect].forEach(control => {
    control?.addEventListener('change', renderAppointmentsTable);
  });
  searchInput?.addEventListener('input', renderAppointmentsTable);

  document.querySelectorAll('[data-nav-target]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      activeStatusFilter = e.currentTarget.getAttribute('data-nav-target');
      renderAppointmentsTable();
    });
  });

  document.querySelectorAll('[data-tab-status]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      activeStatusFilter = e.currentTarget.getAttribute('data-tab-status');
      renderAppointmentsTable();
    });
  });

  // ========================================================
  // 13. INIT
  // ========================================================

  initPromise.then(() => {
    checkSessionAuth();
  }).catch((err) => {
    console.error("Firebase init failed:", err);
    checkSessionAuth();
  });

});