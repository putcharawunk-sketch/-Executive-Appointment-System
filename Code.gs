/**
 * ==============================================================================
 * GOOGLE APPS SCRIPT (Code.gs) FOR EXECUTIVE BOOKING SYSTEM WEBHOOK BACKEND
 * ==============================================================================
 * ทำหน้าที่เป็น Webhook รับเหตุการณ์จาก Frontend ของระบบจองคิวฝ่ายบริหาร
 * เพื่อจัดการ Google Calendar Event และจัดส่งอีเมลแจ้งเตือนลูกค้า/เลขาฯ 
 * ด้วยเทมเพลตอีเมล HTML รูปแบบหรูหรา น่าเชื่อถือ (Executive High-Class Design)
 * ==============================================================================
 */

// ==========================================
// 1. CONFIGURATION
// ==========================================
const CALENDAR_ID = 'primary';
const FIRESTORE_PROJECT_ID = 'ai-studio-a5bd4c57-fd53-487d-a656-60525d934d1b';
const ADMIN_EMAIL = 'putcharawun.k@bu.ac.th';
const FRONTEND_BASE_URL = 'https://ais-dev-4sbo3bax2zhybk2udai3cm-241766677434.asia-east1.run.app';

// เพิ่มตัวแปร global ไว้บนสุดของไฟล์ (ใต้ CONFIGURATION)
var lastEmailThreadId = null;
var lastEmailMessageId = null;

// ==========================================
// 2. ENTRY POINT FOR HTTP GET
// ==========================================
function doGet(e) {
  const action = e.parameter.action;
  
  if (action === 'download_ics') {
    const title = e.parameter.title || 'นัดหมายเข้าพบฝ่ายบริหาร';
    const description = e.parameter.description || '';
    const location = e.parameter.location || '';
    const start = e.parameter.start || '';
    const end = e.parameter.end || '';
    
    const icsLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Executive Booking System//TH',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'SUMMARY:' + title,
      'DESCRIPTION:' + description.replace(/\n/g, '\\n'),
      'LOCATION:' + location,
      'DTSTART:' + start,
      'DTEND:' + end,
      'STATUS:CONFIRMED',
      'SEQUENCE:0',
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    
    const icsContent = icsLines.join('\r\n');
    
    return ContentService.createTextOutput(icsContent)
      .setMimeType(ContentService.MimeType.TEXT)
      .downloadAsFile('appointment-' + (e.parameter.ref || 'event') + '.ics');
  }
  
  return ContentService.createTextOutput("Executive Booking Webhook Server is ONLINE.");
}

// ==========================================
// 3. ENTRY POINT FOR HTTP POST (WEBHOOK)
// ==========================================
function doPost(e) {
  lastEmailThreadId = null;
  lastEmailMessageId = null;
  const result = { success: false, message: '' };
  
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("ไม่มีข้อมูล Payload ส่งมาพร้อมกับคำร้องขอ");
    }
    
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const appData = payload.appointmentData;
    
    if (!action || !appData) {
      throw new Error("พารามิเตอร์ไม่สมบูรณ์ (ต้องประกอบด้วย 'action' และ 'appointmentData')");
    }
    
    console.log("ได้รับคำขอดำเนินการ Action: " + action + " สำหรับรหัสจองคิว: " + appData.refCode);
    
    switch (action.toLowerCase()) {
      case 'approve':
      case 'approved':
        handleApproval(appData, result);
        break;
      case 'client_selected':
      case 'client_selected_notify':
        handleNotifyAdminSelection(appData, result);
        break;
      case 'reschedule':
      case 'rescheduled':
        handleReschedule(appData, result);
        break;
      case 'reject':
      case 'rejected':
        handleRejection(appData, result);
        break;
      case 'offer_slots':
      case 'pending_client_selection':
        handleOfferSlots(appData, result);
        break;
      case 'client_selected_notify':
        handleNotifyAdminSelection(appData, result);
        break;
      case 'cancel_request':
      case 'cancellation_requested':
        handleCancelRequest(appData, result);
        break;
      case 'reschedule_request':
      case 'reschedule_requested':
        handleRescheduleRequest(appData, result);
        break;
      case 'cancelled':
        handleCancelled(appData, result);
        break;
      case 'new_booking':
      case 'create':
        handleNewBookingNotification(appData, result);
        break;
      default:
        throw new Error("ไม่พบ Action ประเภทที่ระบุ: " + action);
    }
    
  } catch (err) {
    console.error("เกิดข้อผิดพลาดในการรัน Webhook: " + err.message);
    result.success = false;
    result.message = err.message;
  }
  
  result.emailThreadId = lastEmailThreadId;
  result.lastMessageId = lastEmailMessageId;
  
  // ===================================================
  // สำคัญ: เพิ่ม CORS headers เพื่อให้ Frontend อ่าน
  // response ได้โดยไม่ต้องใช้ mode: 'no-cors'
  // ===================================================
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// 4. ACTION PROCESSORS
// ==========================================

function handleApproval(appData, result) {
  // ดึง selectedSlotEventId ที่ได้กดยืนยันตอนจอง/เลือกเวลากลับมาจาก Firestore
  const freshDoc = getFirestoreDocument(appData.refCode);
  const selectedSlotEventId = freshDoc ? freshDoc.selectedSlotEventId : null;
  let finalEventId = null;
  
  if (selectedSlotEventId) {
    const title = `[ยืนยัน] เข้าพบ ${appData.executiveHost || appData.executiveId || ''} - คุณ ${appData.clientName || ''}`;
    const success = updateCalendarEvent(selectedSlotEventId, title, null, null, "9");
    if (success) {
      finalEventId = selectedSlotEventId;
    }
  }
  
  // หากไม่มีหรืออัปเดตไม่สำเร็จ ให้สร้างปฏิทินใหม่เลย
  if (!finalEventId) {
    finalEventId = createSingleSlotEvent(
      appData,
      appData.confirmedDate || appData.date,
      appData.confirmedTime || appData.timeSlot,
      "[ยืนยัน] ",
      "9"
    );
  }
  
  if (finalEventId) {
    updateFirestoreDocument(appData.refCode, { calendarEventId: finalEventId });
    result.calendarEventId = finalEventId;
  }
  
  // ทำการลบคิวที่เหลือ (เพื่อความปลอดภัยหากยังมีค้างอยู่)
  if (freshDoc) {
    const pendingIdsStr = freshDoc.pendingEventIds || '';
    if (pendingIdsStr) {
      const pendingIds = pendingIdsStr.split(',').filter(Boolean);
      pendingIds.forEach(id => {
        if (id.trim() !== finalEventId) {
          deleteCalendarEvent(id.trim());
        }
      });
      updateFirestoreDocument(appData.refCode, { pendingEventIds: '' });
    }
  }
  
  const clientEmail = appData.clientEmail || appData.email || '';
  const ccEmails = addAdminToCc(getCcEmails(appData.additionalAttendees));
  
  const dateDisplay = formatDateThai(appData.confirmedDate || appData.date);
  const timeDisplay = (appData.confirmedTime || appData.timeSlot) + " น.";
  const locationDisplay = appData.meetingLocation || "รออัปเดตพิกัด";
  
  const subject = `[อนุมัติแล้ว] ${appData.purpose} (เลขอ้างอิง ${appData.refCode})`;
  
  const calTitle = `[นัดหมาย] เข้าพบ ${appData.executiveHost}`;
  const calDesc = `นัดหมายเข้าพบฝ่ายบริหาร เลขที่อ้างอิง: ${appData.refCode}\nผู้ขอเข้าพบ: ${appData.clientName}\nวัตถุประสงค์: ${appData.purpose}`;
  
  const startISO = getIsoTimeFormat(appData.confirmedDate || appData.date, appData.confirmedTime || appData.timeSlot, false);
  const endISO = getIsoTimeFormat(appData.confirmedDate || appData.date, appData.confirmedTime || appData.timeSlot, true);
  
  const googleCalLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(calTitle)}&dates=${startISO}/${endISO}&details=${encodeURIComponent(calDesc)}&location=${encodeURIComponent(locationDisplay)}`;
  const icsDownloadLink = `${ScriptApp.getService().getUrl()}?action=download_ics&ref=${appData.refCode}&title=${encodeURIComponent(calTitle)}&description=${encodeURIComponent(calDesc)}&location=${encodeURIComponent(locationDisplay)}&start=${startISO}&end=${endISO}`;

  const htmlBody = getApprovalEmailTemplate(appData, dateDisplay, timeDisplay, locationDisplay, googleCalLink, icsDownloadLink);
  
  sendHtmlEmail(clientEmail, subject, htmlBody, ccEmails, appData);
  
  result.success = true;
  result.message = "ดำเนินการสร้างกิจกรรมบนปฏิทินและจัดส่งเมลยืนยันการอนุมัติสำเร็จ";
}

function handleReschedule(appData, result) {
  const freshDoc = getFirestoreDocument(appData.refCode);
  const existingEventId = freshDoc ? (freshDoc.selectedSlotEventId || freshDoc.calendarEventId) : null;
  let finalEventId = null;
  
  const newTitle = `[รอยืนยันเลื่อน] เข้าพบ ${appData.executiveHost || appData.executiveId || ''} - คุณ ${appData.clientName || ''}`;
  
  if (existingEventId) {
    const success = updateCalendarEvent(existingEventId, newTitle, appData.rescheduledDate, appData.rescheduledTime, "6");
    if (success) {
      finalEventId = existingEventId;
    }
  }
  
  if (!finalEventId) {
    finalEventId = createSingleSlotEvent(
      appData,
      appData.rescheduledDate,
      appData.rescheduledTime,
      "[รอยืนยันเลื่อน] ",
      "6"
    );
  }
  
  if (finalEventId) {
    updateFirestoreDocument(appData.refCode, { 
      selectedSlotEventId: finalEventId,
      calendarEventId: '' // เคลียร์ตัวยืนยันเก่าออกไปเพื่อรอคอนเฟิร์มใหม่
    });
    result.selectedSlotEventId = finalEventId;
  }
  
  // ลบคิวเสนอเลือกเก่าถ้ามี
  if (freshDoc) {
    const pendingIdsStr = freshDoc.pendingEventIds || '';
    if (pendingIdsStr) {
      const pendingIds = pendingIdsStr.split(',').filter(Boolean);
      pendingIds.forEach(id => {
        if (id.trim() !== finalEventId) {
          deleteCalendarEvent(id.trim());
        }
      });
      updateFirestoreDocument(appData.refCode, { pendingEventIds: '' });
    }
  }

  const clientEmail = appData.clientEmail || appData.email || '';
  const ccEmails = addAdminToCc(getCcEmails(appData.additionalAttendees));
  
  const oldDate = formatDateThai(appData.date);
  const oldTime = appData.timeSlot + " น.";
  const newDate = formatDateThai(appData.rescheduledDate);
  const newTime = appData.rescheduledTime + " น.";
  const noteText = appData.adminNotes || "มีความจำเป็นต้องขอปรับขอบเขตเวลาเพื่อหลีกเลี่ยงการทับซ้อนเวลากับกิจกรรมเร่งด่วนขององค์กร";
  
  const subject = `[เสนอเลื่อนเวลา] ${appData.purpose} (เลขอ้างอิง ${appData.refCode})`;
  const statusLink = `${FRONTEND_BASE_URL}/status.html?ref=${appData.refCode}`;
  
  const htmlBody = getRescheduleEmailTemplate(appData, oldDate, oldTime, newDate, newTime, noteText, statusLink);
  
  sendHtmlEmail(clientEmail, subject, htmlBody, ccEmails, appData);
  
  result.success = true;
  result.message = "จัดส่งอีเมลข้อเสนอเลื่อนเวลาให้กับลูกค้าเรียบร้อยแล้ว";
}

function handleRejection(appData, result) {
  // ลบ events ทั้งหมดที่เกี่ยวข้องทันที
  deleteAllAssociatedCalendarEvents(appData.refCode);

  const clientEmail = appData.clientEmail || appData.email || '';
  const ccEmails = addAdminToCc('');
  const reason = appData.adminNotes || "ผู้บริหารติดภารกิจด่วนพิเศษในวันดังกล่าว";
  
  const subject = `[ปฏิเสธแล้ว] ${appData.purpose} (เลขอ้างอิง ${appData.refCode})`;
  const htmlBody = getRejectionEmailTemplate(appData, reason);
  
  sendHtmlEmail(clientEmail, subject, htmlBody, ccEmails, appData);
  
  result.success = true;
  result.message = "จัดส่งอีเมลแจ้งปฏิเสธคำขอนัดหมายสำเร็จ และคืนสิทธิ์เวลาบน Google Calendar แล้ว";
}

function handleOfferSlots(appData, result) {
  // ลบคิวปฏิทินเก่าออกก่อนเพื่อป้องกันการทับซ้อนบิดเบือน
  deleteAllAssociatedCalendarEvents(appData.refCode);

  const slots = appData.proposedSlots || appData.proposedDates || [];
  const pendingEventIds = [];
  
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const eventId = createSingleSlotEvent(appData, slot.date, slot.time, "[รอเลือก] ", "5");
    if (eventId) {
      pendingEventIds.push(eventId);
    }
  }
  
  if (pendingEventIds.length > 0) {
    const joinedIds = pendingEventIds.join(',');
    updateFirestoreDocument(appData.refCode, { pendingEventIds: joinedIds });
    result.pendingEventIds = joinedIds;
  }

  const clientEmail = appData.clientEmail || appData.email || '';
  const ccEmails = addAdminToCc(getCcEmails(appData.additionalAttendees));
  
  const subject = `[เสนอคิวจอง] ${appData.purpose} (เลขอ้างอิง ${appData.refCode})`;
  const statusLink = `${FRONTEND_BASE_URL}/status.html?ref=${appData.refCode}`;
  
  const htmlBody = getOfferSlotsEmailTemplate(appData, statusLink);
  
  sendHtmlEmail(clientEmail, subject, htmlBody, ccEmails, appData);
  
  result.success = true;
  result.message = "จัดส่งเมลเสนอคิวเวลาพร้อมลงนัดหมายรอเลือกบน Google Calendar เรียบร้อยแล้ว";
}

function handleNotifyAdminSelection(appData, result) {
  // ดึงคิวเลือกจาก Firestore
  const freshDoc = getFirestoreDocument(appData.refCode);
  if (freshDoc) {
    const selectedDate = appData.confirmedDate || appData.date;
    const selectedTime = appData.confirmedTime || appData.timeSlot;
    
    // หา index ของคิวที่ถูกเลือก
    const slots = freshDoc.proposedSlots || appData.proposedSlots || [];
    let selectedIndex = -1;
    
    // เผื่อโครงสร้างข้อมูลเก็บเป็น JSON หรือ string array
    let slotsArray = [];
    if (typeof slots === 'string') {
      try { slotsArray = JSON.parse(slots); } catch(e) {}
    } else if (Array.isArray(slots)) {
      slotsArray = slots;
    }
    
    for (let i = 0; i < slotsArray.length; i++) {
      if (slotsArray[i].date === selectedDate && slotsArray[i].time === selectedTime) {
        selectedIndex = i;
        break;
      }
    }
    
    const pendingIdsStr = freshDoc.pendingEventIds || '';
    if (pendingIdsStr) {
      const pendingIds = pendingIdsStr.split(',').filter(Boolean);
      let selectedSlotEventId = null;
      
      for (let i = 0; i < pendingIds.length; i++) {
        const id = pendingIds[i].trim();
        if (i === selectedIndex) {
          selectedSlotEventId = id;
          // อัปเดตคิวที่เลือกรอยืนยัน (สีส้ม colorId: '6')
          const title = `[รอยืนยัน] เข้าพบ ${appData.executiveHost || appData.executiveId || ''} - คุณ ${appData.clientName || ''}`;
          updateCalendarEvent(id, title, null, null, "6");
        } else {
          // ลบคิวอื่นๆ ที่ไม่เลือก
          deleteCalendarEvent(id);
        }
      }
      
      if (selectedSlotEventId) {
        updateFirestoreDocument(appData.refCode, { 
          selectedSlotEventId: selectedSlotEventId,
          pendingEventIds: '' // ล้าง pending เพราะดำเนินการแล้ว
        });
        result.selectedSlotEventId = selectedSlotEventId;
      }
    }
  }

  const subject = `[ลูกค้าเลือกคิวแล้ว] คุณ ${appData.clientName} ยืนยันการเลือกวันเวลานัดหมาย - เลขอ้างอิง ${appData.refCode}`;
  const adminLink = `${FRONTEND_BASE_URL}/admin.html`;
  
  const dateDisplay = formatDateThai(appData.confirmedDate || appData.date);
  const timeDisplay = (appData.confirmedTime || appData.timeSlot) + " น.";
  
  const htmlBody = getAdminSelectionNotificationTemplate(appData, dateDisplay, timeDisplay, adminLink);
  
  // ส่งให้ Admin (ไม่ใส่ refCode เพราะนี่คืออีเมลถึง Admin ไม่ใช่ลูกค้า)
  sendHtmlEmail(ADMIN_EMAIL, subject, htmlBody, '', null);
  
  result.success = true;
  result.message = "จัดส่งเมลแจ้งเตือนการเลือกสิทธิ์เวลาของลูกค้าไปยังเลขาฯ และคืนตารางว่างบน Google Calendar แล้ว";
}

function handleCancelRequest(appData, result) {
  const subject = `[แจ้งขอยกเลิกนัด] คำขอยกเลิกนัดหมายจาก คุณ ${appData.clientName} - เลขอ้างอิง ${appData.refCode}`;
  const adminLink = `${FRONTEND_BASE_URL}/admin.html`;
  
  const htmlBody = getAdminCancellationRequestTemplate(appData, adminLink);
  
  // ส่งให้ Admin (ไม่ใส่ refCode เพราะนี่คืออีเมลถึง Admin)
  sendHtmlEmail(ADMIN_EMAIL, subject, htmlBody, '', null);
  
  result.success = true;
  result.message = "ส่งคำร้องขอยกเลิกนัดหมายไปยังกล่องข้อความเลขาฯ แล้ว";
}

function handleRescheduleRequest(appData, result) {
  let subject = `[ลูกค้าขอเลื่อนนัด] คุณ ${appData.clientName} - เลขอ้างอิง ${appData.refCode}`;
  if (appData.rescheduleContext === 'from_offer_slots') {
    subject = `[ขอเปลี่ยนคิว] คุณ ${appData.clientName} ไม่ต้องการคิวที่เสนอ - เลขอ้างอิง ${appData.refCode}`;
  }
  const adminLink = `${FRONTEND_BASE_URL}/admin.html`;
  
  const htmlBody = getAdminRescheduleRequestTemplate(appData, adminLink);
  
  // ส่งให้ Admin (ไม่ใส่ refCode เพราะนี่คืออีเมลถึง Admin)
  sendHtmlEmail(ADMIN_EMAIL, subject, htmlBody, '', null);
  
  // ลบ events ทั้งหมดที่เกี่ยวข้องทันที เพราะขอเสนอวันใหม่เพื่อเคลียร์ตารางเก่า
  deleteAllAssociatedCalendarEvents(appData.refCode);
  
  result.success = true;
  result.message = appData.rescheduleContext === 'from_offer_slots'
    ? "ส่งคำขอเสนอวันนัดหมายใหม่ไปยังเลขาฯ เรียบร้อยแล้ว และระบบได้ยกเลิกสิทธิ์จองคิวเดิมบนปฏิทินแล้ว"
    : "ส่งคำขอเลื่อนนัดหมายไปยังกล่องข้อความเลขาฯ แล้ว";
}

function handleCancelled(appData, result) {
  // ลบ events ทั้งหมดที่เกี่ยวข้องทันที
  deleteAllAssociatedCalendarEvents(appData.refCode);
  
  // ส่งอีเมลยืนยันยกเลิกถึงลูกค้า
  const clientEmail = appData.clientEmail || appData.email || '';
  const ccEmails = addAdminToCc(getCcEmails(appData.additionalAttendees));
  
  const subject = `[ยกเลิกแล้ว] ${appData.purpose} (เลขอ้างอิง ${appData.refCode})`;
  const htmlBody = getCancellationConfirmedEmailTemplate(appData);
  
  sendHtmlEmail(clientEmail, subject, htmlBody, ccEmails, appData);
  
  result.success = true;
  result.calendarDeleted = true;
  result.message = "ดำเนินการยกเลิกนัดหมาย คืนสิทธิ์ตารางว่างบน Google Calendar และส่งเมลยืนยันแก่ลูกค้าแล้ว";
}

function handleNewBookingNotification(appData, result) {
  const subject = `[คำขอใหม่] มีผู้ขออนุเคราะห์เข้าพบ ${appData.executiveHost || appData.executiveId || ''} - คุณ ${appData.clientName || ''}`;
  const adminLink = `${FRONTEND_BASE_URL}/admin.html`;
  
  const htmlBody = getAdminNewBookingNotificationTemplate(appData, adminLink);
  
  // ส่งให้ Admin
  sendHtmlEmail(ADMIN_EMAIL, subject, htmlBody, '', null);
  
  result.success = true;
  result.message = "แจ้งเตือนทางอีเมลส่งไปยังเลขานุการเรียบร้อยแล้ว";
}

// ==========================================
// 5. HELPER UTILITIES
// ==========================================

function setEventColor(event, colorId) {
  if (!event || !colorId) return;
  try {
    var enumColor = null;
    switch (String(colorId)) {
      case "1": enumColor = CalendarApp.EventColor.PALE_BLUE; break;   // Lavender
      case "2": enumColor = CalendarApp.EventColor.PALE_GREEN; break;  // Sage
      case "3": enumColor = CalendarApp.EventColor.MAUVE; break;       // Grape
      case "4": enumColor = CalendarApp.EventColor.PALE_RED; break;    // Flamingo
      case "5": enumColor = CalendarApp.EventColor.YELLOW; break;      // Banana
      case "6": enumColor = CalendarApp.EventColor.ORANGE; break;      // Tangerine
      case "7": enumColor = CalendarApp.EventColor.BLUE; break;        // Peacock
      case "8": enumColor = CalendarApp.EventColor.TURQUOISE; break;   // Blueberry
      case "9": enumColor = CalendarApp.EventColor.GREEN; break;       // Basil
      case "10": enumColor = CalendarApp.EventColor.RED; break;        // Tomato
      case "11": enumColor = CalendarApp.EventColor.GRAY; break;       // Gray/Light Flamingo
    }
    if (enumColor !== null) {
      event.setColor(enumColor);
    } else {
      event.setColor(colorId);
    }
  } catch (e) {
    console.warn("Could not set color using enum, trying string colorId directly: " + e.message);
    try {
      event.setColor(colorId);
    } catch (e2) {
      console.error("Failed to set event color: " + e2.message);
    }
  }
}

function createSingleSlotEvent(appData, dateStr, timeStr, titlePrefix, colorId) {
  try {
    let calendar;
    try {
      calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    } catch(ce) {
      console.warn("ไม่สามารถดึงปฏิทิน " + CALENDAR_ID + " จะใช้ปฏิทินหลักแทน: " + ce.message);
    }
    if (!calendar) {
      calendar = CalendarApp.getDefaultCalendar();
    }
    
    if (!dateStr || !timeStr) {
      console.warn("ข้ามการสร้างปฏิทิน: ข้อมูลวันและเวลาไม่สมบูรณ์");
      return null;
    }
    
    const [startH, startM, endH, endM] = parseTimeSlot(timeStr);
    const [year, month, day] = dateStr.split('-').map(Number);
    const startDate = new Date(year, month - 1, day, startH, startM, 0);
    const endDate = new Date(year, month - 1, day, endH, endM, 0);
    
    const title = `${titlePrefix}เข้าพบ ${appData.executiveHost || appData.executiveId || ''} - คุณ ${appData.clientName || ''}`;
    
    const details = [
      `รหัสอ้างอิงคำขอ: ${appData.refCode}`,
      `ผู้ขอเข้าพบ: คุณ ${appData.clientName || ''} (${appData.position || '-'})`,
      `บริษัท/หน่วยงาน: ${appData.clientCompany || '-'}`,
      `เบอร์โทรศัพท์: ${appData.clientPhone || appData.phone || '-'}`,
      `อีเมล: ${appData.clientEmail || appData.email || ''}`,
      `วัตถุประสงค์หลัก: ${appData.purposeMain || '-'}`,
      `หัวข้อ: ${appData.purpose || '-'}`,
      `รูปแบบ: ${appData.meetingFormat === 'online' ? 'ออนไลน์' : 'ออนไซต์'}`,
      `สถานที่: ${appData.meetingLocation || '-'}`,
      `รายละเอียดเพิ่มเติม: ${appData.additionalDetails || '-'}`
    ].join('\n');
    
    const event = calendar.createEvent(title, startDate, endDate, {
      description: details,
      location: appData.meetingLocation || ''
    });
    
    if (colorId) {
      setEventColor(event, colorId);
    }
    
    // เพิ่มลูกค้าเป็น guest
    try {
      const guestEmail = appData.clientEmail || appData.email;
      if (guestEmail) event.addGuest(guestEmail);
    } catch (e) {
      console.warn("ไม่สามารถเพิ่ม guest: " + e.message);
    }
    
    // เพิ่มผู้เข้าร่วมเสริม
    if (appData.additionalAttendees && appData.additionalAttendees.length > 0) {
      appData.additionalAttendees.forEach(att => {
        if (att.email) {
          try { event.addGuest(att.email); } catch (e) {}
        }
      });
    }
    
    const newEventId = event.getId();
    console.log("สร้าง Slot Calendar event สำเร็จ ID: " + newEventId);
    return newEventId;
  } catch (err) {
    console.error("ผิดพลาดขณะสร้างปฏิทินย่อย: " + err.message);
    return null;
  }
}

function updateCalendarEvent(eventId, newTitle, newDate, newTime, colorId) {
  if (!eventId) return false;
  try {
    let calendar;
    try {
      calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    } catch(e) {}
    if (!calendar) calendar = CalendarApp.getDefaultCalendar();
    
    const event = calendar.getEventById(eventId);
    if (event) {
      if (newTitle) {
        event.setTitle(newTitle);
      }
      if (newDate && newTime) {
        const [startH, startM, endH, endM] = parseTimeSlot(newTime);
        const [year, month, day] = newDate.split('-').map(Number);
        const startDate = new Date(year, month - 1, day, startH, startM, 0);
        const endDate = new Date(year, month - 1, day, endH, endM, 0);
        event.setTime(startDate, endDate);
      }
      if (colorId) {
        setEventColor(event, colorId);
      }
      console.log("อัปเดต Google Calendar event สำเร็จ: " + eventId);
      return true;
    }
  } catch (err) {
    console.error("ขัดข้องระหว่างอัปเดตปฏิทิน: " + err.message);
  }
  return false;
}

function deleteAllAssociatedCalendarEvents(refCode) {
  if (!refCode) return;
  try {
    const freshDoc = getFirestoreDocument(refCode);
    if (!freshDoc) return;
    
    // 1. Delete pendingEventIds
    const pendingIdsStr = freshDoc.pendingEventIds || '';
    if (pendingIdsStr) {
      const pendingIds = pendingIdsStr.split(',').filter(Boolean);
      pendingIds.forEach(id => {
        deleteCalendarEvent(id.trim());
      });
    }
    
    // 2. Delete selectedSlotEventId
    if (freshDoc.selectedSlotEventId) {
      deleteCalendarEvent(freshDoc.selectedSlotEventId.trim());
    }
    
    // 3. Delete calendarEventId
    if (freshDoc.calendarEventId) {
      deleteCalendarEvent(freshDoc.calendarEventId.trim());
    }
    
    // Update Firestore to clear these event IDs and note that calendar is deleted
    updateFirestoreDocument(refCode, {
      calendarEventId: '',
      selectedSlotEventId: '',
      pendingEventIds: '',
      calendarDeleted: true,
      calendarDeletedAt: new Date().toISOString()
    });
    
  } catch (err) {
    console.error("ผิดพลาดขณะลบกิจกรรมทั้งหมด: " + err.message);
  }
}

function createCalendarEvent(appData) {
  try {
    let calendar;
    try {
      calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    } catch(ce) {
      console.warn("ไม่สามารถดึงปฏิทิน " + CALENDAR_ID + " จะใช้ปฏิทินหลักแทน: " + ce.message);
    }
    
    if (!calendar) {
      calendar = CalendarApp.getDefaultCalendar();
    }
    
    const dateStr = appData.confirmedDate || appData.date;
    const timeStr = appData.confirmedTime || appData.timeSlot;
    
    if (!dateStr || !timeStr) {
      console.warn("ข้ามการสร้างปฏิทิน: ข้อมูลวันและเวลาไม่สมบูรณ์");
      return null;
    }
    
    const [startH, startM, endH, endM] = parseTimeSlot(timeStr);
    const [year, month, day] = dateStr.split('-').map(Number);
    const startDate = new Date(year, month - 1, day, startH, startM, 0);
    const endDate = new Date(year, month - 1, day, endH, endM, 0);
    
    const title = `[นัดหมาย] คุณ${appData.clientName} เข้าพบ${appData.executiveHost}`;
    
    const details = [
      `รหัสอ้างอิงคำขอ: ${appData.refCode}`,
      `ผู้ขอเข้าพบ: คุณ${appData.clientName} (${appData.position || '-'})`,
      `บริษัท/หน่วยงาน: ${appData.clientCompany}`,
      `เบอร์โทรศัพท์: ${appData.clientPhone || appData.phone || '-'}`,
      `อีเมล: ${appData.clientEmail || appData.email || ''}`,
      `วัตถุประสงค์หลัก: ${appData.purposeMain || '-'}`,
      `หัวข้อ: ${appData.purpose}`,
      `รูปแบบ: ${appData.meetingFormat === 'online' ? 'ออนไลน์' : 'ออนไซต์'}`,
      `สถานที่: ${appData.meetingLocation || '-'}`,
      `รายละเอียดเพิ่มเติม: ${appData.additionalDetails || '-'}`
    ].join('\n');
    
    const event = calendar.createEvent(title, startDate, endDate, {
      description: details,
      location: appData.meetingLocation || ''
    });
    
    // เพิ่มลูกค้าเป็น guest
    try {
      const guestEmail = appData.clientEmail || appData.email;
      if (guestEmail) event.addGuest(guestEmail);
    } catch (e) {
      console.warn("ไม่สามารถเพิ่ม guest: " + e.message);
    }
    
    // เพิ่มผู้เข้าร่วมเสริม
    if (appData.additionalAttendees && appData.additionalAttendees.length > 0) {
      appData.additionalAttendees.forEach(att => {
        if (att.email) {
          try { event.addGuest(att.email); } catch (e) {}
        }
      });
    }
    
    const newEventId = event.getId();
    console.log("สร้าง Calendar event สำเร็จ ID: " + newEventId);
    return newEventId;
    
  } catch (err) {
    console.error("ผิดพลาดขณะสร้างปฏิทิน: " + err.message);
    return null;
  }
}

function deleteCalendarEvent(eventId) {
  if (!eventId) return false;
  try {
    let calendar;
    try {
      calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    } catch(e) {}
    
    if (!calendar) calendar = CalendarApp.getDefaultCalendar();
    
    const event = calendar.getEventById(eventId);
    if (event) {
      event.deleteEvent();
      console.log("ลบ Calendar event สำเร็จ: " + eventId);
      return true;
    } else {
      console.log("ไม่พบ event ID: " + eventId + " (อาจถูกลบไปแล้ว)");
      return false;
    }
  } catch (err) {
    console.error("ผิดพลาดระหว่างลบปฏิทิน: " + err.message);
    return false;
  }
}

function parseTimeSlot(timeSlotStr) {
  try {
    const parts = timeSlotStr.split('-');
    const [sh, sm] = parts[0].trim().split(':').map(Number);
    const [eh, em] = parts[1].trim().split(':').map(Number);
    return [sh, sm, eh, em];
  } catch (e) {
    return [9, 0, 10, 0];
  }
}

function getCcEmails(additionalAttendees) {
  if (!additionalAttendees || additionalAttendees.length === 0) return '';
  const emails = [];
  additionalAttendees.forEach(att => {
    if (att.email && att.email.trim() !== '') emails.push(att.email.trim());
  });
  return emails.join(',');
}

function addAdminToCc(existingCc) {
  if (!existingCc || existingCc.trim() === '') return ADMIN_EMAIL;
  return existingCc + ',' + ADMIN_EMAIL;
}

function updateFirestoreDocument(refCode, updates) {
  if (!FIRESTORE_PROJECT_ID) return;
  
  const url = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT_ID + "/databases/(default)/documents/appointments/" + refCode;
  
  const fields = {};
  const fieldPaths = [];
  
  for (const [key, val] of Object.entries(updates)) {
    fieldPaths.push(key);
    if (typeof val === 'string') fields[key] = { stringValue: val };
    else if (typeof val === 'number') fields[key] = { doubleValue: val };
    else if (typeof val === 'boolean') fields[key] = { booleanValue: val };
  }
  
  const queryParams = fieldPaths.map(p => "updateMask.fieldPaths=" + p).join('&');
  const token = ScriptApp.getOAuthToken();
  
  try {
    const res = UrlFetchApp.fetch(url + '?' + queryParams, {
      method: 'patch',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ fields }),
      muteHttpExceptions: true
    });
    console.log("Firestore PATCH status: " + res.getResponseCode());
  } catch (err) {
    console.error("ขัดข้องระหว่างบันทึก Firestore: " + err.message);
  }
}

function getFirestoreDocument(refCode) {
  if (!FIRESTORE_PROJECT_ID) return null;
  const url = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT_ID + "/databases/(default)/documents/appointments/" + refCode;
  const token = ScriptApp.getOAuthToken();
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      return convertRestToFlatObj(JSON.parse(res.getContentText()));
    }
  } catch (e) {
    console.warn("ไม่สามารถอ่านข้อมูลจาก Firestore: " + e.message);
  }
  return null;
}

function convertRestToFlatObj(restDoc) {
  const fields = restDoc.fields || {};
  const obj = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value.stringValue !== undefined) obj[key] = value.stringValue;
    else if (value.integerValue !== undefined) obj[key] = parseInt(value.integerValue, 10);
    else if (value.doubleValue !== undefined) obj[key] = parseFloat(value.doubleValue);
    else if (value.booleanValue !== undefined) obj[key] = value.booleanValue;
  }
  return obj;
}

function getIsoTimeFormat(dateStr, timeStr, isEnd) {
  const [sh, sm, eh, em] = parseTimeSlot(timeStr);
  const h = isEnd ? eh : sh;
  const m = isEnd ? em : sm;
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day, h, m, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return yyyy + mm + dd + 'T' + hh + min + '00';
}

function formatDateThai(dateStr) {
  if (!dateStr) return "-";
  try {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parseInt(parts[0], 10);
    const monthIndex = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const months = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
    return `${day} ${months[monthIndex]} พ.ศ. ${year + 543}`;
  } catch (e) {
    return dateStr;
  }
}

// ==========================================
// 6. EMAIL SENDER
// *** แก้ไขหลัก: เพิ่มลิงก์ตรวจสอบสถานะท้ายทุกอีเมลที่ส่งถึงลูกค้า ***
// ==========================================
function sendHtmlEmail(to, subject, bodyHtml, cc, appDataOrRefCode) {
  let refCode = null;
  let existingThreadId = null;

  if (appDataOrRefCode) {
    if (typeof appDataOrRefCode === 'object') {
      refCode = appDataOrRefCode.refCode;
      existingThreadId = appDataOrRefCode.emailThreadId || null;
    } else {
      refCode = appDataOrRefCode;
    }
  }

  // เพิ่มลิงก์ตรวจสอบสถานะท้ายอีเมล
  // refCode จะเป็น null เมื่อส่งให้ Admin (ไม่ต้องการลิงก์นี้)
  if (refCode) {
    const statusLinkHtml = `
<div style="margin-top:32px; padding:20px 24px; background-color:#F8FAFC; border-top:2px solid #E2E8F0; text-align:center;">
  <p style="color:#64748B; font-size:13px; margin:0 0 12px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
    ติดตามสถานะหรือจัดการนัดหมายของท่านได้ตลอดเวลาผ่านลิงก์ด้านล่าง
  </p>
  <a href="${FRONTEND_BASE_URL}/status.html?ref=${refCode}" 
     style="display:inline-block; background:#1e3a5f; color:#ffffff; padding:12px 28px; 
            border-radius:8px; text-decoration:none; font-size:14px; font-weight:600;
            font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
    &#128269; ตรวจสอบสถานะนัดหมาย (${refCode})
  </a>
  <p style="color:#94A3B8; font-size:11px; margin:12px 0 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
    หรือคัดลอกลิงก์: ${FRONTEND_BASE_URL}/status.html?ref=${refCode}
  </p>
  <div style="margin-top:16px; padding:12px; background-color:#F1F5F9; border-radius:6px; display:inline-block; max-width:100%; text-align:left; border:1px solid #E2E8F0;">
    <p style="color:#475569; font-size:12px; margin:0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; line-height:1.5;">
      &#128269; <strong>คำแนะนำในการค้นหา:</strong> ท่านสามารถค้นหาอีเมลเก่าที่เกี่ยวข้องกับงานนี้ทั้งหมดได้โดยค้นหาคำว่า <span style="background-color:#E2E8F0; padding:2px 6px; border-radius:4px; font-family:monospace; font-weight:bold; color:#0F172A;">"${refCode}"</span> ในกล่องจดหมายของคุณ
    </p>
  </div>
</div>`;
    // แทรกก่อน footer (ก่อน closing div สุดท้าย)
    if (bodyHtml.includes('</div>\n    </div>\n  </div>')) {
      bodyHtml = bodyHtml.replace('</div>\n    </div>\n  </div>', statusLinkHtml + '</div>\n    </div>\n  </div>');
    } else {
      // fallback: ต่อท้ายเสมอ
      bodyHtml += statusLinkHtml;
    }
  }

  const options = { 
    htmlBody: bodyHtml,
    name: 'Executive Appointment System'
  };
  if (cc && cc.trim() !== '') options.cc = cc;
  
  Logger.log('Sending email to: ' + to);
  Logger.log('Subject: ' + subject);
  Logger.log('Has status link: ' + (refCode ? 'YES (' + refCode + ')' : 'NO (Admin email)'));
  
  let sent = false;

  if (refCode) {
    try {
      if (existingThreadId) {
        const thread = GmailApp.getThreadById(existingThreadId);
        if (thread) {
          const messages = thread.getMessages();
          if (messages.length > 0) {
            const lastMessageId = messages[messages.length - 1].getHeader('Message-ID');
            Logger.log('Found existing thread. Last Message-ID: ' + lastMessageId);
            thread.reply('', options);
            Logger.log('Replied to thread: ' + existingThreadId);
            sent = true;
          }
        }
      }
    } catch (threadErr) {
      Logger.log('Thread reply failed: ' + threadErr.message);
    }
  }

  if (!sent) {
    // ใช้ GmailApp ทั้งหมด ไม่ใช้ MailApp เลย
    GmailApp.sendEmail(to, subject, '', options);
    Logger.log('Sent new email to: ' + to);
    
    if (refCode) {
      Utilities.sleep(3000); // รอนานขึ้นเป็น 3 วินาที
      try {
        // ค้นหาด้วย refCode ที่อยู่ใน body ของอีเมล
        const searchQuery = '"' + refCode + '" in:anywhere';
        const threads = GmailApp.search(searchQuery, 0, 5);
        Logger.log('Search query: ' + searchQuery + ' | Found: ' + threads.length + ' threads');
        
        if (threads.length > 0) {
          const candidateThread = threads[threads.length - 1];
          const messages = candidateThread.getMessages();
          const newMessageId = messages[messages.length - 1].getHeader('Message-ID');
          
          lastEmailThreadId = candidateThread.getId();
          lastEmailMessageId = newMessageId;
          
          Logger.log('Thread captured: ' + lastEmailThreadId);
        } else {
          Logger.log('WARNING: No thread found for refCode: ' + refCode);
        }
      } catch (searchErr) {
        Logger.log('Search/save threadId failed: ' + searchErr.message);
      }
    }
  }
  
  Logger.log('Email process completed for: ' + to);
}

// ==========================================
// 7. HTML EMAIL TEMPLATES
// ==========================================

function getHeaderHtml(titleText, subtitleText) {
  return `
    <div style="background-color: #0F172A; padding: 32px 24px; text-align: center; border-bottom: 4px solid #D97706;">
      <h1 style="color: #FFFFFF; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">
        ${titleText}
      </h1>
      <p style="color: #94A3B8; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 6px 0 0 0; font-size: 13px;">
        ${subtitleText}
      </p>
    </div>
  `;
}

function getFooterHtml() {
  return `
    <div style="background-color: #F8FAFC; padding: 24px; text-align: center; border-top: 1px solid #E2E8F0;">
      <p style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #64748B; margin: 0 0 4px 0; line-height: 1.5;">
        ระบบนี้เป็นระบบตอบรับและลงทะเบียนเวลาจองคิวอัตโนมัติ สำหรับฝ่ายเลขานุการฯ
      </p>
      <p style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #94A3B8; margin: 0;">
        &copy; 2026 Executive Concierge Booking System. All rights reserved.
      </p>
    </div>
  `;
}

function formatTimelineTimestamp(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    return Utilities.formatDate(d, "GMT+7", "yyyy-MM-dd HH:mm");
  } catch (e) {
    return null;
  }
}

function getOperationHistoryTimelineHtml(app) {
  if (!app) return '';
  
  const events = [];
  
  function addEvent(timestamp, text) {
    if (timestamp) {
      const formatted = formatTimelineTimestamp(timestamp);
      if (formatted) {
        events.push({ time: formatted, rawTime: new Date(timestamp).getTime(), text: text });
      }
    }
  }
  
  addEvent(app.createdAt, 'สร้างคำร้องขอเข้าพบ');
  addEvent(app.proposedAt, 'เลขาฯ เสนอตัวเลือกคิว');
  addEvent(app.clientSelectedAt, 'ลูกค้าเลือกคิวที่สะดวก');
  addEvent(app.rescheduledAt, 'เลขาฯ เสนอขอเปลี่ยนกำหนดเวลาใหม่');
  addEvent(app.approvedAt, 'เลขาฯ อนุมัติการเข้าพบและลงตาราง');
  addEvent(app.rejectedAt, 'คำขอนัดหมายไม่ผ่านการอนุมัติ');
  addEvent(app.cancellationRequestedAt, 'ลูกค้าส่งคำขอยกเลิกนัดหมาย');
  addEvent(app.cancelledAt, 'ยกเลิกนัดหมายสำเร็จ');
  
  if (events.length === 0) return '';
  
  events.sort((a, b) => a.rawTime - b.rawTime);
  
  let timelineLines = '';
  events.forEach(evt => {
    timelineLines += `
      <div style="margin-bottom: 8px; font-size: 13px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; color: #475569;">
        <span style="font-family: monospace; color: #64748B; font-weight: bold; margin-right: 8px;">[${evt.time}]</span>
        <span style="color: #1E293B;">${evt.text}</span>
      </div>
    `;
  });
  
  return `
    <div style="margin-top: 24px; margin-bottom: 24px; padding: 18px 20px; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;">
      <h4 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #475569; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
        &#128197; ประวัติการดำเนินการ (${app.refCode})
      </h4>
      <div style="line-height: 1.6;">
        ${timelineLines}
      </div>
    </div>
  `;
}

function getReferenceTopicBoxHtml(app) {
  if (!app || !app.purpose) return '';
  return `
    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-left: 4px solid #64748B; border-radius: 6px; padding: 14px 18px; margin-top: 16px; margin-bottom: 24px;">
      <span style="font-size: 11px; font-weight: bold; color: #64748B; text-transform: uppercase; tracking-wider: 0.5px; display: block; margin-bottom: 4px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
        &#128203; หัวข้ออ้างอิงการเข้าพบ (Reference Topic)
      </span>
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #1E293B; line-height: 1.5; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
        "${app.purpose}"
      </p>
    </div>
  `;
}

function getApprovalEmailTemplate(app, dateStr, timeStr, locationStr, googleCalLink, icsDownloadLink) {
  return `
    <div style="background-color: #F1F5F9; padding: 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #E2E8F0;">
        ${getHeaderHtml("CONFIRMATION SUCCESSFUL", "ระบบตอบรับการจองสิทธิ์เข้าพบคณะผู้บริหาร")}
        <div style="padding: 32px 24px;">
          <div style="height: 4px; width: 60px; background-color: #10B981; border-radius: 2px; margin-bottom: 24px;"></div>
          <h2 style="font-size: 18px; font-weight: 700; color: #1E293B; margin-top: 0; margin-bottom: 12px;">เรียน คุณ${app.clientName}</h2>
          
          ${getReferenceTopicBoxHtml(app)}

          <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px;">
            ฝ่ายเลขานุการขอเรียนแจ้งให้ทราบว่า <strong>คำขอนัดหมายของคุณได้รับการอนุมัติและลงตารางเรียบร้อยแล้ว</strong>
          </p>
          <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px dashed #E2E8F0;">
                <td style="padding: 8px 0; font-size: 12px; color: #64748B; font-weight: 600; width: 140px;">เลขอ้างอิง</td>
                <td style="padding: 8px 0; font-size: 14px; color: #1E293B; font-weight: 700;">${app.refCode}</td>
              </tr>
              <tr style="border-bottom: 1px dashed #E2E8F0;">
                <td style="padding: 8px 0; font-size: 12px; color: #64748B; font-weight: 600;">ผู้บริหารที่เข้าพบ</td>
                <td style="padding: 8px 0; font-size: 14px; color: #0F172A; font-weight: 600;">${app.executiveHost}</td>
              </tr>
              <tr style="border-bottom: 1px dashed #E2E8F0;">
                <td style="padding: 8px 0; font-size: 12px; color: #64748B; font-weight: 600;">วันนัดหมาย</td>
                <td style="padding: 8px 0; font-size: 14px; color: #1E293B; font-weight: 600;">${dateStr}</td>
              </tr>
              <tr style="border-bottom: 1px dashed #E2E8F0;">
                <td style="padding: 8px 0; font-size: 12px; color: #64748B; font-weight: 600;">เวลานัดหมาย</td>
                <td style="padding: 8px 0; font-size: 14px; color: #1E293B; font-weight: 600;">${timeStr}</td>
              </tr>
              <tr style="border-bottom: 1px dashed #E2E8F0;">
                <td style="padding: 8px 0; font-size: 12px; color: #64748B; font-weight: 600;">รูปแบบ</td>
                <td style="padding: 8px 0; font-size: 14px; color: #1E293B; font-weight: 600;">${app.meetingFormat === 'online' ? '&#129002; ออนไลน์' : '&#127970; ออนไซต์'}</td>
              </tr>
              <tr style="border-bottom: 1px dashed #E2E8F0;">
                <td style="padding: 8px 0; font-size: 12px; color: #64748B; font-weight: 600;">สถานที่</td>
                <td style="padding: 8px 0; font-size: 14px; color: #0369A1; font-weight: 600;">${locationStr}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-size: 12px; color: #64748B; font-weight: 600;">หัวข้อ</td>
                <td style="padding: 8px 0; font-size: 14px; color: #475569;">${app.purpose}</td>
              </tr>
            </table>
          </div>
          <div style="margin-bottom: 16px;">
            <a href="${googleCalLink}" target="_blank" style="display: inline-block; background-color: #0F172A; color: #FFFFFF; font-size: 13px; font-weight: 600; text-decoration: none; padding: 12px 20px; border-radius: 8px; margin-right: 12px;">&#128197; Add to Google Calendar</a>
            <a href="${icsDownloadLink}" style="display: inline-block; background-color: #F1F5F9; color: #1E293B; font-size: 13px; font-weight: 600; text-decoration: none; padding: 12px 20px; border-radius: 8px; border: 1px solid #CBD5E1;">&#128229; ดาวน์โหลด .ics</a>
          </div>

          <div style="margin-top:20px; padding:20px 24px; 
                      background:#F8FAFC; border:1px solid #E2E8F0; 
                      border-radius:10px; text-align:center; margin-bottom: 24px;">
            <p style="color:#64748B; font-size:12px; font-weight:600;
                      margin:0 0 4px; letter-spacing:0.05em;">
              หากต้องการเปลี่ยนแปลงหรือยกเลิกการนัดหมาย
            </p>
            <p style="color:#94A3B8; font-size:11px; margin:0 0 16px;">
              กรุณาดำเนินการล่วงหน้าอย่างน้อย 24 ชั่วโมง
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="padding:0 6px 0 0; width:50%;">
                  <a href="${FRONTEND_BASE_URL}/status.html?ref=${app.refCode}&action=reschedule_request"
                     style="display:block; background:#3B82F6; color:#ffffff; 
                            padding:12px 16px; border-radius:8px; 
                            text-decoration:none; font-size:13px; font-weight:600; text-align:center;">
                    &#128197; ขอเลื่อนวันนัดหมาย
                  </a>
                </td>
                <td align="center" style="padding:0 0 0 6px; width:50%;">
                  <a href="${FRONTEND_BASE_URL}/status.html?ref=${app.refCode}&action=cancel_request"
                     style="display:block; background:#EF4444; color:#ffffff; 
                            padding:12px 16px; border-radius:8px; 
                            text-decoration:none; font-size:13px; font-weight:600; text-align:center;">
                    &#10006; ส่งคำขอยกเลิกนัดหมาย
                  </a>
                </td>
              </tr>
            </table>
            <p style="color:#94A3B8; font-size:11px; margin:12px 0 0;">
              * เมื่อคลิกปุ่มจะไปยังหน้ายืนยันเพื่อดำเนินการต่อ
            </p>
          </div>

          ${getOperationHistoryTimelineHtml(app)}
        </div>
        ${getFooterHtml()}
      </div>
    </div>
  `;
}

function getRescheduleEmailTemplate(app, oldDate, oldTime, newDate, newTime, noteText, statusLink) {
  return `
    <div style="background-color: #F1F5F9; padding: 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #E2E8F0;">
        ${getHeaderHtml("RESCHEDULE PROPOSAL", "ฝ่ายบริหารขอเสนอปรับเปลี่ยนเวลาการนัดหมาย")}
        <div style="padding: 32px 24px;">
          <div style="height: 4px; width: 60px; background-color: #3B82F6; border-radius: 2px; margin-bottom: 24px;"></div>
          <h2 style="font-size: 18px; font-weight: 700; color: #1E293B; margin-top: 0; margin-bottom: 12px;">เรียน คุณ${app.clientName}</h2>
          
          ${getReferenceTopicBoxHtml(app)}

          <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 20px;">
            ฝ่ายเลขานุการขออภัยเป็นอย่างยิ่ง และขอเสนอปรับเวลาเข้าพบใหม่ดังนี้:
          </p>
          <div style="background-color: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tr style="border-bottom: 1px dashed #BFDBFE;">
                <td style="padding: 8px 0; color: #64748B; width: 140px;">เวลาเดิม</td>
                <td style="padding: 8px 0; color: #475569; text-decoration: line-through;">${oldDate} เวลา ${oldTime}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #1E3A8A; font-weight: bold;">เวลาใหม่ที่เสนอ</td>
                <td style="padding: 8px 0; color: #1E3A8A; font-weight: bold; font-size: 15px;">&#10024; ${newDate} เวลา ${newTime}</td>
              </tr>
            </table>
          </div>
          <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
            <h5 style="margin: 0 0 6px 0; font-size: 12px; color: #64748B; font-weight: 600;">หมายเหตุจากเลขาฯ</h5>
            <p style="margin: 0; font-size: 13px; color: #475569; font-style: italic;">"${noteText}"</p>
          </div>
          <div style="text-align: center; margin-bottom: 24px;">
            <a href="${statusLink}&action=confirm_reschedule" target="_blank" style="display: inline-block; background-color: #10B981; color: #FFFFFF; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px; margin: 6px 8px; min-width: 160px; text-align: center;">
              &#9989; ยืนยันตอบรับเวลาใหม่ (Confirm)
            </a>
            <a href="${statusLink}&action=decline_reschedule" target="_blank" style="display: inline-block; background-color: #EF4444; color: #FFFFFF; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px; margin: 6px 8px; min-width: 160px; text-align: center;">
              &#10060; ปฏิเสธข้อเสนอเลื่อนเวลา (Decline)
            </a>
          </div>

          ${getOperationHistoryTimelineHtml(app)}
        </div>
        ${getFooterHtml()}
      </div>
    </div>
  `;
}

function getRejectionEmailTemplate(app, reasonText) {
  return `
    <div style="background-color: #F1F5F9; padding: 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #E2E8F0;">
        ${getHeaderHtml("REQUEST DECLINED", "ขออภัยที่ไม่สามารถตอบรับการนัดหมายได้")}
        <div style="padding: 32px 24px;">
          <div style="height: 4px; width: 60px; background-color: #EF4444; border-radius: 2px; margin-bottom: 24px;"></div>
          <h2 style="font-size: 18px; font-weight: 700; color: #1E293B; margin-top: 0; margin-bottom: 12px;">เรียน คุณ${app.clientName}</h2>
          
          ${getReferenceTopicBoxHtml(app)}

          <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 20px;">
            ขอแจ้งให้ทราบว่า <strong>คำขอนัดหมายเลขที่ ${app.refCode} ไม่ได้รับการอนุมัติ</strong> เนื่องจาก:
          </p>
          <div style="background-color: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <p style="margin: 0; font-size: 13px; color: #7F1D1D; line-height: 1.5; font-style: italic;">"${reasonText}"</p>
          </div>
          <p style="font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 24px;">
            หากต้องการนัดหมายใหม่ ท่านสามารถส่งคำขอเข้ามาใหม่ได้ตลอดเวลาค่ะ
          </p>

          ${getOperationHistoryTimelineHtml(app)}
        </div>
        ${getFooterHtml()}
      </div>
    </div>
  `;
}

function getOfferSlotsEmailTemplate(app, statusLink) {
  let listSlotsHtml = '';
  if (app.proposedSlots && app.proposedSlots.length > 0) {
    app.proposedSlots.forEach((slot, index) => {
      const slotLink = `${statusLink}&selectSlot=${index + 1}`;
      listSlotsHtml += `
        <div style="background-color: #FFFFFF; border: 1px solid #DDD6FE; border-radius: 10px; padding: 18px; margin-bottom: 12px;">
          <h5 style="margin: 0 0 6px 0; color: #6D28D9; font-size: 14px; font-weight: bold;">&#128205; ตัวเลือกที่ ${index + 1}</h5>
          <p style="margin: 0 0 12px 0; font-size: 13.5px; color: #1F2937;">
            วัน: <strong>${formatDateThai(slot.date)}</strong><br>
            เวลา: <strong>${slot.time} น.</strong>
          </p>
          <div style="text-align: right;">
            <a href="${slotLink}" target="_blank" style="display: inline-block; background-color: #7C3AED; color: #FFFFFF; font-size: 12px; font-weight: 600; text-decoration: none; padding: 8px 16px; border-radius: 6px;">
              เลือกเวลานี้ →
            </a>
          </div>
        </div>
      `;
    });
  } else {
    listSlotsHtml = '<div style="color: #9CA3AF; font-size: 13px; text-align: center;">ไม่มีข้อมูลคิวที่เสนอ กรุณาติดต่อเลขาฯ โดยตรง</div>';
  }

  return `
    <div style="background-color: #F1F5F9; padding: 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #E2E8F0;">
        ${getHeaderHtml("CHOOSE YOUR TIME SLOT", "เลขาฯ จัดสรรคิวให้ท่านเลือก")}
        <div style="padding: 32px 24px;">
          <div style="height: 4px; width: 60px; background-color: #8B5CF6; border-radius: 2px; margin-bottom: 24px;"></div>
          <h2 style="font-size: 18px; font-weight: 700; color: #1E293B; margin-top: 0; margin-bottom: 12px;">เรียน คุณ${app.clientName}</h2>
          
          ${getReferenceTopicBoxHtml(app)}

          <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px;">
            เลขาฯ ได้จัดสรรคิวว่างสำหรับการเข้าพบ <strong>${app.executiveHost}</strong> ให้ท่านเลือกดังนี้:
          </p>
          <div style="background-color: #F5F3FF; border: 1px solid #E9D5FF; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
            ${listSlotsHtml}
          </div>
          <div style="background-color: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 14px; margin-bottom: 24px;">
            <p style="margin: 0; font-size: 12.5px; color: #92400E; line-height: 1.5;">
              &#9888; <strong>สำคัญ:</strong> กรุณายืนยันเลือกคิว <strong>ภายใน 48 ชั่วโมง</strong> มิฉะนั้นอาจต้องยกเลิกคิวที่เสนอ
            </p>
          </div>

          <div style="margin-top:20px; padding:20px 24px; 
                      background:#F8FAFC; border:1px solid #E2E8F0; 
                      border-radius:10px; text-align:center; margin-bottom: 24px;">
            <p style="color:#64748B; font-size:12px; font-weight:600;
                      margin:0 0 4px; letter-spacing:0.05em;">
              หากไม่ต้องการคิวที่เสนอ
            </p>
            <p style="color:#94A3B8; font-size:11px; margin:0 0 16px;">
              กรุณาดำเนินการก่อนที่คิวจะหมดอายุภายใน 48 ชั่วโมง
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="padding:0 6px 0 0; width:50%;">
                  <a href="${FRONTEND_BASE_URL}/status.html?ref=${app.refCode}&action=reschedule_request"
                     style="display:block; background:#3B82F6; color:#ffffff; 
                            padding:12px 16px; border-radius:8px; 
                            text-decoration:none; font-size:13px; font-weight:600; text-align:center;">
                    &#128197; ขอเลื่อนวันนัดหมาย
                  </a>
                </td>
                <td align="center" style="padding:0 0 0 6px; width:50%;">
                  <a href="${FRONTEND_BASE_URL}/status.html?ref=${app.refCode}&action=cancel_request"
                     style="display:block; background:#EF4444; color:#ffffff; 
                            padding:12px 16px; border-radius:8px; 
                            text-decoration:none; font-size:13px; font-weight:600; text-align:center;">
                    &#10006; ส่งคำขอยกเลิกนัดหมาย
                  </a>
                </td>
              </tr>
            </table>
            <p style="color:#94A3B8; font-size:11px; margin:12px 0 0;">
              * เมื่อคลิกปุ่มจะไปยังหน้ายืนยันเพื่อดำเนินการต่อ
            </p>
          </div>

          <p style="font-size: 13.5px; color: #64748B; text-align: center; margin-bottom: 24px;">
            * หากปุ่มกดไม่ทำงาน ไปที่ <a href="${statusLink}" target="_blank" style="color:#7C3AED; font-weight:bold;">ตรวจสอบสถานะที่นี่</a>
          </p>

          ${getOperationHistoryTimelineHtml(app)}
        </div>
        ${getFooterHtml()}
      </div>
    </div>
  `;
}

function getAdminSelectionNotificationTemplate(app, dateDisplay, timeDisplay, adminLink) {
  return `
    <div style="background-color: #F1F5F9; padding: 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #E2E8F0;">
        ${getHeaderHtml("CLIENT SELECTED A SLOT", "ลูกค้าเลือกคิวแล้ว รอการยืนยันจากเลขาฯ")}
        <div style="padding: 32px 24px;">
          <div style="height: 4px; width: 60px; background-color: #10B981; border-radius: 2px; margin-bottom: 24px;"></div>
          <h2 style="font-size: 17px; font-weight: 700; color: #1E293B; margin-top: 0; margin-bottom: 12px;">เรียน แผนกเลขานุการ</h2>
          <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 20px;">
            ลูกค้าได้เลือกคิวเรียบร้อยแล้ว กรุณาเข้าระบบเพื่อยืนยัน:
          </p>
          <div style="background-color: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tr style="border-bottom: 1px dashed #BBF7D0;">
                <td style="padding: 6px 0; color: #166534; font-weight: bold; width: 140px;">ลูกค้า</td>
                <td style="padding: 6px 0; color: #14532D; font-weight: bold;">คุณ${app.clientName} (${app.clientCompany})</td>
              </tr>
              <tr style="border-bottom: 1px dashed #BBF7D0;">
                <td style="padding: 6px 0; color: #64748B;">ผู้บริหาร</td>
                <td style="padding: 6px 0; color: #1E293B;">${app.executiveHost}</td>
              </tr>
              <tr style="border-bottom: 1px dashed #BBF7D0;">
                <td style="padding: 6px 0; color: #166534; font-weight: bold;">วันที่เลือก</td>
                <td style="padding: 6px 0; color: #14532D; font-weight: bold;">${dateDisplay}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #166534; font-weight: bold;">เวลาที่เลือก</td>
                <td style="padding: 6px 0; color: #14532D; font-weight: bold;">${timeDisplay}</td>
              </tr>
            </table>
          </div>
          <div style="text-align: center;">
            <a href="${adminLink}" target="_blank" style="display: inline-block; background-color: #10B981; color: #FFFFFF; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
              &#128187; เปิดระบบ Admin เพื่อยืนยัน →
            </a>
          </div>
        </div>
        ${getFooterHtml()}
      </div>
    </div>
  `;
}

function getAdminCancellationRequestTemplate(app, adminLink) {
  return `
    <div style="background-color: #F1F5F9; padding: 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #E2E8F0;">
        ${getHeaderHtml("CANCELLATION REQUESTED", "ลูกค้าส่งคำขอยกเลิกนัดหมาย")}
        <div style="padding: 32px 24px;">
          <div style="height: 4px; width: 60px; background-color: #EF4444; border-radius: 2px; margin-bottom: 24px;"></div>
          <h2 style="font-size: 17px; font-weight: 700; color: #1E293B; margin-top: 0; margin-bottom: 12px;">เรียน แผนกเลขานุการ</h2>
          <div style="background-color: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tr style="border-bottom: 1px dashed #FCA5A5;">
                <td style="padding: 6px 0; color: #991B1B; font-weight: bold; width: 140px;">ผู้ขอยกเลิก</td>
                <td style="padding: 6px 0; color: #7F1D1D; font-weight: bold;">คุณ${app.clientName} (${app.clientCompany})</td>
              </tr>
              <tr style="border-bottom: 1px dashed #FCA5A5;">
                <td style="padding: 6px 0; color: #64748B;">เลขอ้างอิง</td>
                <td style="padding: 6px 0; color: #1E293B; font-weight: bold;">${app.refCode}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748B;">ผู้บริหาร</td>
                <td style="padding: 6px 0; color: #1E293B;">${app.executiveHost}</td>
              </tr>
            </table>
          </div>
          <div style="text-align: center;">
            <a href="${adminLink}" target="_blank" style="display: inline-block; background-color: #EF4444; color: #FFFFFF; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
              &#128721; เปิดระบบ Admin เพื่อยืนยันยกเลิก →
            </a>
          </div>
        </div>
        ${getFooterHtml()}
      </div>
    </div>
  `;
}

function getAdminRescheduleRequestTemplate(app, adminLink) {
  const reason = app.rescheduleReason || '-';
  const rType = app.rescheduleType || 'specific_dates';
  let detailsHtml = '';

  if (rType === 'specific_dates') {
    const dates = app.proposedRescheduleDates || [];
    let listStr = '';
    dates.forEach((d, idx) => {
      const hasTime = d.startTime && d.startTime !== 'TBD' && d.endTime && d.endTime !== 'TBD';
      const timeStr = hasTime ? `เวลา ${d.startTime} - ${d.endTime} น.` : 'ยังไม่ระบุเวลา';
      listStr += `• วันที่ ${idx + 1}: <strong>${formatDateThai(d.date)}</strong> ${timeStr}<br>`;
    });
    detailsHtml = `
      <tr style="border-bottom: 1px dashed #BFDBFE;">
        <td style="padding: 6px 0; color: #64748B; font-weight: bold; width: 140px; vertical-align: top;">วันที่ลูกค้าเสนอ</td>
        <td style="padding: 6px 0; color: #1E3A8A; font-weight: bold; line-height: 1.6;">${listStr || 'ไม่ระบุ'}</td>
      </tr>
    `;
  } else if (rType === 'date_range') {
    const fromStr = app.rescheduleRangeDateFrom ? formatDateThai(app.rescheduleRangeDateFrom) : 'ไม่ระบุ';
    const toStr = app.rescheduleRangeDateTo ? formatDateThai(app.rescheduleRangeDateTo) : 'เป็นต้นไป';
    detailsHtml = `
      <tr style="border-bottom: 1px dashed #BFDBFE;">
        <td style="padding: 6px 0; color: #64748B; font-weight: bold; width: 140px; vertical-align: top;">ช่วงวันที่ต้องการ</td>
        <td style="padding: 6px 0; color: #1E3A8A; font-weight: bold; line-height: 1.6;">
          ${fromStr} ถึง ${toStr}<br>
          <span style="font-size: 12px; color: #D97706; font-weight: normal; font-style: italic;">*(เลขาฯ เป็นผู้จัดสรรวันและเวลาให้)</span>
        </td>
      </tr>
    `;
  }

  const isFromOffer = app.rescheduleContext === 'from_offer_slots';
  const headerMain = isFromOffer ? "PROPOSE NEW DATES" : "RESCHEDULE REQUESTED";
  const headerSub = isFromOffer ? "ลูกค้าขอรับคิวเสนอช่วงเวลาใหม่" : "ลูกค้าส่งคำขอเลื่อนนัดหมาย";
  const labelRequestor = isFromOffer ? "ผู้ขอคิวใหม่" : "ผู้ขอเลื่อนนัด";
  const labelReason = isFromOffer ? "เหตุผลการขอคิวใหม่" : "เหตุผลการขอเลื่อน";
  const btnLabel = isFromOffer ? "เปิดระบบ Admin เพื่อเสนอคิวใหม่ →" : "เปิดระบบ Admin เพื่อจัดการคำขอเลื่อน →";

  return `
    <div style="background-color: #F1F5F9; padding: 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #E2E8F0;">
        ${getHeaderHtml(headerMain, headerSub)}
        <div style="padding: 32px 24px;">
          <div style="height: 4px; width: 60px; background-color: #3B82F6; border-radius: 2px; margin-bottom: 24px;"></div>
          <h2 style="font-size: 17px; font-weight: 700; color: #1E293B; margin-top: 0; margin-bottom: 12px;">เรียน แผนกเลขานุการ</h2>
          <div style="background-color: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tr style="border-bottom: 1px dashed #BFDBFE;">
                <td style="padding: 6px 0; color: #1E3A8A; font-weight: bold; width: 140px;">${labelRequestor}</td>
                <td style="padding: 6px 0; color: #1E293B; font-weight: bold;">คุณ${app.clientName} (${app.clientCompany})</td>
              </tr>
              <tr style="border-bottom: 1px dashed #BFDBFE;">
                <td style="padding: 6px 0; color: #64748B;">เลขอ้างอิง</td>
                <td style="padding: 6px 0; color: #1E293B; font-weight: bold;">${app.refCode}</td>
              </tr>
              <tr style="border-bottom: 1px dashed #BFDBFE;">
                <td style="padding: 6px 0; color: #64748B;">ผู้บริหาร</td>
                <td style="padding: 6px 0; color: #1E293B;">${app.executiveHost}</td>
              </tr>
              ${detailsHtml}
              <tr>
                <td style="padding: 6px 0; color: #64748B; vertical-align: top;">${labelReason}</td>
                <td style="padding: 6px 0; color: #475569; font-style: italic;">"${reason}"</td>
              </tr>
            </table>
          </div>
          <div style="text-align: center;">
            <a href="${adminLink}" target="_blank" style="display: inline-block; background-color: #3B82F6; color: #FFFFFF; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
              &#128197; ${btnLabel}
            </a>
          </div>
        </div>
        ${getFooterHtml()}
      </div>
    </div>
  `;
}

function getCancellationConfirmedEmailTemplate(app) {
  return `
    <div style="background-color: #F1F5F9; padding: 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #E2E8F0;">
        ${getHeaderHtml("CANCELLATION CONFIRMED", "ยืนยันการยกเลิกนัดหมายเรียบร้อยแล้ว")}
        <div style="padding: 32px 24px;">
          <div style="height: 4px; width: 60px; background-color: #6B7280; border-radius: 2px; margin-bottom: 24px;"></div>
          <h2 style="font-size: 18px; font-weight: 700; color: #1E293B; margin-top: 0; margin-bottom: 12px;">เรียน คุณ${app.clientName}</h2>
          
          ${getReferenceTopicBoxHtml(app)}

          <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px;">
            ขอแจ้งยืนยันว่า <strong>นัดหมายเลขที่ ${app.refCode} ได้รับการยกเลิกเรียบร้อยแล้ว</strong> และได้ลบออกจากปฏิทินงานแล้ว
          </p>
          <div style="background-color: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px; margin-bottom: 24px; text-align: center; color: #475569; font-size: 14px;">
            &#128274; <strong>สถานะ:</strong> <span style="color: #6B7280; font-weight: bold;">ยกเลิกแล้ว (Cancelled)</span>
          </div>
          <p style="font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 24px;">
            หากต้องการนัดหมายใหม่ ท่านสามารถส่งคำขอเข้ามาได้ใหม่ตลอดเวลาค่ะ
          </p>

          ${getOperationHistoryTimelineHtml(app)}
        </div>
        ${getFooterHtml()}
      </div>
    </div>
  `;
}

function getAdminNewBookingNotificationTemplate(app, adminLink) {
  const isClientPick = app.bookingType === 'client_pick';
  let timeDetailHtml = '';
  
  if (isClientPick) {
    const slots = app.proposedDates || app.optionBProposedSlots || [];
    const slotLines = slots.map((s, idx) => {
      const timeStr = (s.startTime && s.endTime) ? `${s.startTime} - ${s.endTime} น.` : (s.timeSlot || s.time || 'ยังไม่ระบุเวลา');
      return `<li style="margin-bottom: 6px;">ตัวเลือกที่ ${idx + 1}: <strong>${formatDateThai(s.date || s.dateStr)}</strong> เวลา: <strong>${timeStr}</strong></li>`;
    }).join('');
    timeDetailHtml = `
      <p style="margin: 0 0 6px 0; color: #475569;"><strong>รูปแบบเวลา:</strong> ลูกค้าระบุวันเวลาเอง (Option B)</p>
      <ul style="margin: 0; padding-left: 20px; color: #1E293B;">
        ${slotLines}
      </ul>
    `;
  } else {
    timeDetailHtml = `
      <p style="margin: 0 0 6px 0; color: #475569;"><strong>รูปแบบเวลา:</strong> ให้เลขาจัดสรรเวลาให้ (Option A)</p>
      <p style="margin: 0 0 6px 0; color: #1E293B;"><strong>ระยะเวลาที่ต้องการ (Duration):</strong> ${app.optionAHours || '1 ชั่วโมง'}</p>
      <p style="margin: 0 0 6px 0; color: #1E293B;"><strong>จำนวนคิวที่ต้องการ:</strong> ${app.slotCount || 1} คิว</p>
      <p style="margin: 0; color: #1E293B;"><strong>ช่วงเวลาที่สะดวก:</strong> ${formatDateThai(app.preferredDateFrom) || 'ไม่จำกัด'} ถึง ${formatDateThai(app.preferredDateTo) || 'ไม่จำกัด'}</p>
    `;
  }

  const attendeesList = app.additionalAttendees || [];
  let attendeesHtml = '';
  if (attendeesList.length > 0) {
    const lines = attendeesList.map(a => `<li>คุณ${a.name} (${a.position || '-'}) ${a.email ? `[${a.email}]` : ''}</li>`).join('');
    attendeesHtml = `
      <div style="margin-top: 16px; padding: 12px; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;">
        <span style="font-size: 11px; font-weight: bold; color: #64748B; text-transform: uppercase; display: block; margin-bottom: 6px;">
          👥 ผู้เข้าร่วมประชุมเพิ่มเติม (${attendeesList.length} ท่าน)
        </span>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #475569;">
          ${lines}
        </ul>
      </div>
    `;
  }

  return `
    <div style="background-color: #F1F5F9; padding: 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #E2E8F0;">
        ${getHeaderHtml("NEW BOOKING REQUESTED", "มีคำขอเข้าพบใหม่ส่งเข้ามาในระบบ")}
        <div style="padding: 32px 24px;">
          <div style="height: 4px; width: 60px; background-color: #3B82F6; border-radius: 2px; margin-bottom: 24px;"></div>
          <h2 style="font-size: 17px; font-weight: 700; color: #1E293B; margin-top: 0; margin-bottom: 12px;">เรียน แผนกเลขานุการ</h2>
          <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 20px;">
            มีผู้ขอยื่นเรื่องขอความอนุเคราะห์เข้าพบผู้บริหารเข้ามาใหม่ โดยมีข้อมูลและรายละเอียดดังนี้:
          </p>
          
          <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.6;">
              <tr style="border-bottom: 1px solid #F1F5F9;">
                <td style="padding: 8px 0; color: #64748B; width: 140px; font-weight: bold;">เลขอ้างอิง</td>
                <td style="padding: 8px 0; color: #0F172A; font-weight: bold; font-family: monospace; font-size: 14px;">${app.refCode}</td>
              </tr>
              <tr style="border-bottom: 1px solid #F1F5F9;">
                <td style="padding: 8px 0; color: #64748B; font-weight: bold;">ผู้ขอเข้าพบ</td>
                <td style="padding: 8px 0; color: #1E293B; font-weight: bold;">คุณ${app.clientName}</td>
              </tr>
              <tr style="border-bottom: 1px solid #F1F5F9;">
                <td style="padding: 8px 0; color: #64748B;">ตำแหน่ง / บริษัท</td>
                <td style="padding: 8px 0; color: #334155;">${app.position || '-'} / ${app.clientCompany || '-'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #F1F5F9;">
                <td style="padding: 8px 0; color: #64748B;">เบอร์โทรศัพท์</td>
                <td style="padding: 8px 0; color: #334155;">${app.phone || '-'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #F1F5F9;">
                <td style="padding: 8px 0; color: #64748B;">อีเมล</td>
                <td style="padding: 8px 0; color: #334155; font-family: monospace;">${app.clientEmail}</td>
              </tr>
              <tr style="border-bottom: 1px solid #F1F5F9;">
                <td style="padding: 8px 0; color: #64748B; font-weight: bold;">ผู้บริหารที่ขอพบ</td>
                <td style="padding: 8px 0; color: #1E293B; font-weight: bold; color: #D97706;">${app.executiveHost}</td>
              </tr>
              <tr style="border-bottom: 1px solid #F1F5F9;">
                <td style="padding: 8px 0; color: #64748B; font-weight: bold;">วัตถุประสงค์หลัก</td>
                <td style="padding: 8px 0; color: #1E293B; font-weight: bold;">${app.purposeMain || '-'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #F1F5F9;">
                <td style="padding: 8px 0; color: #64748B;">รายละเอียด / หัวข้อ</td>
                <td style="padding: 8px 0; color: #334155;">${app.purpose}</td>
              </tr>
              <tr style="border-bottom: 1px solid #F1F5F9;">
                <td style="padding: 8px 0; color: #64748B;">สถานที่ / รูปแบบ</td>
                <td style="padding: 8px 0; color: #334155;">
                  ${app.meetingFormat === 'online' ? 'ออนไลน์ (Zoom/Meet)' : `ออนไซต์ ที่ ${app.meetingLocation || '-'}`}
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748B; font-weight: bold;">ระดับความสำคัญ</td>
                <td style="padding: 8px 0; font-weight: bold; color: ${app.priority === 'ด่วนมาก' ? '#EF4444' : '#3B82F6'};">
                  ${app.priority || 'ทั่วไป'}
                </td>
              </tr>
            </table>
          </div>

          <div style="background-color: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 12px; padding: 18px; margin-bottom: 24px; font-size: 13px;">
            <span style="font-weight: bold; color: #1E40AF; display: block; margin-bottom: 8px;">⏱️ รายละเอียดวันเวลาที่สะดวก</span>
            ${timeDetailHtml}
          </div>

          ${attendeesHtml}

          <div style="text-align: center; margin-top: 28px;">
            <a href="${adminLink}" target="_blank" style="display: inline-block; background-color: #2563EB; color: #FFFFFF; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 8px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);">
              &#128187; เปิดหน้าระบบ Admin เพื่อพิจารณา →
            </a>
          </div>
        </div>
        ${getFooterHtml()}
      </div>
    </div>
  `;
}
