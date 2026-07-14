/**
 * Executive Appointment Manager - Utility Helpers
 */

/**
 * Generates a unique, high-end reference code for appointments.
 * Format: APT-YYYYMMDD-XXXX (e.g. APT-20261130-M9R7)
 * @returns {string} Unique reference code
 */
export function generateRefCode() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing glyphs like I, O, 1, 0
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return `APT-${yyyy}${mm}${dd}-${code}`;
}

/**
 * Formats a date string (ISO format or Timestamp) into a luxury Thai date format.
 * @param {string|Date} dateVal - Date representation
 * @returns {string} Formatted date (e.g. 23 มิ.ย. 2569)
 */
export function formatDate(dateVal) {
  if (!dateVal) return '-';
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return String(dateVal);
  
  const options = {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  };
  
  // Return Thai formatted date with Buddhist Era adjustment (+543 years done automatically by th-TH locale)
  return date.toLocaleDateString('th-TH', options);
}

/**
 * Formats time string (HH:MM) to readable text
 * @param {string} timeStr - Time string
 * @returns {string} Formatted period
 */
export function formatTime(timeStr) {
  if (!timeStr) return '-';
  return `${timeStr} น.`;
}

/**
 * Maps appointment status keys to metadata for UI display.
 * @param {string} status - Campaign status (pending, approved, rejected, rescheduled, confirmed_reschedule)
 * @returns {Object} { label: string, badgeClass: string, color: string }
 */
export function statusLabel(status) {
  const normalized = (status || 'pending').toLowerCase();
  switch (normalized) {
    case 'approved':
      return {
        key: 'approved',
        label: 'อนุมัติแล้ว (Approved)',
        badgeClass: 'badge-approved',
        color: '#10B981',
        icon: `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
      };
    case 'rejected':
      return {
        key: 'rejected',
        label: 'ปฏิเสธ (Rejected)',
        badgeClass: 'badge-rejected',
        color: '#EF4444',
        icon: `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
      };
    case 'rescheduled':
      return {
        key: 'rescheduled',
        label: 'เลื่อนนัดหมาย (Rescheduled)',
        badgeClass: 'badge-rescheduled',
        color: '#3B82F6',
        icon: `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`
      };
    case 'confirmed_reschedule':
      return {
        key: 'confirmed_reschedule',
        label: 'ยืนยันรับเวลาใหม่แล้ว (Confirmed Reschedule)',
        badgeClass: 'badge-confirmed-reschedule',
        color: '#10B981',
        icon: `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`
      };
    case 'client_selected':
      return {
        key: 'client_selected',
        label: 'ลูกค้าเลือกคิวแล้ว (Selected)',
        badgeClass: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
        color: '#10B981',
        icon: `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`
      };
    case 'pending_client_selection':
      return {
        key: 'pending_client_selection',
        label: 'จัดสรรคิวเสนอให้ลูกค้าเลือก (Offer Slots)',
        badgeClass: 'bg-purple-100 text-purple-800 border border-purple-200',
        color: '#8B5CF6',
        icon: `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
      };
    case 'cancellation_requested':
      return {
        key: 'cancellation_requested',
        label: 'ลูกค้าขอยกเลิก',
        badgeClass: 'bg-red-100 text-red-800 border border-red-200 font-bold animate-pulse',
        color: '#EF4444',
        icon: `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
      };
    case 'reschedule_requested':
      return {
        key: 'reschedule_requested',
        label: 'ลูกค้าขอเลื่อนนัด',
        badgeClass: 'bg-blue-100 text-blue-800 border border-blue-200 font-bold animate-pulse',
        color: '#3B82F6',
        icon: `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`
      };
    case 'cancelled':
      return {
        key: 'cancelled',
        label: 'ยกเลิกแล้ว (Cancelled)',
        badgeClass: 'bg-gray-100 text-gray-500 border border-gray-200 line-through',
        color: '#6B7280',
        icon: `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
      };
    case 'pending':
    default:
      return {
        key: 'pending',
        label: 'รอดำเนินการ (Pending)',
        badgeClass: 'badge-pending',
        color: '#F59E0B',
        icon: `<svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
      };
  }
}

/**
 * Gets a standardized list of executive hosts.
 */
export const EXECUTIVE_HOSTS = [
  { 
    id: "ผช.บร.", 
    name: "ผศ.ชนัญชี ภังคานนท์", 
    title: "ผู้ช่วยอธิการบดีสายบริหารและบริการการศึกษา (ผช.บร.)",
    fullTitle: "ผศ.ชนัญชี ภังคานนท์ ผู้ช่วยอธิการบดีสายบริหารและบริการการศึกษา (ผช.บร.)",
    shortTitle: "ผู้ช่วยอธิการบดี (ผช.บร.)",
    imageUrl: "https://i.postimg.cc/Jz6cF6Gz/phch-br.jpg",
    adminOwner: "admin1"
  },
  { 
    id: "รอง บร.", 
    name: "ดร.สุนทรี รัตภาสกร",
    title: "รองอธิการบดีสายบริหารและบริการการศึกษา (รอง บร.)",
    fullTitle: "ดร.สุนทรี รัตภาสกร รองอธิการบดีสายบริหารและบริการการศึกษา (รอง บร.)",
    shortTitle: "รองอธิการบดี (รอง บร.)",
    imageUrl: "https://i.postimg.cc/Px4mmSsr/rxng-br.jpg",
    adminOwner: "admin1"
  },
  { 
    id: "รอ.วก.", 
    name: "ผศ.สรรเสริญ มิลินทสูต",
    title: "รองอธิการบดีอาวุโสด้านวิชาการ (รอ.วก.)",
    fullTitle: "ผศ.สรรเสริญ มิลินทสูต รองอธิการบดีอาวุโสด้านวิชาการ (รอ.วก.)",
    shortTitle: "รองอธิการบดีอาวุโส (รอ.วก.)",
    imageUrl: "https://i.postimg.cc/gk53qw5y/rx-wk.jpg",
    adminOwner: "admin2"
  }
];

export const ADMIN_ACCOUNTS = {
  "putcharawun.k@bu.ac.th": "admin1",
  "pimapsorn.s@bu.ac.th": "admin2"
};

/**
 * Pre-defined slots for appointment scheduling
 */
export const AVAILABLE_SLOTS = [
  '09:00 - 10:00',
  '10:30 - 11:30',
  '13:30 - 14:30',
  '15:00 - 16:00'
];
