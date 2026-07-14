/**
 * Executive Appointment Manager - Status Check Portal Controller
 */

import { dbManager } from './firebase-config.js';
import { formatDate, statusLabel, EXECUTIVE_HOSTS } from './utils.js';

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

async function checkConflict(executiveName, proposedDate, proposedTime, durationHours, excludeRefCode = '') {
  try {
    const slots = await dbManager.getExecutiveSlots(executiveName);
    
    let targetStartMin = 0;
    let targetEndMin = 0;
    if (proposedTime.includes('-')) {
      const parts = proposedTime.split('-');
      const [sh, sm] = parts[0].trim().split(':').map(Number);
      const [eh, em] = parts[1].trim().split(':').map(Number);
      targetStartMin = sh * 60 + sm;
      targetEndMin = eh * 60 + em;
    } else {
      const [sh, sm] = proposedTime.trim().split(':').map(Number);
      targetStartMin = sh * 60 + sm;
      targetEndMin = targetStartMin + Math.round(durationHours * 60);
    }

    for (const slot of slots) {
      if (excludeRefCode && slot.appointmentRef === excludeRefCode) continue;
      if (slot.date !== proposedDate) continue;
      
      const [sH, sM] = slot.startTime.split(':').map(Number);
      const [eH, eM] = slot.endTime.split(':').map(Number);
      const slotStart = sH * 60 + sM;
      const slotEnd = eH * 60 + eM;

      // Overlap detection
      if (targetStartMin < slotEnd && targetEndMin > slotStart) {
        return { hasConflict: true, conflictWith: slot.appointmentRef || 'ภารกิจส่วนบุคคล' };
      }
    }
    return { hasConflict: false };
  } catch (err) {
    console.error('Error checking conflict:', err);
    return { hasConflict: false };
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const searchForm = document.getElementById('status_search_form');
  const codeInput = document.getElementById('search_ref_code');
  const resultContainer = document.getElementById('status_result_card');

  async function handleUrlAction(code, action) {
    try {
      const app = await dbManager.getAppointmentByRef(code);
      if (!app) return;
      
      const isPendingSelection = app.status === 'pending_client_selection';

      if (action === 'cancel_request') {
        const cancelModal = document.getElementById('cancel_modal');
        if (cancelModal) {
          const refDisp = document.getElementById('cancel_ref_code_disp');
          const dateTimeDisp = document.getElementById('cancel_date_time_disp');
          const execDisp = document.getElementById('cancel_exec_disp');
          
          if (refDisp) refDisp.textContent = app.refCode || code;
          if (dateTimeDisp) {
            const confirmedDate = app.confirmedDate || app.date || '-';
            const confirmedTime = app.confirmedTime || app.timeSlot || '-';
            dateTimeDisp.textContent = `${formatDate(confirmedDate)} ${confirmedTime} น.`;
          }
          if (execDisp) execDisp.textContent = app.executiveHost || app.executiveId || '-';
          
          const titleEl = document.getElementById('cancel_modal_title');
          const customMsgEl = document.getElementById('cancel_custom_msg');
          const confirmBtn = document.getElementById('cancel_modal_confirm');
          const reasonInput = document.getElementById('cancel_reason');
          const reasonLabel = document.getElementById('cancel_reason_label');
          
          if (reasonInput) reasonInput.value = '';
          
          if (isPendingSelection) {
            if (titleEl) titleEl.textContent = 'ยืนยันการถอนคำขอนัดหมาย';
            if (customMsgEl) {
              customMsgEl.textContent = "ยืนยันการถอนคำขอนัดหมายนี้ทั้งหมดใช่หรือไม่?\nคิวที่เสนอให้เลือกทั้งหมดจะถูกยกเลิก\nและ Admin จะได้รับการแจ้งเตือน";
              customMsgEl.classList.remove('hidden');
            }
            if (reasonLabel) reasonLabel.textContent = 'ระบุเหตุผลในการถอนคำขอ (ถ้ามี):';
            if (confirmBtn) confirmBtn.textContent = 'ยืนยันการถอนคำขอ';
          } else {
            if (titleEl) titleEl.textContent = 'ยืนยันการขอยกเลิกนัดหมาย';
            if (customMsgEl) {
              customMsgEl.classList.add('hidden');
            }
            if (reasonLabel) reasonLabel.textContent = 'เหตุผล (ถ้ามี):';
            if (confirmBtn) confirmBtn.textContent = 'ยืนยันขอยกเลิก';
          }

          cancelModal.classList.remove('hidden');
          
          const closeBtn = document.getElementById('cancel_modal_close');
          
          const closeHandler = () => {
            cancelModal.classList.add('hidden');
            cleanup();
          };
          
          const confirmHandler = async () => {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'กำลังส่งคำขอ...';
            try {
              const reason = reasonInput ? reasonInput.value.trim() : '';
              const finalReason = isPendingSelection 
                ? (reason || "ลูกค้าถอนคำขอจากอีเมลเสนอคิว")
                : reason;
              
              await dbManager.updateAppointment(app.refCode, {
                status: 'cancellation_requested',
                cancellationReason: finalReason,
                updatedAt: new Date().toISOString()
              });

              await dbManager.appendTimelineEvent(app.refCode, {
                action: "cancellation_requested",
                label: isPendingSelection ? "ลูกค้าถอนคำขอ" : "ลูกค้าขอยกเลิก",
                detail: finalReason || "",
                by: "client",
                timestamp: new Date().toISOString()
              });
              
              await sendGasNotification('cancel_request', {
                ...app,
                status: 'cancellation_requested',
                cancellationReason: finalReason,
                updatedAt: new Date().toISOString()
              });
              
              if (isPendingSelection) {
                alert('ถอนคำขอเรียบร้อยแล้ว\nAdmin จะดำเนินการยืนยันการยกเลิกให้ท่าน');
              } else {
                alert('ส่งคำขอยกเลิกเรียบร้อยแล้ว เลขาฯ จะดำเนินการแจ้งผลให้ท่านทราบทางอีเมล');
              }
              cancelModal.classList.add('hidden');
              cleanup();
              fetchAndRenderStatus(app.refCode);
            } catch (err) {
              alert('เกิดข้อผิดพลาด: ' + err.message);
              confirmBtn.disabled = false;
              confirmBtn.textContent = isPendingSelection ? 'ยืนยันการถอนคำขอ' : 'ยืนยันขอยกเลิก';
            }
          };
          
          const cleanup = () => {
            closeBtn.removeEventListener('click', closeHandler);
            confirmBtn.removeEventListener('click', confirmHandler);
          };
          
          closeBtn.addEventListener('click', closeHandler);
          confirmBtn.addEventListener('click', confirmHandler);
        }
      } else if (action === 'reschedule_request') {
        const rescheduleModal = document.getElementById('reschedule_modal');
        if (rescheduleModal) {
          const currentDisp = document.getElementById('reschedule_current_time_disp');
          if (currentDisp) {
            const confirmedDate = app.confirmedDate || app.date || '-';
            const confirmedTime = app.confirmedTime || app.timeSlot || '-';
            currentDisp.textContent = `${formatDate(confirmedDate)} ${confirmedTime} น.`;
          }
          
          const titleEl = document.getElementById('reschedule_modal_title');
          const customMsgEl = document.getElementById('reschedule_custom_msg');
          const currentTimeBox = document.getElementById('reschedule_current_time_box');
          const reasonLabel = document.getElementById('reschedule_reason_label');
          const reasonTextarea = document.getElementById('reschedule_reason');
          const confirmBtn = document.getElementById('reschedule_modal_confirm');
          
          if (isPendingSelection) {
            if (titleEl) titleEl.textContent = '📅 ขอเสนอวันใหม่';
            if (customMsgEl) {
              customMsgEl.textContent = "คิวที่เสนอให้ท่านไม่สะดวก ต้องการเสนอช่วงวันอื่นแทน";
              customMsgEl.classList.remove('hidden');
            }
            if (currentTimeBox) currentTimeBox.classList.add('hidden');
            if (reasonLabel) reasonLabel.innerHTML = 'เหตุผล (ถ้ามี):';
            if (reasonTextarea) {
              reasonTextarea.placeholder = 'ระบุรายละเอียดหรือความสะดวกเพิ่มเติม (ไม่บังคับ)...';
              reasonTextarea.removeAttribute('required');
            }
            if (confirmBtn) confirmBtn.textContent = 'ส่งคำขอ';
          } else {
            if (titleEl) titleEl.textContent = 'ขอเลื่อนวันนัดหมาย';
            if (customMsgEl) {
              customMsgEl.classList.add('hidden');
            }
            if (currentTimeBox) currentTimeBox.classList.remove('hidden');
            if (reasonLabel) reasonLabel.innerHTML = 'เหตุผลการขอเลื่อนนัด *:';
            if (reasonTextarea) {
              reasonTextarea.placeholder = 'กรุณาระบุเหตุผลในการขอเลื่อนนัด...';
              reasonTextarea.setAttribute('required', 'required');
            }
            if (confirmBtn) confirmBtn.textContent = 'ส่งคำขอเลื่อนนัด';
          }

          rescheduleModal.classList.remove('hidden');
          
          const closeBtn = document.getElementById('reschedule_modal_close');
          const reasonInput = document.getElementById('reschedule_reason');
          const specificDatesContainer = document.getElementById('reschedule_specific_dates_container');
          const dateRangeContainer = document.getElementById('reschedule_date_range_container');
          const rangeFromInput = document.getElementById('reschedule_range_from');
          const rangeToInput = document.getElementById('reschedule_range_to');
          const addSlotBtn = document.getElementById('btn_add_reschedule_slot');
          const rescheduleTypeRadios = document.getElementsByName('reschedule_type');
          
          if (reasonInput) reasonInput.value = '';
          if (rangeFromInput) rangeFromInput.value = '';
          if (rangeToInput) rangeToInput.value = '';
          
          // Default selection is specific_dates
          if (rescheduleTypeRadios.length > 0) {
            rescheduleTypeRadios[0].checked = true;
          }
          if (specificDatesContainer) specificDatesContainer.classList.remove('hidden');
          if (dateRangeContainer) dateRangeContainer.classList.add('hidden');
 
          let proposedRescheduleSlots = [{ date: '', startTime: '', endTime: '' }];
 
          const updateAddButtonVisibility = () => {
            if (addSlotBtn) {
              if (proposedRescheduleSlots.length >= 3) {
                addSlotBtn.classList.add('hidden');
              } else {
                addSlotBtn.classList.remove('hidden');
              }
            }
          };
 
          const renderRescheduleSlots = () => {
            const listEl = document.getElementById('reschedule_slots_list');
            if (!listEl) return;
            listEl.innerHTML = proposedRescheduleSlots.map((slot, index) => {
              return `
                <div class="bg-gray-50 border border-gray-150 rounded-xl p-3.5 space-y-2.5 relative" data-index="${index}">
                  <div class="flex justify-between items-center">
                    <span class="text-xs font-bold text-gray-550 font-sans">วันที่ต้องการที่ ${index + 1} ${index === 0 ? '<span class="text-red-400 font-bold">*</span>' : ''}</span>
                    ${index > 0 ? `
                      <button type="button" class="btn-remove-reschedule-slot text-xs text-red-500 hover:text-red-700 font-semibold cursor-pointer" data-index="${index}">
                        🗑 ลบ
                      </button>
                    ` : ''}
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div class="sm:col-span-5">
                      <input type="date" class="reschedule-slot-date w-full px-3 py-2 border border-gray-250 rounded-lg text-xs" value="${slot.date}" />
                    </div>
                    <div class="flex items-center space-x-2 sm:col-span-7">
                      <input type="time" class="reschedule-slot-start w-full px-3 py-2 border border-gray-250 rounded-lg text-xs" value="${slot.startTime}" placeholder="เริ่ม" />
                      <span class="text-[11px] text-gray-400 shrink-0">ถึง</span>
                      <input type="time" class="reschedule-slot-end w-full px-3 py-2 border border-gray-250 rounded-lg text-xs" value="${slot.endTime}" placeholder="สิ้นสุด" />
                    </div>
                  </div>
                </div>
              `;
            }).join('');
 
            // Wire up events
            listEl.querySelectorAll('.reschedule-slot-date').forEach((el, index) => {
              el.addEventListener('change', (e) => {
                proposedRescheduleSlots[index].date = e.target.value;
              });
            });
 
            listEl.querySelectorAll('.reschedule-slot-start').forEach((el, index) => {
              el.addEventListener('change', (e) => {
                proposedRescheduleSlots[index].startTime = e.target.value;
                e.target.blur(); // Blur automatically
              });
            });
 
            listEl.querySelectorAll('.reschedule-slot-end').forEach((el, index) => {
              el.addEventListener('change', (e) => {
                proposedRescheduleSlots[index].endTime = e.target.value;
                e.target.blur(); // Blur automatically
              });
            });
 
            listEl.querySelectorAll('.btn-remove-reschedule-slot').forEach(btn => {
              btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.getAttribute('data-index'), 10);
                proposedRescheduleSlots.splice(idx, 1);
                renderRescheduleSlots();
                updateAddButtonVisibility();
              });
            });
          };
 
          renderRescheduleSlots();
          updateAddButtonVisibility();
 
          const addSlotHandler = () => {
            if (proposedRescheduleSlots.length < 3) {
              proposedRescheduleSlots.push({ date: '', startTime: '', endTime: '' });
              renderRescheduleSlots();
              updateAddButtonVisibility();
            }
          };
 
          if (addSlotBtn) {
            addSlotBtn.addEventListener('click', addSlotHandler);
          }
 
          const onTypeChange = (e) => {
            if (e.target.value === 'specific_dates') {
              if (specificDatesContainer) specificDatesContainer.classList.remove('hidden');
              if (dateRangeContainer) dateRangeContainer.classList.add('hidden');
            } else {
              if (specificDatesContainer) specificDatesContainer.classList.add('hidden');
              if (dateRangeContainer) dateRangeContainer.classList.remove('hidden');
            }
          };
 
          rescheduleTypeRadios.forEach(radio => {
            radio.addEventListener('change', onTypeChange);
          });
 
          const closeHandler = () => {
            rescheduleModal.classList.add('hidden');
            cleanup();
          };
 
          const confirmHandler = async () => {
            const reason = reasonInput ? reasonInput.value.trim() : '';
            if (!isPendingSelection && !reason) {
              alert('กรุณากรอกเหตุผลการขอเลื่อนนัด');
              return;
            }
 
            const selectedType = document.querySelector('input[name="reschedule_type"]:checked')?.value || 'specific_dates';
 
            let updateData = {
              status: 'reschedule_requested',
              rescheduleType: selectedType,
              rescheduleReason: reason,
              updatedAt: new Date().toISOString()
            };

            if (isPendingSelection) {
              updateData.rescheduleContext = 'from_offer_slots';
            }
 
            if (selectedType === 'specific_dates') {
              if (proposedRescheduleSlots.length === 0) {
                alert('กรุณาเพิ่มวันที่ต้องการอย่างน้อย 1 วัน');
                return;
              }
 
              // Validations:
              // - 1st date is required
              if (!proposedRescheduleSlots[0].date) {
                alert('กรุณาระบุวันที่สำหรับวันที่ต้องการที่ 1');
                return;
              }
 
              // Parse list, ensure dates are filled if specified
              const datesToSave = [];
              for (let i = 0; i < proposedRescheduleSlots.length; i++) {
                const slot = proposedRescheduleSlots[i];
                if (i > 0 && !slot.date) {
                  alert(`กรุณาระบุวันที่ต้องการที่ ${i + 1} หรือกดลบออก`);
                  return;
                }
                
                if (slot.startTime) {
                  if (!slot.endTime) {
                    alert(`กรุณาระบุเวลาสิ้นสุดสำหรับวันที่ต้องการที่ ${i + 1}`);
                    return;
                  }
                  if (slot.endTime <= slot.startTime) {
                    alert(`เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้นสำหรับวันที่ต้องการที่ ${i + 1}`);
                    return;
                  }
                } else if (slot.endTime) {
                  alert(`กรุณาระบุเวลาเริ่มต้นสำหรับวันที่ต้องการที่ ${i + 1}`);
                  return;
                }
 
                datesToSave.push({
                  date: slot.date,
                  startTime: slot.startTime || '',
                  endTime: slot.endTime || ''
                });
              }
 
              updateData.proposedRescheduleDates = datesToSave;
 
            } else {
              // date_range
              const fromVal = rangeFromInput ? rangeFromInput.value : '';
              const toVal = rangeToInput ? rangeToInput.value : '';
 
              if (!fromVal) {
                alert('กรุณาระบุวันเริ่มต้นสำหรับช่วงวันที่ต้องการ');
                return;
              }
 
              if (toVal && toVal < fromVal) {
                alert('วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น');
                return;
              }
 
              updateData.rescheduleRangeDateFrom = fromVal;
              updateData.rescheduleRangeDateTo = toVal || '';
            }
 
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'กำลังส่งคำขอ...';
 
            try {
              await dbManager.updateAppointment(app.refCode, updateData);
 
              const detailText = isPendingSelection
                ? `ขอให้จัดสรรคิวใหม่: ${reason || "ลูกค้าไม่สะดวกคิวที่เสนอ"}`
                : `ขอเลื่อนนัดหมาย: ${reason || ""}`;

              await dbManager.appendTimelineEvent(app.refCode, {
                action: "reschedule_requested",
                label: isPendingSelection ? "ลูกค้าขอเสนอวันใหม่" : "ลูกค้าขอเลื่อนนัด",
                detail: detailText,
                by: "client",
                timestamp: new Date().toISOString()
              });

              await sendGasNotification('reschedule_request', {
                ...app,
                ...updateData
              });
 
              if (isPendingSelection) {
                alert('ส่งคำขอเรียบร้อยแล้ว\nAdmin จะจัดสรรคิวใหม่ให้ท่านในช่วงวันที่ระบุ');
              } else {
                alert('ส่งคำขอเลื่อนนัดเรียบร้อยแล้ว เลขาฯ จะติดต่อกลับเพื่อยืนยันวันใหม่ทางอีเมล');
              }
              rescheduleModal.classList.add('hidden');
              cleanup();
              fetchAndRenderStatus(app.refCode);
            } catch (err) {
              alert('เกิดข้อผิดพลาด: ' + err.message);
              confirmBtn.disabled = false;
              confirmBtn.textContent = isPendingSelection ? 'ส่งคำขอ' : 'ส่งคำขอเลื่อนนัด';
            }
          };
 
          const cleanup = () => {
            closeBtn.removeEventListener('click', closeHandler);
            confirmBtn.removeEventListener('click', confirmHandler);
            if (addSlotBtn) {
              addSlotBtn.removeEventListener('click', addSlotHandler);
            }
            rescheduleTypeRadios.forEach(radio => {
              radio.removeEventListener('change', onTypeChange);
            });
          };
 
          closeBtn.addEventListener('click', closeHandler);
          confirmBtn.addEventListener('click', confirmHandler);
        }
      }
    } catch (e) {
      console.error('Error handling URL action:', e);
    }
  }

  // Parse immediate reference codes in current URL Parameters (e.g. ?code=APT-xxxx-xxxx or ?ref=APT-xxxx-xxxx)
  const urlParams = new URLSearchParams(window.location.search);
  const initialCode = urlParams.get('code') || urlParams.get('ref');
  if (initialCode) {
    const searchSection = document.getElementById('search_section');
    if (searchSection) {
      searchSection.classList.add('hidden');
    }
    if (codeInput) {
      codeInput.value = initialCode.trim().toUpperCase();
    }
    fetchAndRenderStatus(initialCode).then(() => {
      // อ่าน action parameter
      const actionParam = urlParams.get('action');
      
      // จัดการ selectSlot เดิม
      const selectSlotParam = urlParams.get('selectSlot');
      if (selectSlotParam) {
        setTimeout(() => {
          const btnIdx = parseInt(selectSlotParam, 10) - 1; // 1 -> 0, 2 -> 1, 3 -> 2
          const targetBtn = document.querySelector(`.btn-select-proposed-slot[data-slot-index="${btnIdx}"]`);
          if (targetBtn) {
            targetBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetBtn.classList.add('ring-4', 'ring-purple-400');
            targetBtn.click();
          }
        }, 1000);
      }
      
      // จัดการ action parameter ใหม่
      if (actionParam) {
        setTimeout(() => {
          console.log('Action param detected:', actionParam);
          
          if (actionParam === 'cancel_request') {
            // หาปุ่มขอยกเลิกแล้วคลิกอัตโนมัติ
            const cancelBtn = document.getElementById('btn_request_cancel')
              || document.getElementById('btn_request_cancellation')
              || document.querySelector('[data-action="cancel_request"]')
              || document.querySelector('.btn-cancel-appointment')
              || document.querySelector('button[id*="cancel"]');
            
            console.log('Cancel btn found:', cancelBtn);
            
            if (cancelBtn) {
              cancelBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              cancelBtn.click();
            } else {
              // ถ้าหาปุ่มไม่เจอ ให้เรียก handleUrlAction โดยตรงเพื่อให้ Modal โหลดข้อมูลและปุ่มควบคุมอย่างสมบูรณ์
              handleUrlAction(initialCode, 'cancel_request');
            }
          }
          
          if (actionParam === 'reschedule_request') {
            // หาปุ่มขอเลื่อนนัดแล้วคลิกอัตโนมัติ
            const rescheduleBtn = document.getElementById('btn_request_reschedule')
              || document.querySelector('[data-action="reschedule_request"]')
              || document.querySelector('.btn-reschedule-appointment')
              || document.querySelector('button[id*="reschedule"]');
            
            console.log('Reschedule btn found:', rescheduleBtn);
            
            if (rescheduleBtn) {
              rescheduleBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              rescheduleBtn.click();
            } else {
              // ถ้าหาปุ่มไม่เจอ ให้เรียก handleUrlAction โดยตรงเพื่อให้ Modal โหลดข้อมูลและปุ่มควบคุมอย่างสมบูรณ์
              handleUrlAction(initialCode, 'reschedule_request');
            }
          }

          if (actionParam === 'confirm_reschedule') {
            // หาปุ่มยืนยันคิวรอบใหม่แล้วคลิกอัตโนมัติ
            const confirmRescheduleBtn = document.getElementById('btn_confirm_reschedule');
            console.log('Confirm Reschedule btn found:', confirmRescheduleBtn);
            if (confirmRescheduleBtn) {
              confirmRescheduleBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              confirmRescheduleBtn.click();
            }
          }

          if (actionParam === 'decline_reschedule') {
            // หาปุ่มปฏิเสธคิวรอบใหม่แล้วคลิกอัตโนมัติ
            const declineRescheduleBtn = document.getElementById('btn_decline_reschedule');
            console.log('Decline Reschedule btn found:', declineRescheduleBtn);
            if (declineRescheduleBtn) {
              declineRescheduleBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              declineRescheduleBtn.click();
            }
          }
        }, 1500); // รอ 1.5 วินาที ให้ข้อมูลและปุ่มโหลดครบก่อน
      }
    });
  }

  // Handle Lookup Submissions
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = codeInput.value.trim().toUpperCase();
      if (!code) {
        alert('กรุณากรอกรหัสอ้างอิง คำขอนัดหมายของคุณ');
        return;
      }
      
      // Update URL parameters without reloading for shareable links
      const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?code=' + code;
      window.history.pushState({ path: newUrl }, '', newUrl);

      fetchAndRenderStatus(code);
    });
  }

  async function fetchAndRenderStatus(code) {
    if (!resultContainer) return;

    // Show loading state
    resultContainer.innerHTML = `
      <div class="text-center py-16 animate-pulse">
        <svg class="animate-spin h-8 w-8 text-[#1A1A2E] mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="text-sm font-sans text-gray-500">กำลังสืบค้นบันทึกข้อมูลนัดหมายในสารระบบ...</p>
      </div>
    `;
    resultContainer.classList.remove('hidden');

    try {
      const app = await dbManager.getAppointmentByRef(code);

      if (!app) {
        const searchSection = document.getElementById('search_section');
        if (searchSection) {
          searchSection.classList.remove('hidden');
        }
        resultContainer.innerHTML = `
          <div class="text-center py-12 px-6">
            <div class="h-12 w-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
              </svg>
            </div>
            <h3 class="text-lg font-serif text-[#1A1A2E] font-semibold">ไม่พบข้อมูลคำขอนัดหมายของคุณ</h3>
            <p class="text-sm text-gray-400 mt-2 max-w-sm mx-auto font-sans">โปรดตรวจสอบรหัสอ้างอิงใหม่อีกครั้ง รหัสเข้าพบต้องขึ้นด้วยต้น "APT-YYYYMMDD-XXXX" (ตัวอย่าง: APT-20260623-M9R7)</p>
          </div>
        `;
        return;
      }

      // Resolve status config mapping
      const statusMeta = statusLabel(app.status);

      // Construct Result UI card
      let rescheduledHtml = '';
      if (app.status === 'rescheduled') {
        rescheduledHtml = `
          <div class="mt-6 border-l-4 border-blue-500 bg-blue-50/70 p-5 rounded-r-lg">
            <div class="flex">
              <div class="flex-shrink-0 mt-0.5">
                <svg class="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </div>
              <div class="ml-3 flex-1">
                <h4 class="text-sm font-bold text-blue-800">ผู้บริหารเสนอขอเปลี่ยนกำหนดเวลานัดหมายใหม่</h4>
                <p class="mt-1 text-xs text-blue-700/90 leading-relaxed font-sans">
                  เนื่องจากติดภารกิจด่วน เลขานุการจึงเรียนขอเลื่อนวันการเข้าพบฝ่ายบริหาร เป็นกำหนดนัดหมายใหม่ดังนี้:
                </p>
                <div class="mt-3 bg-white/80 p-3 rounded-lg border border-blue-100 grid grid-cols-2 gap-4 text-[#1A1A2E]">
                  <div>
                    <span class="text-[10px] text-blue-600 font-bold block uppercase tracking-wider">วันนัดเสนอเปลี่ยนใหม่</span>
                    <span class="text-sm font-bold text-gray-900">${formatDate(app.rescheduledDate)}</span>
                  </div>
                  <div>
                    <span class="text-[10px] text-blue-600 font-bold block uppercase tracking-wider">ช่วงกำหนดเวลารอบใหม่</span>
                    <span class="text-sm font-bold text-gray-900">${app.rescheduledTime} น.</span>
                  </div>
                </div>
                <div class="mt-4 flex space-x-2.5" id="reschedule_actions">
                  <button id="btn_confirm_reschedule" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 px-4 rounded transition-all cursor-pointer">
                    ยืนยันเลือกเวลาใหม่ (Confirm New Time)
                  </button>
                  <button id="btn_decline_reschedule" class="bg-white border border-gray-300 text-gray-500 hover:text-red-500 text-xs py-2 px-3 rounded transition-all cursor-pointer">
                    ยกเลิกนัดหมายนี้
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
      }

      let adminNotesHtml = '';
      if (app.adminNotes) {
        adminNotesHtml = `
          <div class="mt-5 border border-dashed border-gray-200 bg-gray-50 p-4 rounded-lg">
            <span class="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1 font-sans">บันทึกหรือหมายเหตุเพิ่มเติมจากฝ่ายเลขานุการ (Admin Notes)</span>
            <p class="text-xs italic text-gray-600 font-serif leading-relaxed">"${app.adminNotes}"</p>
          </div>
        `;
      }

      // Time option details block
      let timeOptionHtml = '';
      if (app.timeOption === 'A') {
        timeOptionHtml = `
          <div>
            <span class="text-xs text-gray-400 block">รูปแบบช่วงเวลาที่จอง</span>
            <span class="font-medium text-sm text-gray-900">Option A: ระบุเวลาเข้าพบจำนวน ${app.optionAHours || '-'} ชั่วโมง เพื่อให้เจ้านัดหมาย</span>
          </div>
        `;
      } else {
        let listSlots = '';
        if (app.optionBProposedSlots && app.optionBProposedSlots.length > 0) {
          app.optionBProposedSlots.forEach((slot, index) => {
            listSlots += `<div>ช่วง ${index + 1}: <span class="font-semibold text-gray-800">${formatDate(slot.date)}</span> เวลา <span class="font-semibold text-gray-800">${slot.time} น.</span></div>`;
          });
        } else {
          listSlots = '<span class="text-gray-400">ระบุเวลาเอง (ไม่พบข้อมูลตัวเลือกช่วงเวลา)</span>';
        }
        timeOptionHtml = `
          <div>
            <span class="text-xs text-gray-400 block mb-1">รูปแบบเวลาที่เสนอ (Option B)</span>
            <div class="text-xs space-y-1 bg-gray-50 p-2.5 rounded border border-gray-100">
              ${listSlots}
            </div>
          </div>
        `;
      }

      // If approved, confirmed_reschedule, or client_selected, we show the formal confirmed date-time
      let confirmedTimeHtml = '';
      if (app.status === 'approved' || app.status === 'confirmed_reschedule' || app.status === 'client_selected') {
        const checkDate = app.rescheduledDate || app.date || '-';
        const checkTime = app.rescheduledTime || app.timeSlot || '-';
        confirmedTimeHtml = `
          <div class="mt-4 p-4 bg-emerald-50/50 border border-emerald-100 rounded-lg flex items-center space-x-3">
            <div class="p-2 bg-emerald-500 rounded-full text-white">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <div>
              <span class="text-[10px] font-bold text-emerald-800 block uppercase tracking-wider font-sans">วันและเวลาที่อนุมัติเข้าพบอย่างเป็นทางการ</span>
              <span class="text-sm font-bold text-emerald-950">${formatDate(checkDate)} เวลา ${checkTime} น.</span>
            </div>
          </div>
        `;
      }

      let proposedSlotsHtml = '';
      if (app.status === 'pending_client_selection') {
        let listProposedSlotsButtons = '';
        if (app.proposedSlots && app.proposedSlots.length > 0) {
          app.proposedSlots.forEach((slot, index) => {
            listProposedSlotsButtons += `
              <button type="button" data-slot-index="${index}" data-slot-date="${slot.date}" data-slot-time="${slot.time}" class="btn-select-proposed-slot w-full text-left p-3.5 hover:bg-purple-50 border border-purple-100 rounded-xl flex justify-between items-center transition-all cursor-pointer bg-white text-[#1A1A2E] shadow-sm hover:shadow-md">
                <span class="font-sans text-xs">
                  📌 ตัวเลือกที่ ${index + 1}: <strong class="text-purple-950 font-bold">${formatDate(slot.date)}</strong> เวลา <strong class="text-purple-950 font-bold">${slot.time} น.</strong>
                </span>
                <span class="text-xs bg-purple-600 hover:bg-purple-700 text-white font-semibold px-2.5 py-1 rounded transition-all">เลือกเวลานี้</span>
              </button>
            `;
          });
        } else {
          listProposedSlotsButtons = '<div class="text-gray-400 text-xs">ไม่พบข้อมูลคิวเสนอจัดสรรคิวจากเลขาฯ กรุณาติดต่อเลขาฯ โดยตรง</div>';
        }

        proposedSlotsHtml = `
          <div class="mt-6 border-l-4 border-purple-500 bg-purple-50/70 p-5 rounded-r-lg">
            <div class="flex flex-col">
              <div class="flex items-center mb-2">
                <svg class="h-5 w-5 text-purple-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                </svg>
                <h4 class="text-sm font-bold text-purple-800">โปรดเลือกวันและเวลานัดหมายที่คุณสะดวกเข้าพบฝ่ายบริหาร</h4>
              </div>
              <p class="text-xs text-purple-700/90 leading-relaxed font-sans mb-3">
                เลขานุการได้ทำตรวจสอบช่วงเวลาร่วมกับตารางงานผู้บริหารและทำเสนอขอบเขตเวลาจัดสรรคิว (Offer Slots) ไว้ให้เลือกจำนวนดังต่อไปนี้:
              </p>
              <div class="space-y-2.5 max-w-md">
                ${listProposedSlotsButtons}
              </div>
            </div>
          </div>
        `;
      }

      resultContainer.innerHTML = `
        <div class="animate-fade-in divide-y divide-gray-100 font-sans">
          
          <!-- Card Header & Badge -->
          <div class="pb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <span class="text-xs font-mono font-medium text-gray-400">รหัสอ้างอิง: ${app.refCode}</span>
              <h3 class="text-xl font-serif text-[#1A1A2E] mt-1 font-bold">สืบค้นสถานะนัดหมายเรียบร้อยแล้ว</h3>
            </div>
            <div class="flex flex-col items-start sm:items-end gap-2.5 shrink-0">
              <div class="flex items-center px-3.5 py-1.5 rounded-full text-xs font-bold ${statusMeta.badgeClass}">
                ${statusMeta.icon}
                <span>${statusMeta.label}</span>
              </div>
              <button id="btn_show_search" class="text-xs text-gray-500 hover:text-[#1A1A2E] underline font-medium cursor-pointer flex items-center space-x-1">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                </svg>
                <span>สืบค้นคำขอนัดหมายอื่น</span>
              </button>
            </div>
          </div>
 
          <!-- Card Content Grid -->
          <div class="py-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <!-- Left Info Block: Profile -->
            <div class="space-y-4 text-sm text-[#1A1A2E]">
              <h4 class="text-xs font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100 pb-1.5 font-sans">ข้อมูลผู้มาเข้าพบ</h4>
              <div>
                <span class="text-xs text-gray-400 block">ชื่อ-นามสกุล</span>
                <span class="font-semibold text-gray-900">${app.clientName}</span>
              </div>
              <div>
                <span class="text-xs text-gray-400 block">องค์กร / บริษัท / หน่วยงาน</span>
                <span class="font-medium text-gray-800">${app.clientCompany}</span>
              </div>
              <div>
                <span class="text-xs text-gray-400 block">ช่องทางติดต่อหลัก</span>
                <span class="font-medium text-gray-800">${app.clientEmail}</span>
              </div>
              <div>
                <span class="text-xs text-gray-400 block">ระดับความสำคัญ</span>
                <span class="px-2 py-0.5 rounded text-xs font-bold inline-block ${app.priority === 'ด่วนมาก' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-gray-50 text-gray-600'}">
                  ${app.priority || 'ทั่วไป'}
                </span>
              </div>
              <div>
                <span class="text-xs text-gray-400 block">หัวข้อติดต่อเพื่อเข้าประชุม</span>
                <p class="text-xs text-gray-700 mt-1 bg-gray-50 p-2.5 rounded leading-relaxed italic border border-gray-100 font-serif">"${app.purpose || '-'}"</p>
              </div>
            </div>
 
            <!-- Right Info Block: Host Details -->
            <div class="space-y-4 text-sm text-[#1A1A2E]">
              <h4 class="text-xs font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100 pb-1.5 font-sans">เป้าหมายฝ่ายบริหารและเวลาจอง</h4>
              <div>
                <span class="text-xs text-gray-400 block">ต้องการพบท่านผู้บริหาร</span>
                <span class="font-bold text-base text-[#1A1A2E] bg-slate-50 border border-slate-100 px-2.5 py-1 rounded inline-block">${app.executiveHost || app.executiveId || '-'}</span>
              </div>
              
              <!-- Custom rendering of Time selections based on Options A/B -->
              ${timeOptionHtml}

              <div>
                <span class="text-xs text-gray-400 block">วันบันทึกข้อมูลนัดเข้าระบบ</span>
                <span class="text-xs font-mono text-gray-400">${app.createdAt ? new Date(app.createdAt).toLocaleString('th-TH') : '-'}</span>
              </div>
            </div>
 
          </div>
 
          <!-- Final Confirmation block -->
          ${confirmedTimeHtml}

          <!-- Nested Notes & Action Boxes -->
          <div class="pt-5 space-y-4">
            ${rescheduledHtml}
            ${proposedSlotsHtml}
            ${adminNotesHtml}
 
            <!-- Printing Action & Controls -->
            <div class="pt-5 flex flex-col sm:flex-row justify-between items-center gap-3 border-t border-gray-100">
              <div class="flex flex-col sm:flex-row gap-2.5 w-full sm:w-auto">
                <button id="btn_print_receipt" class="w-full sm:w-auto bg-gray-900 hover:bg-black text-white font-sans text-xs font-semibold py-2.5 px-4 rounded inline-flex items-center justify-center space-x-1.5 transition-all cursor-pointer">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path>
                  </svg>
                  <span>พิมพ์ใบตอบรับ (Print Confirmation)</span>
                </button>
                ${['pending', 'approved', 'rescheduled', 'confirmed_reschedule', 'pending_client_selection'].includes(app.status) ? `
                  <button id="btn_request_reschedule" class="w-full sm:w-auto bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 font-sans text-xs font-semibold py-2.5 px-4 rounded inline-flex items-center justify-center space-x-1.5 transition-all cursor-pointer">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                    </svg>
                    <span>ขอเลื่อนวันนัดหมาย</span>
                  </button>
                  <button id="btn_request_cancel" class="w-full sm:w-auto bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-sans text-xs font-semibold py-2.5 px-4 rounded inline-flex items-center justify-center space-x-1.5 transition-all cursor-pointer">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                    </svg>
                    <span>ส่งคำขอขอยกเลิกนัดหมาย</span>
                  </button>
                ` : ''}
              </div>
              
              <div class="text-xs text-gray-400 text-right w-full sm:w-auto font-sans">
                <span>อัปเดตข้อมูลความเคลื่อนไหว: </span>
                <span class="font-mono font-bold text-gray-800">${new Date().toLocaleDateString('th-TH')}</span>
              </div>
            </div>
          </div>
 
        </div>
      `;

      // Set up click handlers inside the newly generated card
      const printBtn = document.getElementById('btn_print_receipt');
      if (printBtn) {
        printBtn.addEventListener('click', () => {
          window.print();
        });
      }

      const showSearchBtn = document.getElementById('btn_show_search');
      if (showSearchBtn) {
        showSearchBtn.addEventListener('click', () => {
          const searchSection = document.getElementById('search_section');
          if (searchSection) {
            searchSection.classList.remove('hidden');
            const codeInput = document.getElementById('search_ref_code');
            if (codeInput) {
              codeInput.value = '';
              codeInput.focus();
            }
          }
          // Reset URL parameters without reloading
          const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
          window.history.pushState({ path: newUrl }, '', newUrl);
          // Hide result container
          resultContainer.classList.add('hidden');
          resultContainer.innerHTML = '';
        });
      }

      // Handler for confirming reschedule to "confirmed_reschedule"
      const confirmRescheduleBtn = document.getElementById('btn_confirm_reschedule');
      if (confirmRescheduleBtn) {
        confirmRescheduleBtn.addEventListener('click', async () => {
          if (confirm('คุณยืนยันที่จะตกลงกําหนดเวลาเข้าพบรอบใหม่ตามที่เสนอนี้ใช่หรือไม่?')) {
            const container = document.getElementById('reschedule_actions');
            if (container) container.innerHTML = '<span class="text-xs text-gray-400 italic">กำลังตรวจสอบคิวงานและบันทึกข้อมูล...</span>';
            
            try {
              const execName = app.executiveHost || app.executiveId;
              const hours = parseFloat(app.optionAHours || app.optionHours || 1);
              const slotDate = app.rescheduledDate;
              const slotTime = app.rescheduledTime;

              // 1. checkConflict
              const conflictResult = await checkConflict(execName, slotDate, slotTime, hours, app.refCode);
              if (conflictResult.hasConflict) {
                alert(`⚠️ ช่วงเวลานี้ทับซ้อนชนกับคิวอื่นที่ลงทะเบียนเรียบร้อยแล้ว (คิวที่ชน: ${conflictResult.conflictWith}) โปรดติดต่อแผนกเลขานุการส่วนงานบริหารค่ะ`);
                fetchAndRenderStatus(app.refCode);
                return;
              }

              // 2. updateAppointment in Firestore
              await dbManager.updateAppointment(app.refCode, {
                status: 'confirmed_reschedule',
                confirmedDate: slotDate,
                confirmedTime: slotTime,
                date: slotDate,
                timeSlot: slotTime,
                adminNotes: (app.adminNotes || '') + `\n(หมายเหตุ: ลูกค้าได้ตกลงปรับเปลี่ยนเวลานัดหมายใหม่เป็นวันที่ ${formatDate(slotDate)} เวลา ${slotTime} น. เรียบร้อยแล้ว)`
              });

              await dbManager.appendTimelineEvent(app.refCode, {
                action: "confirmed_reschedule",
                label: "ลูกค้าตอบรับเวลาใหม่",
                detail: `ตอบรับคิวเสนอใหม่: วันที่ ${formatDate(slotDate)} เวลา ${slotTime} น.`,
                by: "client",
                timestamp: new Date().toISOString()
              });

              // 3. Send GAS Notification
              await sendGasNotification('confirmed_reschedule', { 
                ...app, 
                status: 'confirmed_reschedule', 
                confirmedDate: slotDate, 
                confirmedTime: slotTime,
                date: slotDate,
                timeSlot: slotTime
              });

              alert('ตอบรับกำหนดเวลาเข้าพบใหม่เรียบร้อยแล้วค่ะ!');
              fetchAndRenderStatus(app.refCode);
            } catch (error) {
              alert('ระบบขัดข้อง: ' + error.message);
              fetchAndRenderStatus(app.refCode);
            }
          }
        });
      }

      // Handler for declining reschedule -> cancellation_requested
      const declineRescheduleBtn = document.getElementById('btn_decline_reschedule');
      if (declineRescheduleBtn) {
        declineRescheduleBtn.addEventListener('click', async () => {
          if (confirm('คุณต้องการยกเลิกคำขอนัดหมายผู้บริหารนี้ใช่หรือไม่? คำขอจะถูกส่งให้เลขาฯ ดำเนินการอนุมัติยกเลิกอีกครั้ง')) {
            const container = document.getElementById('reschedule_actions');
            if (container) container.innerHTML = '<span class="text-xs text-gray-400 italic">กำลังส่งคำขอแจ้งยกเลิกนัดหมาย...</span>';

            try {
              await dbManager.updateAppointment(app.refCode, {
                status: 'cancellation_requested',
                cancellationRequestedAt: new Date().toISOString(),
                adminNotes: (app.adminNotes || '') + '\n(หมายเหตุ: ลูกค้าผู้เข้าพบขอส่งคำแจ้งยกเลิกรายการนัดเนื่องจากขอผ่านข้อเสนอเลื่อนเวลา)'
              });

              await dbManager.appendTimelineEvent(app.refCode, {
                action: "decline_reschedule",
                label: "ลูกค้าปฏิเสธข้อเสนอเลื่อนเวลา",
                detail: `ปฏิเสธข้อเสนอเลื่อนเวลา และขอส่งคำแจ้งยกเลิกรายการนัดหมาย`,
                by: "client",
                timestamp: new Date().toISOString()
              });

              await sendGasNotification('cancellation_requested', { ...app, status: 'cancellation_requested', cancellationRequestedAt: new Date().toISOString() });
              alert('ส่งคำขอยกเลิกนัดหมายเรียบร้อยแล้วค่ะ');
              fetchAndRenderStatus(app.refCode);
            } catch (error) {
              alert('ระบบขัดข้อง: ' + error.message);
            }
          }
        });
      }

      // Handler for request reschedule button click
      const requestRescheduleBtn = document.getElementById('btn_request_reschedule');
      if (requestRescheduleBtn) {
        requestRescheduleBtn.addEventListener('click', () => {
          handleUrlAction(app.refCode, 'reschedule_request');
        });
      }

      // Handler for request cancel button click
      const requestCancelBtn = document.getElementById('btn_request_cancel');
      if (requestCancelBtn) {
        requestCancelBtn.addEventListener('click', () => {
          handleUrlAction(app.refCode, 'cancel_request');
        });
      }

      // Setup handler for proposed slot selection
      document.querySelectorAll('.btn-select-proposed-slot').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const slotIndex = parseInt(e.currentTarget.getAttribute('data-slot-index'));
          const slotDate = e.currentTarget.getAttribute('data-slot-date');
          const slotTime = e.currentTarget.getAttribute('data-slot-time');
          
          if (confirm(`คุณต้องการยืนยันเลือกนัดหมายรอบวันตัวเลือกที่ ${slotIndex + 1} (${formatDate(slotDate)} เวลา ${slotTime} น.) ใช่หรือไม่?`)) {
            const btnConfirm = e.currentTarget.querySelector('span:last-child');
            if (btnConfirm) btnConfirm.textContent = 'ตรวจสอบคิวว่าง...';
            
            try {
              // 1. checkConflict
              const execName = app.executiveHost || app.executiveId;
              const hours = parseFloat(app.optionAHours || app.optionHours || 1);
              const conflictResult = await checkConflict(execName, slotDate, slotTime, hours, app.refCode);
              if (conflictResult.hasConflict) {
                alert(`⚠️ ช่วงเวลานี้ทับซ้อนชนกับคิวอื่นที่ลงทะเบียนเรียบร้อยแล้ว (คิวที่ชน: ${conflictResult.conflictWith}) โปรดเลือกข้อเสนอเวลาใหม่อื่นๆ หรือติดต่อแผนกเลขานุการส่วนงานบริหารค่ะ`);
                if (btnConfirm) btnConfirm.textContent = 'เลือกเวลานี้';
                return;
              }
              
              if (btnConfirm) btnConfirm.textContent = 'กำลังบันทึกข้อมูล...';

              // 2. updateAppointment in Firestore
              await dbManager.updateAppointment(app.refCode, {
                status: 'client_selected',
                confirmedDate: slotDate,
                confirmedTime: slotTime,
                date: slotDate,
                timeSlot: slotTime,
                clientSelectedAt: new Date().toISOString(),
                adminNotes: (app.adminNotes || '') + `\n(หมายเหตุ: ลูกค้าได้เลือกและตกลงใช้สิทธิ์นัดหมายคิวเสนอตัวเลือกที่ ${slotIndex + 1} วันที่ ${formatDate(slotDate)} เวลา ${slotTime} น. เพื่อรอการอนุมัติเรียบร้อยแล้ว)`
              });

              await dbManager.appendTimelineEvent(app.refCode, {
                action: "client_selected",
                label: "ลูกค้าเลือกคิวเสนอตัวเลือก",
                detail: `ลูกค้าเลือกคิวตัวเลือกที่ ${slotIndex + 1}: วันที่ ${formatDate(slotDate)} เวลา ${slotTime} น.`,
                by: "client",
                timestamp: new Date().toISOString()
              });

              // 3. Send GAS
              await sendGasNotification('client_selected', { 
                ...app, 
                status: 'client_selected', 
                confirmedDate: slotDate, 
                confirmedTime: slotTime,
                date: slotDate,
                timeSlot: slotTime,
                clientSelectedAt: new Date().toISOString()
              });

              alert('เลือกช่วงเวลาเรียบร้อยแล้วค่ะ! กรุณารอเลขานุการส่วนการบริหารทำการยืนยันและอนุมัติอย่างเป็นทางการนะคะ');
              fetchAndRenderStatus(app.refCode);

            } catch (err) {
              alert('เกิดข้อผิดพลาดในการทำรายการเลือกคิว: ' + err.message);
              if (btnConfirm) btnConfirm.textContent = 'เลือกเวลานี้';
            }
          }
        });
      });

    } catch (err) {
      console.error(err);
      const searchSection = document.getElementById('search_section');
      if (searchSection) {
        searchSection.classList.remove('hidden');
      }
      resultContainer.innerHTML = `
        <div class="text-center py-8 text-red-500">
          เกิดความผิดพลาดในการค้นหา: ${err.message}
        </div>
      `;
    }
  }
});
