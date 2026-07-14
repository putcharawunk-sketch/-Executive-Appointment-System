/**
 * Executive Appointment Manager - Client Portal logic
 */

import { dbManager } from './firebase-config.js';
import { generateRefCode, EXECUTIVE_HOSTS } from './utils.js';

// GAS Notification Dispatcher
async function sendGasNotification(action, appointmentData) {
  let webhookUrl = '';

  // 1. ตรวจสอบว่า appointment นี้ผูกกับผู้บริหารคนไหน
  if (appointmentData) {
    const execId = appointmentData.executiveId || '';
    const execName = appointmentData.executiveHost || '';
    
    // 2. ค้นหา adminOwner ของผู้บริหารคนนั้นจาก EXECUTIVE_HOSTS
    const matchedExec = EXECUTIVE_HOSTS.find(e => e.id === execId || e.name === execName);
    const adminOwner = matchedExec ? matchedExec.adminOwner : 'admin1';
    
    // 3. เรียก dbManager.getWebhookUrlByAdmin(adminOwner) เพื่อหา Webhook URL ที่ถูกต้อง
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
    try {
      const fetchedUrl = await dbManager.getGasWebhookUrl();
      if (fetchedUrl) {
        webhookUrl = fetchedUrl;
      }
    } catch (err) {
      console.warn("Failed to get global GAS webhook url:", err);
    }
  }

  if (!webhookUrl || webhookUrl.includes('example') || webhookUrl.trim() === '') {
    console.log(`[GAS Webhook Bypassed] Action: ${action}`, appointmentData);
    return;
  }
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, appointmentData })
    });
    console.log(`[GAS Webhook Dispatched] Action: ${action} Successful using URL: ${webhookUrl}`);
  } catch (err) {
    console.warn('[GAS Webhook Error] Failed to fetch:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Load Executive Select options and Cards selection
  const execSelect = document.getElementById('executive_host');
  const execCardsContainer = document.getElementById('executive_cards_container');

  if (execSelect) {
    execSelect.innerHTML = '<option value="" disabled selected>กรุณาเลือกผู้บริหารที่ต้องการพบ...</option>';
    EXECUTIVE_HOSTS.forEach((exec) => {
      const opt = document.createElement('option');
      opt.value = exec.id;
      opt.textContent = exec.name;
      execSelect.appendChild(opt);
    });
  }

  // Render executive selection cards dynamically as requested
  if (execCardsContainer) {
    execCardsContainer.innerHTML = EXECUTIVE_HOSTS.map(exec => `
      <div data-exec-id="${exec.id}" class="executive-card cursor-pointer rounded-xl p-4 flex flex-col items-center text-center">
        <div class="relative w-24 h-24 mb-3 rounded-full overflow-hidden border border-slate-700/80 flex items-center justify-center bg-slate-800 shadow-inner">
          <img src="${exec.imageUrl}" alt="${exec.name}" 
               referrerpolicy="no-referrer" 
               class="w-full h-full object-cover object-top"
               style="object-position: center 20%;"
               onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');">
          <div class="hidden w-full h-full flex items-center justify-center bg-slate-950 text-amber-500 font-bold text-xs font-mono uppercase">${exec.id}</div>
        </div>
        <p class="executive-card-name mt-2">${exec.name}</p>
        <p class="executive-card-title mt-1 leading-tight">${exec.title}</p>
      </div>
    `).join('');

    const cards = execCardsContainer.querySelectorAll('.executive-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-exec-id');
        if (execSelect) {
          execSelect.value = id;
          execSelect.dispatchEvent(new Event('change'));
        }
        
        // Highlight active selection using the css-based class
        cards.forEach(c => {
          c.classList.remove('selected');
        });
        card.classList.add('selected');
      });
    });
  }

  // Set min date to today for date field
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const minDateStr = `${yyyy}-${mm}-${dd}`;

  // Set min date on preferred date range fields
  const preferredDateFrom = document.getElementById('preferred_date_from');
  const preferredDateTo = document.getElementById('preferred_date_to');
  if (preferredDateFrom) preferredDateFrom.min = minDateStr;
  if (preferredDateTo) preferredDateTo.min = minDateStr;

  // --- Dynamic Proposed Dates (แบบที่ 1) ---
  let proposedSlots = [{ id: Date.now(), date: '', startTime: '', endTime: '' }];

  const proposedDatesContainer = document.getElementById('proposed_dates_container');
  const btnAddProposedDate = document.getElementById('btn_add_proposed_date');

  function renderProposedSlots() {
    if (!proposedDatesContainer) return;
    
    proposedDatesContainer.innerHTML = proposedSlots.map((slot, index) => {
      const isOnlyOne = proposedSlots.length === 1;
      return `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center bg-slate-900/30 p-3 rounded-xl border border-slate-700/30 relative" data-slot-id="${slot.id}">
          <div class="lg:col-span-2 text-xs font-bold text-[#F59E0B]">วันที่ต้องการที่ ${index + 1}</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 lg:col-span-9">
            <div class="flex flex-col">
              <label class="form-label mb-1">วันที่ <span class="text-red-400">*</span></label>
              <input type="date" class="proposed-date-input luxury-input w-full" value="${slot.date}" min="${minDateStr}" />
            </div>
            <div class="flex flex-col">
              <label class="form-label mb-1">เวลาเริ่ม</label>
              <input type="time" step="900" style="max-width: 140px;" class="proposed-start-time-input luxury-input w-full" value="${slot.startTime}" />
            </div>
            <div class="flex flex-col">
              <label class="form-label mb-1">เวลาสิ้นสุด</label>
              <input type="time" step="900" style="max-width: 140px;" class="proposed-end-time-input luxury-input w-full" value="${slot.endTime}" />
            </div>
          </div>
          <div class="lg:col-span-1 flex justify-end lg:pt-4">
            <button type="button" class="btn-delete-proposed-slot p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors" data-slot-id="${slot.id}" ${isOnlyOne ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach sync & action event listeners
    proposedDatesContainer.querySelectorAll('[data-slot-id]').forEach(row => {
      const slotId = parseInt(row.getAttribute('data-slot-id'));
      const slot = proposedSlots.find(s => s.id === slotId);
      if (!slot) return;

      const dateInput = row.querySelector('.proposed-date-input');
      const startInput = row.querySelector('.proposed-start-time-input');
      const endInput = row.querySelector('.proposed-end-time-input');

      if (dateInput) {
        dateInput.addEventListener('change', (e) => {
          slot.date = e.target.value;
        });
      }
      if (startInput) {
        startInput.addEventListener('change', (e) => {
          slot.startTime = e.target.value;
        });
      }
      if (endInput) {
        endInput.addEventListener('change', (e) => {
          slot.endTime = e.target.value;
        });
      }

      const btnDel = row.querySelector('.btn-delete-proposed-slot');
      if (btnDel) {
        btnDel.addEventListener('click', () => {
          if (proposedSlots.length > 1) {
            proposedSlots = proposedSlots.filter(s => s.id !== slotId);
            renderProposedSlots();
          }
        });
      }
    });

    if (btnAddProposedDate) {
      if (proposedSlots.length >= 5) {
        btnAddProposedDate.disabled = true;
        btnAddProposedDate.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        btnAddProposedDate.disabled = false;
        btnAddProposedDate.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }
  }

  if (btnAddProposedDate) {
    btnAddProposedDate.addEventListener('click', () => {
      if (proposedSlots.length < 5) {
        proposedSlots.push({ id: Date.now(), date: '', startTime: '', endTime: '' });
        renderProposedSlots();
      }
    });
  }

  // Initial render of proposed dates list
  renderProposedSlots();

  // --- Toggle Booking Type ( แบบที่ 1 / แบบที่ 2 ) ---
  let selectedBookingType = 'client_pick'; // 'client_pick' or 'secretary_allocate'
  const bookingTypeRadios = document.querySelectorAll('input[name="booking_type"]');
  const panelBookingClient = document.getElementById('panel_booking_client');
  const panelBookingSec = document.getElementById('panel_booking_sec');
  const labelBookingTypeClient = document.getElementById('label_booking_type_client');
  const labelBookingTypeSec = document.getElementById('label_booking_type_sec');

  function updateBookingTypeVisibility(type) {
    selectedBookingType = type;
    if (type === 'client_pick') {
      panelBookingClient.classList.remove('hidden');
      panelBookingSec.classList.add('hidden');
      
      labelBookingTypeClient.className = 'flex flex-col items-center justify-center p-4 border rounded-xl cursor-pointer transition-all border-[#F59E0B] text-center bg-slate-800/50';
      labelBookingTypeSec.className = 'flex flex-col items-center justify-center p-4 border rounded-xl cursor-pointer transition-all border-slate-700 bg-slate-900 text-center hover:border-slate-600';
    } else {
      panelBookingClient.classList.add('hidden');
      panelBookingSec.classList.remove('hidden');
      
      labelBookingTypeClient.className = 'flex flex-col items-center justify-center p-4 border rounded-xl cursor-pointer transition-all border-slate-700 bg-slate-900 text-center hover:border-slate-600';
      labelBookingTypeSec.className = 'flex flex-col items-center justify-center p-4 border rounded-xl cursor-pointer transition-all border-[#F59E0B] text-center bg-slate-800/50';
    }
  }


  bookingTypeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      updateBookingTypeVisibility(e.target.value);
    });
  });

  // --- Purpose "อื่นๆ" Conditional Input ---
  const purposeRadios = document.querySelectorAll('input[name="purpose_main"]');
  const purposeOtherContainer = document.getElementById('purpose_other_container');
  const purposeOtherText = document.getElementById('purpose_other_text');

  purposeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'อื่นๆ') {
        purposeOtherContainer.classList.remove('hidden');
        if (purposeOtherText) purposeOtherText.required = true;
      } else {
        purposeOtherContainer.classList.add('hidden');
        if (purposeOtherText) {
          purposeOtherText.required = false;
          purposeOtherText.value = '';
        }
      }
    });
  });

  // --- Meeting Format ( Online / Onsite ) ---
  const meetingFormatRadios = document.querySelectorAll('input[name="meeting_format"]');
  const locationContainer = document.getElementById('location_container');
  const meetingLocationInput = document.getElementById('meeting_location');

  meetingFormatRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'onsite') {
        locationContainer.classList.remove('hidden');
        if (meetingLocationInput) meetingLocationInput.required = true;
      } else {
        locationContainer.classList.add('hidden');
        if (meetingLocationInput) {
          meetingLocationInput.required = false;
          meetingLocationInput.value = '';
        }
      }
    });
  });

  // --- Additional Attendees ( มี / ไม่มี ) ---
  const hasAttendeesRadios = document.querySelectorAll('input[name="has_attendees"]');
  const attendeesSection = document.getElementById('attendees_section');
  const attendeesContainer = document.getElementById('attendees_container');
  const btnAddAttendee = document.getElementById('btn_add_attendee');

  let attendeesList = [];

  hasAttendeesRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'yes') {
        attendeesSection.classList.remove('hidden');
        if (attendeesList.length === 0) {
          addAttendeeRow();
        }
      } else {
        attendeesSection.classList.add('hidden');
      }
    });
  });

  function renderAttendees() {
    if (!attendeesContainer) return;
    attendeesContainer.innerHTML = '';
    
    attendeesList.forEach((attendee, index) => {
      const row = document.createElement('div');
      row.className = 'grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl relative';
      row.innerHTML = `
        <div>
          <label class="form-label">ชื่อ-นามสกุลจริง</label>
          <input type="text" value="${attendee.name}" placeholder="ชื่อ-นามสกุล" class="luxury-input w-full attendee-name" data-index="${index}" />
        </div>
        <div>
          <label class="form-label">ตำแหน่ง</label>
          <input type="text" value="${attendee.position}" placeholder="ตำแหน่ง" class="luxury-input w-full attendee-position" data-index="${index}" />
        </div>
        <div class="flex items-end space-x-2">
          <div class="flex-grow">
            <label class="form-label">อีเมล</label>
            <input type="email" value="${attendee.email}" placeholder="email@company.com" class="luxury-input w-full attendee-email" data-index="${index}" />
          </div>
          <button type="button" class="btn-delete-attendee px-4 h-[50.5px] bg-red-500/10 hover:bg-red-500/25 text-red-400 rounded-lg transition-all text-sm border border-red-500/20 font-semibold" data-index="${index}" title="ลบผู้เข้าร่วม">
            ลบ
          </button>
        </div>
      `;
      attendeesContainer.appendChild(row);
    });

    // Add listeners to dynamic input changes to keep state in sync
    attendeesContainer.querySelectorAll('.attendee-name').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index);
        attendeesList[idx].name = e.target.value.trim();
      });
    });

    attendeesContainer.querySelectorAll('.attendee-position').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index);
        attendeesList[idx].position = e.target.value.trim();
      });
    });

    attendeesContainer.querySelectorAll('.attendee-email').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index);
        attendeesList[idx].email = e.target.value.trim();
      });
    });

    attendeesContainer.querySelectorAll('.btn-delete-attendee').forEach(button => {
      button.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index);
        removeAttendeeRow(idx);
      });
    });
  }

  function addAttendeeRow() {
    if (attendeesList.length >= 20) {
      alert('จำกัดรายชื่อผู้เข้าร่วมประชุมเพิ่มเติมสูงสุด 20 คน');
      return;
    }
    attendeesList.push({ name: '', position: '', email: '' });
    renderAttendees();
  }

  function removeAttendeeRow(index) {
    attendeesList.splice(index, 1);
    renderAttendees();
  }

  if (btnAddAttendee) {
    btnAddAttendee.addEventListener('click', addAttendeeRow);
  }

  // --- STEP WIZARD NAV & VALIDATION ENGINE ---
  let currentStep = 1;
  const btnNext = document.getElementById('btn_next');
  const btnPrev = document.getElementById('btn_prev');
  const submitBtn = document.getElementById('submit_btn');
  const progressBarActive = document.getElementById('progress_bar_active');

  // Set initial state
  updateBookingTypeVisibility('client_pick');
  updateStepUI();

  function validateStep(step) {
    if (step === 1) {
      const name = document.getElementById('client_name').value.trim();
      const position = document.getElementById('client_position').value.trim();
      const company = document.getElementById('client_company').value.trim();
      const phone = document.getElementById('client_phone').value.trim();
      const email = document.getElementById('client_email').value.trim();
      if (!name || !position || !company || !phone || !email) {
        alert('กรุณากรอกข้อมูลผู้ประสานงานให้ครบถ้วนก่อนไปขั้นตอนถัดไป');
        return false;
      }
      return true;
    }
    if (step === 2) {
      const hostId = execSelect.value;
      const purposeTextarea = document.getElementById('purpose').value.trim();
      const selectedPurposeMainRadio = document.querySelector('input[name="purpose_main"]:checked');
      let purposeMain = selectedPurposeMainRadio ? selectedPurposeMainRadio.value : '';
      if (purposeMain === 'อื่นๆ' && purposeOtherText) {
        purposeMain = purposeOtherText.value.trim();
      }
      if (!hostId) {
        alert('กรุณาเลือกผู้บริหารที่ต้องการเข้าพบ');
        return false;
      }
      if (!purposeMain) {
        alert('กรุณาเลือกวัตถุประสงค์หลักของการเข้าพบ');
        return false;
      }
      if (!purposeTextarea) {
        alert('กรุณากรอกหัวข้อการประชุม / จุดประสงค์ในการเข้าพบ');
        return false;
      }
      return true;
    }
    if (step === 3) {
      if (selectedBookingType === 'client_pick') {
        if (proposedSlots.length === 0) {
          alert('กรุณาเพิ่มวันที่ต้องการอย่างน้อย 1 วัน');
          return false;
        }
        for (let i = 0; i < proposedSlots.length; i++) {
          const slot = proposedSlots[i];
          if (!slot.date) {
            alert(`กรุณาระบุวันที่ สำหรับวันที่ต้องการที่ ${i + 1}`);
            return false;
          }
          if ((slot.startTime && !slot.endTime) || (!slot.startTime && slot.endTime)) {
            alert(`กรุณากรอกทั้งเวลาเริ่มต้นและเวลาสิ้นสุด สำหรับวันที่ต้องการที่ ${i + 1} หรือปล่อยว่างทั้งคู่หากยังไม่ระบุเวลา`);
            return false;
          }
          if (slot.startTime && slot.endTime) {
            if (slot.endTime <= slot.startTime) {
              alert(`เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม สำหรับวันที่ต้องการที่ ${i + 1}`);
              return false;
            }
          }
        }
      } else {
        const hInput2 = document.getElementById('booking2_hours');
        if (!hInput2 || !hInput2.value.trim()) {
          alert('กรุณาระบุระยะเวลาที่ต้องการ');
          return false;
        }
        const pfVal = document.getElementById('preferred_date_from')?.value;
        const ptVal = document.getElementById('preferred_date_to')?.value;
        if (pfVal && ptVal) {
          if (ptVal <= pfVal) {
            alert('วันสิ้นสุดต้องมากกว่าวันเริ่มต้น');
            return false;
          }
        }
      }
      return true;
    }
    if (step === 4) {
      const formatVal = document.querySelector('input[name="meeting_format"]:checked')?.value;
      if (formatVal === 'onsite') {
        const loc = document.getElementById('meeting_location').value.trim();
        if (!loc) {
          alert('กรุณาระบุสถานที่/ห้องประชุมสําหรับรูปแบบออนไซต์');
          return false;
        }
      }
      return true;
    }
    if (step === 5) {
      const hasAttendees = document.querySelector('input[name="has_attendees"]:checked')?.value === 'yes';
      if (hasAttendees) {
        if (attendeesList.length === 0) {
          alert('กรุณาเพิ่มผู้เข้าร่วม หรือ เลือกรูปแบบไม่มีผู้เข้าร่วม');
          return false;
        }
        for (let i = 0; i < attendeesList.length; i++) {
          if (!attendeesList[i].name) {
            alert(`กรุณากรอกชื่อ-นามสกุลจริงของผู้เข้าร่วมลำดับที่ ${i + 1}`);
            return false;
          }
        }
      }
      return true;
    }
    return true;
  }

  function calculateDuration(start, end) {
    if (!start || !end) return '1 ชั่วโมง';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const diffMin = (eh * 60 + em) - (sh * 60 + sm);
    const hours = diffMin / 60;
    if (hours % 1 === 0) {
      return `${hours} ชั่วโมง`;
    }
    return `${hours.toFixed(1)} ชั่วโมง`;
  }

  function renderSummaryRecap() {
    const summaryContainer = document.getElementById('summary_recap');
    if (!summaryContainer) return;

    const name = document.getElementById('client_name').value.trim();
    const position = document.getElementById('client_position').value.trim();
    const company = document.getElementById('client_company').value.trim();
    const phone = document.getElementById('client_phone').value.trim();
    const email = document.getElementById('client_email').value.trim();

    const hostId = execSelect.value;
    const selectedHostObj = EXECUTIVE_HOSTS.find(h => h.id === hostId);
    const hostName = selectedHostObj ? selectedHostObj.name : '-';
    const hostTitle = selectedHostObj ? selectedHostObj.title : '';

    const selectedPurposeMainRadio = document.querySelector('input[name="purpose_main"]:checked');
    let purposeMain = selectedPurposeMainRadio ? selectedPurposeMainRadio.value : '';
    if (purposeMain === 'อื่นๆ' && purposeOtherText) {
      purposeMain = purposeOtherText.value.trim();
    }
    const purpose = document.getElementById('purpose').value.trim();
    const additionalDetails = document.getElementById('additional_details')?.value.trim() || '';

    const formatVal = document.querySelector('input[name="meeting_format"]:checked')?.value;
    const formatText = formatVal === 'online' ? '🟢 ออนไลน์ (Zoom/Meet/Teams)' : `🏢 ออนไซต์ — ${document.getElementById('meeting_location').value.trim()}`;

    let dateText = '';
    if (selectedBookingType === 'client_pick') {
      const prioVal = document.querySelector('input[name="priority_1"]:checked')?.value || 'ทั่วไป';
      let slotsHtml = proposedSlots.map((slot, idx) => {
        const timeStr = (slot.startTime && slot.endTime) ? `${slot.startTime} - ${slot.endTime} น.` : 'ยังไม่ระบุเวลา';
        const dateStr = slot.date ? slot.date : '-';
        return `
          <div class="flex items-start gap-2.5 ${idx < proposedSlots.length - 1 ? 'border-b border-white/[0.06] pb-2 mb-2' : ''}">
            <svg class="h-4 w-4 text-[#F59E0B] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
            </svg>
            <div>
              <span class="summary-label">วันที่เสนอที่ ${idx + 1}</span>
              <p class="summary-value" style="margin-bottom: 0 !important;">${dateStr} &nbsp;|&nbsp; เวลา ${timeStr}</p>
            </div>
          </div>
        `;
      }).join('');

      dateText = `
        <div style="display:flex; flex-direction:column; gap:10px;">
          <div class="border-b border-white/[0.06] pb-[10px] flex items-start gap-2.5">
            <svg class="h-4 w-4 text-slate-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
            </svg>
            <div>
              <span class="summary-label">รูปแบบการนัด</span>
              <p class="summary-value" style="margin-bottom: 0 !important;">แบบที่ 1 (ระบุวันเวลาเอง)</p>
            </div>
          </div>
          <div class="border-b border-white/[0.06] pb-[10px]">
            <span class="summary-label">วันเวลาที่ขอเสนอ</span>
            <div class="space-y-2 bg-slate-950/20 p-2.5 rounded-lg border border-slate-800/50 mt-1">
              ${slotsHtml}
            </div>
          </div>
          <div class="flex items-start gap-2.5">
            <svg class="h-4 w-4 ${prioVal === 'ด่วนมาก' ? 'text-red-400' : 'text-slate-400'} shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <div>
              <span class="summary-label">ระดับความสำคัญ</span>
              <p class="${prioVal === 'ด่วนมาก' ? 'text-red-400 font-bold' : 'summary-value'}" style="margin-bottom: 0 !important;">${prioVal}</p>
            </div>
          </div>
        </div>
      `;
    } else {
      const slotsCount = document.querySelector('input[name="slot_count"]:checked')?.value || '1';
      const hoursVal = document.getElementById('booking2_hours').value.trim() || '1 ชั่วโมง';
      const prioVal = document.querySelector('input[name="priority_2"]:checked')?.value || 'ทั่วไป';
      const hoursFormatted = hoursVal.includes('ชั่วโมง') || hoursVal.includes('นาที') ? hoursVal : `${hoursVal} ชั่วโมง`;
      
      const pfVal = document.getElementById('preferred_date_from')?.value;
      const ptVal = document.getElementById('preferred_date_to')?.value;
      let rangeText = 'ไม่จำกัดช่วงเวลา';
      if (pfVal || ptVal) {
        rangeText = `${pfVal || 'ไม่จำกัด'} ถึง ${ptVal || 'ไม่จำกัด'}`;
      }

      dateText = `
        <div style="display:flex; flex-direction:column; gap:10px;">
          <div class="border-b border-white/[0.06] pb-[10px] flex items-start gap-2.5">
            <svg class="h-4 w-4 text-slate-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
            </svg>
            <div>
              <span class="summary-label">รูปแบบการนัด</span>
              <p class="summary-value" style="margin-bottom: 0 !important;">แบบที่ 2 (ให้เลขาฯ จัดสรรเวลาให้)</p>
            </div>
          </div>
          <div class="border-b border-white/[0.06] pb-[10px] flex items-start gap-2.5">
            <svg class="h-4 w-4 text-slate-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <div>
              <span class="summary-label">จำนวนคิว</span>
              <p class="summary-value" style="margin-bottom: 0 !important;">ต้องการ ${slotsCount} คิว (${hoursFormatted})</p>
            </div>
          </div>
          <div class="border-b border-white/[0.06] pb-[10px] flex items-start gap-2.5">
            <svg class="h-4 w-4 text-slate-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
            </svg>
            <div>
              <span class="summary-label">ช่วงวันที่ต้องการ</span>
              <p class="summary-value" style="margin-bottom: 0 !important;">${rangeText}</p>
            </div>
          </div>
          <div class="flex items-start gap-2.5">
            <svg class="h-4 w-4 ${prioVal === 'ด่วนมาก' ? 'text-red-400' : 'text-slate-400'} shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <div>
              <span class="summary-label">ระดับความสำคัญ</span>
              <p class="${prioVal === 'ด่วนมาก' ? 'text-red-400 font-bold' : 'summary-value'}" style="margin-bottom: 0 !important;">${prioVal}</p>
            </div>
          </div>
        </div>
      `;
    }

    const hasAttendees = document.querySelector('input[name="has_attendees"]:checked')?.value === 'yes';
    let attendeesText = 'ไม่มี (เข้าพบคนเดียว)';
    if (hasAttendees) {
      const validAttendees = attendeesList.filter(att => att.name.trim() !== '');
      if (validAttendees.length > 0) {
        attendeesText = validAttendees.map((att, i) => `${i + 1}. ${att.name} (${att.position || '-'})`).join('<br>');
      } else {
        attendeesText = 'ระบุมีผู้เข้าร่วม แต่ไม่ได้เพิ่มรายชื่อ';
      }
    }

    summaryContainer.innerHTML = `
      <div class="space-y-4">
        <div class="border-b border-slate-800/60 pb-3">
          <h4 class="text-xs font-bold text-[#F59E0B] uppercase tracking-wider flex items-center gap-2">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            📋 ตรวจสอบและยืนยันข้อมูลนัดหมาย
          </h4>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-slate-900/40 p-5 rounded-lg border border-slate-800 flex flex-col justify-between">
            <div class="flex flex-col space-y-[10px] w-full">
              <div class="border-b border-white/[0.06] pb-[10px]">
                <span class="summary-label">ชื่อ-นามสกุล</span>
                <p class="summary-value">${name}</p>
              </div>
              <div class="border-b border-white/[0.06] pb-[10px]">
                <span class="summary-label">ตำแหน่ง</span>
                <p class="summary-value">${position}</p>
              </div>
              <div class="border-b border-white/[0.06] pb-[10px]">
                <span class="summary-label">องค์กร / บริษัท / หน่วยงาน</span>
                <p class="summary-value">${company}</p>
              </div>
              <div>
                <span class="summary-label">ช่องทางการติดต่อ</span>
                <p class="summary-value font-mono" style="margin-bottom: 0 !important;">📞 ${phone} &nbsp;|&nbsp; ✉️ ${email}</p>
              </div>
            </div>
          </div>
          <div class="bg-slate-900/40 p-5 rounded-lg border border-slate-800 flex flex-col justify-between">
            <div class="flex flex-col space-y-[10px] w-full">
              <div class="border-b border-white/[0.06] pb-[10px]">
                <span class="summary-label">ผู้บริหารที่ท่านต้องการนัดหมาย</span>
                <p style="font-weight: 700; color: #F59E0B; font-size: 16px; margin-bottom: 4px;">${hostName}</p>
                ${hostTitle ? `<p style="font-weight: 400; color: #94A3B8; font-size: 12px; margin-bottom: 0 !important;">${hostTitle}</p>` : ''}
              </div>
              <div class="border-b border-white/[0.06] pb-[10px]">
                <span class="summary-label">วัตถุประสงค์หลัก</span>
                <p class="summary-value">${purposeMain}</p>
              </div>
              <div>
                <span class="summary-label">หัวข้อการประชุม / จุดประสงค์</span>
                <p class="summary-value" style="margin-bottom: 0 !important;">${purpose}</p>
              </div>
              ${additionalDetails ? `
              <div class="border-t border-white/[0.06] pt-[10px] mt-1">
                <span class="summary-label">รายละเอียดเพิ่มเติม</span>
                <p class="summary-value" style="margin-bottom: 0 !important;">${additionalDetails}</p>
              </div>
              ` : ''}
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-slate-900/40 p-5 rounded-lg border border-slate-800 flex flex-col justify-between">
            <div class="flex flex-col space-y-[10px] w-full">
              <span class="summary-label">รูปแบบการประชุม</span>
              <p class="summary-value" style="margin-bottom: 0 !important;">${formatText}</p>
            </div>
          </div>
          <div class="bg-slate-900/40 p-5 rounded-lg border border-slate-800">
            ${dateText}
          </div>
        </div>
        <div class="bg-slate-900/40 p-5 rounded-lg border border-slate-800">
          <span class="summary-label">รายชื่อผู้เข้าร่วมประชุมเพิ่มเติม</span>
          <p class="summary-value" style="margin-bottom: 0 !important; line-height: 1.6;">${attendeesText}</p>
        </div>
      </div>
    `;
  }

  function updateStepUI() {
    // Hide all step forms and show current
    for (let i = 1; i <= 6; i++) {
      const formEl = document.getElementById(`form_step_${i}`);
      if (formEl) {
        if (i === currentStep) {
          formEl.classList.remove('hidden');
        } else {
          formEl.classList.add('hidden');
        }
      }

      // Update Stepper dots
      const dot = document.getElementById(`step_dot_${i}`);
      if (dot) {
        if (i < currentStep) {
          // Completed
          dot.className = "w-8 h-8 rounded-full flex items-center justify-center border-2 border-[#10B981] bg-[#10B981] text-slate-950 font-bold text-xs transition-all duration-300";
          dot.innerHTML = "✓";
        } else if (i === currentStep) {
          // Active
          dot.className = "w-8 h-8 rounded-full flex items-center justify-center border-2 border-[#F59E0B] bg-slate-900 text-[#F59E0B] font-bold text-xs shadow-[0_0_12px_rgba(245,158,11,0.4)] transition-all duration-300";
          dot.innerHTML = i;
        } else {
          // Future
          dot.className = "w-8 h-8 rounded-full flex items-center justify-center border-2 border-slate-700 bg-slate-900 text-slate-400 font-bold text-xs transition-all duration-300";
          dot.innerHTML = i;
        }
      }
    }

    // Progress Bar width
    if (progressBarActive) {
      progressBarActive.style.width = `${((currentStep - 1) / 5) * 100}%`;
    }

    // Toggle navigation footer buttons
    if (btnPrev) {
      if (currentStep === 1) {
        btnPrev.classList.add('hidden');
      } else {
        btnPrev.classList.remove('hidden');
      }
    }

    if (currentStep === 6) {
      if (btnNext) btnNext.classList.add('hidden');
      if (submitBtn) submitBtn.classList.remove('hidden');
      renderSummaryRecap();
    } else {
      if (btnNext) btnNext.classList.remove('hidden');
      if (submitBtn) submitBtn.classList.add('hidden');
    }
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (validateStep(currentStep)) {
        currentStep++;
        updateStepUI();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (currentStep > 1) {
        currentStep--;
        updateStepUI();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  // Support direct Stepper dot clicks
  document.querySelectorAll('.step-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const targetStep = parseInt(dot.getAttribute('data-step'));
      if (targetStep < currentStep) {
        currentStep = targetStep;
        updateStepUI();
      } else if (targetStep > currentStep) {
        // Validate intermediate steps
        let isValid = true;
        for (let s = currentStep; s < targetStep; s++) {
          if (!validateStep(s)) {
            isValid = false;
            break;
          }
        }
        if (isValid) {
          currentStep = targetStep;
          updateStepUI();
        }
      }
    });
  });

  // --- Form Submission Logic ---
  const bookingForm = document.getElementById('booking_form');
  const successModal = document.getElementById('success_modal');
  const successRefCodeEl = document.getElementById('success_ref_code');
  const successDetailsEl = document.getElementById('success_details');
  const closeModalBtn = document.getElementById('close_modal_btn');
  const copyCodeBtn = document.getElementById('copy_code_btn');

  function showModal() {
    if (!successModal) return;
    successModal.classList.remove('hidden');
    void successModal.offsetWidth;
    successModal.classList.remove('opacity-0');
    successModal.classList.add('opacity-100');
    successModal.querySelector('div').classList.remove('scale-95');
    successModal.querySelector('div').classList.add('scale-100');
  }

  function hideModal() {
    if (!successModal) return;
    successModal.classList.add('opacity-0');
    successModal.classList.remove('opacity-100');
    successModal.querySelector('div').classList.remove('scale-100');
    successModal.querySelector('div').classList.add('scale-95');
    setTimeout(() => {
      successModal.classList.add('hidden');
    }, 300);
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
      hideModal();
      if (bookingForm) {
        bookingForm.reset();
        attendeesList = [];
        renderAttendees();
        proposedSlots = [{ id: Date.now(), date: '', startTime: '', endTime: '' }];
        renderProposedSlots();
        currentStep = 1;
        updateBookingTypeVisibility('client_pick');
        updateStepUI();
        
        // Reset dynamic panels
        locationContainer.classList.add('hidden');
        attendeesSection.classList.add('hidden');
        purposeOtherContainer.classList.add('hidden');
        
        // Remove active highlights
        if (execCardsContainer) {
          execCardsContainer.querySelectorAll('.executive-card').forEach(c => {
            c.classList.remove('selected');
          });
        }
      }
    });
  }

  if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', () => {
      const codeText = successRefCodeEl?.textContent;
      if (codeText) {
        navigator.clipboard.writeText(codeText).then(() => {
          const origContent = copyCodeBtn.innerHTML;
          copyCodeBtn.innerHTML = `
            <svg class="h-5 w-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          `;
          setTimeout(() => {
            copyCodeBtn.innerHTML = origContent;
          }, 2000);
        });
      }
    });
  }

  if (bookingForm) {
    bookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Secondary safety check for Step 6 validations
      if (!validateStep(1) || !validateStep(2) || !validateStep(3) || !validateStep(4) || !validateStep(5)) {
        return;
      }

      const name = document.getElementById('client_name').value.trim();
      const position = document.getElementById('client_position').value.trim();
      const company = document.getElementById('client_company').value.trim();
      const phone = document.getElementById('client_phone').value.trim();
      const email = document.getElementById('client_email').value.trim();

      const hostId = execSelect.value;
      const purposeTextarea = document.getElementById('purpose').value.trim();
      const additionalDetails = document.getElementById('additional_details').value.trim();

      const selectedPurposeMainRadio = document.querySelector('input[name="purpose_main"]:checked');
      let purposeMain = selectedPurposeMainRadio ? selectedPurposeMainRadio.value : '';
      if (purposeMain === 'อื่นๆ' && purposeOtherText) {
        purposeMain = purposeOtherText.value.trim();
      }

      const meetingFormat = document.querySelector('input[name="meeting_format"]:checked').value;
      const meetingLocation = meetingFormat === 'onsite' ? document.getElementById('meeting_location').value.trim() : '';

      // Set booking style dependent parameters
      let optionHours = '1 ชั่วโมง';
      let date = '';
      let timeSlot = '';
      let priority = 'ทั่วไป';
      let slotCount = 1;
      let optionProposedSlots = [];
      let startTime = '';
      let endTime = '';
      let proposedDates = [];
      let preferredDateFrom = '';
      let preferredDateTo = '';

      if (selectedBookingType === 'client_pick') {
        proposedDates = proposedSlots.map(slot => ({
          date: slot.date,
          startTime: slot.startTime || '',
          endTime: slot.endTime || ''
        }));
        
        if (proposedSlots.length > 0) {
          date = proposedSlots[0].date;
          startTime = proposedSlots[0].startTime || '';
          endTime = proposedSlots[0].endTime || '';
          timeSlot = (startTime && endTime) ? `${startTime} - ${endTime}` : 'TBD';
          optionHours = (startTime && endTime) ? calculateDuration(startTime, endTime) : '1 ชั่วโมง';
          
          optionProposedSlots = proposedSlots.map(slot => {
            const slotTime = (slot.startTime && slot.endTime) ? `${slot.startTime} - ${slot.endTime}` : 'TBD';
            const slotDuration = (slot.startTime && slot.endTime) ? calculateDuration(slot.startTime, slot.endTime) : '1 ชั่วโมง';
            return {
              date: slot.date,
              time: slotTime,
              duration: slotDuration
            };
          });
        }
        priority = document.querySelector('input[name="priority_1"]:checked').value;
      } else {
        optionHours = document.getElementById('booking2_hours').value.trim();
        priority = document.querySelector('input[name="priority_2"]:checked').value;
        slotCount = parseInt(document.querySelector('input[name="slot_count"]:checked').value);
        preferredDateFrom = document.getElementById('preferred_date_from')?.value || '';
        preferredDateTo = document.getElementById('preferred_date_to')?.value || '';
      }

      const hasAttendees = document.querySelector('input[name="has_attendees"]:checked').value === 'yes';
      let finalAttendees = [];
      if (hasAttendees) {
        finalAttendees = attendeesList.filter(att => att.name.trim() !== '');
      }

      const agreedToCalendarInvite = document.getElementById('agreed_to_calendar_invite').checked;
      if (!agreedToCalendarInvite) {
        alert('กรุณากดยอมรับข้อตกลงการส่งคำเชิญผ่าน Google Calendar');
        return;
      }

      const selectedHostObj = EXECUTIVE_HOSTS.find(h => h.id === hostId);
      const refCode = generateRefCode();

      // Formulate payload (compatible with Firestore and Code.gs schema)
      const payload = {
        refCode,
        clientName: name,
        clientCompany: company,
        clientEmail: email,
        executiveHost: selectedHostObj.name,
        executiveId: hostId,
        purpose: purposeTextarea,
        priority,
        
        // --- Backward compatible scheduling fields ---
        timeOption: selectedBookingType === 'client_pick' ? 'B' : 'A',
        optionAHours: optionHours,
        optionBProposedSlots: optionProposedSlots,
        date,
        timeSlot,
        startTime,
        endTime,
        
        // --- New Schema Fields ---
        position,
        phone,
        purposeMain,
        additionalDetails,
        bookingType: selectedBookingType,
        slotCount,
        meetingFormat,
        meetingLocation,
        additionalAttendees: finalAttendees,
        agreedToCalendarInvite,
        proposedDates,
        preferredDateFrom,
        preferredDateTo,
        
        // --- Administrative Defaults ---
        status: 'pending',
        createdAt: new Date().toISOString(),
        adminNotes: '',
        rescheduledDate: '',
        rescheduledTime: '',
        timeline: [
          {
            action: "created",
            label: "สร้างคำขอเข้าพบ",
            detail: selectedHostObj.name + " หัวข้อ: " + purposeTextarea,
            by: "client",
            timestamp: new Date().toISOString()
          }
        ]
      };

      // Disable submit button during insertion
      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-slate-950 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        กำลังบันทึกข้อมูลนัดหมาย...
      `;

      try {
        await dbManager.createAppointment(payload);
        
        // Notify admin via GAS webhook about the new booking
        try {
          await sendGasNotification('new_booking', payload);
        } catch (gasErr) {
          console.error("Failed to send new booking notification via GAS:", gasErr);
        }
        
        // Show success modal
        if (successRefCodeEl) {
          successRefCodeEl.textContent = refCode;
        }

        if (successDetailsEl) {
          let timeDisplayHtml = '';
          if (selectedBookingType === 'client_pick') {
            const slotsStr = proposedSlots.map((slot, i) => {
              const timeText = (slot.startTime && slot.endTime) ? `เวลา ${slot.startTime} - ${slot.endTime} น.` : 'ยังไม่ระบุเวลา';
              return `<p>• วันที่ ${slot.date} ${timeText}</p>`;
            }).join('');
            timeDisplayHtml = `
              <div class="text-xs text-slate-300">
                <p class="font-semibold text-slate-400">วันที่เสนอเข้าพบ:</p>
                ${slotsStr}
              </div>
            `;
          } else {
            let rangeText = '';
            const pfVal = document.getElementById('preferred_date_from')?.value;
            const ptVal = document.getElementById('preferred_date_to')?.value;
            if (pfVal || ptVal) {
              rangeText = `<p class="mt-1 text-slate-400">ช่วงวันที่ต้องการ: <span class="text-slate-200">${pfVal || 'ไม่จำกัด'} ถึง ${ptVal || 'ไม่จำกัด'}</span></p>`;
            }
            timeDisplayHtml = `
              <p>ระยะเวลาที่ต้องการ: <span class="font-bold text-slate-200">${optionHours}</span> (จำนวน ${slotCount} คิว)</p>
              ${rangeText}
              <p class="text-[10px] text-amber-500 mt-1">รอเลขาฯ จัดสรรคิวและแจ้งผลทางอีเมล</p>
            `;
          }

          let attendeesDisplayHtml = '';
          if (finalAttendees.length > 0) {
            attendeesDisplayHtml = `<p><span class="text-slate-400 font-medium">ผู้เข้าร่วมเพิ่มเติม:</span> <span class="font-semibold text-slate-200">${finalAttendees.map(a => `${a.name} (${a.position})`).join(', ')}</span></p>`;
          }

          successDetailsEl.innerHTML = `
            <div class="space-y-1.5 leading-relaxed">
              <p><span class="text-slate-400 font-medium">ชื่อผู้ติดต่อ:</span> <span class="font-semibold text-slate-200">${name} (${position})</span></p>
              <p><span class="text-slate-400 font-medium">บริษัท:</span> <span class="font-semibold text-slate-200">${company}</span></p>
              <p><span class="text-slate-400 font-medium">เบอร์โทรศัพท์:</span> <span class="font-semibold text-slate-200">${phone}</span></p>
              <p><span class="text-slate-400 font-medium">วัตถุประสงค์หลัก:</span> <span class="font-semibold text-slate-200">${purposeMain}</span></p>
              <p><span class="text-slate-400 font-medium">ผู้บริหารที่ขอพบ:</span> <span class="font-semibold text-[#F59E0B]">${selectedHostObj.name}</span></p>
              <p><span class="text-slate-400 font-medium">หัวข้อการประชุม:</span> <span class="text-slate-300">${purposeTextarea}</span></p>
              <p><span class="text-slate-400 font-medium">รูปแบบการประชุม:</span> <span class="font-semibold text-slate-200">${meetingFormat === 'online' ? 'ออนไลน์ (Zoom/Meet)' : `ออนไซต์ ที่ ${meetingLocation}`}</span></p>
              ${attendeesDisplayHtml}
              <div class="mt-2.5 pt-2.5 border-t border-slate-800 text-xs text-slate-400">
                ${timeDisplayHtml}
              </div>
            </div>
          `;
          
          // Modify 'go to status button' URL parameter so it is prefilled
          const goStatusBtn = document.getElementById('go_status_btn');
          if (goStatusBtn) {
            goStatusBtn.href = `status.html?code=${refCode}`;
          }
        }

        showModal();
      } catch (err) {
        alert('บันทึกข้อมูลไม่สำเร็จ: ' + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    });
  }
});
