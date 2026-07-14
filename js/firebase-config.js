/**
 * Executive Appointment Manager - Firebase Integration Engine
 * Dynamically resolves Firestore/Auth connection or falls back to robust LocalStorage
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, onSnapshot, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

let firebaseApp = null;
let db = null;
let auth = null;
let provider = null;
let useFirebase = false;

// Attempt dynamic loading of Firebase Configuration
async function initFirebase() {
  try {
    const configResponse = await fetch('/firebase-applet-config.json');
    if (!configResponse.ok) {
      throw new Error('Config file omitted or inaccessible.');
    }
    const firebaseConfig = await configResponse.json();
    
    firebaseApp = initializeApp(firebaseConfig);
    db = firebaseConfig.firestoreDatabaseId 
      ? getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId)
      : getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);
    provider = new GoogleAuthProvider();
    useFirebase = true;
    console.log('🏛️ Firebase Integration initialized successfully.');
    
    // Test collection verification
    const connTest = doc(db, 'test', 'connection');
    getDoc(connTest).catch(() => {});
  } catch (err) {
    console.warn('🏛️ Running in Offline Mode (LocalStorage Engine). Firebase config not present yet.');
    useFirebase = false;
  }
}

// Fire the initializer
export const initPromise = initFirebase();

export { firebaseApp, db, auth, provider, useFirebase };

/**
 * Standardized Firestore Error Handler conforming to system constraints
 */
export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
    },
    operationType,
    path
  };
  console.error('Firestore Error Details: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Robust Database Controller (dbManager) which abstracts Firebase / LocalStorage
 */
export const dbManager = {
  // Local storage mock DB operations
  _getLocalData() {
    let data = localStorage.getItem('executive_appointments');
    if (!data) {
      data = JSON.stringify(this._getInitialMockData());
      localStorage.setItem('executive_appointments', data);
    }
    return JSON.parse(data);
  },

  _saveLocalData(data) {
    localStorage.setItem('executive_appointments', JSON.stringify(data));
  },

  _getInitialMockData() {
    return [
      {
        refCode: 'APT-20260625-M9R7',
        clientName: 'ดร. อนันต์ รุ่งเรืองลาภ',
        clientCompany: 'Siam Synergy Group',
        clientEmail: 'anan@siamsynergy.com',
        clientPhone: '081-456-7890',
        executiveId: 'ceo',
        executiveHost: 'คุณศิรินทร์ รัตน์นภากร (CEO)',
        date: '2026-06-25',
        timeSlot: '10:30 - 11:30',
        purpose: 'หารือเกี่ยวกับยุทธศาสตร์การร่วมทุนกลุ่มบริษัทไตรมาสที่ 3',
        status: 'approved',
        createdAt: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
        adminNotes: 'ได้รับการคอนเฟิร์มจากฝ่ายเลขาซียูเรียบร้อยแล้ว เตรียมเอกสารรายงานส่วนขยายธุรกิจ',
        rescheduledDate: '',
        rescheduledTime: ''
      },
      {
        refCode: 'APT-20260626-H2B4',
        clientName: 'คุณมลฤดี เจริญเกียรติ',
        clientCompany: 'Nexus Dynamic Ventures',
        clientEmail: 'monrudee.j@nexus.co.th',
        clientPhone: '089-987-6543',
        executiveId: 'cto',
        executiveHost: 'ดร. นลิน พิชญเดชา (CTO)',
        date: '2026-06-26',
        timeSlot: '13:30 - 14:30',
        purpose: 'นำเสนอระบบ AI & Enterprise Infrastructure โมเดลที่เพิ่มผลผลิต',
        status: 'pending',
        createdAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
        adminNotes: '',
        rescheduledDate: '',
        rescheduledTime: ''
      },
      {
        refCode: 'APT-20260624-X5Y1',
        clientName: 'คุณภัทรกร พงษ์ศิริเมธา',
        clientCompany: 'Capital Apex Capital',
        clientEmail: 'pattarakorn@capitalapex.com',
        clientPhone: '082-351-8991',
        executiveId: 'cfo',
        executiveHost: 'คุณกิตติธัช เมธาพันธ์ (CFO)',
        date: '2026-06-24',
        timeSlot: '09:00 - 10:00',
        purpose: 'ประชุมวิเคราะห์งบการลงทุนและการลดหย่อนด่านภาษีนำเข้าผลิตภัณฑ์ใหม่',
        status: 'rescheduled',
        createdAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
        adminNotes: 'เลื่อนการประชุมเนื่องจากติดภารกิจประเมินภาษีประจำปีที่กระทรวง',
        rescheduledDate: '2026-06-30',
        rescheduledTime: '15:00 - 16:00'
      }
    ];
  },

  /**
   * Save a new appointment
   */
  async createAppointment(appointment) {
    await initPromise;
    const defaultData = {
      status: 'pending',
      createdAt: new Date().toISOString(),
      adminNotes: '',
      rescheduledDate: '',
      rescheduledTime: '',
      ...appointment
    };

    if (useFirebase && db) {
      try {
        await setDoc(doc(db, 'appointments', defaultData.refCode), defaultData);
        return defaultData;
      } catch (err) {
        handleFirestoreError(err, 'write', `appointments/${defaultData.refCode}`);
      }
    } else {
      const records = this._getLocalData();
      records.unshift(defaultData);
      this._saveLocalData(records);
      return defaultData;
    }
  },

  /**
   * Fetch appointment by its reference code
   */
  async getAppointmentByRef(refCode) {
    await initPromise;
    const rawRef = refCode.trim().toUpperCase();
    if (useFirebase && db) {
      try {
        const docRef = doc(db, 'appointments', rawRef);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          return docSnap.data();
        }
        return null;
      } catch (err) {
        handleFirestoreError(err, 'get', `appointments/${rawRef}`);
      }
    } else {
      const records = this._getLocalData();
      return records.find(item => item.refCode === rawRef) || null;
    }
  },

  /**
   * Updates status, notes, other fields
   */
  async updateAppointment(refCode, updates) {
    await initPromise;
    if (useFirebase && db) {
      try {
        const docRef = doc(db, 'appointments', refCode);
        await updateDoc(docRef, updates);
        return true;
      } catch (err) {
        handleFirestoreError(err, 'update', `appointments/${refCode}`);
      }
    } else {
      const records = this._getLocalData();
      const index = records.findIndex(item => item.refCode === refCode);
      if (index !== -1) {
        records[index] = { ...records[index], ...updates };
        this._saveLocalData(records);
        return true;
      }
      return false;
    }
  },

  /**
   * Fetch all records (for Admin portal)
   */
  async getAllAppointments() {
    await initPromise;
    if (useFirebase && db) {
      try {
        const q = query(collection(db, 'appointments'));
        const querySnapshot = await getDocs(q);
        const list = [];
        querySnapshot.forEach((doc) => {
          list.push(doc.data());
        });
        // Sort newest first
        return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      } catch (err) {
        handleFirestoreError(err, 'list', 'appointments');
      }
    } else {
      const records = this._getLocalData();
      return records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
  },

  /**
   * Subscribe to real-time changes
   */
  subscribeAppointments(callback) {
    if (useFirebase && db) {
      const q = query(collection(db, 'appointments'));
      return onSnapshot(q, (querySnapshot) => {
        const list = [];
        querySnapshot.forEach((doc) => {
          list.push(doc.data());
        });
        const sorted = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        callback(sorted);
      }, (err) => {
        console.error("onSnapshot failed to register or execute:", err);
      });
    } else {
      const runLocal = () => {
        const records = this._getLocalData();
        callback(records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
      };
      runLocal();
      const interval = setInterval(runLocal, 2000);
      return () => {
        clearInterval(interval);
      };
    }
  },

  /**
   * Add a slot allocation to executive_slots
   */
  async addExecutiveSlot(slot) {
    await initPromise;
    if (useFirebase && db) {
      try {
        const docId = `${slot.executive}_${slot.date}_${slot.startTime.replace(':', '')}`;
        await setDoc(doc(db, 'executive_slots', docId), slot);
        return docId;
      } catch (err) {
        handleFirestoreError(err, 'write', `executive_slots`);
      }
    } else {
      let slots = JSON.parse(localStorage.getItem('executive_slots') || '[]');
      const docId = `${slot.executive}_${slot.date}_${slot.startTime.replace(':', '')}`;
      // Remove any existing with same id to simulate setDoc behavior
      slots = slots.filter(s => s.id !== docId);
      slots.push({ id: docId, ...slot });
      localStorage.setItem('executive_slots', JSON.stringify(slots));
      return docId;
    }
  },

  /**
   * Retrieve slot allocations for a specific executive
   */
  async getExecutiveSlots(executiveName) {
    await initPromise;
    if (useFirebase && db) {
      try {
        const q = query(collection(db, 'executive_slots'));
        const querySnapshot = await getDocs(q);
        const list = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.executive === executiveName) {
            list.push({ id: doc.id, ...data });
          }
        });
        return list;
      } catch (err) {
        handleFirestoreError(err, 'list', 'executive_slots');
      }
    } else {
      let slots = JSON.parse(localStorage.getItem('executive_slots') || '[]');
      return slots.filter(s => s.executive === executiveName);
    }
  },

  /**
   * Delete slots in executive_slots for a given appointmentRef
   */
  async deleteExecutiveSlotsForAppointment(appointmentRef) {
    await initPromise;
    if (useFirebase && db) {
      try {
        const q = query(collection(db, 'executive_slots'));
        const querySnapshot = await getDocs(q);
        const deletePromises = [];
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.appointmentRef === appointmentRef) {
            deletePromises.push(deleteDoc(doc(db, 'executive_slots', docSnap.id)));
          }
        });
        await Promise.all(deletePromises);
        return true;
      } catch (err) {
        console.error("Failed to delete executive slots:", err);
        return false;
      }
    } else {
      let slots = JSON.parse(localStorage.getItem('executive_slots') || '[]');
      slots = slots.filter(s => s.appointmentRef !== appointmentRef);
      localStorage.setItem('executive_slots', JSON.stringify(slots));
      return true;
    }
  },

  /**
   * Subscribe to all executive slots in real-time
   */
  subscribeExecutiveSlots(callback) {
    if (useFirebase && db) {
      const q = query(collection(db, 'executive_slots'));
      return onSnapshot(q, (querySnapshot) => {
        const list = [];
        querySnapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() });
        });
        callback(list);
      }, (err) => {
        console.error("onSnapshot failed for executive_slots:", err);
      });
    } else {
      const runLocal = () => {
        const slots = JSON.parse(localStorage.getItem('executive_slots') || '[]');
        callback(slots);
      };
      runLocal();
      const interval = setInterval(runLocal, 2000);
      return () => {
        clearInterval(interval);
      };
    }
  },

  /**
   * Update the status of a specific executive slot
   */
  async updateExecutiveSlotStatus(slotId, status) {
    await initPromise;
    if (useFirebase && db) {
      try {
        const docRef = doc(db, 'executive_slots', slotId);
        await updateDoc(docRef, { status: status });
        return true;
      } catch (err) {
        console.error("Failed to update executive slot status:", err);
        return false;
      }
    } else {
      let slots = JSON.parse(localStorage.getItem('executive_slots') || '[]');
      let updated = false;
      slots = slots.map(s => {
        if (s.id === slotId) {
          updated = true;
          return { ...s, status: status };
        }
        return s;
      });
      localStorage.setItem('executive_slots', JSON.stringify(slots));
      return updated;
    }
  },

  /**
   * Delete expired pending slots or cancelled pending slots for a specific appointment
   */
  async deleteExpiredPendingSlots(appointmentRef) {
    await initPromise;
    if (useFirebase && db) {
      try {
        const q = query(collection(db, 'executive_slots'));
        const querySnapshot = await getDocs(q);
        const deletePromises = [];
        const now = Date.now();
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          let shouldDelete = false;
          if (data.status === 'pending') {
            if (appointmentRef && data.appointmentRef === appointmentRef) {
              shouldDelete = true;
            } else if (data.expiresAt && new Date(data.expiresAt).getTime() < now) {
              shouldDelete = true;
            }
          }
          if (shouldDelete) {
            deletePromises.push(deleteDoc(doc(db, 'executive_slots', docSnap.id)));
          }
        });
        await Promise.all(deletePromises);
        return true;
      } catch (err) {
        console.error("Failed to delete expired pending slots:", err);
        return false;
      }
    } else {
      let slots = JSON.parse(localStorage.getItem('executive_slots') || '[]');
      const now = Date.now();
      slots = slots.filter(s => {
        let shouldDelete = false;
        if (s.status === 'pending') {
          if (appointmentRef && s.appointmentRef === appointmentRef) {
            shouldDelete = true;
          } else if (s.expiresAt && new Date(s.expiresAt).getTime() < now) {
            shouldDelete = true;
          }
        }
        return !shouldDelete;
      });
      localStorage.setItem('executive_slots', JSON.stringify(slots));
      return true;
    }
  },

  /**
   * Fetch custom Google Apps Script Webhook URL
   */
  async getGasWebhookUrl() {
    await initPromise;
    if (useFirebase && db) {
      try {
        const docRef = doc(db, 'settings', 'system_config');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data && data.gasWebhookUrl) {
            return data.gasWebhookUrl;
          }
        }
      } catch (err) {
        console.warn("Failed to fetch webhook URL from Firestore:", err);
      }
    }
    return localStorage.getItem('GAS_WEBHOOK_URL') || 'https://script.google.com/macros/s/AKfycbz_example/exec';
  },

  /**
   * Save custom Google Apps Script Webhook URL
   */
  async setGasWebhookUrl(url) {
    await initPromise;
    localStorage.setItem('GAS_WEBHOOK_URL', url);
    if (useFirebase && db) {
      try {
        const docRef = doc(db, 'settings', 'system_config');
        await setDoc(docRef, { gasWebhookUrl: url }, { merge: true });
        return true;
      } catch (err) {
        console.error("Failed to save webhook URL to Firestore:", err);
        return false;
      }
    }
    return true;
  },

  /**
   * Fetch Webhook URL separated by adminOwner ('admin1' or 'admin2')
   */
  async getWebhookUrlByAdmin(adminOwner) {
    await initPromise;
    if (useFirebase && db) {
      try {
        const docRef = doc(db, 'settings', adminOwner);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data && data.webhookUrl) {
            return data.webhookUrl;
          }
        }
      } catch (err) {
        console.warn(`Failed to fetch webhook URL for ${adminOwner} from Firestore:`, err);
      }
    }
    return localStorage.getItem(`GAS_WEBHOOK_URL_${adminOwner}`) || '';
  },

  /**
   * Fetch Admin Email separated by adminOwner ('admin1' or 'admin2')
   */
  async getAdminEmailByAdmin(adminOwner) {
    await initPromise;
    if (useFirebase && db) {
      try {
        const docRef = doc(db, 'settings', adminOwner);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data && data.adminEmail) {
            return data.adminEmail;
          }
        }
      } catch (err) {
        console.warn(`Failed to fetch admin email for ${adminOwner} from Firestore:`, err);
      }
    }
    if (adminOwner === 'admin1') return 'putcharawun.k@bu.ac.th';
    if (adminOwner === 'admin2') return 'pimapsorn.s@bu.ac.th';
    return '';
  },

  /**
   * Save Webhook URL and Admin Email for a specific adminOwner
   */
  async setAdminSettings(adminOwner, webhookUrl, adminEmail) {
    await initPromise;
    if (webhookUrl !== undefined) {
      localStorage.setItem(`GAS_WEBHOOK_URL_${adminOwner}`, webhookUrl);
    }
    if (useFirebase && db) {
      try {
        const docRef = doc(db, 'settings', adminOwner);
        const updateData = {};
        if (webhookUrl !== undefined) updateData.webhookUrl = webhookUrl;
        if (adminEmail !== undefined) updateData.adminEmail = adminEmail;
        await setDoc(docRef, updateData, { merge: true });
        return true;
      } catch (err) {
        console.error(`Failed to save admin settings for ${adminOwner} to Firestore:`, err);
        return false;
      }
    }
    return true;
  },

  /**
   * Appends an event to the appointment's timeline
   */
  async appendTimelineEvent(refCode, event) {
    await initPromise;
    if (useFirebase && db) {
      try {
        const docRef = doc(db, 'appointments', refCode);
        await updateDoc(docRef, {
          timeline: arrayUnion(event)
        });
        return true;
      } catch (err) {
        handleFirestoreError(err, 'update', `appointments/${refCode}`);
      }
    } else {
      const records = this._getLocalData();
      const index = records.findIndex(item => item.refCode === refCode);
      if (index !== -1) {
        if (!records[index].timeline) {
          records[index].timeline = [];
        }
        records[index].timeline.push(event);
        this._saveLocalData(records);
        return true;
      }
      return false;
    }
  },

  /**
   * Clears all appointment and slot data (both Firebase and LocalStorage)
   */
  async clearAllData() {
    await initPromise;
    if (useFirebase && db) {
      try {
        const appQuery = query(collection(db, 'appointments'));
        const appSnapshot = await getDocs(appQuery);
        const appDeletes = [];
        appSnapshot.forEach((docSnap) => {
          appDeletes.push(deleteDoc(doc(db, 'appointments', docSnap.id)));
        });
        await Promise.all(appDeletes);

        const slotQuery = query(collection(db, 'executive_slots'));
        const slotSnapshot = await getDocs(slotQuery);
        const slotDeletes = [];
        slotSnapshot.forEach((docSnap) => {
          slotDeletes.push(deleteDoc(doc(db, 'executive_slots', docSnap.id)));
        });
        await Promise.all(slotDeletes);
      } catch (err) {
        handleFirestoreError(err, 'write', 'clearAllData');
      }
    }
    
    localStorage.removeItem('executive_appointments');
    localStorage.removeItem('executive_slots');
    return true;
  }
};
