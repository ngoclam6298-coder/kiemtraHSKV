/**
 * CÔNG TY ĐIỆN LỰC VŨNG TÀU - TỔNG CÔNG TY ĐIỆN LỰC TP. HỒ CHÍ MINH (EVNHCMC)
 * HỆ THỐNG KIỆN TOÀN HỆ THỐNG ĐO ĐẾM - PC VŨNG TÀU
 * File: js/kienthoan.js
 * Quản lý toàn bộ 221.038 khách hàng và 1.698 trạm biến áp từ Google Sheet
 */

(function() {
  'use strict';

  // --- Constants & Storage Keys ---
  const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1unVxNXZkTO_ps_HqlNIOnP05FIbU9DT4/edit?gid=1392868293#gid=1392868293';
  const STORAGE_KEY_INSPECTIONS = 'PCVT_KT_INSPECTIONS_V2';
  const STORAGE_KEY_SHEET_URL = 'PCVT_KT_SHEET_URL_V2';
  const STORAGE_KEY_INSPECTOR = 'PCVT_CURRENT_INSPECTOR';
  const STORAGE_KEY_WEBHOOK_URL = 'PCVT_APPS_SCRIPT_URL';
  const DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbzMEYBk19BLUyew0FBjnmKWpcP-jVBevIesaxRYowMY9mqUzgWfu45Ylk3TO6rXbCm7MQ/exec';
  const STORAGE_KEY_OFFLINE_QUEUE = 'PCVT_OFFLINE_QUEUE';
  const STORAGE_KEY_LIVE_SYNC_ENABLED = 'PCVT_LIVE_SYNC_ENABLED';
  const STORAGE_KEY_SOUND_ENABLED = 'PCVT_SOUND_ENABLED';
  const STORAGE_KEY_STATION_ASSIGNMENTS = 'PCVT_STATION_ASSIGNMENTS_V1';
  const STORAGE_KEY_SIDEBAR_OPEN = 'PCVT_SIDEBAR_OPEN';
  const STORAGE_KEY_INCOMPLETE_WARN = 'PCVT_INCOMPLETE_WARN_ENABLED';
  const LIVE_SYNC_POLL_INTERVAL = 15000; // Quét tự động mỗi 15 giây
  
  // IndexedDB Constants for Customer Database (210.123 customers)
  const DATASET_VERSION = '20260914_SONO_NODOT';
  const STORAGE_KEY_DATASET_VER = 'PCVT_DATASET_VERSION';
  const STORAGE_KEY_CUSTOM_METER_NO = 'PCVT_CUSTOM_METER_NO';
  const IDB_NAME = 'PCVT_KIENTHOAN_FULL_DB_V2';
  const IDB_VERSION = 2;
  const IDB_STORE_CHUNKS = 'customer_chunks';
  const CHUNK_SIZE = 10000;

  // --- Multi-tab / Realtime Broadcast Channel ---
  let syncChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      syncChannel = new BroadcastChannel('PCVT_KIENTHOAN_SYNC_CHANNEL');
      syncChannel.onmessage = (event) => {
        handleSyncMessage(event.data);
      };
    }
  } catch (e) {
    console.warn('BroadcastChannel not supported:', e);
  }

  // --- State ---
  let allCustomers = [];           // In-memory array of all 221.038 customers
  let stationsMeta = {};           // Map: id_tram -> { id, name, khu_vuc, count }
  let inspectionsMap = {};         // Map: ma_kh -> { trang_thai, ngay_kiem_tra, ghi_chu, hinh_anh, nguoi_cap_nhat }
  let filteredCustomers = [];      // Filtered list
  let currentStationFilter = '';   // Selected station ID
  let currentAreaFilter = '';      // Selected Area
  let currentConditionFilter = ''; // Selected condition filter (Hiện trạng đo đếm 12 mục)
  let currentAssignedGroupFilter = ''; // '' | 'unassigned' | 'group_1' ... 'group_9'
  let currentStatusFilter = 'all'; // 'all' | 'pending' | 'completed'
  let currentSearchKeyword = '';   // Free text search
  let currentPage = 1;
  const pageSize = 40;             // 40 items per page for ultra fast rendering
  let activeViewMode = 'auto';     // 'auto' | 'cards' | 'table'

  // --- Station Assignment State (Giao việc theo ID trạm) ---
  let stationAssignments = {};     // Map: stationId -> { groupId, groupIndex, groupName, leader, fullName, assignedAt }
  let selectedAssignStations = new Set(); // Station IDs currently selected in Assignment Modal
  let currentAssignModalFilter = 'all';   // 'all' | 'assigned' | 'unassigned'
  let currentAssignModalSearch = '';

  // --- Real-time Field Sync State (Giám sát hiện trường thời gian thực) ---
  let liveSyncTimer = null;
  let isLiveSyncRunning = true;
  let isSoundAlertEnabled = true;
  let liveActivityLog = [];        // Dòng thời gian các KH vừa kiểm tra ngoài hiện trường
  let lastLivePollTimestamp = 0;   // Dấu thời gian quét gần nhất

  // --- 9 Nhóm công tác kiểm tra hệ thống đo đếm (PC Vũng Tàu) chuẩn theo ảnh mẫu ---
  const PRESET_WORKGROUPS = [
    {
      id: 'group_1',
      index: 1,
      name: 'Nguyễn Xuân Thắng + Phạm Duy Phương',
      leader: 'Nguyễn Xuân Thắng',
      shortName: 'Thắng + Phương',
      fullName: 'Nguyễn Xuân Thắng + Phạm Duy Phương (Trưởng nhóm: Nguyễn Xuân Thắng)'
    },
    {
      id: 'group_2',
      index: 2,
      name: 'Nguyễn Thế Viện + Nguyễn Kim Linh',
      leader: 'Nguyễn Thế Viện',
      shortName: 'Viện + Linh',
      fullName: 'Nguyễn Thế Viện + Nguyễn Kim Linh (Trưởng nhóm: Nguyễn Thế Viện)'
    },
    {
      id: 'group_3',
      index: 3,
      name: 'Nguyễn Đức Thành + Lê Gia Quốc Trung',
      leader: 'Nguyễn Đức Thành',
      shortName: 'Thành + Trung',
      fullName: 'Nguyễn Đức Thành + Lê Gia Quốc Trung (Trưởng nhóm: Nguyễn Đức Thành)'
    },
    {
      id: 'group_4',
      index: 4,
      name: 'Lưu Quang Tuấn + Lê Gia Quốc Trung',
      leader: 'Lưu Quang Tuấn',
      shortName: 'Tuấn + Trung',
      fullName: 'Lưu Quang Tuấn + Lê Gia Quốc Trung (Trưởng nhóm: Lưu Quang Tuấn)'
    },
    {
      id: 'group_5',
      index: 5,
      name: 'Nguyễn Ngọc Kỳ + Huỳnh Tấn Phát',
      leader: 'Nguyễn Ngọc Kỳ',
      shortName: 'Kỳ + Phát',
      fullName: 'Nguyễn Ngọc Kỳ + Huỳnh Tấn Phát (Trưởng nhóm: Nguyễn Ngọc Kỳ)'
    },
    {
      id: 'group_6',
      index: 6,
      name: 'Nguyễn Trọng Hải + Nguyễn văn Thành',
      leader: 'Nguyễn Trọng Hải',
      shortName: 'Hải + Thành',
      fullName: 'Nguyễn Trọng Hải + Nguyễn văn Thành (Trưởng nhóm: Nguyễn Trọng Hải)'
    },
    {
      id: 'group_7',
      index: 7,
      name: 'Nguyễn Đức Thành + Nguyễn Văn Nguyên',
      leader: 'Nguyễn Đức Thành',
      shortName: 'Thành + Nguyên',
      fullName: 'Nguyễn Đức Thành + Nguyễn Văn Nguyên (Trưởng nhóm: Nguyễn Đức Thành)'
    },
    {
      id: 'group_8',
      index: 8,
      name: 'Nguyễn Văn Nguyên + Lê Phúc Hậu',
      leader: 'Nguyễn văn Nguyên',
      shortName: 'Nguyên + Hậu',
      fullName: 'Nguyễn Văn Nguyên + Lê Phúc Hậu (Trưởng nhóm: Nguyễn văn Nguyên)'
    },
    {
      id: 'group_9',
      index: 9,
      name: 'Nguyễn Hữu Mến + Lê Phúc Hậu',
      leader: 'Nguyễn Hữu Mến',
      shortName: 'Mến + Hậu',
      fullName: 'Nguyễn Hữu Mến + Lê Phúc Hậu (Trưởng nhóm: Nguyễn Hữu Mến)'
    }
  ];

  const PRESET_INSPECTORS = PRESET_WORKGROUPS.map(g => g.fullName);

  function isPresetInspector(val) {
    if (!val) return false;
    const str = String(val).trim().toLowerCase();
    return PRESET_WORKGROUPS.some(g => 
      g.fullName.toLowerCase() === str || 
      g.name.toLowerCase() === str || 
      str.includes(g.name.toLowerCase())
    );
  }

  function getInspectorPresetValue(val) {
    if (!val) return '';
    const str = String(val).trim().toLowerCase();
    for (const g of PRESET_WORKGROUPS) {
      if (g.fullName.toLowerCase() === str || g.name.toLowerCase() === str || str.includes(g.name.toLowerCase())) {
        return g.fullName;
      }
    }
    return '__custom__';
  }

  function isWorkgroupOrInspectorName(val) {
    if (!val) return false;
    const str = String(val).trim().toLowerCase();
    if (!str) return false;

    // 1. Khớp chính xác hoặc chứa tên/tên rút gọn/trưởng nhóm của 9 nhóm
    for (const g of PRESET_WORKGROUPS) {
      if (str === g.fullName.toLowerCase() || 
          str === g.name.toLowerCase() || 
          str === g.shortName.toLowerCase() ||
          str === g.leader.toLowerCase() ||
          str.includes(g.name.toLowerCase()) ||
          (g.shortName && str.includes(g.shortName.toLowerCase()))) {
        return true;
      }
    }

    // 2. Tiền tố nhóm hoặc trưởng nhóm
    if (/^nhóm\s*\d+/i.test(str)) return true;
    if (/^trưởng\s*nhóm/i.test(str)) return true;

    // 3. Tên các thành viên trong tổ kiểm tra hiện trường
    const workerNames = [
      'nguyễn hữu mến', 'lê phúc hậu', 'nguyễn xuân thắng', 'mai huỳnh long',
      'vũ đức thành', 'nguyễn văn toàn', 'bùi đức vinh', 'nguyễn văn bảy',
      'hồ tấn đạt', 'nguyễn trọng hiếu', 'võ minh tiên', 'huỳnh hữu nghĩa',
      'nguyễn thanh tùng', 'nguyễn văn bình', 'nguyễn văn nguyên', 'nguyễn văn đạt',
      'nguyễn hữu đức', 'nguyễn thanh điền', 'nguyễn văn thọ'
    ];
    return workerNames.some(w => str.includes(w));
  }

  // --- 12 Hiện trạng hệ thống đo đếm chuẩn (PC Vũng Tàu) ---
  const PRESET_CONDITIONS = [
    'Hoạt động bình thường',
    'Hoạt động bình thường ( nhưng không có chì niêm)',
    'Cài đặt sai hệ số nhân',
    'Điện kế quá hạn kiểm định',
    'Điện kế mờ, đen màn hình',
    'Đã cô lập hoặc đã thu hồi',
    'Bị lỏng dây trên hệ thống đo đếm',
    'Mất dòng, mất áp',
    'Thùng điện kế, CB,... bị mục đáy, khe hở lớn, ....',
    'Sai giờ thực tế',
    'Điện kế hư, hỏng',
    'Không kiểm tra được do nhiều lý do (khóa cửa, kh vắng nhà, ...)'
  ];
  const PRESET_NOTES = PRESET_CONDITIONS; // Alias tương thích ngược

  // ==========================================================================
  // NUMBER NORMALIZATION (SỐ NO CỐ ĐỊNH - VIẾT LIỀN KHÔNG CÓ DẤU CHẤM)
  // ==========================================================================
  function formatMeterNo(val) {
    if (val === null || val === undefined) return '';
    let s = String(val).trim();
    if (!s || s === 'null' || s === 'undefined' || s === '---') return '';
    // Làm sạch phần đuôi ,00 hoặc .00 hoặc ,0 thừa do định dạng số thập phân
    s = s.replace(/,\d+$/, '').replace(/\.\d+$/, '');
    // Xử lý ký hiệu khoa học nếu có (vd: 2.21E+14)
    if (/[eE]/.test(s)) {
      try {
        const normalized = s.replace(',', '.');
        const num = Number(normalized);
        if (!isNaN(num) && isFinite(num)) {
          s = BigInt(Math.round(num)).toString();
        }
      } catch (e) {
        console.warn('formatMeterNo scientific parse error:', e);
      }
    }
    // Viết sát không có dấu chấm, dấu phẩy hay khoảng trắng
    s = s.replace(/[.,\s]/g, '');
    return s;
  }

  // ==========================================================================
  // SỐ NO LÀ CỐ ĐỊNH (KHÔNG SỬA TAY, DÙNG NGUỒN DỮ LIỆU GỐC CHUẨN)
  // ==========================================================================
  let customMeterNoMap = {};

  function loadCustomMeterNos() {
    try {
      localStorage.removeItem(STORAGE_KEY_CUSTOM_METER_NO);
    } catch (e) {}
    customMeterNoMap = {};
  }

  function saveCustomMeterNos() {
    // Không ghi đè số No
  }

  // ==========================================================================
  // INSPECTOR & SYNC HELPERS
  // ==========================================================================
  function getCurrentInspector() {
    return (localStorage.getItem(STORAGE_KEY_INSPECTOR) || '').trim();
  }

  function setCurrentInspector(name) {
    const trimmed = (name || '').trim();
    localStorage.setItem(STORAGE_KEY_INSPECTOR, trimmed);

    const sel = document.getElementById('selectInspectorPreset');
    const input = document.getElementById('inputInspectorName');
    const btn = document.getElementById('btnSaveInspector');

    const isPreset = isPresetInspector(trimmed);
    const presetVal = getInspectorPresetValue(trimmed);

    if (sel) {
      if (isPreset) {
        sel.value = presetVal;
      } else if (trimmed) {
        sel.value = '__custom__';
      } else {
        sel.value = '';
      }
    }

    if (input) {
      input.value = trimmed;
      if (!isPreset && trimmed) {
        input.style.display = 'block';
      } else if (sel && sel.value === '__custom__') {
        input.style.display = 'block';
      } else {
        input.style.display = 'none';
      }
    }

    if (btn) {
      btn.style.display = (input && input.style.display === 'block') ? 'inline-flex' : 'none';
    }

    return trimmed;
  }

  function getWebhookUrl() {
    let url = (localStorage.getItem(STORAGE_KEY_WEBHOOK_URL) || '').trim();
    if (!url) {
      url = DEFAULT_WEBHOOK_URL;
      localStorage.setItem(STORAGE_KEY_WEBHOOK_URL, url);
    }
    return url;
  }

  function updateSyncStatus(status, text, subText) {
    const statusEl = document.getElementById('syncRealtimeStatus');
    const textEl = document.getElementById('syncRealtimeText');
    const subEl = document.getElementById('syncRealtimeSub');

    if (statusEl) {
      statusEl.className = `sync-realtime-status ${status}`;
    }
    if (textEl && text) {
      textEl.textContent = text;
    }
    if (subEl && subText) {
      subEl.textContent = subText;
    }
  }

  function getOfflineQueue() {
    try {
      const q = localStorage.getItem(STORAGE_KEY_OFFLINE_QUEUE);
      return q ? JSON.parse(q) : [];
    } catch (e) {
      return [];
    }
  }

  function saveOfflineQueue(queue) {
    try {
      localStorage.setItem(STORAGE_KEY_OFFLINE_QUEUE, JSON.stringify(queue));
    } catch (e) {}
  }

  function enqueueOffline(item) {
    const queue = getOfflineQueue();
    const idx = queue.findIndex(q => q.ma_kh === item.ma_kh);
    if (idx >= 0) {
      queue[idx] = item;
    } else {
      queue.push(item);
    }
    saveOfflineQueue(queue);
  }

  async function processOfflineQueue() {
    const queue = getOfflineQueue();
    if (queue.length === 0) return;

    const webhookUrl = getWebhookUrl();
    if (!webhookUrl || !navigator.onLine) return;

    updateSyncStatus('syncing', `Đang đồng bộ ${queue.length} bản ghi...`, 'Tự động gửi cập nhật ngoại tuyến lên Google Sheet');

    const remaining = [];
    for (const item of queue) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
      } catch (err) {
        remaining.push(item);
      }
    }

    saveOfflineQueue(remaining);
    if (remaining.length === 0) {
      updateSyncStatus('synced', '🟢 Đã đồng bộ tất cả lên Google Sheet', 'Mọi dữ liệu đã được cập nhật trực tuyến');
      showToast('Đã đồng bộ toàn bộ dữ liệu ngoại tuyến lên Google Sheet!', 'success');
    } else {
      updateSyncStatus('offline', `Còn ${remaining.length} bản ghi chờ mạng`, 'Sẽ tự động gửi khi kết nối mạng ổn định');
    }
  }

  // --- Photo DOM Updating Helper ---
  function updatePhotoCellInDOM(ma_kh, photoUrl) {
    const cleanMaKh = String(ma_kh || '').trim();
    if (!cleanMaKh) return;

    const deskCell = document.getElementById(`photo-cell-${cleanMaKh}`);
    if (deskCell) {
      if (photoUrl) {
        deskCell.innerHTML = `
          <div class="photo-box">
            <div class="photo-preview-wrap" onclick="window.PCVT.viewPhoto('${escapeHTML(cleanMaKh)}')">
              <img src="${photoUrl}" class="photo-thumbnail" alt="Ảnh HTĐĐ">
              <button type="button" class="btn-remove-photo" onclick="event.stopPropagation(); window.PCVT.removePhoto('${escapeHTML(cleanMaKh)}')" title="Xóa ảnh">✕</button>
            </div>
          </div>
        `;
      } else {
        deskCell.innerHTML = `
          <div class="photo-box">
            <label class="btn-upload-photo" title="Tải ảnh hoặc chụp từ camera">
              <input type="file" accept="image/*" capture="environment" style="display:none" onchange="window.PCVT.handlePhotoUpload(this, '${escapeHTML(cleanMaKh)}')">
              📷 Thêm ảnh
            </label>
          </div>
        `;
      }
    }

    const mobCell = document.getElementById(`mphoto-cell-${cleanMaKh}`);
    if (mobCell) {
      if (photoUrl) {
        mobCell.innerHTML = `
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <div class="photo-preview-wrap" onclick="window.PCVT.viewPhoto('${escapeHTML(cleanMaKh)}')">
              <img src="${photoUrl}" style="width:54px; height:54px; border-radius:8px; object-fit:cover; border:1px solid #cbd5e1;" alt="Ảnh công tơ">
            </div>
            <div style="display:flex; flex-direction:column; gap:4px;">
              <span style="font-size:0.75rem; color:#059669; font-weight:700;">✅ Đã chụp ảnh</span>
              <button type="button" style="background:#fee2e2; color:#dc2626; border:none; padding:3px 8px; border-radius:4px; font-size:0.75rem; font-weight:600; cursor:pointer;" onclick="window.PCVT.removePhoto('${escapeHTML(cleanMaKh)}')">✕ Xóa ảnh</button>
            </div>
          </div>
          <button type="button" class="btn-row-save" style="min-height:42px; padding:0 1rem; border-radius:8px;" onclick="window.PCVT.saveRow('${escapeHTML(cleanMaKh)}')">
            💾 Lưu
          </button>
        `;
      } else {
        mobCell.innerHTML = `
          <label class="btn-mobile-camera">
            <input type="file" accept="image/*" capture="environment" style="display:none" onchange="window.PCVT.handlePhotoUpload(this, '${escapeHTML(cleanMaKh)}')">
            📷 Chụp ảnh công tơ
          </label>
          <button type="button" class="btn-row-save" style="min-height:42px; padding:0 1rem; border-radius:8px;" onclick="window.PCVT.saveRow('${escapeHTML(cleanMaKh)}')">
            💾 Lưu
          </button>
        `;
      }
    }
  }

  function autoSyncLocalPhotos() {
    const webhookUrl = getWebhookUrl();
    if (!webhookUrl || !navigator.onLine) return;

    const list = Object.keys(inspectionsMap).filter(m => {
      const it = inspectionsMap[m];
      return it && it.hinh_anh && it.hinh_anh.startsWith('data:image');
    });

    if (list.length === 0) return;
    console.log(`[Photo Sync] Tìm thấy ${list.length} ảnh hiện trường trên máy cần đồng bộ...`);

    let i = 0;
    const interval = setInterval(() => {
      if (i < list.length) {
        syncItemImmediately(list[i]);
        i++;
      } else {
        clearInterval(interval);
      }
    }, 400);
  }

  function syncItemImmediately(ma_kh) {
    const custObj = allCustomers.find(c => c.ma_kh === ma_kh);
    const insp = inspectionsMap[ma_kh] || {};
    const currentInsp = getCurrentInspector();
    const isCompleted = (insp.trang_thai === 'Đã kiểm tra');

    // 1. Instant local persistence
    if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};
    if (isWorkgroupOrInspectorName(inspectionsMap[ma_kh].ghi_chu)) {
      if (!inspectionsMap[ma_kh].nguoi_cap_nhat) inspectionsMap[ma_kh].nguoi_cap_nhat = inspectionsMap[ma_kh].ghi_chu;
      inspectionsMap[ma_kh].ghi_chu = '';
    }
    inspectionsMap[ma_kh].localUpdatedAt = Date.now();
    saveLocalInspections();

    // 2. Broadcast to other open tabs
    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'sync_customer',
          ma_kh: ma_kh,
          inspection: inspectionsMap[ma_kh],
          so_no: custObj ? custObj.so_no : undefined
        });
      } catch (e) {}
    }

    // 3. Webhook Real-time Sync to Google Sheet
    const webhookUrl = getWebhookUrl();
    const itemStation = (custObj && (custObj.id_tram || custObj.ma_tram)) || '';
    const itemStationName = (custObj && custObj.ten_tram) || (stationsMeta[itemStation] && stationsMeta[itemStation].name) || '';
    const itemDanhSo = (custObj && custObj.danh_so) || '';

    const itemPayload = {
      action: 'update_customer',
      ma_kh: ma_kh,
      id_tram: itemStation,
      ten_tram: itemStationName,
      danh_so: itemDanhSo,
      so_no: custObj ? (custObj.so_no || '') : '',
      nguoi_cap_nhat: insp.nguoi_cap_nhat || currentInsp || '',
      trang_thai: insp.trang_thai || 'Chưa kiểm tra',
      trang_thai_x: isCompleted ? 'X' : '',
      ngay_kiem_tra: insp.ngay_kiem_tra || '',
      ghi_chu: insp.ghi_chu || '',
      hinh_anh: insp.hinh_anh || '',
      timestamp: Date.now()
    };

    if (!navigator.onLine) {
      enqueueOffline(itemPayload);
      updateSyncStatus('offline', '💾 Đã lưu trên máy (Ngoại tuyến)', 'Tự động đồng bộ ngay khi có mạng Internet');
      return;
    }

    if (webhookUrl) {
      updateSyncStatus('syncing', '🔄 Đang đồng bộ lên Google Sheet...', 'Đang gửi cập nhật thời gian thực');
      fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemPayload)
      }).then(() => {
        updateSyncStatus('synced', '🟢 Đã đồng bộ ngay lên Google Sheet', 'Đã lưu trên máy và cập nhật Google Sheet thành công');
      }).catch((err) => {
        console.warn('Webhook sync error:', err);
        enqueueOffline(itemPayload);
        updateSyncStatus('offline', '💾 Đã lưu trên máy (Chờ gửi)', 'Sẽ tự động đồng bộ khi kết nối mạng ổn định');
      });
    } else {
      updateSyncStatus('warning', '💾 Đã lưu trên máy này', 'Dùng nút "Gộp Đa Thiết Bị" hoặc cài Webhook để gửi sang máy khác');
    }
  }

  function handleSyncMessage(data) {
    if (data && data.type === 'sync_customer' && data.ma_kh) {
      inspectionsMap[data.ma_kh] = data.inspection;
      const photoUrl = (data.inspection && data.inspection.hinh_anh) || '';
      updatePhotoCellInDOM(data.ma_kh, photoUrl);
      if (data.so_no !== undefined) {
        customMeterNoMap[data.ma_kh] = data.so_no;
        saveCustomMeterNos();
        const cObj = allCustomers.find(c => c.ma_kh === data.ma_kh);
        if (cObj) cObj.so_no = data.so_no;
        const bDesk = document.getElementById(`meter-val-${data.ma_kh}`);
        if (bDesk) bDesk.textContent = data.so_no || '---';
        const bMobHead = document.getElementById(`m-header-meter-${data.ma_kh}`);
        if (bMobHead) bMobHead.textContent = data.so_no || '---';
        const bMobVal = document.getElementById(`m-meter-val-${data.ma_kh}`);
        if (bMobVal) bMobVal.textContent = data.so_no || 'Chưa có số No';
      }
      renderKPIs();
      renderStationBanner();
      renderMobileStickyBar();

      const isCompleted = data.inspection && data.inspection.trang_thai === 'Đã kiểm tra';
      const upVal = (data.inspection && data.inspection.nguoi_cap_nhat) || '';
      const isPreset = isPresetInspector(upVal);
      const selVal = isPreset ? getInspectorPresetValue(upVal) : (upVal ? '__custom__' : '');

      const row = document.getElementById(`row-${data.ma_kh}`);
      if (row) {
        if (isCompleted) {
          row.classList.add('row-completed');
          const stEl = row.querySelector('.col-status');
          if (stEl) stEl.innerHTML = '<span class="badge-status completed">✅ Đã kiểm tra</span>';
          const chk = row.querySelector('.custom-checkbox input');
          if (chk) chk.checked = true;
        } else {
          row.classList.remove('row-completed');
          const stEl = row.querySelector('.col-status');
          if (stEl) stEl.innerHTML = '<span class="badge-status pending">⏳ Chưa kiểm tra</span>';
          const chk = row.querySelector('.custom-checkbox input');
          if (chk) chk.checked = false;
        }
        const noteInput = document.getElementById(`note-${data.ma_kh}`);
        const noteVal = (data.inspection && data.inspection.ghi_chu) || '';
        if (noteInput && data.inspection) noteInput.value = noteVal;

        // Đồng bộ thanh xổ chọn hiện trạng trên bảng
        const isPresetCond = PRESET_CONDITIONS.includes(noteVal);
        const selCondVal = isPresetCond ? noteVal : (noteVal ? '__custom__' : '');
        const selCond = document.getElementById(`sel-cond-${data.ma_kh}`);
        if (selCond) selCond.value = selCondVal;

        // Đồng bộ các ô tick chọn hiện trạng trên bảng
        PRESET_CONDITIONS.forEach((cond, cIdx) => {
          const isTicked = noteVal.includes(cond);
          const chk = document.getElementById(`chk-cond-d-${data.ma_kh}-${cIdx}`);
          if (chk) {
            chk.checked = isTicked;
            if (chk.parentElement) chk.parentElement.classList.toggle('active', isTicked);
          }
        });

        const selUp = document.getElementById(`sel-updater-${data.ma_kh}`);
        const upInput = document.getElementById(`updater-${data.ma_kh}`);
        if (selUp) selUp.value = selVal;
        if (upInput) {
          upInput.value = upVal;
          upInput.style.display = (!isPreset && upVal) ? 'block' : 'none';
        }
      }

      const card = document.getElementById(`mcard-${data.ma_kh}`);
      if (card) {
        const mstatus = document.getElementById(`mstatus-${data.ma_kh}`);
        const mbtn = document.getElementById(`mbtn-toggle-${data.ma_kh}`);
        const mnote = document.getElementById(`mnote-${data.ma_kh}`);
        const mselUp = document.getElementById(`msel-updater-${data.ma_kh}`);
        const mupdater = document.getElementById(`mupdater-${data.ma_kh}`);
        if (isCompleted) {
          card.classList.add('card-completed');
          if (mstatus) mstatus.innerHTML = '<span class="badge-status completed">✅ Đã kiểm tra</span>';
          if (mbtn) {
            mbtn.className = 'btn-mobile-status-toggle completed';
            mbtn.innerHTML = '✅ ĐÃ HOÀN THÀNH KIỂM TRA';
          }
        } else {
          card.classList.remove('card-completed');
          if (mstatus) mstatus.innerHTML = '<span class="badge-status pending">⏳ Chưa kiểm tra</span>';
          if (mbtn) {
            mbtn.className = 'btn-mobile-status-toggle';
            mbtn.innerHTML = '🔘 CHẠM ĐỂ ĐÁNH DẤU HOÀN THÀNH';
          }
        }
        const noteVal = (data.inspection && data.inspection.ghi_chu) || '';
        if (mnote && data.inspection) mnote.value = noteVal;

        // Đồng bộ thanh xổ chọn hiện trạng trên thẻ di động
        const isPresetCond = PRESET_CONDITIONS.includes(noteVal);
        const selCondVal = isPresetCond ? noteVal : (noteVal ? '__custom__' : '');
        const mselCond = document.getElementById(`msel-cond-${data.ma_kh}`);
        if (mselCond) mselCond.value = selCondVal;

        // Đồng bộ các ô tick chọn hiện trạng trên thẻ di động
        PRESET_CONDITIONS.forEach((cond, cIdx) => {
          const isTicked = noteVal.includes(cond);
          const chk = document.getElementById(`chk-cond-m-${data.ma_kh}-${cIdx}`);
          if (chk) {
            chk.checked = isTicked;
            if (chk.parentElement) chk.parentElement.classList.toggle('active', isTicked);
          }
        });

        if (mselUp) mselUp.value = selVal;
        if (mupdater) {
          mupdater.value = upVal;
          mupdater.style.display = (!isPreset && upVal) ? 'block' : 'none';
        }
      }
    } else if (data && data.type === 'sync_station_assignments' && data.assignments) {
      stationAssignments = data.assignments;
      saveStationAssignments();
      renderSidebarWorkgroups();
      updateGroupFilterUI();
      updateFilterWorkgroupDropdown();
      const assignModal = document.getElementById('modalStationAssignment');
      if (assignModal && assignModal.classList.contains('active')) {
        renderStationAssignmentModalTable();
      }
      renderDataList();
    }
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  document.addEventListener('DOMContentLoaded', async () => {
    loadLocalInspections();
    loadCustomMeterNos();

    // Tự động nhận link cấu hình Webhook từ URL (chia sẻ từ máy tính qua Zalo sang điện thoại)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const webhookParam = urlParams.get('webhook');
      if (webhookParam) {
        const decodedWebhook = decodeURIComponent(webhookParam).trim();
        if (decodedWebhook.startsWith('http')) {
          localStorage.setItem(STORAGE_KEY_WEBHOOK_URL, decodedWebhook);
          const inputWebhook = document.getElementById('inputAppsScriptUrl');
          if (inputWebhook) inputWebhook.value = decodedWebhook;
          setTimeout(() => {
            showToast('✅ Đã tự động kết nối Webhook Google Sheet cho thiết bị này!', 'success');
          }, 800);
        }
      }
    } catch (e) {
      console.warn('URL params parsing notice:', e);
    }

    initEventListeners();
    loadStationAssignments();
    await loadInitialData();
    renderSidebarWorkgroups();
    updateFilterWorkgroupDropdown();

    // Setup YouTube sidebar responsive state
    const isDesktop = window.innerWidth >= 1200;
    const savedSidebarOpen = localStorage.getItem(STORAGE_KEY_SIDEBAR_OPEN);
    if (isDesktop) {
      if (savedSidebarOpen === '0') {
        document.body.classList.add('sidebar-collapsed');
      } else {
        document.body.classList.add('sidebar-open');
      }
    }

    // Init inspector name
    const savedInspector = getCurrentInspector();
    if (savedInspector) {
      setCurrentInspector(savedInspector);
    }

    // Init Webhook URL
    const savedWebhook = getWebhookUrl();
    const inputWebhook = document.getElementById('inputAppsScriptUrl');
    if (inputWebhook && savedWebhook) {
      inputWebhook.value = savedWebhook;
    }

    // Check online status and process offline queue
    window.addEventListener('online', () => {
      showToast('Đã kết nối Internet trở lại, đang đồng bộ dữ liệu...', 'info');
      processOfflineQueue();
      autoSyncLocalPhotos();
    });

    window.addEventListener('offline', () => {
      updateSyncStatus('offline', '💾 Đang hoạt động ngoại tuyến', 'Mọi thao tác vẫn được lưu an toàn trên máy');
    });

    if (savedWebhook) {
      updateSyncStatus('synced', '🟢 Đã kết nối Google Sheet Webhook', 'Cập nhật tức thì giữa các thiết bị qua Cloud');
    } else {
      updateSyncStatus('warning', '💾 Đang lưu trên máy này (Chưa gửi Sheet)', 'Dùng nút "Gộp Đa Thiết Bị" hoặc cài Webhook để đồng bộ');
    }

    if (navigator.onLine) {
      processOfflineQueue();
      autoSyncLocalPhotos();
    }

    // Init Live Field Sync Monitor (Đồng bộ thời gian thực từ hiện trường về nhà)
    const savedLiveSync = localStorage.getItem(STORAGE_KEY_LIVE_SYNC_ENABLED);
    if (savedLiveSync !== 'false') {
      startLiveFieldSync();
    } else {
      stopLiveFieldSync();
    }

    const savedSound = localStorage.getItem(STORAGE_KEY_SOUND_ENABLED);
    if (savedSound === 'false') {
      isSoundAlertEnabled = false;
      const soundBtnText = document.getElementById('btnToggleSoundText');
      const soundBtnIcon = document.getElementById('btnToggleSoundIcon');
      if (soundBtnText) soundBtnText.textContent = 'Chuông: Tắt';
      if (soundBtnIcon) soundBtnIcon.textContent = '🔕';
    }

    // Khởi tạo nút cảnh báo thông tin chưa đầy đủ
    updateIncompleteWarningButtonUI();

    // Quét ngay lần đầu sau 2 giây để nạp các KH vừa cập nhật mới nhất
    setTimeout(() => {
      pollFieldUpdates(false);
    }, 2000);
  });

  // ==========================================================================
  // INDEXEDDB UTILITIES (HANDLES 221.038 CUSTOMERS IN 30MS)
  // ==========================================================================
  function openIDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE_CHUNKS)) {
          db.createObjectStore(IDB_STORE_CHUNKS, { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async function getCustomersFromIDB() {
    try {
      const db = await openIDB();
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE_CHUNKS, 'readonly');
        const store = tx.objectStore(IDB_STORE_CHUNKS);
        const req = store.getAll();
        req.onsuccess = () => {
          const chunks = req.result || [];
          if (chunks.length === 0) {
            resolve(null);
            return;
          }
          chunks.sort((a, b) => a.id - b.id);
          let merged = [];
          for (let i = 0; i < chunks.length; i++) {
            merged = merged.concat(chunks[i].items);
          }
          resolve(merged);
        };
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      console.warn('IndexedDB read fallback:', e);
      return null;
    }
  }

  async function saveCustomersToIDB(customers) {
    try {
      const db = await openIDB();
      const tx = db.transaction(IDB_STORE_CHUNKS, 'readwrite');
      const store = tx.objectStore(IDB_STORE_CHUNKS);
      store.clear();

      for (let i = 0; i < customers.length; i += CHUNK_SIZE) {
        const chunk = customers.slice(i, i + CHUNK_SIZE);
        store.put({ id: Math.floor(i / CHUNK_SIZE), items: chunk });
      }

      return new Promise((resolve) => {
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      console.warn('IndexedDB write error:', e);
      return false;
    }
  }

  async function clearCustomersInIDB() {
    try {
      const db = await openIDB();
      const tx = db.transaction(IDB_STORE_CHUNKS, 'readwrite');
      const store = tx.objectStore(IDB_STORE_CHUNKS);
      store.clear();
      return new Promise((resolve) => {
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      console.warn('IndexedDB clear error:', e);
      return false;
    }
  }

  // ==========================================================================
  // DATA LOADING & STORAGE
  // ==========================================================================
  function loadLocalInspections() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_INSPECTIONS);
      if (stored) {
        inspectionsMap = JSON.parse(stored) || {};
        // Tự động làm sạch các bản ghi bị lưu nhầm tên nhóm/cán bộ vào ô hiện trạng (ghi_chu)
        let cleaned = false;
        Object.keys(inspectionsMap).forEach(k => {
          const item = inspectionsMap[k];
          if (item && item.ghi_chu && isWorkgroupOrInspectorName(item.ghi_chu)) {
            if (!item.nguoi_cap_nhat) item.nguoi_cap_nhat = item.ghi_chu;
            item.ghi_chu = '';
            cleaned = true;
          }
        });
        if (cleaned) {
          saveLocalInspections();
        }
      }
    } catch (e) {
      console.warn('Could not parse local inspections:', e);
      inspectionsMap = {};
    }
  }

  function saveLocalInspections() {
    try {
      localStorage.setItem(STORAGE_KEY_INSPECTIONS, JSON.stringify(inspectionsMap));
    } catch (e) {
      console.error('LocalStorage error:', e);
      showToast('Bộ nhớ trình duyệt đầy, vui lòng xuất báo cáo để lưu trữ!', 'error');
    }
  }

  async function loadInitialData() {
    showLoading(true, 'Đang tải danh mục 1.696 trạm biến áp...');

    // 1. Load pre-built stations directory
    try {
      const stResp = await fetch('data/kienthoan_stations.json');
      if (stResp.ok) {
        stationsMeta = await stResp.json();
      }
    } catch (e) {
      console.warn('Stations meta loading fallback:', e);
    }

    // 2. Check IndexedDB cache and dataset version
    showLoading(true, 'Đang kiểm tra bộ nhớ đệm khách hàng...');
    const currentVersion = localStorage.getItem(STORAGE_KEY_DATASET_VER);

    if (currentVersion === DATASET_VERSION) {
      const cachedCustomers = await getCustomersFromIDB();
      if (cachedCustomers && cachedCustomers.length >= 100000) {
        allCustomers = cachedCustomers;
        // Áp dụng định dạng số No chuẩn (viết liền, không có dấu chấm)
        let hasFixed = false;
        allCustomers.forEach(c => {
          const oldNo = c.so_no;
          c.so_no = formatMeterNo(c.so_no);
          if (oldNo !== c.so_no) hasFixed = true;
        });
        if (hasFixed) {
          setTimeout(async () => {
            await saveCustomersToIDB(allCustomers);
          }, 100);
        }
        buildStationsMetaFromCustomers();
        applyFilters();
        renderApp();
        showLoading(false);
        showToast(`Đã nạp toàn bộ ${allCustomers.length.toLocaleString('vi-VN')} khách hàng từ bộ nhớ!`, 'success');
        pollFieldUpdates(false);
        return;
      }
    } else {
      // Xóa bộ đệm cũ của tập dữ liệu trước để nạp mới 210.123 khách hàng
      await clearCustomersInIDB();
      localStorage.removeItem(STORAGE_KEY_DATASET_VER);
    }

    // 3. Load full dataset from data/kienthoan_sheet.csv.gz (6.8MB) or .csv
    showLoading(true, 'Đang nạp toàn bộ 210.123 khách hàng từ Google Sheet...');
    let csvText = '';

    try {
      // Try gzipped CSV first (super fast 6.8MB download) with cache-busting
      if (typeof DecompressionStream !== 'undefined') {
        const gzResp = await fetch('data/kienthoan_sheet.csv.gz?v=' + DATASET_VERSION);
        if (gzResp.ok) {
          const ds = new DecompressionStream('gzip');
          const decompressedStream = gzResp.body.pipeThrough(ds);
          csvText = await new Response(decompressedStream).text();
        }
      }
    } catch (gzErr) {
      console.warn('Gzip stream error, trying raw CSV:', gzErr);
    }

    if (!csvText) {
      try {
        const rawResp = await fetch('data/kienthoan_sheet.csv?v=' + DATASET_VERSION);
        if (rawResp.ok) {
          csvText = await rawResp.text();
        }
      } catch (rawErr) {
        console.warn('Raw CSV fetch error:', rawErr);
      }
    }

    if (csvText && csvText.length > 1000) {
      showLoading(true, 'Đang xử lý dữ liệu 210.123 khách hàng...');
      // Allow browser to render loading UI before parsing
      await new Promise(r => setTimeout(r, 40));

      const parsed = parseCSV(csvText);
      if (parsed && parsed.length > 0) {
        allCustomers = parsed;
        buildStationsMetaFromCustomers();
        applyFilters();
        renderApp();
        showLoading(false);
        showToast(`Đã nạp toàn bộ ${allCustomers.length.toLocaleString('vi-VN')} khách hàng thành công!`, 'success');

        // Save to IndexedDB in background & set version
        setTimeout(async () => {
          await saveCustomersToIDB(allCustomers);
          localStorage.setItem(STORAGE_KEY_DATASET_VER, DATASET_VERSION);
          console.log(`Saved all ${allCustomers.length} customers to IndexedDB cache.`);
        }, 100);
        pollFieldUpdates(false);
        return;
      }
    }

    // 4. Fallback to sample if files not available
    try {
      const resp = await fetch('data/kienthoan_sample.json?v=' + DATASET_VERSION);
      if (resp.ok) {
        const json = await resp.json();
        allCustomers = json.customers || [];
        buildStationsMetaFromCustomers();
        applyFilters();
        renderApp();
        showToast(`Đã nạp ${allCustomers.length.toLocaleString('vi-VN')} khách hàng`, 'info');
      }
    } catch (e) {
      console.error('Sample data fetch error:', e);
    } finally {
      showLoading(false);
    }
  }

  function buildStationsMetaFromCustomers() {
    // Reset count = 0 cho tất cả trạm để không bị cộng dồn nhân đôi dữ liệu
    Object.keys(stationsMeta).forEach(id => {
      stationsMeta[id].count = 0;
    });

    allCustomers.forEach(c => {
      const id = c.id_tram || c.ma_tram;
      if (id) {
        if (!stationsMeta[id]) {
          stationsMeta[id] = {
            id: id,
            name: c.ten_tram || '',
            khu_vuc: c.khu_vuc || '',
            count: 0
          };
        }
        stationsMeta[id].count = (stationsMeta[id].count || 0) + 1;
      }
    });

    cachedStationCustStats = null;
  }

  // Sync directly from Google Sheet CSV
  async function syncFromGoogleSheet(sheetUrl, showUserFeedback = true) {
    if (!sheetUrl) sheetUrl = DEFAULT_SHEET_URL;
    
    const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
      if (showUserFeedback) showToast('Đường link Google Sheet không hợp lệ!', 'error');
      return false;
    }
    const sheetId = sheetIdMatch[1];
    let gid = '1392868293';
    const gidMatch = sheetUrl.match(/[#&?]gid=([0-9]+)/);
    if (gidMatch) gid = gidMatch[1];

    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;

    showLoading(true, 'Đang tải dữ liệu từ Google Sheet (221.038 dòng)...');
    let csvText = '';
    try {
      const resp = await fetch(exportUrl);
      if (resp.ok) {
        csvText = await resp.text();
      } else {
        const resp2 = await fetch(gvizUrl);
        if (resp2.ok) csvText = await resp2.text();
        else throw new Error(`HTTP ${resp.status}`);
      }
    } catch (netErr) {
      console.warn('Direct fetch error:', netErr);
      if (showUserFeedback) {
        openModal('modalSheetGuide');
        showToast('Không thể tải từ Google Sheet, đang dùng dữ liệu lưu trữ!', 'error');
      }
      showLoading(false);
      return false;
    }

    if (csvText && csvText.length > 50 && !csvText.includes('<!DOCTYPE html>')) {
      showLoading(true, 'Đang xử lý và lưu trữ dữ liệu mới...');
      await new Promise(r => setTimeout(r, 40));

      const parsedRows = parseCSV(csvText);
      if (parsedRows && parsedRows.length > 0) {
        allCustomers = parsedRows;
        buildStationsMetaFromCustomers();
        localStorage.setItem(STORAGE_KEY_SHEET_URL, sheetUrl);
        await saveCustomersToIDB(allCustomers);
        applyFilters();
        renderApp();
        showLoading(false);
        if (showUserFeedback) {
          showToast(`Đã đồng bộ thành công toàn bộ ${allCustomers.length.toLocaleString('vi-VN')} khách hàng từ Google Sheet!`, 'success');
        }
        return true;
      }
    }

    showLoading(false);
    if (showUserFeedback) {
      openModal('modalSheetGuide');
      showToast('Cần cấp quyền Xem (Viewer) cho link Google Sheet!', 'error');
    }
    return false;
  }

  // Fast line tokenizer for customer records (210,123 customers)
  function parseCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    const total = lines.length;
    if (total < 2) return [];

    const result = [];
    let isFirst = true;

    // Default column indices (compatible with clean 13-column format)
    let idxStt = 0;
    let idxMaKh = 1;
    let idxTenKh = 2;
    let idxDcKh = 3;
    let idxDcDdo = 4;
    let idxTram = 5;
    let idxTenTram = 6;
    let idxDanhSo = 7;
    let idxSdt = 8;
    let idxSoNo = 9;
    let idxKhuVuc = 10;
    let idxUpdater = 11;
    let idxTrangThai = 12;
    let idxKq = -1;

    for (let i = 0; i < total; i++) {
      const line = lines[i];
      if (!line || line.length < 5) continue;

      const cols = [];
      let insideQuote = false;
      let start = 0;
      const len = line.length;

      for (let j = 0; j < len; j++) {
        const c = line[j];
        if (c === '"') {
          insideQuote = !insideQuote;
        } else if (c === ',' && !insideQuote) {
          let val = line.substring(start, j).trim();
          if (val.charCodeAt(0) === 34 && val.charCodeAt(val.length - 1) === 34) {
            val = val.substring(1, val.length - 1).replace(/""/g, '"').trim();
          }
          cols.push(val);
          start = j + 1;
        }
      }
      let lastVal = line.substring(start).trim();
      if (lastVal.charCodeAt(0) === 34 && lastVal.charCodeAt(lastVal.length - 1) === 34) {
        lastVal = lastVal.substring(1, lastVal.length - 1).replace(/""/g, '"').trim();
      }
      cols.push(lastVal);

      if (cols.length < 3) continue;

      // Skip and detect header row
      if (isFirst) {
        isFirst = false;
        const col0 = (cols[0] || '').toLowerCase();
        const col1 = (cols[1] || '').toLowerCase();
        if (col0.includes('stt') || col1.includes('mã kh') || col1.includes('makh')) {
          cols.forEach((colName, cIdx) => {
            const cn = colName.toLowerCase().trim();
            if (cn.includes('stt')) idxStt = cIdx;
            else if (cn.includes('mã kh') || cn.includes('makh')) idxMaKh = cIdx;
            else if (cn.includes('tên kh') || cn.includes('tenkh')) idxTenKh = cIdx;
            else if (cn.includes('địa chỉ kh') || cn.includes('diachikh')) idxDcKh = cIdx;
            else if (cn.includes('điểm đo') || cn.includes('diachi_ddo')) idxDcDdo = cIdx;
            else if (cn.includes('mã trạm') || cn.includes('matram')) idxTram = cIdx;
            else if (cn.includes('tên trạm') || cn.includes('tentram')) idxTenTram = cIdx;
            else if (cn.includes('danh số') || cn.includes('danhso')) idxDanhSo = cIdx;
            else if (cn.includes('điện thoại') || cn.includes('sđt') || cn.includes('sdt')) idxSdt = cIdx;
            else if (cn.includes('số no') || cn.includes('sono') || cn.includes('công tơ')) idxSoNo = cIdx;
            else if (cn.includes('kết quả') || cn.includes('ket qua')) idxKq = cIdx;
            else if (cn.includes('khu vực') || cn.includes('khuvuc')) idxKhuVuc = cIdx;
            else if (cn.includes('người cập nhật') || cn.includes('nguoicapnhat')) idxUpdater = cIdx;
            else if (cn.includes('trạng thái') || cn.includes('trangthai')) idxTrangThai = cIdx;
          });
          continue;
        }
      }

      // Skip rows that already have 'kết quả kiểm tra' (customers excluded by user)
      if (idxKq !== -1 && cols[idxKq] && cols[idxKq].trim()) {
        continue;
      }

      const stt = cols[idxStt] || (result.length + 1);
      const ma_kh = cols[idxMaKh] || '';
      const ten_kh = cols[idxTenKh] || '';
      const dia_chi_kh = cols[idxDcKh] || '';
      const dia_chi_ddo = cols[idxDcDdo] || '';
      const ma_tram = cols[idxTram] || '';
      const ten_tram = cols[idxTenTram] || '';
      const danh_so = cols[idxDanhSo] || '';
      const sdt = cols[idxSdt] || '';
      const so_no = formatMeterNo(cols[idxSoNo] || '');
      const khu_vuc = cols[idxKhuVuc] || '';
      const nguoi_cap_nhat = cols[idxUpdater] || '';
      const trang_thai_sheet = (cols[idxTrangThai] || '').trim();

      if (!ma_kh && !ten_kh) continue;

      // Đồng bộ từ Google Sheet: Cột Trạng thái có dấu "X"
      if (trang_thai_sheet.toUpperCase() === 'X') {
        if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};
        inspectionsMap[ma_kh].trang_thai = 'Đã kiểm tra';
        if (nguoi_cap_nhat && !inspectionsMap[ma_kh].nguoi_cap_nhat) {
          inspectionsMap[ma_kh].nguoi_cap_nhat = nguoi_cap_nhat;
        }
      }

      result.push({
        stt: parseInt(stt) || (result.length + 1),
        ma_kh: ma_kh,
        ten_kh: ten_kh,
        dia_chi_kh: dia_chi_kh,
        dia_chi_ddo: dia_chi_ddo,
        id_tram: ma_tram,
        ma_tram: ma_tram,
        ten_tram: ten_tram,
        danh_so: danh_so,
        sdt: sdt,
        so_no: so_no,
        khu_vuc: khu_vuc,
        nguoi_cap_nhat: nguoi_cap_nhat,
        trang_thai_sheet: trang_thai_sheet,
        dia_chi: dia_chi_ddo || dia_chi_kh
      });
    }

    // Lưu các khách hàng có dấu X từ Sheet vào bộ nhớ máy
    saveLocalInspections();

    return result;
  }

  // ==========================================================================
  // FILTERING & SEARCH
  // ==========================================================================
  function applyFilters(preservePage = false) {
    const kw = currentSearchKeyword.toLowerCase().trim();
    const stationFilter = currentStationFilter.trim();
    const areaFilter = currentAreaFilter.trim();

    filteredCustomers = allCustomers.filter(item => {
      const itemStation = item.id_tram || item.ma_tram || '';
      if (stationFilter && itemStation !== stationFilter) return false;
      if (areaFilter && item.khu_vuc !== areaFilter) return false;

      // Filter by Assigned Workgroup (Phân công 9 nhóm)
      if (currentAssignedGroupFilter) {
        const assign = stationAssignments[itemStation];
        if (currentAssignedGroupFilter === 'unassigned') {
          if (assign) return false;
        } else {
          if (!assign || assign.groupId !== currentAssignedGroupFilter) return false;
        }
      }

      const insp = inspectionsMap[item.ma_kh] || {};
      const isCompleted = insp.trang_thai === 'Đã kiểm tra';
      if (currentStatusFilter === 'completed' && !isCompleted) return false;
      if (currentStatusFilter === 'pending' && isCompleted) return false;

      // Filter by condition (Hiện trạng đo đếm 12 mục)
      if (currentConditionFilter) {
        const custNote = (insp.ghi_chu || '').toLowerCase();
        if (!custNote.includes(currentConditionFilter.toLowerCase())) return false;
      }

      // Global search across all 12 fields
      if (kw) {
        const kwNoDot = kw.replace(/\./g, '');
        const stationName = (stationsMeta[itemStation] && stationsMeta[itemStation].name) || item.ten_tram || '';
        const match = 
          (item.ma_kh && item.ma_kh.toLowerCase().includes(kw)) ||
          (item.ten_kh && item.ten_kh.toLowerCase().includes(kw)) ||
          (itemStation && itemStation.toLowerCase().includes(kw)) ||
          (stationName && stationName.toLowerCase().includes(kw)) ||
          (item.dia_chi_ddo && item.dia_chi_ddo.toLowerCase().includes(kw)) ||
          (item.dia_chi_kh && item.dia_chi_kh.toLowerCase().includes(kw)) ||
          (item.so_no && (item.so_no.toLowerCase().includes(kw) || item.so_no.replace(/\./g, '').toLowerCase().includes(kwNoDot))) ||
          (item.danh_so && item.danh_so.toLowerCase().includes(kw)) ||
          (item.sdt && item.sdt.toLowerCase().includes(kw)) ||
          (item.khu_vuc && item.khu_vuc.toLowerCase().includes(kw));
        if (!match) return false;
      }

      return true;
    });

    if (!preservePage) {
      currentPage = 1;
    } else {
      const maxPage = Math.max(1, Math.ceil(filteredCustomers.length / pageSize));
      if (currentPage > maxPage) {
        currentPage = maxPage;
      }
    }
    const activeEl = document.activeElement;
    const activeId = (activeEl && activeEl.id) ? activeEl.id : null;
    const selStart = (activeEl && typeof activeEl.selectionStart === 'number') ? activeEl.selectionStart : null;
    const selEnd = (activeEl && typeof activeEl.selectionEnd === 'number') ? activeEl.selectionEnd : null;

    if (activeId) {
      setTimeout(() => {
        const restored = document.getElementById(activeId);
        if (restored) {
          try {
            restored.focus();
            if (selStart !== null && selEnd !== null && typeof restored.setSelectionRange === 'function') {
              restored.setSelectionRange(selStart, selEnd);
            }
          } catch (e) {}
        }
      }, 0);
    }
  }

  // ==========================================================================
  // RENDERING (DUAL ENGINE: TABLE & MOBILE CARDS)
  // ==========================================================================
  function renderApp() {
    renderKPIs();
    renderStationBanner();
    renderAreaDropdown();
    renderSidebarWorkgroups();
    renderDataList();
    renderPagination();
    renderMobileStickyBar();
  }

  function renderKPIs() {
    const totalCount = allCustomers.length;
    let completedCount = 0;

    allCustomers.forEach(c => {
      if (inspectionsMap[c.ma_kh] && inspectionsMap[c.ma_kh].trang_thai === 'Đã kiểm tra') {
        completedCount++;
      }
    });

    const pendingCount = Math.max(0, totalCount - completedCount);
    const percent = totalCount > 0 ? ((completedCount / totalCount) * 100).toFixed(1) : 0;
    const stationsCount = Object.keys(stationsMeta).length || 1696;

    const kpiTotal = document.getElementById('kpiTotalCount');
    const kpiCompleted = document.getElementById('kpiCompletedCount');
    const kpiPending = document.getElementById('kpiPendingCount');
    const kpiStations = document.getElementById('kpiStationsCount');
    const kpiProgress = document.getElementById('kpiProgressFill');
    const kpiPercentLabel = document.getElementById('kpiPercentLabel');

    if (kpiTotal) kpiTotal.textContent = totalCount.toLocaleString('vi-VN');
    if (kpiCompleted) kpiCompleted.textContent = completedCount.toLocaleString('vi-VN');
    if (kpiPending) kpiPending.textContent = pendingCount.toLocaleString('vi-VN');
    if (kpiStations) kpiStations.textContent = stationsCount.toLocaleString('vi-VN');
    if (kpiProgress) kpiProgress.style.width = `${percent}%`;
    if (kpiPercentLabel) kpiPercentLabel.textContent = `${percent}% Đạt chỉ tiêu`;

    const countAll = document.getElementById('countTabAll');
    const countPending = document.getElementById('countTabPending');
    const countCompleted = document.getElementById('countTabCompleted');
    if (countAll) countAll.textContent = totalCount.toLocaleString('vi-VN');
    if (countPending) countPending.textContent = pendingCount.toLocaleString('vi-VN');
    if (countCompleted) countCompleted.textContent = completedCount.toLocaleString('vi-VN');
  }

  function renderStationBanner() {
    const banner = document.getElementById('stationBanner');
    if (!banner) return;

    if (!currentStationFilter) {
      banner.style.display = 'none';
      return;
    }

    banner.style.display = 'flex';
    const sMeta = stationsMeta[currentStationFilter];
    const stationName = (sMeta && sMeta.name) || 'Chưa cập nhật tên trạm';
    
    const stationCustomers = allCustomers.filter(c => (c.id_tram || c.ma_tram) === currentStationFilter);
    const stationTotal = stationCustomers.length;
    let stationCompleted = 0;
    stationCustomers.forEach(c => {
      if (inspectionsMap[c.ma_kh] && inspectionsMap[c.ma_kh].trang_thai === 'Đã kiểm tra') {
        stationCompleted++;
      }
    });
    const stationPercent = stationTotal > 0 ? Math.round((stationCompleted / stationTotal) * 100) : 0;

    const bannerTitle = document.getElementById('stationBannerTitle');
    const bannerMeta = document.getElementById('stationBannerMeta');
    if (bannerTitle) {
      bannerTitle.innerHTML = `TRẠM: <strong>${escapeHTML(stationName)}</strong> (Mã trạm: ${escapeHTML(currentStationFilter)})`;
    }
    if (bannerMeta) {
      bannerMeta.innerHTML = `
        <span>👥 Tổng: <strong>${stationTotal}</strong> KH</span> &bull; 
        <span>✅ Đã kiểm tra: <strong>${stationCompleted}/${stationTotal}</strong> (${stationPercent}%)</span>
      `;
    }
  }

  function renderAreaDropdown() {
    const select = document.getElementById('filterAreaSelect');
    if (!select) return;

    const currentVal = select.value;
    const areas = new Set(['Bà Rịa', 'Vũng Tàu', 'Phú Mỹ', 'Côn Đảo']);
    allCustomers.forEach(c => {
      if (c.khu_vuc) areas.add(c.khu_vuc);
    });

    const sortedAreas = Array.from(areas).sort();
    let optionsHtml = '<option value="">-- Tất cả khu vực --</option>';
    sortedAreas.forEach(a => {
      optionsHtml += `<option value="${escapeHTML(a)}">${escapeHTML(a)}</option>`;
    });
    select.innerHTML = optionsHtml;
    select.value = currentVal || '';
  }

  // Render both Table Rows (Desktop) AND Mobile Cards (Phones)
  function renderDataList() {
    const tbody = document.getElementById('customerTableBody');
    const mobileContainer = document.getElementById('mobileCardsContainer');
    const tableInfo = document.getElementById('tableCountInfo');

    if (tableInfo) {
      tableInfo.textContent = `(${filteredCustomers.length.toLocaleString('vi-VN')} / ${allCustomers.length.toLocaleString('vi-VN')} KH)`;
    }

    if (filteredCustomers.length === 0) {
      const emptyHtml = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">Không tìm thấy khách hàng nào</div>
          <div class="empty-desc">Vui lòng thử đổi ID trạm, khu vực hoặc từ khóa tìm kiếm.</div>
          <button class="btn-secondary" onclick="window.PCVT.resetFilters()">Xóa tất cả bộ lọc</button>
        </div>
      `;
      if (tbody) tbody.innerHTML = `<tr><td colspan="15">${emptyHtml}</td></tr>`;
      if (mobileContainer) mobileContainer.innerHTML = emptyHtml;
      return;
    }

    const startIndex = (currentPage - 1) * pageSize;
    const pagedItems = filteredCustomers.slice(startIndex, startIndex + pageSize);

    let tableHtml = '';
    let cardsHtml = '';

    pagedItems.forEach((c, idx) => {
      const rowStt = startIndex + idx + 1;
      const insp = inspectionsMap[c.ma_kh] || {};
      const isCompleted = insp.trang_thai === 'Đã kiểm tra';
      const itemStation = c.id_tram || c.ma_tram || '';
      const sMeta = stationsMeta[itemStation];
      const stationName = (sMeta && sMeta.name) || c.ten_tram || '';
      const stationDisplay = stationName ? `${itemStation} - ${stationName}` : (itemStation || '---');

      const statusBadge = isCompleted
        ? `<span class="badge-status completed">✅ Đã kiểm tra</span>`
        : `<span class="badge-status pending">⏳ Chưa kiểm tra</span>`;

      // 1. Desktop Table Row
      const photoHtmlDesktop = insp.hinh_anh
        ? `
          <div class="photo-preview-wrap" onclick="window.PCVT.viewPhoto('${escapeHTML(c.ma_kh)}')">
            <img src="${insp.hinh_anh}" class="photo-thumbnail" alt="Ảnh HTĐĐ">
            <button type="button" class="btn-remove-photo" onclick="event.stopPropagation(); window.PCVT.removePhoto('${escapeHTML(c.ma_kh)}')" title="Xóa ảnh">✕</button>
          </div>
        `
        : `
          <label class="btn-upload-photo" title="Tải ảnh hoặc chụp từ camera">
            <input type="file" accept="image/*" capture="environment" style="display:none" onchange="window.PCVT.handlePhotoUpload(this, '${escapeHTML(c.ma_kh)}')">
            📷 Thêm ảnh
          </label>
        `;

      // Chuẩn bị thanh xổ xuống hiện trạng (12 mục chuẩn)
      let currentNote = (insp.ghi_chu || '').trim();
      if (isWorkgroupOrInspectorName(currentNote)) {
        currentNote = '';
      }
      let conditionOptions = `<option value="">-- Chọn hiện trạng đo đếm (12 mục) --</option>`;
      PRESET_CONDITIONS.forEach((cond, cIdx) => {
        const isSelected = (currentNote === cond);
        conditionOptions += `<option value="${escapeHTML(cond)}" ${isSelected ? 'selected' : ''}>${cIdx + 1}. ${escapeHTML(cond)}</option>`;
      });
      const isCustomNote = Boolean(currentNote && !PRESET_CONDITIONS.includes(currentNote));
      conditionOptions += `<option value="__custom__" ${isCustomNote ? 'selected' : ''}>✏️ Khác (Tự nhập tay)...</option>`;

      // Chuẩn bị danh sách tick chọn nhiều hiện trạng (Checklist)
      let conditionCheckboxesDesktop = '';
      let conditionCheckboxesMobile = '';
      PRESET_CONDITIONS.forEach((cond, cIdx) => {
        const isTicked = currentNote.includes(cond);
        conditionCheckboxesDesktop += `
          <label class="condition-check-item ${isTicked ? 'active' : ''}">
            <input type="checkbox" id="chk-cond-d-${escapeHTML(c.ma_kh)}-${cIdx}" ${isTicked ? 'checked' : ''} 
                   onchange="window.PCVT.toggleConditionCheck('${escapeHTML(c.ma_kh)}', '${escapeHTML(cond)}', this.checked)">
            <span><strong>${cIdx + 1}.</strong> ${escapeHTML(cond)}</span>
          </label>
        `;
        conditionCheckboxesMobile += `
          <label class="condition-check-item ${isTicked ? 'active' : ''}">
            <input type="checkbox" id="chk-cond-m-${escapeHTML(c.ma_kh)}-${cIdx}" ${isTicked ? 'checked' : ''} 
                   onchange="window.PCVT.toggleConditionCheck('${escapeHTML(c.ma_kh)}', '${escapeHTML(cond)}', this.checked)">
            <span><strong>${cIdx + 1}.</strong> ${escapeHTML(cond)}</span>
          </label>
        `;
      });

      const phoneLink = c.sdt
        ? `<a href="tel:${escapeHTML(c.sdt)}" style="color:#2563eb; text-decoration:none; font-weight:600;" title="Gọi điện">📞 ${escapeHTML(c.sdt)}</a>`
        : '<span style="color:var(--text-light)">---</span>';

      const currentUpdater = insp.nguoi_cap_nhat || c.nguoi_cap_nhat || '';
      const isPreset = isPresetInspector(currentUpdater);
      const presetVal = getInspectorPresetValue(currentUpdater);
      const isCustom = Boolean(currentUpdater && !isPreset);

      let updaterSelectOptions = `<option value="">-- Chọn nhóm công tác --</option>`;
      PRESET_WORKGROUPS.forEach(g => {
        const isSel = (currentUpdater === g.fullName || currentUpdater === g.name || presetVal === g.fullName);
        updaterSelectOptions += `<option value="${escapeHTML(g.fullName)}" ${isSel ? 'selected' : ''}>Nhóm ${g.index}: ${escapeHTML(g.shortName)} (TN: ${escapeHTML(g.leader)})</option>`;
      });
      updaterSelectOptions += `<option value="__custom__" ${isCustom ? 'selected' : ''}>✏️ Khác (Tự nhập)...</option>`;

      const stationAssign = getStationAssignment(itemStation);
      const assignBadgeHtml = stationAssign 
        ? `<div class="badge-assigned-group" title="Phân công: ${escapeHTML(stationAssign.fullName)} - Giao lúc: ${escapeHTML(stationAssign.assignedAt || '')}">👥 Nhóm ${stationAssign.groupIndex}: ${escapeHTML(stationAssign.shortName || stationAssign.groupName)}</div>`
        : '';

      tableHtml += `
        <tr class="${isCompleted ? 'row-completed' : ''}" id="row-${escapeHTML(c.ma_kh)}">
          <td class="col-stt">${rowStt}</td>
          <td class="col-check">
            <label class="custom-checkbox" title="Đánh dấu đã hoàn thành kiểm tra">
              <input type="checkbox" ${isCompleted ? 'checked' : ''} onchange="window.PCVT.toggleStatus('${escapeHTML(c.ma_kh)}', this.checked)">
              <span class="checkmark"></span>
            </label>
          </td>
          <td class="col-status">${statusBadge}</td>
          <td class="col-cust-id">
            <span style="cursor:pointer;" onclick="window.PCVT.copyText('${escapeHTML(c.ma_kh)}')" title="Bấm để sao chép mã KH">${escapeHTML(c.ma_kh)} 📋</span>
          </td>
          <td class="col-cust-name">${escapeHTML(c.ten_kh || '---')}</td>
          <td class="col-meter">
            <span class="badge-meter" id="meter-val-${escapeHTML(c.ma_kh)}" title="Số No công tơ">${escapeHTML(formatMeterNo(c.so_no) || '---')}</span>
          </td>
          <td class="col-station" title="${escapeHTML(stationDisplay)}">
            <strong>${escapeHTML(itemStation || '---')}</strong>
            ${stationName ? `<div style="font-size:0.75rem; color:var(--text-muted);">${escapeHTML(stationName)}</div>` : ''}
            ${assignBadgeHtml}
          </td>
          <td class="col-danhso" style="font-family:monospace; font-size:0.75rem;">${escapeHTML(c.danh_so || '---')}</td>
          <td class="col-phone">${phoneLink}</td>
          <td class="col-address">
            <div><strong>Điểm đo:</strong> ${escapeHTML(c.dia_chi_ddo || c.dia_chi || '---')}</div>
            ${c.dia_chi_kh && c.dia_chi_kh !== c.dia_chi_ddo ? `<div style="font-size:0.75rem; color:var(--text-muted);"><strong>ĐC KH:</strong> ${escapeHTML(c.dia_chi_kh)}</div>` : ''}
          </td>
          <td class="col-area">
            <span class="badge-area">${escapeHTML(c.khu_vuc || '---')}</span>
          </td>
          <td class="col-updater">
            <div class="updater-picker-wrap">
              <select class="updater-select" id="sel-updater-${escapeHTML(c.ma_kh)}" onchange="window.PCVT.onUpdaterSelectChange('${escapeHTML(c.ma_kh)}', this.value)">
                ${updaterSelectOptions}
              </select>
              <input type="text" class="updater-input" id="updater-${escapeHTML(c.ma_kh)}" 
                     style="display: ${isCustom ? 'block' : 'none'};"
                     value="${escapeHTML(currentUpdater)}" 
                     placeholder="Nhập tên cán bộ khác..."
                     title="Người cập nhật (Cột L)"
                     onchange="window.PCVT.updateUpdater('${escapeHTML(c.ma_kh)}', this.value)">
            </div>
          </td>
          <td class="col-note">
            <div class="note-wrapper">
              <select class="condition-select" id="sel-cond-${escapeHTML(c.ma_kh)}" 
                      onchange="window.PCVT.onConditionSelect('${escapeHTML(c.ma_kh)}', this.value)" title="Thanh xổ xuống chọn hiện trạng">
                ${conditionOptions}
              </select>
              <input type="text" class="note-input" id="note-${escapeHTML(c.ma_kh)}" 
                     value="${escapeHTML(currentNote)}" 
                     placeholder="Ghi chú chi tiết hoặc tự nhập..."
                     onchange="window.PCVT.updateNote('${escapeHTML(c.ma_kh)}', this.value)">
              <details class="condition-multicheck">
                <summary class="condition-multicheck-toggle" title="Mở danh sách để tick chọn nhiều hiện trạng cùng lúc">
                  <span>☑️ Tick chọn nhiều hiện trạng...</span>
                </summary>
                <div class="condition-multicheck-panel">
                  ${conditionCheckboxesDesktop}
                </div>
              </details>
            </div>
          </td>
          <td class="col-photo" id="photo-cell-${escapeHTML(c.ma_kh)}">
            <div class="photo-box">${photoHtmlDesktop}</div>
          </td>
          <td class="col-actions">
            <button class="btn-row-save" onclick="window.PCVT.saveRow('${escapeHTML(c.ma_kh)}')">💾 Lưu</button>
          </td>
        </tr>
      `;

      // 2. Mobile Responsive Card
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((c.dia_chi_ddo || c.dia_chi_kh || '') + ', ' + (c.khu_vuc || 'Vũng Tàu'))}`;

      const photoHtmlMobile = insp.hinh_anh
        ? `
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <div class="photo-preview-wrap" onclick="window.PCVT.viewPhoto('${escapeHTML(c.ma_kh)}')">
              <img src="${insp.hinh_anh}" style="width:54px; height:54px; border-radius:8px; object-fit:cover; border:1px solid #cbd5e1;" alt="Ảnh công tơ">
            </div>
            <div style="display:flex; flex-direction:column; gap:4px;">
              <span style="font-size:0.75rem; color:#059669; font-weight:700;">✅ Đã chụp ảnh</span>
              <button type="button" style="background:#fee2e2; color:#dc2626; border:none; padding:3px 8px; border-radius:4px; font-size:0.75rem; font-weight:600; cursor:pointer;" onclick="window.PCVT.removePhoto('${escapeHTML(c.ma_kh)}')">✕ Xóa ảnh</button>
            </div>
          </div>
        `
        : `
          <label class="btn-mobile-camera">
            <input type="file" accept="image/*" capture="environment" style="display:none" onchange="window.PCVT.handlePhotoUpload(this, '${escapeHTML(c.ma_kh)}')">
            📷 Chụp ảnh công tơ
          </label>
        `;

      cardsHtml += `
        <div class="mobile-card ${isCompleted ? 'card-completed' : ''}" id="mcard-${escapeHTML(c.ma_kh)}">
          <!-- Card Header -->
          <div class="mobile-card-header">
            <div class="mobile-stt-chip">
              <strong>#${rowStt}</strong> &bull; Khu vực: <span class="badge-area">${escapeHTML(c.khu_vuc || '---')}</span>
            </div>
            <div id="mstatus-${escapeHTML(c.ma_kh)}">${statusBadge}</div>
          </div>

          <!-- Customer Name & Codes -->
          <div>
            <div class="mobile-card-title">${escapeHTML(c.ten_kh || '---')}</div>
            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-top:0.35rem;">
              <div class="mobile-cust-code" onclick="window.PCVT.copyText('${escapeHTML(c.ma_kh)}')">
                <span>Mã KH: <strong>${escapeHTML(c.ma_kh)}</strong></span>
                <span style="font-size:0.75rem; opacity:0.8;">📋</span>
              </div>
              <span class="badge-meter" title="Số No công tơ">
                🔢 Số No: <strong id="m-header-meter-${escapeHTML(c.ma_kh)}">${escapeHTML(formatMeterNo(c.so_no) || '---')}</strong>
              </span>
              ${c.danh_so ? `<span style="font-size:0.72rem; background:#f1f5f9; padding:2px 6px; border-radius:4px; color:#475569;">DS: ${escapeHTML(c.danh_so)}</span>` : ''}
            </div>
          </div>

          <!-- Technical & Address Details -->
          <div class="mobile-meta-grid">
            <div class="mobile-meta-item">
              <strong>🔢 Số No công tơ:</strong>
              <div style="margin-top:2px;">
                <span class="badge-meter" id="m-meter-val-${escapeHTML(c.ma_kh)}">${escapeHTML(formatMeterNo(c.so_no) || 'Chưa có')}</span>
              </div>
            </div>
            <div class="mobile-meta-item">
              <strong>⚡ Trạm:</strong>
              <div>
                <span>${escapeHTML(itemStation || '---')} ${stationName ? `(${escapeHTML(stationName)})` : ''}</span>
                ${assignBadgeHtml}
              </div>
            </div>
            ${c.sdt ? `
              <div class="mobile-meta-item">
                <strong>📞 Liên hệ:</strong>
                <a href="tel:${escapeHTML(c.sdt)}" style="color:#2563eb; font-weight:700; text-decoration:none;">
                  Gọi ${escapeHTML(c.sdt)} 📲
                </a>
              </div>
            ` : ''}
            <div class="mobile-meta-item">
              <strong>📍 Điểm đo:</strong>
              <div>
                <span>${escapeHTML(c.dia_chi_ddo || c.dia_chi || '---')}</span>
                <br>
                <a href="${mapsUrl}" target="_blank" class="mobile-address-link" title="Mở bản đồ dẫn đường">
                  🗺️ Mở Google Maps dẫn đường
                </a>
              </div>
            </div>
            ${c.dia_chi_kh && c.dia_chi_kh !== c.dia_chi_ddo ? `
              <div class="mobile-meta-item">
                <strong>🏠 ĐC KH:</strong>
                <span style="font-size:0.8rem;">${escapeHTML(c.dia_chi_kh)}</span>
              </div>
            ` : ''}
            <div class="mobile-meta-item" style="grid-column: 1 / -1;">
              <strong>👤 Người cập nhật (Cột L):</strong>
              <div class="updater-picker-wrap" style="margin-top: 4px;">
                <select class="mobile-updater-select" id="msel-updater-${escapeHTML(c.ma_kh)}" onchange="window.PCVT.onUpdaterSelectChange('${escapeHTML(c.ma_kh)}', this.value)">
                  ${updaterSelectOptions}
                </select>
                <input type="text" class="mobile-updater-input" id="mupdater-${escapeHTML(c.ma_kh)}" 
                       style="display: ${isCustom ? 'block' : 'none'}; margin-top: 4px;"
                       value="${escapeHTML(currentUpdater)}" 
                       placeholder="Nhập tên cán bộ khác..."
                       onchange="window.PCVT.updateUpdater('${escapeHTML(c.ma_kh)}', this.value)">
              </div>
            </div>
            ${insp.ngay_kiem_tra ? `
              <div class="mobile-meta-item">
                <strong>🕒 Đã KT:</strong>
                <span style="color:#059669; font-weight:600;">${escapeHTML(insp.ngay_kiem_tra)}</span>
              </div>
            ` : ''}
          </div>

          <!-- Interactive Actions -->
          <div class="mobile-card-actions">
            <button type="button" 
                    class="btn-mobile-status-toggle ${isCompleted ? 'completed' : ''}" 
                    id="mbtn-toggle-${escapeHTML(c.ma_kh)}"
                    onclick="window.PCVT.toggleStatus('${escapeHTML(c.ma_kh)}', ${!isCompleted})">
              ${isCompleted ? '✅ ĐÃ HOÀN THÀNH KIỂM TRA' : '🔘 CHẠM ĐỂ ĐÁNH DẤU HOÀN THÀNH'}
            </button>

            <div class="note-wrapper">
              <label style="font-size:0.75rem; font-weight:700; color:#334155; margin-bottom:2px; display:block;">📋 Hiện trạng hệ thống đo đếm (12 mục):</label>
              <select class="mobile-condition-select" id="msel-cond-${escapeHTML(c.ma_kh)}" 
                      onchange="window.PCVT.onConditionSelect('${escapeHTML(c.ma_kh)}', this.value)" title="Thanh xổ xuống chọn hiện trạng">
                ${conditionOptions}
              </select>
              <input type="text" class="note-input" id="mnote-${escapeHTML(c.ma_kh)}" 
                     value="${escapeHTML(currentNote)}" 
                     placeholder="Ghi chú chi tiết hoặc tự nhập..."
                     onchange="window.PCVT.updateNote('${escapeHTML(c.ma_kh)}', this.value)">
              <details class="condition-multicheck">
                <summary class="condition-multicheck-toggle" title="Mở danh sách để tick chọn nhiều hiện trạng cùng lúc">
                  <span>☑️ Tick chọn nhiều hiện trạng...</span>
                </summary>
                <div class="condition-multicheck-panel">
                  ${conditionCheckboxesMobile}
                </div>
              </details>
            </div>

            <div class="mobile-photo-row" id="mphoto-cell-${escapeHTML(c.ma_kh)}">
              ${photoHtmlMobile}
              <button type="button" class="btn-row-save" style="min-height:42px; padding:0 1rem; border-radius:8px;" onclick="window.PCVT.saveRow('${escapeHTML(c.ma_kh)}')">
                💾 Lưu
              </button>
            </div>
          </div>
        </div>
      `;
    });

    if (tbody) tbody.innerHTML = tableHtml;
    if (mobileContainer) mobileContainer.innerHTML = cardsHtml;
  }

  function renderPagination() {
    const paginationInfo = document.getElementById('paginationInfo');
    const paginationControls = document.getElementById('paginationControls');
    if (!paginationInfo || !paginationControls) return;

    const totalItems = filteredCustomers.length;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;

    const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, totalItems);
    paginationInfo.textContent = `${start.toLocaleString('vi-VN')} - ${end.toLocaleString('vi-VN')} trên ${totalItems.toLocaleString('vi-VN')} KH`;

    let buttonsHtml = '';
    buttonsHtml += `<button class="btn-page" onclick="window.PCVT.goToPage(1)" ${currentPage === 1 ? 'disabled' : ''}>&laquo;</button>`;
    buttonsHtml += `<button class="btn-page" onclick="window.PCVT.goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>&lsaquo;</button>`;

    const pStart = Math.max(1, currentPage - 1);
    const pEnd = Math.min(totalPages, currentPage + 1);
    for (let p = pStart; p <= pEnd; p++) {
      buttonsHtml += `<button class="btn-page ${p === currentPage ? 'active' : ''}" onclick="window.PCVT.goToPage(${p})">${p}</button>`;
    }

    buttonsHtml += `<button class="btn-page" onclick="window.PCVT.goToPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>&rsaquo;</button>`;
    buttonsHtml += `<button class="btn-page" onclick="window.PCVT.goToPage(${totalPages})" ${currentPage >= totalPages ? 'disabled' : ''}>&raquo;</button>`;

    paginationControls.innerHTML = buttonsHtml;
  }

  function renderMobileStickyBar() {
    const stickyBar = document.getElementById('mobileStickyBar');
    const stickyProgress = document.getElementById('mobileStickyProgress');
    if (!stickyBar || !stickyProgress) return;

    let total = allCustomers.length;
    let completed = 0;

    if (currentStationFilter) {
      const stationCustomers = allCustomers.filter(c => (c.id_tram || c.ma_tram) === currentStationFilter);
      total = stationCustomers.length;
      stationCustomers.forEach(c => {
        if (inspectionsMap[c.ma_kh] && inspectionsMap[c.ma_kh].trang_thai === 'Đã kiểm tra') completed++;
      });
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      stickyProgress.innerHTML = `⚡ <strong>Trạm ${escapeHTML(currentStationFilter)}</strong>: ${completed}/${total} (${pct}%)`;
    } else {
      allCustomers.forEach(c => {
        if (inspectionsMap[c.ma_kh] && inspectionsMap[c.ma_kh].trang_thai === 'Đã kiểm tra') completed++;
      });
      const pct = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
      stickyProgress.innerHTML = `⚡ <strong>Tiến độ</strong>: ${completed.toLocaleString('vi-VN')}/${total.toLocaleString('vi-VN')} KH (${pct}%)`;
    }
  }

  // ==========================================================================
  // EVENT LISTENERS
  // ==========================================================================
  function initEventListeners() {
    const searchStationInput = document.getElementById('searchStationInput');
    const stationDropdown = document.getElementById('stationAutocompleteDropdown');
    const clearStationBtn = document.getElementById('btnClearStation');

    if (searchStationInput && stationDropdown) {
      searchStationInput.addEventListener('input', () => {
        const query = searchStationInput.value.toLowerCase().trim();
        if (clearStationBtn) clearStationBtn.style.display = query ? 'block' : 'none';

        if (!query) {
          stationDropdown.classList.remove('active');
          currentStationFilter = '';
          applyFilters();
          renderApp();
          return;
        }

        // Search in all 1,698 stations
        const matchedStations = [];
        for (const [sId, sObj] of Object.entries(stationsMeta)) {
          const sName = (sObj && sObj.name) || '';
          if (sId.toLowerCase().includes(query) || sName.toLowerCase().includes(query)) {
            matchedStations.push({ id: sId, name: sName, khu_vuc: sObj.khu_vuc || '' });
            if (matchedStations.length >= 25) break;
          }
        }

        if (matchedStations.length > 0) {
          let itemsHtml = '';
          matchedStations.forEach(s => {
            itemsHtml += `
              <div class="autocomplete-item" onclick="window.PCVT.selectStation('${escapeHTML(s.id)}', '${escapeHTML(s.name)}')">
                <span class="station-name">${escapeHTML(s.name || 'Trạm TBA')}</span>
                <span class="station-id">Mã: ${escapeHTML(s.id)} ${s.khu_vuc ? `(${escapeHTML(s.khu_vuc)})` : ''}</span>
              </div>
            `;
          });
          stationDropdown.innerHTML = itemsHtml;
          stationDropdown.classList.add('active');
        } else {
          stationDropdown.innerHTML = '<div class="autocomplete-item" style="color:var(--text-light)">Không tìm thấy trạm</div>';
          stationDropdown.classList.add('active');
        }
      });

      document.addEventListener('click', (e) => {
        if (!searchStationInput.contains(e.target) && !stationDropdown.contains(e.target)) {
          stationDropdown.classList.remove('active');
        }
      });
    }

    if (clearStationBtn) {
      clearStationBtn.addEventListener('click', () => {
        if (searchStationInput) searchStationInput.value = '';
        clearStationBtn.style.display = 'none';
        currentStationFilter = '';
        applyFilters();
        renderApp();
      });
    }

    const filterAreaSelect = document.getElementById('filterAreaSelect');
    if (filterAreaSelect) {
      filterAreaSelect.addEventListener('change', (e) => {
        currentAreaFilter = e.target.value;
        applyFilters();
        renderApp();
      });
    }

    const filterConditionSelect = document.getElementById('filterConditionSelect');
    if (filterConditionSelect) {
      filterConditionSelect.addEventListener('change', (e) => {
        currentConditionFilter = e.target.value;
        applyFilters();
        renderApp();
      });
    }

    const globalSearchInput = document.getElementById('globalKeywordInput');
    if (globalSearchInput) {
      let debounceTimer;
      globalSearchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          currentSearchKeyword = e.target.value;
          applyFilters();
          renderApp();
        }, 200);
      });
    }

    document.querySelectorAll('.status-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.status-tab-btn').forEach(b => b.classList.remove('active'));
        const target = e.currentTarget;
        target.classList.add('active');
        currentStatusFilter = target.getAttribute('data-status') || 'all';
        applyFilters();
        renderApp();
      });
    });

    document.querySelectorAll('.btn-view-mode').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-view-mode').forEach(b => b.classList.remove('active'));
        const target = e.currentTarget;
        target.classList.add('active');
        const mode = target.getAttribute('data-mode');
        activeViewMode = mode;
        applyViewMode(mode);
      });
    });

    const btnResetFilters = document.getElementById('btnResetFilters');
    if (btnResetFilters) btnResetFilters.addEventListener('click', resetFilters);

    const btnSyncGSheet = document.getElementById('btnSyncGSheet');
    if (btnSyncGSheet) {
      btnSyncGSheet.addEventListener('click', async () => {
        showToast('🔄 Đang đồng bộ kết quả kiểm tra và phân công từ Google Sheet...', 'info');
        if (navigator.onLine) {
          processOfflineQueue();
        }
        await pollFieldUpdates(true);
      });
    }

    const btnExport = document.getElementById('btnExportExcel');
    if (btnExport) btnExport.addEventListener('click', exportToExcel);

    const btnCheckAllStation = document.getElementById('btnCheckAllStation');
    if (btnCheckAllStation) btnCheckAllStation.addEventListener('click', checkAllInCurrentStation);

    const formSaveSheetUrl = document.getElementById('formSaveSheetUrl');
    if (formSaveSheetUrl) {
      formSaveSheetUrl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inputUrl = document.getElementById('inputGoogleSheetUrl').value.trim();
        if (inputUrl) {
          closeModal('modalSheetGuide');
          await syncFromGoogleSheet(inputUrl, true);
        }
      });
    }

    const fileImportInput = document.getElementById('fileImportInput');
    if (fileImportInput) fileImportInput.addEventListener('change', handleFileImport);

    // Inspector name dropdown & input events
    const selInspector = document.getElementById('selectInspectorPreset');
    const inputInspector = document.getElementById('inputInspectorName');
    const btnSaveInspector = document.getElementById('btnSaveInspector');

    if (selInspector) {
      selInspector.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === '__custom__') {
          if (inputInspector) {
            inputInspector.style.display = 'block';
            inputInspector.focus();
          }
          if (btnSaveInspector) btnSaveInspector.style.display = 'inline-flex';
        } else if (val) {
          if (inputInspector) {
            inputInspector.style.display = 'none';
            inputInspector.value = val;
          }
          if (btnSaveInspector) btnSaveInspector.style.display = 'none';
          setCurrentInspector(val);
          showToast(`Đã chọn cán bộ kiểm tra: "${val}"`, 'success');
        } else {
          if (inputInspector) {
            inputInspector.style.display = 'none';
            inputInspector.value = '';
          }
          if (btnSaveInspector) btnSaveInspector.style.display = 'none';
          setCurrentInspector('');
          showToast('Đã xóa chọn cán bộ kiểm tra', 'info');
        }
      });
    }

    if (btnSaveInspector && inputInspector) {
      btnSaveInspector.addEventListener('click', () => {
        const name = setCurrentInspector(inputInspector.value);
        showToast(name ? `Đã lưu cán bộ kiểm tra: "${name}"` : 'Đã xóa tên cán bộ kiểm tra', 'success');
      });
      inputInspector.addEventListener('change', () => {
        setCurrentInspector(inputInspector.value);
      });
      inputInspector.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const name = setCurrentInspector(inputInspector.value);
          showToast(name ? `Đã lưu cán bộ kiểm tra: "${name}"` : 'Đã xóa tên cán bộ kiểm tra', 'success');
          inputInspector.blur();
        }
      });
    }

    // Webhook settings & script copy
    const btnSaveWebhook = document.getElementById('btnSaveWebhookUrl');
    const inputAppsScriptUrl = document.getElementById('inputAppsScriptUrl');
    if (btnSaveWebhook && inputAppsScriptUrl) {
      btnSaveWebhook.addEventListener('click', () => {
        const url = inputAppsScriptUrl.value.trim();
        localStorage.setItem(STORAGE_KEY_WEBHOOK_URL, url);
        if (url) {
          updateSyncStatus('synced', '🟢 Đã kết nối Webhook Google Sheet', 'Cập nhật từ điện thoại sẽ đồng bộ ngay lập tức');
          showToast('Đã lưu cấu hình Webhook Google Apps Script thành công!', 'success');
          processOfflineQueue();
        } else {
          updateSyncStatus('warning', '💾 Đang lưu trên máy này (Chưa gửi Sheet)', 'Dùng nút "Gộp Đa Thiết Bị" hoặc cài Webhook để đồng bộ');
          showToast('Đã xóa cấu hình Webhook Google Sheet', 'info');
        }
      });
    }

    const btnCopyScript = document.getElementById('btnCopyAppsScriptCode');
    if (btnCopyScript) {
      btnCopyScript.addEventListener('click', () => {
        const scriptCode = `// =========================================================================
// GOOGLE APPS SCRIPT CHO HỆ THỐNG KIỆN TOÀN HTĐĐ PC VŨNG TÀU (ĐỒNG BỘ ĐA THIẾT BỊ)
// 1. Sheet Log_DongBo (9 cột): Nhật ký kiểm tra khách hàng
// 2. Sheet PhanCong_Tram (7 cột): Phân công trạm cho 9 nhóm công tác
// =========================================================================

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(15000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data = JSON.parse(e.postData.contents);
    var action = String(data.action || '').trim();
    var nowTime = new Date().getTime();

    // -------------------------------------------------------------------------
    // A. XỬ LÝ ĐỒNG BỘ PHÂN CÔNG TRẠM (PhanCong_Tram)
    // -------------------------------------------------------------------------
    if (action === 'assign_stations' || action === 'unassign_stations' || data.type === 'station_assignment') {
      var assignSheet = ss.getSheetByName('PhanCong_Tram');
      if (!assignSheet) {
        assignSheet = ss.insertSheet('PhanCong_Tram');
        assignSheet.appendRow(['Timestamp', 'ID trạm', 'Tên trạm', 'Mã nhóm', 'Tên nhóm', 'Trưởng nhóm', 'Thời gian giao']);
      } else if (assignSheet.getLastRow() === 0) {
        assignSheet.appendRow(['Timestamp', 'ID trạm', 'Tên trạm', 'Mã nhóm', 'Tên nhóm', 'Trưởng nhóm', 'Thời gian giao']);
      }

      var assignLastRow = assignSheet.getLastRow();

      if (action === 'unassign_stations') {
        // Hủy giao việc: xóa dòng các trạm này khỏi PhanCong_Tram
        var unassignIds = data.station_ids || [];
        if (assignLastRow > 1 && unassignIds.length > 0) {
          var idSet = {};
          for (var u = 0; u < unassignIds.length; u++) idSet[String(unassignIds[u]).trim()] = true;
          var allRows = assignSheet.getRange(2, 1, assignLastRow - 1, 7).getValues();
          for (var r = allRows.length - 1; r >= 0; r--) {
            var rowStId = String(allRows[r][1] || '').trim();
            if (idSet[rowStId]) {
              assignSheet.deleteRow(r + 2);
            }
          }
        }
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success',
          action: 'unassigned',
          count: unassignIds.length,
          server_time: nowTime
        })).setMimeType(ContentService.MimeType.JSON);

      } else {
        // Giao việc trạm: cập nhật dòng đã có hoặc thêm dòng mới
        var assignments = data.assignments || [];
        if (assignLastRow > 1 && assignments.length > 0) {
          var existingData = assignSheet.getRange(2, 2, assignLastRow - 1, 1).getValues();
          var idToRowMap = {};
          for (var i = 0; i < existingData.length; i++) {
            var existId = String(existingData[i][0] || '').trim();
            if (existId) idToRowMap[existId] = i + 2;
          }

          assignments.forEach(function(item) {
            var stId = String(item.stId || item.id || '').trim();
            var rowVals = [
              nowTime,
              stId,
              String(item.stName || item.name || '').trim(),
              String(item.groupId || '').trim(),
              String(item.groupName || '').trim(),
              String(item.leader || '').trim(),
              String(item.assignedAt || Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm")).trim()
            ];

            if (idToRowMap[stId]) {
              assignSheet.getRange(idToRowMap[stId], 1, 1, 7).setValues([rowVals]);
            } else {
              assignSheet.appendRow(rowVals);
              idToRowMap[stId] = assignSheet.getLastRow();
            }
          });
        } else {
          assignments.forEach(function(item) {
            assignSheet.appendRow([
              nowTime,
              String(item.stId || item.id || '').trim(),
              String(item.stName || item.name || '').trim(),
              String(item.groupId || '').trim(),
              String(item.groupName || '').trim(),
              String(item.leader || '').trim(),
              String(item.assignedAt || Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm")).trim()
            ]);
          });
        }

        return ContentService.createTextOutput(JSON.stringify({
          status: 'success',
          action: 'assigned',
          count: assignments.length,
          server_time: nowTime
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // -------------------------------------------------------------------------
    // B. XỬ LÝ ĐỒNG BỘ KHÁCH HÀNG (Log_DongBo 10 CỘT KÈM ẢNH & Trang tính chính)
    // -------------------------------------------------------------------------
    var sheet = ss.getActiveSheet();
    var maKH = String(data.ma_kh || '').trim();
    var idTram = String(data.id_tram || '').trim();
    var tenTram = String(data.ten_tram || '').trim();
    var danhSo = String(data.danh_so || '').trim();
    var nguoiCapNhat = String(data.nguoi_cap_nhat || '').trim();
    var trangThaiX = (data.trang_thai === 'Đã kiểm tra' || data.trang_thai_x === 'X') ? 'X' : '';
    var ghiChu = String(data.ghi_chu || '').trim();
    var ngayKT = data.ngay_kiem_tra || Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm");
    var photoUrl = String(data.hinh_anh || data.photo || '').trim();

    if (!maKH) return ContentService.createTextOutput(JSON.stringify({status: 'no_makh'}));

    // Tự động lưu ảnh vào Google Drive nếu gửi dạng Base64
    if (photoUrl && photoUrl.indexOf('data:image') === 0) {
      try {
        var base64Data = photoUrl.split(',')[1];
        var contentType = photoUrl.substring(5, photoUrl.indexOf(';'));
        var decodedBlob = Utilities.newBlob(Utilities.base64Decode(base64Data), contentType, maKH + '_' + nowTime + '.jpg');
        var folderIterator = DriveApp.getFoldersByName('Anh_KiemTra_HTDD');
        var folder = folderIterator.hasNext() ? folderIterator.next() : DriveApp.createFolder('Anh_KiemTra_HTDD');
        var file = folder.createFile(decodedBlob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        photoUrl = 'https://lh3.googleusercontent.com/d/' + file.getId();
      } catch (driveErr) {
        // Nếu Drive đầy hoặc không có quyền ghi, giữ nguyên base64 nếu cần
      }
    }

    // 1. Cập nhật trang nhật ký Log_DongBo 10 cột TRƯỚC TIÊN (Siêu tốc < 100ms, đảm bảo đồng bộ tức thời)
    var logSheet = ss.getSheetByName('Log_DongBo');
    if (!logSheet) {
      logSheet = ss.insertSheet('Log_DongBo');
      logSheet.appendRow(['Timestamp', 'Mã KH', 'ID trạm', 'Tên trạm', 'Mã danh số', 'Người cập nhật', 'Trạng thái', 'Ngày KT', 'Ghi chú', 'Ảnh chụp công tơ']);
    } else if (logSheet.getLastRow() === 0) {
      logSheet.appendRow(['Timestamp', 'Mã KH', 'ID trạm', 'Tên trạm', 'Mã danh số', 'Người cập nhật', 'Trạng thái', 'Ngày KT', 'Ghi chú', 'Ảnh chụp công tơ']);
    }

    var logLastRow = logSheet.getLastRow();
    var existingRows = [];
    if (logLastRow > 1) {
      var logFinder = logSheet.getRange(2, 2, logLastRow - 1, 1).createTextFinder(maKH).matchEntireCell(true).findAll();
      for (var f = 0; f < logFinder.length; f++) {
        existingRows.push(logFinder[f].getRow());
      }
    }

    if (trangThaiX === 'X') {
      if (existingRows.length > 0) {
        var oldRow = logSheet.getRange(existingRows[0], 1, 1, 10).getValues()[0];
        if (!photoUrl && oldRow[9]) photoUrl = oldRow[9];
        var rowData = [nowTime, maKH, idTram, tenTram, danhSo, nguoiCapNhat, 'X', ngayKT, ghiChu, photoUrl];
        logSheet.getRange(existingRows[0], 1, 1, 10).setValues([rowData]);
        for (var d = existingRows.length - 1; d >= 1; d--) {
          logSheet.deleteRow(existingRows[d]);
        }
      } else {
        var rowData = [nowTime, maKH, idTram, tenTram, danhSo, nguoiCapNhat, 'X', ngayKT, ghiChu, photoUrl];
        logSheet.appendRow(rowData);
      }
    } else {
      if (existingRows.length > 0) {
        for (var r = existingRows.length - 1; r >= 0; r--) {
          logSheet.deleteRow(existingRows[r]);
        }
      }
    }

    // 2. Cập nhật trang tính dữ liệu chính (Sheet đầu tiên: Cột Người cập nhật, Trạng thái, và Cột Ảnh)
    var rowIndex = -1;
    try {
      var sheet = ss.getSheets()[0];
      var rangeB = sheet.getRange("B:B");
      var foundCell = rangeB.createTextFinder(maKH).matchEntireCell(true).findNext();
      if (foundCell) {
        rowIndex = foundCell.getRow();
        var maxCol = Math.max(sheet.getLastColumn(), 22);
        var headerVals = sheet.getRange(1, 1, 1, maxCol).getValues()[0];
        var colUpdaterIdx = 19;
        var colStatusIdx = 20;
        var colPhotoIdx = -1;
        for (var c = 0; c < headerVals.length; c++) {
          var hName = String(headerVals[c] || '').toLowerCase().trim();
          if (hName.indexOf('người cập nhật') !== -1 || hName.indexOf('nguoi cap nhat') !== -1) colUpdaterIdx = c + 1;
          if (hName.indexOf('trạng thái') !== -1 || hName.indexOf('trang thai') !== -1) colStatusIdx = c + 1;
          if (hName.indexOf('ảnh') !== -1 || hName.indexOf('link') !== -1) colPhotoIdx = c + 1;
        }
        if (colPhotoIdx === -1) {
          colPhotoIdx = 22; // Cột 22 nằm ngay sau Cột 21 "đã thay định kỳ"
          sheet.getRange(1, colPhotoIdx).setValue('Ảnh chụp công tơ');
          sheet.getRange(1, colPhotoIdx).setBackground('#e0f2fe').setFontWeight('bold');
        }

        if (trangThaiX === 'X') {
          sheet.getRange(rowIndex, colUpdaterIdx).setValue(nguoiCapNhat);
          sheet.getRange(rowIndex, colStatusIdx).setValue('X');
          if (photoUrl) {
            sheet.getRange(rowIndex, colPhotoIdx).setValue(photoUrl);
          }
        } else {
          sheet.getRange(rowIndex, colUpdaterIdx).setValue('');
          sheet.getRange(rowIndex, colStatusIdx).setValue('');
        }
      }
    } catch(sheetErr) {
      // Bỏ qua lỗi timeout trang chính nếu có, vì Log_DongBo đã ghi thành công
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      row: rowIndex,
      ma_kh: maKH,
      trang_thai: trangThaiX,
      action: (trangThaiX === 'X') ? 'saved' : 'deleted',
      server_time: nowTime
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = String((e && e.parameter && e.parameter.action) || 'get_updates').trim();
    var nowTime = new Date().getTime();

    // 1. ĐỌC DANH SÁCH TRẠM ĐÃ PHÂN CÔNG (PhanCong_Tram)
    var stationAssignments = [];
    var assignSheet = ss.getSheetByName('PhanCong_Tram');
    if (assignSheet && assignSheet.getLastRow() > 1) {
      var assignData = assignSheet.getDataRange().getValues();
      for (var a = 1; a < assignData.length; a++) {
        var aStId = String(assignData[a][1] || '').trim();
        if (aStId) {
          stationAssignments.push({
            timestamp: Number(assignData[a][0] || 0),
            stId: aStId,
            stName: String(assignData[a][2] || '').trim(),
            groupId: String(assignData[a][3] || '').trim(),
            groupName: String(assignData[a][4] || '').trim(),
            leader: String(assignData[a][5] || '').trim(),
            assignedAt: String(assignData[a][6] || '').trim()
          });
        }
      }
    }

    if (action === 'get_station_assignments') {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        server_time: nowTime,
        station_assignments: stationAssignments
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. ĐỌC CẬP NHẬT KIỂM TRA KHÁCH HÀNG (Log_DongBo)
    var since = Number((e && e.parameter && e.parameter.since) || 0);
    var logSheet = ss.getSheetByName('Log_DongBo');
    var updates = [];

    if (logSheet && logSheet.getLastRow() > 1) {
      var data = logSheet.getDataRange().getValues();
      var headers = (data[0] || []).map(function(h) { return String(h || '').toLowerCase().trim(); });
      
      var idxMaKh = headers.indexOf('mã kh');
      if (idxMaKh === -1) idxMaKh = 1;
      
      var idxIdTram = headers.indexOf('id trạm');
      if (idxIdTram === -1 && data[0].length >= 9) idxIdTram = 2;

      var idxTenTram = headers.indexOf('tên trạm');
      if (idxTenTram === -1 && data[0].length >= 9) idxTenTram = 3;

      var idxDanhSo = headers.indexOf('mã danh số') !== -1 ? headers.indexOf('mã danh số') : headers.indexOf('danh số');
      if (idxDanhSo === -1 && data[0].length >= 9) idxDanhSo = 4;

      var idxNguoi = -1;
      for (var hi = 0; hi < headers.length; hi++) {
        if (headers[hi].indexOf('cán bộ') !== -1 || headers[hi].indexOf('người') !== -1 || headers[hi].indexOf('nhóm') !== -1) {
          idxNguoi = hi;
          break;
        }
      }
      if (idxNguoi === -1) idxNguoi = (data[0].length >= 9 ? 5 : 2);

      var idxTrangThai = -1;
      for (var hj = 0; hj < headers.length; hj++) {
        if (headers[hj].indexOf('trạng thái') !== -1 || headers[hj] === 'x') {
          idxTrangThai = hj;
          break;
        }
      }
      if (idxTrangThai === -1) idxTrangThai = (data[0].length >= 9 ? 6 : 3);

      var idxNgay = -1;
      for (var hk = 0; hk < headers.length; hk++) {
        if (headers[hk].indexOf('ngày') !== -1) {
          idxNgay = hk;
          break;
        }
      }
      if (idxNgay === -1) idxNgay = (data[0].length >= 9 ? 7 : 4);

      var idxGhiChu = -1;
      for (var hg = 0; hg < headers.length; hg++) {
        if (headers[hg].indexOf('ghi chú') !== -1 || headers[hg].indexOf('ghi chu') !== -1 || headers[hg].indexOf('hiện trạng') !== -1 || headers[hg].indexOf('hien trang') !== -1) {
          idxGhiChu = hg;
          break;
        }
      }
      if (idxGhiChu === -1) idxGhiChu = (data[0].length >= 9 ? 8 : (data[0].length >= 6 ? 5 : -1));

      var idxHinhAnh = -1;
      for (var hx = 0; hx < headers.length; hx++) {
        if (headers[hx].indexOf('ảnh') !== -1 || headers[hx].indexOf('hinh') !== -1) {
          idxHinhAnh = hx;
          break;
        }
      }
      if (idxHinhAnh === -1 && data[0].length >= 10) idxHinhAnh = 9;

      for (var i = 1; i < data.length; i++) {
        var rawTime = data[i][0];
        var rowTime = (rawTime instanceof Date) ? rawTime.getTime() : Number(rawTime);
        if (isNaN(rowTime) || rowTime <= 0) rowTime = Date.now();

        if (since === 0 || rowTime > since) {
          var uMaKh = String(data[i][idxMaKh] || '').trim();
          if (uMaKh) {
            var rowNote = idxGhiChu !== -1 ? String(data[i][idxGhiChu] || '').trim() : '';
            var rowUpdater = String(data[i][idxNguoi] || '').trim();
            // Nếu ghi chú vô tình bị lệch cột chứa tên cán bộ/nhóm, làm sạch ngay
            if (rowNote && (rowNote.indexOf('Nguyễn') !== -1 || rowNote.indexOf('Nhóm') !== -1 || rowNote.indexOf('+') !== -1 || rowNote.indexOf('Trưởng nhóm') !== -1)) {
              if (!rowUpdater) rowUpdater = rowNote;
              rowNote = '';
            }

            updates.push({
              timestamp: rowTime,
              ma_kh: uMaKh,
              id_tram: idxIdTram !== -1 ? String(data[i][idxIdTram] || '').trim() : '',
              ten_tram: idxTenTram !== -1 ? String(data[i][idxTenTram] || '').trim() : '',
              danh_so: idxDanhSo !== -1 ? String(data[i][idxDanhSo] || '').trim() : '',
              nguoi_cap_nhat: rowUpdater,
              trang_thai_x: String(data[i][idxTrangThai] || 'X').trim(),
              ngay_kiem_tra: idxNgay !== -1 ? String(data[i][idxNgay] || '').trim() : '',
              ghi_chu: rowNote,
              hinh_anh: idxHinhAnh !== -1 ? String(data[i][idxHinhAnh] || '').trim() : ''
            });
          }
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      count: updates.length,
      server_time: nowTime,
      updates: updates,
      station_assignments: stationAssignments
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// HÀM TIỆN ÍCH: Dọn dẹp sạch sẽ các dòng trùng lặp hiện có trong Log_DongBo (Chạy 1 lần)
function donDepLogDongBo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('Log_DongBo');
  if (!logSheet || logSheet.getLastRow() < 2) return;

  var data = logSheet.getDataRange().getValues();
  var isNineCol = (data[0] && data[0].length >= 9);
  var statusIdx = isNineCol ? 6 : 3;
  var seen = {};
  var rowsToDelete = [];

  for (var i = 1; i < data.length; i++) {
    var maKH = String(data[i][1]).trim();
    var status = String(data[i][statusIdx]).trim();
    if (status !== 'X' || seen[maKH] || maKH.indexOf('TEST_PING') !== -1) {
      rowsToDelete.push(i + 1);
    } else {
      seen[maKH] = true;
    }
  }

  for (var k = rowsToDelete.length - 1; k >= 0; k--) {
    logSheet.deleteRow(rowsToDelete[k]);
  }
}

// TẠO MENU TIỆN ÍCH TRÊN GOOGLE SHEETS
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚡ Kiện Toàn HTĐĐ')
    .addItem('➕ Cài đặt cột Ảnh chụp công tơ', 'caiDatCotAnh')
    .addItem('🧹 Dọn dẹp Log_DongBo trùng lặp', 'donDepLogDongBo')
    .addToUi();
}

// HÀM CÀI ĐẶT CỘT ẢNH CHỤP VÀ THƯ MỤC DRIVE (CHẠY 1 LẦN)
function caiDatCotAnh() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Cập nhật Sheet chính (Sheet đầu tiên): Tạo tiêu đề Cột 22 "Ảnh chụp công tơ"
  var mainSheet = ss.getSheets()[0];
  var lastCol = mainSheet.getLastColumn();
  var maxCol = Math.max(lastCol, 22);
  var headers = mainSheet.getRange(1, 1, 1, maxCol).getValues()[0];
  var photoColIdx = -1;
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').toLowerCase().trim();
    if (h.indexOf('ảnh') !== -1 || h.indexOf('link') !== -1) {
      photoColIdx = c + 1;
      break;
    }
  }
  if (photoColIdx === -1) {
    photoColIdx = 22; // Cột 22 ngay sau Cột 21 "đã thay định kỳ"
    mainSheet.getRange(1, photoColIdx).setValue('Ảnh chụp công tơ');
    mainSheet.getRange(1, photoColIdx).setBackground('#e0f2fe').setFontWeight('bold');
  }

  // 2. Cập nhật Sheet Log_DongBo: Cột 10 là "Ảnh chụp công tơ"
  var logSheet = ss.getSheetByName('Log_DongBo');
  if (!logSheet) {
    logSheet = ss.insertSheet('Log_DongBo');
    logSheet.appendRow(['Timestamp', 'Mã KH', 'ID trạm', 'Tên trạm', 'Mã danh số', 'Người cập nhật', 'Trạng thái', 'Ngày KT', 'Ghi chú', 'Ảnh chụp công tơ']);
    logSheet.getRange(1, 1, 1, 10).setBackground('#0284c7').setFontColor('#ffffff').setFontWeight('bold');
  } else {
    logSheet.getRange(1, 10).setValue('Ảnh chụp công tơ');
    logSheet.getRange(1, 10).setBackground('#0284c7').setFontColor('#ffffff').setFontWeight('bold');
  }

  // 3. Khởi tạo thư mục Google Drive để sẵn sàng lưu ảnh
  var folderIterator = DriveApp.getFoldersByName('Anh_KiemTra_HTDD');
  var folder = folderIterator.hasNext() ? folderIterator.next() : DriveApp.createFolder('Anh_KiemTra_HTDD');
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  SpreadsheetApp.getUi().alert('✅ CÀI ĐẶT CỘT ẢNH THÀNH CÔNG!\\n\\n1. Đã thêm cột "Ảnh chụp công tơ" vào Sheet chính (Cột 22).\\n2. Đã kiểm tra cột 10 trên Sheet Log_DongBo.\\n3. Đã sẵn sàng thư mục "Anh_KiemTra_HTDD" trên Google Drive.');
}`;
        navigator.clipboard.writeText(scriptCode).then(() => {
          showToast('Đã sao chép mã Google Apps Script đồng bộ 2 chiều! Hãy dán vào Apps Script của Google Sheet.', 'success');
        }).catch(() => {
          showToast('Vui lòng mở rộng phần hướng dẫn để xem mã!', 'info');
        });
      });
    }

    // Live Field Monitor Controls
    const btnToggleLive = document.getElementById('btnToggleLiveSync');
    if (btnToggleLive) {
      btnToggleLive.addEventListener('click', () => {
        if (isLiveSyncRunning) {
          stopLiveFieldSync();
          showToast('Đã tạm dừng tự động theo dõi hiện trường', 'info');
        } else {
          startLiveFieldSync();
          pollFieldUpdates(false);
          showToast('Đã kích hoạt đồng bộ hiện trường thời gian thực!', 'success');
        }
      });
    }

    const btnQuickScan = document.getElementById('btnManualQuickScan');
    if (btnQuickScan) {
      btnQuickScan.addEventListener('click', async () => {
        btnQuickScan.disabled = true;
        btnQuickScan.classList.add('scanning');
        showToast('🔍 Đang quét trực tiếp cập nhật từ Google Sheet...', 'info');
        try {
          if (navigator.onLine) {
            processOfflineQueue();
          }
          await pollFieldUpdates(true);
        } catch (scanErr) {
          console.error('Quick scan error:', scanErr);
          showToast('Lỗi khi quét cập nhật từ Google Sheet', 'error');
        } finally {
          btnQuickScan.disabled = false;
          btnQuickScan.classList.remove('scanning');
        }
      });
    }

    const btnSound = document.getElementById('btnToggleSound');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        isSoundAlertEnabled = !isSoundAlertEnabled;
        localStorage.setItem(STORAGE_KEY_SOUND_ENABLED, isSoundAlertEnabled ? 'true' : 'false');
        const sText = document.getElementById('btnToggleSoundText');
        const sIcon = document.getElementById('btnToggleSoundIcon');
        if (sText) sText.textContent = isSoundAlertEnabled ? 'Chuông: Bật' : 'Chuông: Tắt';
        if (sIcon) sIcon.textContent = isSoundAlertEnabled ? '🔔' : '🔕';
        if (isSoundAlertEnabled) {
          playNotificationChime();
          showToast('Đã bật chuông báo âm thanh khi có KH mới!', 'success');
        } else {
          showToast('Đã tắt chuông báo âm thanh', 'info');
        }
      });
    }

    const btnFeed = document.getElementById('btnToggleFeed');
    const btnCloseFeed = document.getElementById('btnCloseFeed');
    const feedDrawer = document.getElementById('liveFeedDrawer');
    if (btnFeed && feedDrawer) {
      btnFeed.addEventListener('click', () => {
        const isHidden = feedDrawer.style.display === 'none';
        feedDrawer.style.display = isHidden ? 'block' : 'none';
        if (isHidden) renderLiveActivityFeed();
      });
    }
    if (btnCloseFeed && feedDrawer) {
      btnCloseFeed.addEventListener('click', () => {
        feedDrawer.style.display = 'none';
      });
    }

    // --- Multi-Device Sync & Merge Events (Đồng bộ đa thiết bị) ---
    const btnCopySync = document.getElementById('btnCopySyncCode');
    if (btnCopySync) {
      btnCopySync.addEventListener('click', () => {
        const code = refreshSyncExportData();
        if (!code || code === '{}') {
          showToast('Chưa có khách hàng nào được kiểm tra để sao chép!', 'info');
          return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(() => {
            showToast('📋 Đã sao chép mã đồng bộ! Hãy gửi qua Zalo hoặc dán vào máy tính.', 'success');
          }).catch(() => fallbackCopySync(code));
        } else {
          fallbackCopySync(code);
        }
      });
    }

    function fallbackCopySync(text) {
      const ta = document.getElementById('syncExportCodeText');
      if (ta) {
        ta.select();
        document.execCommand('copy');
        showToast('📋 Đã sao chép mã đồng bộ!', 'success');
      }
    }

    const btnDownSync = document.getElementById('btnDownloadSyncFile');
    if (btnDownSync) {
      btnDownSync.addEventListener('click', () => {
        const code = refreshSyncExportData();
        const blob = new Blob([code], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const now = new Date();
        const timeTag = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
        a.href = url;
        a.download = `KetQua_DongBo_KienToan_${timeTag}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('💾 Đã tải tệp KetQua_DongBo_KienToan.json!', 'success');
      });
    }

    const btnApplySync = document.getElementById('btnApplySyncCode');
    if (btnApplySync) {
      btnApplySync.addEventListener('click', () => {
        const codeArea = document.getElementById('syncImportCodeText');
        if (codeArea) {
          mergeSyncPackage(codeArea.value);
        }
      });
    }

    const fileImportSync = document.getElementById('syncImportFileInput');
    if (fileImportSync) {
      fileImportSync.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          mergeSyncPackage(evt.target.result);
          fileImportSync.value = '';
        };
        reader.onerror = () => {
          showToast('Lỗi khi đọc tệp đồng bộ!', 'error');
          fileImportSync.value = '';
        };
        reader.readAsText(file);
      });
    }

    // Share Webhook auto-config link for mobile phone
    function handleShareWebhook() {
      const currentWebhook = getWebhookUrl();
      if (!currentWebhook) {
        showToast('Bạn chưa cấu hình Webhook URL! Vui lòng dán link Webhook và bấm Lưu Cấu Hình trước.', 'warning');
        openModal('modalSheetGuide');
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set('webhook', currentWebhook);
      const shareUrl = url.toString();

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => {
          showToast('📲 Đã sao chép link tự động cấu hình! Hãy gửi link này lên Zalo và mở trên điện thoại.', 'success');
        }).catch(() => {
          prompt('Sao chép link này và gửi qua Zalo để mở trên điện thoại:', shareUrl);
        });
      } else {
        prompt('Sao chép link này và gửi qua Zalo để mở trên điện thoại:', shareUrl);
      }
    }

    const btnSharePhone = document.getElementById('btnShareWebhookToPhone');
    if (btnSharePhone) {
      btnSharePhone.addEventListener('click', handleShareWebhook);
    }

    const btnSharePhoneModal = document.getElementById('btnShareWebhookFromModal');
    if (btnSharePhoneModal) {
      btnSharePhoneModal.addEventListener('click', handleShareWebhook);
    }

    // --- YouTube Sidebar & Station Assignment Events ---
    const btnToggleSidebar = document.getElementById('btnToggleSidebar');
    if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', toggleSidebar);

    const btnCloseSidebar = document.getElementById('btnCloseSidebar');
    if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', closeSidebar);

    const sidebarBackdrop = document.getElementById('ytSidebarBackdrop');
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

    const ytNavAll = document.getElementById('ytNavAllCustomers');
    if (ytNavAll) {
      ytNavAll.addEventListener('click', () => {
        setAssignedGroupFilter('');
        window.PCVT.scrollToTop();
      });
    }

    const btnOpenAssignModal = document.getElementById('btnOpenAssignModal');
    if (btnOpenAssignModal) {
      btnOpenAssignModal.addEventListener('click', () => {
        openStationAssignmentModal();
      });
    }

    const btnClearFilterSidebar = document.getElementById('ytBtnClearGroupFilter');
    if (btnClearFilterSidebar) {
      btnClearFilterSidebar.addEventListener('click', () => setAssignedGroupFilter(''));
    }

    const btnClearGroupBanner = document.getElementById('btnClearGroupBanner');
    if (btnClearGroupBanner) {
      btnClearGroupBanner.addEventListener('click', () => setAssignedGroupFilter(''));
    }

    const filterWorkgroupSelect = document.getElementById('filterWorkgroupSelect');
    if (filterWorkgroupSelect) {
      filterWorkgroupSelect.addEventListener('change', () => {
        setAssignedGroupFilter(filterWorkgroupSelect.value);
      });
    }

    // Station Assignment Modal interactions
    const assignSearchInput = document.getElementById('assignStationSearchInput');
    const btnClearAssignSearch = document.getElementById('btnClearAssignStationSearch');
    let assignSearchDebounceTimer = null;
    if (assignSearchInput) {
      assignSearchInput.addEventListener('input', () => {
        clearTimeout(assignSearchDebounceTimer);
        assignSearchDebounceTimer = setTimeout(() => {
          currentAssignModalSearch = assignSearchInput.value;
          if (btnClearAssignSearch) {
            btnClearAssignSearch.style.display = currentAssignModalSearch ? 'block' : 'none';
          }
          renderStationAssignmentModalTable();
        }, 100);
      });

      assignSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(assignSearchDebounceTimer);
          currentAssignModalSearch = assignSearchInput.value;
          if (btnClearAssignSearch) {
            btnClearAssignSearch.style.display = currentAssignModalSearch ? 'block' : 'none';
          }
          renderStationAssignmentModalTable();
        } else if (e.key === 'Escape') {
          if (assignSearchInput.value) {
            assignSearchInput.value = '';
            currentAssignModalSearch = '';
            if (btnClearAssignSearch) btnClearAssignSearch.style.display = 'none';
            renderStationAssignmentModalTable();
          }
        }
      });
    }
    if (btnClearAssignSearch) {
      btnClearAssignSearch.addEventListener('click', () => {
        if (assignSearchInput) {
          assignSearchInput.value = '';
          assignSearchInput.focus();
        }
        currentAssignModalSearch = '';
        btnClearAssignSearch.style.display = 'none';
        renderStationAssignmentModalTable();
      });
    }

    // Filter pills in assignment modal
    document.querySelectorAll('.assign-pill-filter').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.assign-pill-filter').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentAssignModalFilter = pill.getAttribute('data-filter') || 'all';
        renderStationAssignmentModalTable();
      });
    });

    // Select all checkbox in assignment modal
    const chkAssignAll = document.getElementById('chkAssignSelectAll');
    if (chkAssignAll) {
      chkAssignAll.addEventListener('change', () => {
        const filtered = getFilteredStationsForAssignModal();
        if (chkAssignAll.checked) {
          filtered.forEach(([stId]) => selectedAssignStations.add(stId));
        } else {
          filtered.forEach(([stId]) => selectedAssignStations.delete(stId));
        }
        renderStationAssignmentModalTable();
      });
    }

    // Quick select buttons in assignment modal
    const btnSelectAllFiltered = document.getElementById('btnSelectAllFilteredStations');
    if (btnSelectAllFiltered) {
      btnSelectAllFiltered.addEventListener('click', () => {
        const filtered = getFilteredStationsForAssignModal();
        filtered.forEach(([stId]) => selectedAssignStations.add(stId));
        renderStationAssignmentModalTable();
        const custStats = getStationCustStats();
        let totalCust = 0;
        filtered.forEach(([stId]) => {
          totalCust += (custStats[stId] && custStats[stId].total) || 0;
        });
        showToast(`Đã chọn tất cả ${filtered.length.toLocaleString('vi-VN')} trạm (${totalCust.toLocaleString('vi-VN')} KH)!`, 'info');
      });
    }

    const btnClearAllSelected = document.getElementById('btnClearAllSelectedStations');
    if (btnClearAllSelected) {
      btnClearAllSelected.addEventListener('click', () => {
        selectedAssignStations.clear();
        renderStationAssignmentModalTable();
        showToast('Đã bỏ chọn tất cả trạm', 'info');
      });
    }

    // Apply / Unassign buttons in assignment modal
    const btnApplyAssign = document.getElementById('btnApplyStationAssign');
    if (btnApplyAssign) btnApplyAssign.addEventListener('click', applySelectedStationAssignment);

    const btnUnassign = document.getElementById('btnUnassignSelectedStations');
    if (btnUnassign) btnUnassign.addEventListener('click', applySelectedStationUnassignment);

    const btnExportAssign = document.getElementById('btnExportAssignments');
    if (btnExportAssign) btnExportAssign.addEventListener('click', exportAssignments);
  }

  // ==========================================================================
  // STATION WORKGROUP ASSIGNMENT SYSTEM (GIAO VIỆC CHO 9 NHÓM THEO ID TRẠM)
  // ==========================================================================
  function loadStationAssignments() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATION_ASSIGNMENTS);
      if (raw) {
        stationAssignments = JSON.parse(raw) || {};
      }
    } catch (e) {
      console.warn('Error loading station assignments:', e);
      stationAssignments = {};
    }
  }

  function saveStationAssignments() {
    try {
      localStorage.setItem(STORAGE_KEY_STATION_ASSIGNMENTS, JSON.stringify(stationAssignments));
    } catch (e) {
      console.warn('Error saving station assignments:', e);
    }
  }

  function getStationAssignment(stationId) {
    if (!stationId) return null;
    return stationAssignments[String(stationId).trim()] || null;
  }

  function syncStationAssignmentsToCloud(stationIds, action = 'assign', groupId = '') {
    const webhookUrl = getWebhookUrl();
    if (!webhookUrl) return;

    let payload = {};
    if (action === 'assign') {
      const g = PRESET_WORKGROUPS.find(item => item.id === groupId) || {};
      const assignments = stationIds.map(stId => {
        const meta = stationsMeta[stId] || {};
        const assign = stationAssignments[stId] || {};
        return {
          stId: stId,
          stName: meta.name || '',
          groupId: groupId,
          groupIndex: g.index || 1,
          groupName: g.name || '',
          leader: g.leader || '',
          assignedAt: assign.assignedAt || ''
        };
      });
      payload = {
        action: 'assign_stations',
        assignments: assignments,
        timestamp: Date.now()
      };
    } else {
      payload = {
        action: 'unassign_stations',
        station_ids: stationIds,
        timestamp: Date.now()
      };
    }

    fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(() => {
      console.log('PhanCong_Tram synced to cloud:', action, stationIds.length);
    }).catch(err => {
      console.warn('Error syncing PhanCong_Tram to cloud:', err);
    });
  }

  function reconcileStationAssignmentsFromCloud(cloudAssignmentsList) {
    if (!Array.isArray(cloudAssignmentsList)) return false;
    let changed = false;
    const cloudMap = new Map();

    cloudAssignmentsList.forEach(item => {
      const stId = String(item.stId || item.id || '').trim();
      if (stId) {
        const g = PRESET_WORKGROUPS.find(w => w.id === item.groupId || w.name === item.groupName || (w.index && w.index === Number(item.groupIndex))) || PRESET_WORKGROUPS[0];
        cloudMap.set(stId, {
          groupId: g ? g.id : (item.groupId || 'group_1'),
          groupIndex: g ? g.index : 1,
          groupName: g ? g.name : (item.groupName || ''),
          leader: g ? g.leader : (item.leader || ''),
          shortName: g ? g.shortName : (item.groupName || ''),
          fullName: g ? g.fullName : (item.groupName || ''),
          assignedAt: item.assignedAt || ''
        });
      }
    });

    // 1. Phân công bị xóa/hủy trên điện thoại hoặc thiết bị khác -> Xóa trên máy tính
    Object.keys(stationAssignments).forEach(stId => {
      if (!cloudMap.has(stId)) {
        delete stationAssignments[stId];
        changed = true;
      }
    });

    // 2. Phân công mới hoặc thay đổi nhóm từ thiết bị khác -> Cập nhật trên máy
    cloudMap.forEach((cloudObj, stId) => {
      const localObj = stationAssignments[stId];
      if (!localObj || localObj.groupId !== cloudObj.groupId) {
        stationAssignments[stId] = cloudObj;
        changed = true;
      }
    });

    if (changed) {
      saveStationAssignments();
      renderSidebarWorkgroups();
      updateGroupFilterUI();
      updateFilterWorkgroupDropdown();
      const assignModal = document.getElementById('modalStationAssignment');
      if (assignModal && assignModal.classList.contains('active')) {
        renderStationAssignmentModalTable();
      }
      renderDataList();
    }

    return changed;
  }

  function assignStationsToGroup(stationIds, groupId) {
    const group = PRESET_WORKGROUPS.find(g => g.id === groupId);
    if (!group) {
      showToast('Nhóm công tác không hợp lệ!', 'error');
      return;
    }
    if (!stationIds || stationIds.length === 0) {
      showToast('Vui lòng chọn ít nhất 1 trạm để giao việc!', 'warning');
      return;
    }

    const now = new Date();
    const timeStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    stationIds.forEach(stId => {
      const cleanId = String(stId).trim();
      stationAssignments[cleanId] = {
        groupId: group.id,
        groupIndex: group.index,
        groupName: group.name,
        leader: group.leader,
        shortName: group.shortName,
        fullName: group.fullName,
        assignedAt: timeStr
      };
    });

    saveStationAssignments();
    renderSidebarWorkgroups();
    renderStationAssignmentModalTable();
    updateFilterWorkgroupDropdown();
    applyFilters();
    renderApp();

    // Broadcast đa tab trên cùng thiết bị
    if (syncChannel) {
      try {
        syncChannel.postMessage({ type: 'sync_station_assignments', assignments: stationAssignments });
      } catch (e) {}
    }

    // Đồng bộ tức thời lên Google Sheet cho các thiết bị khác (Điện thoại <-> Máy tính)
    syncStationAssignmentsToCloud(stationIds, 'assign', groupId);

    showToast(`Đã giao ${stationIds.length} trạm cho Nhóm ${group.index} (${group.shortName}) và đồng bộ lên đám mây!`, 'success');
  }

  function unassignStations(stationIds) {
    if (!stationIds || stationIds.length === 0) {
      showToast('Vui lòng chọn trạm cần hủy giao việc!', 'warning');
      return;
    }

    let count = 0;
    stationIds.forEach(stId => {
      const cleanId = String(stId).trim();
      if (stationAssignments[cleanId]) {
        delete stationAssignments[cleanId];
        count++;
      }
    });

    saveStationAssignments();
    renderSidebarWorkgroups();
    renderStationAssignmentModalTable();
    updateFilterWorkgroupDropdown();
    applyFilters();
    renderApp();

    // Broadcast đa tab trên cùng thiết bị
    if (syncChannel) {
      try {
        syncChannel.postMessage({ type: 'sync_station_assignments', assignments: stationAssignments });
      } catch (e) {}
    }

    // Đồng bộ tức thời hủy giao việc lên Google Sheet cho các thiết bị khác
    syncStationAssignmentsToCloud(stationIds, 'unassign');

    showToast(`Đã hủy giao việc ${count} trạm và đồng bộ lên đám mây!`, 'info');
  }

  function getGroupStationStats() {
    const stats = {};
    PRESET_WORKGROUPS.forEach(g => {
      stats[g.id] = {
        group: g,
        stationCount: 0,
        customerCount: 0,
        completedCustomerCount: 0
      };
    });
    stats['unassigned'] = {
      group: { id: 'unassigned', index: 0, name: 'Chưa giao việc', shortName: 'Chưa giao' },
      stationCount: 0,
      customerCount: 0,
      completedCustomerCount: 0
    };

    // 1. Đếm số lượng trạm đã phân công cho từng nhóm
    const stationIds = Object.keys(stationsMeta);
    stationIds.forEach(stId => {
      const meta = stationsMeta[stId] || { count: 0 };
      const assign = stationAssignments[stId];
      const targetKey = assign ? assign.groupId : 'unassigned';

      if (stats[targetKey]) {
        stats[targetKey].stationCount += 1;
        // Nếu allCustomers chưa nạp xong thì tạm thời dùng meta.count
        if (allCustomers.length === 0) {
          stats[targetKey].customerCount += meta.count || 0;
        }
      }
    });

    // 2. Đếm trực tiếp từ mảng allCustomers để số lượng khách hàng luôn chuẩn xác 100% (không bao giờ bị nhân đôi)
    if (allCustomers.length > 0) {
      allCustomers.forEach(c => {
        const stId = c.id_tram || c.ma_tram;
        const assign = stationAssignments[stId];
        const targetKey = assign ? assign.groupId : 'unassigned';
        if (stats[targetKey]) {
          stats[targetKey].customerCount += 1;
          const insp = inspectionsMap[c.ma_kh];
          if (insp && insp.trang_thai === 'Đã kiểm tra') {
            stats[targetKey].completedCustomerCount += 1;
          }
        }
      });
    }

    return stats;
  }

  function renderSidebarWorkgroups() {
    const container = document.getElementById('ytWorkgroupList');
    if (!container) return;

    const stats = getGroupStationStats();
    const totalStations = Object.keys(stationsMeta).length || 1696;
    let totalAssigned = 0;

    let html = '';
    PRESET_WORKGROUPS.forEach(g => {
      const st = stats[g.id] || { stationCount: 0, customerCount: 0, completedCustomerCount: 0 };
      totalAssigned += st.stationCount;
      const pct = st.customerCount > 0 ? Math.round((st.completedCustomerCount / st.customerCount) * 100) : 0;
      const isActive = (currentAssignedGroupFilter === g.id);

      html += `
        <button type="button" class="yt-workgroup-card ${isActive ? 'active' : ''}" onclick="window.PCVT.setAssignedGroupFilter('${g.id}')" title="Bấm để xem danh sách của Nhóm ${g.index}: ${escapeHTML(g.fullName)}">
          <div class="yt-group-avatar">${g.index}</div>
          <div class="yt-group-info">
            <div class="yt-group-name">Nhóm ${g.index}: ${escapeHTML(g.shortName)}</div>
            <div class="yt-group-leader">TN: ${escapeHTML(g.leader)}</div>
            <div class="yt-group-stats">
              <span class="yt-badge-stations">${st.stationCount} trạm (${st.customerCount.toLocaleString('vi-VN')} KH)</span>
              ${st.customerCount > 0 ? `<span class="yt-badge-progress">${pct}%</span>` : ''}
            </div>
          </div>
        </button>
      `;
    });

    container.innerHTML = html;

    const statBadge = document.getElementById('ytAssignedStatBadge');
    if (statBadge) {
      statBadge.textContent = `${totalAssigned}/${totalStations.toLocaleString('vi-VN')} trạm`;
    }
  }

  function setAssignedGroupFilter(groupId) {
    if (currentAssignedGroupFilter === groupId) {
      currentAssignedGroupFilter = '';
    } else {
      currentAssignedGroupFilter = groupId || '';
    }

    updateGroupFilterUI();

    if (window.innerWidth < 1200) {
      closeSidebar();
    }

    applyFilters();
    renderApp();
  }

  function updateGroupFilterUI() {
    const banner = document.getElementById('groupFilterBanner');
    const bannerName = document.getElementById('groupBannerName');
    const bannerStats = document.getElementById('groupBannerStats');
    const sidebarFilterBox = document.getElementById('ytActiveFilterBox');
    const sidebarFilterName = document.getElementById('ytFilterGroupName');
    const sidebarFilterSub = document.getElementById('ytFilterGroupSub');
    const selectFilter = document.getElementById('filterWorkgroupSelect');

    if (selectFilter && selectFilter.value !== currentAssignedGroupFilter) {
      selectFilter.value = currentAssignedGroupFilter;
    }

    if (!currentAssignedGroupFilter) {
      if (banner) banner.style.display = 'none';
      if (sidebarFilterBox) sidebarFilterBox.style.display = 'none';
      renderSidebarWorkgroups();
      return;
    }

    const stats = getGroupStationStats();
    let titleText = '';
    let subText = '';

    if (currentAssignedGroupFilter === 'unassigned') {
      titleText = 'Chưa phân công cho nhóm nào';
      const st = stats['unassigned'] || { stationCount: 0, customerCount: 0 };
      subText = `Tổng cộng: ${st.stationCount} trạm &bull; ${st.customerCount.toLocaleString('vi-VN')} khách hàng`;
    } else {
      const g = PRESET_WORKGROUPS.find(item => item.id === currentAssignedGroupFilter);
      if (g) {
        titleText = `Nhóm ${g.index}: ${g.name} (Trưởng nhóm: ${g.leader})`;
        const st = stats[g.id] || { stationCount: 0, customerCount: 0, completedCustomerCount: 0 };
        const pct = st.customerCount > 0 ? Math.round((st.completedCustomerCount / st.customerCount) * 100) : 0;
        subText = `Phụ trách: ${st.stationCount} trạm &bull; ${st.customerCount.toLocaleString('vi-VN')} KH (Đã kiểm tra: ${st.completedCustomerCount.toLocaleString('vi-VN')} KH - ${pct}%)`;
      }
    }

    if (banner) {
      banner.style.display = 'flex';
      if (bannerName) bannerName.textContent = titleText;
      if (bannerStats) bannerStats.innerHTML = subText;
    }

    if (sidebarFilterBox) {
      sidebarFilterBox.style.display = 'block';
      if (sidebarFilterName) sidebarFilterName.textContent = titleText;
      if (sidebarFilterSub) sidebarFilterSub.innerHTML = subText;
    }

    renderSidebarWorkgroups();
  }

  function updateFilterWorkgroupDropdown() {
    const sel = document.getElementById('filterWorkgroupSelect');
    if (!sel) return;

    const stats = getGroupStationStats();
    let html = `<option value="">-- Tất cả nhóm công tác --</option>`;
    const unassigned = stats['unassigned'] || { stationCount: 0, customerCount: 0 };
    html += `<option value="unassigned" ${currentAssignedGroupFilter === 'unassigned' ? 'selected' : ''}>⚠️ Chưa giao việc (${unassigned.stationCount} trạm, ${unassigned.customerCount.toLocaleString('vi-VN')} KH)</option>`;

    PRESET_WORKGROUPS.forEach(g => {
      const st = stats[g.id] || { stationCount: 0, customerCount: 0 };
      const isSel = (currentAssignedGroupFilter === g.id);
      html += `<option value="${g.id}" ${isSel ? 'selected' : ''}>Nhóm ${g.index}: ${escapeHTML(g.shortName)} (${st.stationCount} trạm, ${st.customerCount.toLocaleString('vi-VN')} KH)</option>`;
    });

    sel.innerHTML = html;
  }

  function openStationAssignmentModal(preselectedGroupId) {
    openModal('modalStationAssignment');
    currentAssignModalSearch = '';
    selectedAssignStations.clear();
    cachedStationCustStats = null;

    const searchInput = document.getElementById('assignStationSearchInput');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('btnClearAssignStationSearch');
    if (clearBtn) clearBtn.style.display = 'none';

    if (preselectedGroupId) {
      const groupSelect = document.getElementById('assignGroupSelect');
      if (groupSelect) groupSelect.value = preselectedGroupId;
    }

    renderStationAssignmentModalTable();
  }

  // Helper to remove Vietnamese tones for fast, diacritic-insensitive search
  function removeVietnameseTones(str) {
    if (!str) return '';
    str = String(str);
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, 'a');
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, 'e');
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, 'i');
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, 'o');
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, 'u');
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, 'y');
    str = str.replace(/đ/g, 'd');
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, 'A');
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, 'E');
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, 'I');
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, 'O');
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, 'U');
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, 'Y');
    str = str.replace(/Đ/g, 'D');
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  // Cache customer count per station for ultra-fast rendering of 1.696 stations
  let cachedStationCustStats = null;
  function getStationCustStats() {
    if (cachedStationCustStats) return cachedStationCustStats;
    const stats = {};
    for (let i = 0; i < allCustomers.length; i++) {
      const c = allCustomers[i];
      const sId = c.id_tram || c.ma_tram;
      if (sId) {
        if (!stats[sId]) stats[sId] = { total: 0, checked: 0 };
        stats[sId].total++;
        if (inspectionsMap[c.ma_kh] && inspectionsMap[c.ma_kh].trang_thai === 'Đã kiểm tra') {
          stats[sId].checked++;
        }
      }
    }
    cachedStationCustStats = stats;
    return stats;
  }

  function getFilteredStationsForAssignModal() {
    const rawQuery = (currentAssignModalSearch || '').trim();
    const stationEntries = Object.entries(stationsMeta);

    return stationEntries.filter(([stId, meta]) => {
      const sName = (meta && meta.name) || '';
      const sKhuVuc = (meta && meta.khu_vuc) || '';
      const assign = stationAssignments[stId];

      if (currentAssignModalFilter === 'assigned' && !assign) return false;
      if (currentAssignModalFilter === 'unassigned' && assign) return false;

      if (rawQuery) {
        // 1. Check if user pasted/entered a list of IDs (e.g. "101467, 101470" or "101467 101470")
        const idTokens = rawQuery.split(/[,;\s\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
        const isMultiId = idTokens.length > 1 && idTokens.every(t => /^[a-zA-Z0-9_-]+$/.test(t));
        if (isMultiId) {
          return idTokens.includes(stId.toLowerCase());
        }

        // 2. Flexible multi-word & accent-insensitive search on ID, Name, Khu Vuc, and Group
        const normQuery = removeVietnameseTones(rawQuery);
        const normId = removeVietnameseTones(stId);
        const normName = removeVietnameseTones(sName);
        const normKhuVuc = removeVietnameseTones(sKhuVuc);
        const normGroup = assign ? removeVietnameseTones(`${assign.groupName} ${assign.leader} Nhom ${assign.groupIndex}`) : '';

        // Exact / substring match
        if (normId.includes(normQuery)) return true;
        if (normName.includes(normQuery)) return true;
        if (normKhuVuc.includes(normQuery)) return true;
        if (normGroup && normGroup.includes(normQuery)) return true;

        // All words must be present in the station info
        const words = normQuery.split(/\s+/).filter(Boolean);
        const fullTarget = `${normId} ${normName} ${normKhuVuc} ${normGroup}`;
        return words.every(w => fullTarget.includes(w));
      }

      return true;
    });
  }

  function renderStationAssignmentModalTable() {
    const tbody = document.getElementById('assignStationTableBody');
    if (!tbody) return;

    const allStationEntries = Object.entries(stationsMeta);
    let totalAssigned = 0;
    allStationEntries.forEach(([stId]) => {
      if (stationAssignments[stId]) totalAssigned++;
    });
    const totalCount = allStationEntries.length;
    const totalUnassigned = Math.max(0, totalCount - totalAssigned);

    const countAllEl = document.getElementById('assignCountAll');
    const countAssignedEl = document.getElementById('assignCountAssigned');
    const countUnassignedEl = document.getElementById('assignCountUnassigned');
    if (countAllEl) countAllEl.textContent = totalCount.toLocaleString('vi-VN');
    if (countAssignedEl) countAssignedEl.textContent = totalAssigned.toLocaleString('vi-VN');
    if (countUnassignedEl) countUnassignedEl.textContent = totalUnassigned.toLocaleString('vi-VN');

    const filteredStations = getFilteredStationsForAssignModal();
    updateAssignSelectionCountDisplay(filteredStations);

    if (filteredStations.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-muted);">
            🔍 Không tìm thấy trạm nào khớp với điều kiện tìm kiếm.
          </td>
        </tr>
      `;
      return;
    }

    const stationCustStats = getStationCustStats();
    let rowsHtml = '';
    const displayList = filteredStations; // Hiện TOÀN BỘ tất cả trạm (không giới hạn 100)

    displayList.forEach(([stId, meta]) => {
      const sName = (meta && meta.name) || '---';
      const assign = stationAssignments[stId];
      const isSelected = selectedAssignStations.has(stId);
      const stats = stationCustStats[stId] || { total: meta.count || 0, checked: 0 };
      const pct = stats.total > 0 ? Math.round((stats.checked / stats.total) * 100) : 0;

      let groupBadge = '';
      if (assign) {
        groupBadge = `<span class="badge-assigned-group" title="Trưởng nhóm: ${escapeHTML(assign.leader)} - Giao lúc: ${escapeHTML(assign.assignedAt || '')}">
          👥 Nhóm ${assign.groupIndex}: ${escapeHTML(assign.shortName || assign.groupName)}
        </span>`;
      } else {
        groupBadge = `<span class="badge-assigned-group unassigned">⚠️ Chưa giao việc</span>`;
      }

      rowsHtml += `
        <tr class="${isSelected ? 'selected' : ''}" id="assign-row-${escapeHTML(stId)}" onclick="window.PCVT.handleAssignRowClick(event, '${escapeHTML(stId)}')">
          <td style="text-align:center;">
            <input type="checkbox" class="assign-row-chk" value="${escapeHTML(stId)}" 
                   ${isSelected ? 'checked' : ''} 
                   onchange="window.PCVT.toggleStationAssignSelection('${escapeHTML(stId)}', this.checked)">
          </td>
          <td><span class="badge-station-id">${escapeHTML(stId)}</span></td>
          <td>
            <strong>${escapeHTML(sName)}</strong>
            ${meta.khu_vuc ? `<span style="font-size:0.7rem; color:var(--text-muted); margin-left:4px;">(${escapeHTML(meta.khu_vuc)})</span>` : ''}
          </td>
          <td style="text-align:right; font-weight:600;">${stats.total.toLocaleString('vi-VN')}</td>
          <td style="text-align:center;">
            <div style="font-size:0.75rem; font-weight:700; color:${pct === 100 ? '#059669' : '#1e293b'}">
              ${stats.checked}/${stats.total} (${pct}%)
            </div>
            <div style="width:100%; height:4px; background:#e2e8f0; border-radius:2px; margin-top:2px; overflow:hidden;">
              <div style="width:${pct}%; height:100%; background:${pct === 100 ? '#059669' : '#2563eb'};"></div>
            </div>
          </td>
          <td>${groupBadge}</td>
          <td style="text-align:center;">
            <div style="display:flex; gap:6px; justify-content:center; align-items:center;">
              <button type="button" class="btn-link" onclick="event.stopPropagation(); window.PCVT.quickFilterByStation('${escapeHTML(stId)}', '${escapeHTML(sName)}')" title="Xem danh sách khách hàng của trạm này">
                🔍 Xem KH
              </button>
              <button type="button" class="btn-quick-assign-row" onclick="event.stopPropagation(); window.PCVT.quickAssignSingleStation('${escapeHTML(stId)}')" title="Giao ngay trạm này cho nhóm đang chọn ở Bước 1">
                ⚡ Giao
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    rowsHtml += `
      <tr>
        <td colspan="7" style="text-align:center; padding:0.65rem; color:var(--text-muted); font-size:0.78rem; background:#f8fafc; border-top:1px solid #e2e8f0;">
          ⚡ Đang hiển thị toàn bộ <strong>${filteredStations.length.toLocaleString('vi-VN')}</strong> trạm. Nhập ID hoặc Tên trạm vào ô tìm kiếm để lọc nhanh và giao việc.
        </td>
      </tr>
    `;

    tbody.innerHTML = rowsHtml;
  }

  function updateAssignSelectionCountDisplay(filteredStations) {
    const selCountEl = document.getElementById('assignSelectedCount');
    const custStats = getStationCustStats();
    let totalCustSelected = 0;
    selectedAssignStations.forEach(stId => {
      if (custStats[stId]) totalCustSelected += custStats[stId].total;
      else if (stationsMeta[stId]) totalCustSelected += (stationsMeta[stId].count || 0);
    });

    if (selCountEl) {
      selCountEl.innerHTML = `<strong>${selectedAssignStations.size.toLocaleString('vi-VN')}</strong> trạm <span style="font-weight:600; color:#2563eb; margin-left:4px;">(${totalCustSelected.toLocaleString('vi-VN')} KH)</span>`;
    }

    const selectAllChk = document.getElementById('chkAssignSelectAll');
    if (selectAllChk && filteredStations) {
      const allChecked = filteredStations.length > 0 && filteredStations.every(([stId]) => selectedAssignStations.has(stId));
      selectAllChk.checked = allChecked;
    }
  }

  function quickAssignSingleStation(stId) {
    const groupSelect = document.getElementById('assignGroupSelect');
    const groupId = groupSelect ? groupSelect.value : 'group_1';
    assignStationsToGroup([stId], groupId);
    const g = PRESET_WORKGROUPS.find(item => item.id === groupId);
    const gName = g ? `Nhóm ${g.index}: ${g.shortName}` : groupId;
    showToast(`Đã giao trạm ${stId} cho ${gName}!`, 'success');
    renderStationAssignmentModalTable();
  }

  function handleAssignRowClick(event, stId) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON' || event.target.closest('button') || event.target.closest('a')) {
      return;
    }
    const isChecked = !selectedAssignStations.has(stId);
    if (isChecked) selectedAssignStations.add(stId);
    else selectedAssignStations.delete(stId);

    const chk = document.querySelector(`#assign-row-${stId} .assign-row-chk`);
    if (chk) chk.checked = isChecked;
    const row = document.getElementById(`assign-row-${stId}`);
    if (row) row.classList.toggle('selected', isChecked);

    const filtered = getFilteredStationsForAssignModal();
    updateAssignSelectionCountDisplay(filtered);
  }

  function applySelectedStationAssignment() {
    if (selectedAssignStations.size === 0) {
      showToast('Vui lòng chọn ít nhất 1 trạm từ danh sách!', 'warning');
      return;
    }
    const groupSelect = document.getElementById('assignGroupSelect');
    const groupId = groupSelect ? groupSelect.value : 'group_1';

    assignStationsToGroup(Array.from(selectedAssignStations), groupId);
    selectedAssignStations.clear();
    renderStationAssignmentModalTable();
  }

  function applySelectedStationUnassignment() {
    if (selectedAssignStations.size === 0) {
      showToast('Vui lòng chọn ít nhất 1 trạm để hủy giao việc!', 'warning');
      return;
    }

    unassignStations(Array.from(selectedAssignStations));
    selectedAssignStations.clear();
    renderStationAssignmentModalTable();
  }

  function exportAssignments() {
    const totalStationIds = Object.keys(stationsMeta);
    if (totalStationIds.length === 0) {
      showToast('Chưa có danh sách trạm để xuất!', 'warning');
      return;
    }

    showLoading(true, 'Đang tạo tệp Excel phân công trạm (.xlsx)...');

    setTimeout(() => {
      try {
        const custStats = getStationCustStats();
        const headers = [
          'STT',
          'ID Trạm',
          'Tên Trạm',
          'Khu Vực',
          'Tổng Số KH',
          'Đã Kiểm Tra',
          'Tiến Độ (%)',
          'Trạng Thái Giao Việc',
          'Nhóm Nhận Việc',
          'Tên Nhóm Công Tác',
          'Trưởng Nhóm',
          'Thời Gian Giao Việc'
        ];

        const rows = [headers];

        // Sort stations: assigned stations first, then sorted by ID numerically
        const sortedIds = totalStationIds.slice().sort((a, b) => {
          const aAssign = Boolean(stationAssignments[a]);
          const bAssign = Boolean(stationAssignments[b]);
          if (aAssign && !bAssign) return -1;
          if (!aAssign && bAssign) return 1;
          return a.localeCompare(b, undefined, { numeric: true });
        });

        let idx = 1;
        sortedIds.forEach(stId => {
          const meta = stationsMeta[stId] || {};
          const assign = stationAssignments[stId];
          const stats = custStats[stId] || { total: meta.count || 0, checked: 0 };
          const pct = stats.total > 0 ? Math.round((stats.checked / stats.total) * 100) : 0;

          rows.push([
            idx++,
            String(stId || ''),
            String(meta.name || ''),
            String(meta.khu_vuc || ''),
            Number(stats.total || 0),
            Number(stats.checked || 0),
            `${pct}%`,
            assign ? 'Đã giao việc' : 'Chưa giao việc',
            assign ? `Nhóm ${assign.groupIndex}` : '',
            assign ? assign.groupName : '',
            assign ? assign.leader : '',
            assign ? (assign.assignedAt || '') : ''
          ]);
        });

        const now = new Date();
        const dateStr = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
        const filename = `Phan_Cong_Giao_Viec_Tram_PCVT_${dateStr}.xlsx`;

        if (typeof XLSX !== 'undefined') {
          const ws = XLSX.utils.aoa_to_sheet(rows);

          // Căn chỉnh độ rộng cột chuẩn thẩm mỹ chuyên nghiệp trong Excel
          ws['!cols'] = [
            { wch: 7 },   // STT
            { wch: 14 },  // ID Trạm
            { wch: 30 },  // Tên Trạm
            { wch: 16 },  // Khu Vực
            { wch: 13 },  // Tổng Số KH
            { wch: 13 },  // Đã Kiểm Tra
            { wch: 12 },  // Tiến Độ (%)
            { wch: 22 },  // Trạng Thái Giao Việc
            { wch: 16 },  // Nhóm Nhận Việc
            { wch: 38 },  // Tên Nhóm Công Tác
            { wch: 24 },  // Trưởng Nhóm
            { wch: 20 }   // Thời Gian Giao Việc
          ];

          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Phân Công Trạm');
          XLSX.writeFile(wb, filename);

          showLoading(false);
          showToast(`Đã xuất thành công tệp Excel: ${filename}`, 'success');
        } else {
          // Fallback to CSV with UTF-8 BOM
          const csvContent = '\uFEFF' + rows.map(r => r.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `Phan_Cong_Giao_Viec_Tram_PCVT_${dateStr}.csv`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          showLoading(false);
          showToast('Đã xuất file phân công trạm thành công!', 'success');
        }
      } catch (err) {
        console.error('Export assignments error:', err);
        showLoading(false);
        showToast('Có lỗi khi tạo tệp Excel phân công: ' + err.message, 'error');
      }
    }, 50);
  }

  // YouTube-style Sidebar Drawer Toggle
  function toggleSidebar() {
    const isDesktop = window.innerWidth >= 1200;
    const sidebar = document.getElementById('ytSidebar');
    const backdrop = document.getElementById('ytSidebarBackdrop');

    if (isDesktop) {
      if (document.body.classList.contains('sidebar-collapsed')) {
        document.body.classList.remove('sidebar-collapsed');
        document.body.classList.add('sidebar-open');
        localStorage.setItem(STORAGE_KEY_SIDEBAR_OPEN, '1');
      } else {
        document.body.classList.remove('sidebar-open');
        document.body.classList.add('sidebar-collapsed');
        localStorage.setItem(STORAGE_KEY_SIDEBAR_OPEN, '0');
      }
    } else {
      if (sidebar) sidebar.classList.toggle('open');
      if (backdrop) backdrop.classList.toggle('active');
    }
  }

  function closeSidebar() {
    const isDesktop = window.innerWidth >= 1200;
    const sidebar = document.getElementById('ytSidebar');
    const backdrop = document.getElementById('ytSidebarBackdrop');

    if (isDesktop) {
      document.body.classList.remove('sidebar-open');
      document.body.classList.add('sidebar-collapsed');
      localStorage.setItem(STORAGE_KEY_SIDEBAR_OPEN, '0');
    } else {
      if (sidebar) sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('active');
    }
  }

  function openSidebar() {
    const isDesktop = window.innerWidth >= 1200;
    const sidebar = document.getElementById('ytSidebar');
    const backdrop = document.getElementById('ytSidebarBackdrop');

    if (isDesktop) {
      document.body.classList.remove('sidebar-collapsed');
      document.body.classList.add('sidebar-open');
      localStorage.setItem(STORAGE_KEY_SIDEBAR_OPEN, '1');
    } else {
      if (sidebar) sidebar.classList.add('open');
      if (backdrop) backdrop.classList.add('active');
    }
  }

  function applyViewMode(mode) {
    const tableWrap = document.querySelector('.table-responsive');
    const mobileWrap = document.getElementById('mobileCardsContainer');
    if (!tableWrap || !mobileWrap) return;

    if (mode === 'table') {
      tableWrap.style.display = 'block';
      mobileWrap.style.display = 'none';
    } else if (mode === 'cards') {
      tableWrap.style.display = 'none';
      mobileWrap.style.display = 'flex';
    } else {
      tableWrap.style.display = '';
      mobileWrap.style.display = '';
    }
  }

  function resetFilters() {
    currentStationFilter = '';
    currentAreaFilter = '';
    currentConditionFilter = '';
    currentAssignedGroupFilter = '';
    currentStatusFilter = 'all';
    currentSearchKeyword = '';

    const sInput = document.getElementById('searchStationInput');
    if (sInput) sInput.value = '';
    const aSelect = document.getElementById('filterAreaSelect');
    if (aSelect) aSelect.value = '';
    const cSelect = document.getElementById('filterConditionSelect');
    if (cSelect) cSelect.value = '';
    const gInput = document.getElementById('globalKeywordInput');
    if (gInput) gInput.value = '';
    const clearBtn = document.getElementById('btnClearStation');
    if (clearBtn) clearBtn.style.display = 'none';

    updateGroupFilterUI();

    document.querySelectorAll('.status-tab-btn').forEach(b => {
      b.classList.remove('active');
      if (b.getAttribute('data-status') === 'all') b.classList.add('active');
    });

    applyFilters();
    renderApp();
    showToast('Đã xóa tất cả bộ lọc', 'info');
  }

  // ==========================================================================
  // INCOMPLETE INSPECTION WARNING SYSTEM (CẢNH BÁO THÔNG TIN CHƯA ĐẦY ĐỦ)
  // ==========================================================================
  function isIncompleteWarningEnabled() {
    const val = localStorage.getItem(STORAGE_KEY_INCOMPLETE_WARN);
    return val === null ? true : (val !== 'false');
  }

  function toggleIncompleteWarning() {
    const next = !isIncompleteWarningEnabled();
    localStorage.setItem(STORAGE_KEY_INCOMPLETE_WARN, next ? 'true' : 'false');
    updateIncompleteWarningButtonUI();
    showToast(next ? '⚠️ Đã BẬT cảnh báo khi thiếu thông tin kiểm tra' : 'ℹ️ Đã TẮT cảnh báo thiếu thông tin kiểm tra', next ? 'warning' : 'info');
  }

  function updateIncompleteWarningButtonUI() {
    const btn = document.getElementById('btnToggleIncompleteWarn');
    const label = document.getElementById('labelToggleIncompleteWarn');
    const isEnabled = isIncompleteWarningEnabled();
    if (btn) {
      if (isEnabled) {
        btn.style.background = '#f59e0b';
        btn.style.borderColor = '#d97706';
        btn.style.color = '#ffffff';
        btn.title = 'Cảnh báo thông tin chưa đầy đủ đang BẬT. Bấm để Tắt.';
      } else {
        btn.style.background = '#64748b';
        btn.style.borderColor = '#475569';
        btn.style.color = '#ffffff';
        btn.title = 'Cảnh báo thông tin chưa đầy đủ đang TẮT. Bấm để Bật.';
      }
    }
    if (label) {
      label.textContent = isEnabled ? '⚠️ Cảnh báo: BẬT' : '⚠️ Cảnh báo: TẮT';
    }
  }

  function checkInspectionIncomplete(ma_kh) {
    const cleanMaKh = String(ma_kh || '').trim();
    const insp = inspectionsMap[cleanMaKh] || {};
    const customer = allCustomers.find(c => String(c.ma_kh).trim() === cleanMaKh) || {};

    // 1. Ghi chú / Hiện trạng đo đếm
    const deskInput = document.getElementById(`note-${cleanMaKh}`);
    const mobInput = document.getElementById(`mnote-${cleanMaKh}`);
    const isMobile = window.innerWidth < 1200;
    let noteVal = isMobile
      ? ((mobInput && mobInput.value) || (deskInput && deskInput.value) || insp.ghi_chu || '').trim()
      : ((deskInput && deskInput.value) || (mobInput && mobInput.value) || insp.ghi_chu || '').trim();

    if (isWorkgroupOrInspectorName(noteVal)) {
      noteVal = ''; // Tên cán bộ/nhóm công tác không phải là hiện trạng đo đếm!
    }

    // 2. Ảnh công tơ hiện trường
    const hasPhoto = !!(insp.hinh_anh || insp.link_anh || customer.link_anh);

    // 3. Cán bộ / Nhóm kiểm tra
    const deskUp = document.getElementById(`updater-${cleanMaKh}`);
    const mobUp = document.getElementById(`mupdater-${cleanMaKh}`);
    const curInsp = getCurrentInspector();
    const upVal = ((deskUp && deskUp.value) || (mobUp && mobUp.value) || insp.nguoi_cap_nhat || curInsp || '').trim();

    const missingItems = [];

    if (!noteVal) {
      missingItems.push({
        type: 'note',
        icon: '📝',
        title: 'Hiện trạng / Ghi chú:',
        desc: 'Chưa chọn 1 trong 12 hiện trạng đo đếm hoặc chưa nhập ghi chú kiểm tra.',
        badge: 'Chưa có hiện trạng',
        level: 'error'
      });
    }

    if (!hasPhoto) {
      missingItems.push({
        type: 'photo',
        icon: '📸',
        title: 'Ảnh chụp công tơ hiện trường:',
        desc: 'Chưa chụp hoặc tải ảnh công tơ hiện trường (bắt buộc chụp làm bằng chứng nghiệm thu).',
        badge: 'Chưa có ảnh',
        level: 'error'
      });
    }

    return {
      isIncomplete: missingItems.length > 0,
      missingItems,
      customer,
      insp,
      cleanMaKh,
      noteVal,
      upVal,
      hasPhoto,
      isCompleted: (insp.trang_thai === 'Đã kiểm tra')
    };
  }

  function focusMissingField(ma_kh, missingItems) {
    const hasMissingNote = missingItems.some(it => it.type === 'note');
    const hasMissingPhoto = missingItems.some(it => it.type === 'photo');

    if (hasMissingNote) {
      const deskInput = document.getElementById(`note-${ma_kh}`);
      const mobInput = document.getElementById(`mnote-${ma_kh}`);
      if (mobInput && window.innerWidth < 1200) {
        mobInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        mobInput.focus();
      } else if (deskInput) {
        deskInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        deskInput.focus();
      }
      showToast('Vui lòng chọn hiện trạng hoặc nhập ghi chú cho khách hàng', 'info');
      return;
    }

    if (hasMissingPhoto) {
      const deskPhoto = document.getElementById(`photo-upload-${ma_kh}`);
      const mobPhoto = document.getElementById(`mphoto-upload-${ma_kh}`);
      if (mobPhoto && window.innerWidth < 1200) {
        mobPhoto.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (deskPhoto) {
        deskPhoto.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      showToast('Vui lòng bấm nút chụp hoặc đính kèm ảnh công tơ', 'info');
      return;
    }

    const row = document.getElementById(`row-${ma_kh}`) || document.getElementById(`mcard-${ma_kh}`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function showIncompleteWarningModal(ma_kh, check) {
    const c = check.customer || {};
    const cardEl = document.getElementById('incompleteWarnCustomerCard');
    if (cardEl) {
      cardEl.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; flex-wrap: wrap; gap: 4px;">
          <div>
            <span style="display: inline-block; background: #0284c7; color: #fff; font-weight: 700; font-size: 0.78rem; padding: 2px 7px; border-radius: 4px;">
              ${escapeHTML(check.cleanMaKh)}
            </span>
            <strong style="margin-left: 6px; font-size: 0.95rem; color: #0f172a;">${escapeHTML(c.ten_kh || 'Chưa rõ tên KH')}</strong>
          </div>
          <div style="font-size: 0.8rem; color: #475569;">
            Trạm: <strong style="color: #0369a1;">${escapeHTML(c.id_tram || c.ma_tram || '---')}</strong>
          </div>
        </div>
        <div style="font-size: 0.8rem; color: #334155; line-height: 1.45;">
          ${c.so_no ? `<div>Số No công tơ: <strong style="font-family: monospace; font-size: 0.9rem; color: #b91c1c; letter-spacing: 0.5px;">${escapeHTML(c.so_no)}</strong></div>` : ''}
          <div>Địa chỉ điểm đo: <span>${escapeHTML(c.dia_chi_ddo || c.dia_chi || '---')}</span></div>
          ${c.sdt ? `<div>SĐT: <span>${escapeHTML(c.sdt)}</span></div>` : ''}
        </div>
      `;
    }

    const listEl = document.getElementById('incompleteWarnItemsList');
    if (listEl) {
      listEl.innerHTML = check.missingItems.map(item => {
        return `
          <div style="display: flex; gap: 10px; align-items: flex-start; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 8px 10px;">
            <div style="font-size: 1.15rem; line-height: 1;">${item.icon}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                <strong style="font-size: 0.82rem; color: #991b1b;">${item.title}</strong>
                <span style="background: #ef4444; color: #fff; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 3px; white-space: nowrap;">
                  ${item.badge}
                </span>
              </div>
              <div style="font-size: 0.77rem; color: #475569; margin-top: 2px; line-height: 1.35;">
                ${item.desc}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Nút duy nhất: Chưa đầy đủ thông tin kiểm tra, quay lại nhập tiếp (Không cho lưu)
    const btnBack = document.getElementById('btnIncompleteBack');
    if (btnBack) {
      btnBack.onclick = function() {
        closeModal('modalIncompleteWarning');
        focusMissingField(check.cleanMaKh, check.missingItems);
      };
    }

    openModal('modalIncompleteWarning');
  }

  // ==========================================================================
  // CUSTOMER INTERACTION HANDLERS (EXPOSED ON window.PCVT)
  // ==========================================================================
  window.PCVT = {
    toggleIncompleteWarning: toggleIncompleteWarning,
    isIncompleteWarningEnabled: isIncompleteWarningEnabled,
    checkInspectionIncomplete: checkInspectionIncomplete,
    editMeterNo: function() {},

    saveEditedMeterNo: function() {},

    selectStation: function(id, name) {
      currentStationFilter = id;
      const sInput = document.getElementById('searchStationInput');
      if (sInput) sInput.value = `${id} - ${name}`;
      const stationDropdown = document.getElementById('stationAutocompleteDropdown');
      if (stationDropdown) stationDropdown.classList.remove('active');
      const clearBtn = document.getElementById('btnClearStation');
      if (clearBtn) clearBtn.style.display = 'block';

      applyFilters();
      renderApp();
    },

    toggleStatus: function(ma_kh, isChecked) {
      const cleanMaKh = String(ma_kh || '').trim();

      // Khi người dùng bấm hoàn thành: Kiểm tra đầy đủ thông tin (Không đủ KHÔNG CHO HOÀN THÀNH)
      if (isChecked) {
        const check = checkInspectionIncomplete(cleanMaKh);
        if (check.isIncomplete) {
          showIncompleteWarningModal(cleanMaKh, check);
          showToast('⚠️ Không thể lưu: Chưa đầy đủ hiện trạng hoặc ảnh công tơ!', 'error');

          const row = document.getElementById(`row-${cleanMaKh}`);
          if (row) {
            const chk = row.querySelector('.custom-checkbox input');
            if (chk) chk.checked = false;
          }
          return; // Chặn hoàn toàn!
        }
      }

      if (!inspectionsMap[cleanMaKh]) inspectionsMap[cleanMaKh] = {};

      const now = new Date();
      const timeStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

      if (isChecked) {
        inspectionsMap[cleanMaKh].trang_thai = 'Đã kiểm tra';
        inspectionsMap[cleanMaKh].ngay_kiem_tra = timeStr;
        inspectionsMap[cleanMaKh].localUpdatedAt = Date.now();
        if (!inspectionsMap[cleanMaKh].nguoi_cap_nhat) {
          const curInsp = getCurrentInspector();
          if (curInsp) {
            inspectionsMap[cleanMaKh].nguoi_cap_nhat = curInsp;
            const isPreset = isPresetInspector(curInsp);
            const selVal = isPreset ? getInspectorPresetValue(curInsp) : '__custom__';

            const dSel = document.getElementById(`sel-updater-${cleanMaKh}`);
            const mSel = document.getElementById(`msel-updater-${cleanMaKh}`);
            if (dSel) dSel.value = selVal;
            if (mSel) mSel.value = selVal;

            const dUp = document.getElementById(`updater-${cleanMaKh}`);
            const mUp = document.getElementById(`mupdater-${cleanMaKh}`);
            if (dUp) {
              dUp.value = curInsp;
              dUp.style.display = (!isPreset && curInsp) ? 'block' : 'none';
            }
            if (mUp) {
              mUp.value = curInsp;
              mUp.style.display = (!isPreset && curInsp) ? 'block' : 'none';
            }
          }
        }
      } else {
        inspectionsMap[cleanMaKh].trang_thai = 'Chưa kiểm tra';
        inspectionsMap[cleanMaKh].localUpdatedAt = Date.now();
      }

      renderKPIs();
      renderStationBanner();
      renderMobileStickyBar();

      const row = document.getElementById(`row-${cleanMaKh}`);
      if (row) {
        if (isChecked) {
          row.classList.add('row-completed');
          row.querySelector('.col-status').innerHTML = '<span class="badge-status completed">✅ Đã kiểm tra</span>';
          const chk = row.querySelector('.custom-checkbox input');
          if (chk) chk.checked = true;
        } else {
          row.classList.remove('row-completed');
          row.querySelector('.col-status').innerHTML = '<span class="badge-status pending">⏳ Chưa kiểm tra</span>';
          const chk = row.querySelector('.custom-checkbox input');
          if (chk) chk.checked = false;
        }
      }

      const card = document.getElementById(`mcard-${cleanMaKh}`);
      const mstatus = document.getElementById(`mstatus-${cleanMaKh}`);
      const mbtn = document.getElementById(`mbtn-toggle-${cleanMaKh}`);
      if (card) {
        if (isChecked) {
          card.classList.add('card-completed');
          if (mstatus) mstatus.innerHTML = '<span class="badge-status completed">✅ Đã kiểm tra</span>';
          if (mbtn) {
            mbtn.className = 'btn-mobile-status-toggle completed';
            mbtn.innerHTML = '✅ ĐÃ HOÀN THÀNH KIỂM TRA';
            mbtn.setAttribute('onclick', `window.PCVT.toggleStatus('${cleanMaKh}', false)`);
          }
        } else {
          card.classList.remove('card-completed');
          if (mstatus) mstatus.innerHTML = '<span class="badge-status pending">⏳ Chưa kiểm tra</span>';
          if (mbtn) {
            mbtn.className = 'btn-mobile-status-toggle';
            mbtn.innerHTML = '🔘 CHẠM ĐỂ ĐÁNH DẤU HOÀN THÀNH';
            mbtn.setAttribute('onclick', `window.PCVT.toggleStatus('${cleanMaKh}', true)`);
          }
        }
      }

      syncItemImmediately(cleanMaKh);
      showToast(isChecked ? `Đã hoàn thành kiểm tra KH ${cleanMaKh}` : `Đã chuyển KH ${cleanMaKh} về Chưa kiểm tra`, 'success');
    },

    onUpdaterSelectChange: function(ma_kh, val) {
      const dSel = document.getElementById(`sel-updater-${ma_kh}`);
      const mSel = document.getElementById(`msel-updater-${ma_kh}`);
      const dUp = document.getElementById(`updater-${ma_kh}`);
      const mUp = document.getElementById(`mupdater-${ma_kh}`);

      if (dSel && dSel.value !== val) dSel.value = val;
      if (mSel && mSel.value !== val) mSel.value = val;

      if (val === '__custom__') {
        if (dUp) {
          dUp.style.display = 'block';
          dUp.focus();
        }
        if (mUp) {
          mUp.style.display = 'block';
          mUp.focus();
        }
      } else if (val) {
        if (dUp) {
          dUp.style.display = 'none';
          dUp.value = val;
        }
        if (mUp) {
          mUp.style.display = 'none';
          mUp.value = val;
        }
        this.updateUpdater(ma_kh, val);
      } else {
        if (dUp) {
          dUp.style.display = 'none';
          dUp.value = '';
        }
        if (mUp) {
          mUp.style.display = 'none';
          mUp.value = '';
        }
        this.updateUpdater(ma_kh, '');
      }
    },

    onConditionSelect: function(ma_kh, val) {
      const dSel = document.getElementById(`sel-cond-${ma_kh}`);
      const mSel = document.getElementById(`msel-cond-${ma_kh}`);
      const dNote = document.getElementById(`note-${ma_kh}`);
      const mNote = document.getElementById(`mnote-${ma_kh}`);

      if (dSel && dSel.value !== val) dSel.value = val;
      if (mSel && mSel.value !== val) mSel.value = val;

      if (val === '__custom__') {
        if (dNote) dNote.focus();
        if (mNote) mNote.focus();
      } else if (val) {
        this.updateNote(ma_kh, val);
        showToast(`Đã chọn hiện trạng: "${val}"`, 'info');
      } else {
        this.updateNote(ma_kh, '');
      }
    },

    toggleConditionCheck: function(ma_kh, cond, isChecked) {
      let currentVal = (inspectionsMap[ma_kh] && inspectionsMap[ma_kh].ghi_chu) || '';
      if (isWorkgroupOrInspectorName(currentVal)) currentVal = '';
      let items = currentVal ? currentVal.split(/;\s*|,\s*/).map(s => s.trim()).filter(Boolean) : [];

      if (isChecked) {
        if (!items.includes(cond)) {
          items.push(cond);
        }
      } else {
        items = items.filter(item => item !== cond);
      }

      const newVal = items.join('; ');
      this.updateNote(ma_kh, newVal);
      showToast(isChecked ? `Đã tick chọn: "${cond}"` : `Đã bỏ chọn: "${cond}"`, 'info');
    },

    updateNote: function(ma_kh, value) {
      if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};
      const trimmed = (value || '').trim();
      if (isWorkgroupOrInspectorName(trimmed)) {
        return; // Tuyệt đối không cho phép ghi đè tên nhóm/cán bộ vào ô hiện trạng
      }
      inspectionsMap[ma_kh].ghi_chu = trimmed;
      syncItemImmediately(ma_kh);

      const deskInput = document.getElementById(`note-${ma_kh}`);
      const mobInput = document.getElementById(`mnote-${ma_kh}`);
      if (deskInput && deskInput.value !== trimmed) deskInput.value = trimmed;
      if (mobInput && mobInput.value !== trimmed) mobInput.value = trimmed;

      // Đồng bộ thanh xổ chọn hiện trạng (Desktop & Mobile)
      const isPreset = PRESET_CONDITIONS.includes(trimmed);
      const selVal = isPreset ? trimmed : (trimmed ? '__custom__' : '');
      const dSel = document.getElementById(`sel-cond-${ma_kh}`);
      const mSel = document.getElementById(`msel-cond-${ma_kh}`);
      if (dSel && dSel.value !== selVal) dSel.value = selVal;
      if (mSel && mSel.value !== selVal) mSel.value = selVal;

      // Đồng bộ các ô checkbox tick chọn (Desktop & Mobile)
      PRESET_CONDITIONS.forEach((cond, cIdx) => {
        const isTicked = trimmed.includes(cond);
        const chkDesktop = document.getElementById(`chk-cond-d-${ma_kh}-${cIdx}`);
        const chkMobile = document.getElementById(`chk-cond-m-${ma_kh}-${cIdx}`);
        if (chkDesktop) {
          chkDesktop.checked = isTicked;
          if (chkDesktop.parentElement) chkDesktop.parentElement.classList.toggle('active', isTicked);
        }
        if (chkMobile) {
          chkMobile.checked = isTicked;
          if (chkMobile.parentElement) chkMobile.parentElement.classList.toggle('active', isTicked);
        }
      });
    },

    updateUpdater: function(ma_kh, value) {
      if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};
      const trimmed = (value || '').trim();
      inspectionsMap[ma_kh].nguoi_cap_nhat = trimmed;
      syncItemImmediately(ma_kh);

      const isPreset = isPresetInspector(trimmed);
      const selVal = isPreset ? getInspectorPresetValue(trimmed) : (trimmed ? '__custom__' : '');

      const dSel = document.getElementById(`sel-updater-${ma_kh}`);
      const mSel = document.getElementById(`msel-updater-${ma_kh}`);
      if (dSel && dSel.value !== selVal) dSel.value = selVal;
      if (mSel && mSel.value !== selVal) mSel.value = selVal;

      const dUp = document.getElementById(`updater-${ma_kh}`);
      const mUp = document.getElementById(`mupdater-${ma_kh}`);
      if (dUp) {
        if (dUp.value !== trimmed) dUp.value = trimmed;
        dUp.style.display = (!isPreset && trimmed) ? 'block' : 'none';
      }
      if (mUp) {
        if (mUp.value !== trimmed) mUp.value = trimmed;
        mUp.style.display = (!isPreset && trimmed) ? 'block' : 'none';
      }
      showToast(`Đã lưu người cập nhật: ${trimmed || '(trống)'}`, 'info');
    },

    addTagNote: function(ma_kh, tagText) {
      let currentVal = (inspectionsMap[ma_kh] && inspectionsMap[ma_kh].ghi_chu) || '';
      if (isWorkgroupOrInspectorName(currentVal)) currentVal = '';
      if (currentVal) {
        if (!currentVal.includes(tagText)) {
          currentVal = `${currentVal}; ${tagText}`;
        }
      } else {
        currentVal = tagText;
      }

      this.updateNote(ma_kh, currentVal);
      showToast(`Đã thêm ghi chú: "${tagText}"`, 'info');
    },

    handlePhotoUpload: function(inputElement, ma_kh) {
      if (!inputElement.files || !inputElement.files[0]) return;
      const file = inputElement.files[0];

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 800;
          let width = img.width;
          let height = img.height;

          if (width > height && width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);

          if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};
          inspectionsMap[ma_kh].hinh_anh = compressedBase64;
          inspectionsMap[ma_kh].localUpdatedAt = Date.now();
          saveLocalInspections();

          updatePhotoCellInDOM(ma_kh, compressedBase64);
          syncItemImmediately(ma_kh);

          showToast(`Đã lưu và đồng bộ ảnh hiện trường KH ${ma_kh}`, 'success');
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    },

    removePhoto: function(ma_kh) {
      if (confirm('Bạn có chắc chắn muốn xóa ảnh này không?')) {
        if (inspectionsMap[ma_kh]) {
          delete inspectionsMap[ma_kh].hinh_anh;
          inspectionsMap[ma_kh].localUpdatedAt = Date.now();
          saveLocalInspections();
        }

        updatePhotoCellInDOM(ma_kh, '');
        syncItemImmediately(ma_kh);

        showToast('Đã xóa ảnh hiện trường', 'info');
      }
    },

    viewPhoto: function(ma_kh) {
      const insp = inspectionsMap[ma_kh];
      if (!insp || !insp.hinh_anh) return;

      const customer = allCustomers.find(c => c.ma_kh === ma_kh) || {};
      const modalImg = document.getElementById('zoomModalImg');
      const modalMeta = document.getElementById('zoomModalMeta');

      if (modalImg) modalImg.src = insp.hinh_anh;
      if (modalMeta) {
        modalMeta.innerHTML = `
          <strong>Mã KH:</strong> ${escapeHTML(ma_kh)} &bull; 
          <strong>Tên KH:</strong> ${escapeHTML(customer.ten_kh || '---')} &bull; 
          <strong>Trạm:</strong> ${escapeHTML(customer.id_tram || customer.ma_tram || '---')}<br>
          <strong>Điểm đo:</strong> ${escapeHTML(customer.dia_chi_ddo || customer.dia_chi || '---')}<br>
          ${customer.so_no ? `<strong>Số No công tơ:</strong> ${escapeHTML(customer.so_no)} &bull; ` : ''}
          ${customer.sdt ? `<strong>SĐT:</strong> ${escapeHTML(customer.sdt)}<br>` : '<br>'}
          <strong>Ghi chú:</strong> ${escapeHTML(insp.ghi_chu || 'Không có ghi chú')}
        `;
      }

      openModal('modalPhotoZoom');
    },

    saveRow: function(ma_kh) {
      const cleanMaKh = String(ma_kh || '').trim();
      const deskInput = document.getElementById(`note-${cleanMaKh}`);
      const mobInput = document.getElementById(`mnote-${cleanMaKh}`);
      const isMobile = window.innerWidth < 1200;

      // Ưu tiên lấy từ input trên giao diện đang hiển thị (mobile hoặc desktop)
      let val = isMobile 
        ? ((mobInput && mobInput.value) || (deskInput && deskInput.value) || '')
        : ((deskInput && deskInput.value) || (mobInput && mobInput.value) || '');

      if (!val && inspectionsMap[cleanMaKh] && inspectionsMap[cleanMaKh].ghi_chu) {
        val = inspectionsMap[cleanMaKh].ghi_chu;
      }
      if (isWorkgroupOrInspectorName(val)) {
        val = ''; // Tuyệt đối không lấy tên nhóm công tác làm hiện trạng
      }

      const deskUp = document.getElementById(`updater-${cleanMaKh}`);
      const mobUp = document.getElementById(`mupdater-${cleanMaKh}`);
      const deskSel = document.getElementById(`sel-updater-${cleanMaKh}`);
      const mobSel = document.getElementById(`msel-updater-${cleanMaKh}`);

      let upVal = isMobile
        ? ((mobUp && mobUp.value) || (deskUp && deskUp.value) || '')
        : ((deskUp && deskUp.value) || (mobUp && mobUp.value) || '');

      if (!upVal) {
        const selVal = isMobile ? (mobSel && mobSel.value) : (deskSel && deskSel.value);
        if (selVal && selVal !== '__custom__') upVal = selVal;
      }
      if (!upVal && inspectionsMap[cleanMaKh] && inspectionsMap[cleanMaKh].nguoi_cap_nhat) {
        upVal = inspectionsMap[cleanMaKh].nguoi_cap_nhat;
      }
      if (!upVal) {
        const curInsp = getCurrentInspector();
        if (curInsp) upVal = curInsp;
      }

      // Kiểm tra thông tin bắt buộc trước khi lưu (Không đầy đủ KHÔNG CHO LƯU)
      const check = checkInspectionIncomplete(cleanMaKh);
      if (check.isIncomplete) {
        showIncompleteWarningModal(cleanMaKh, check);
        showToast('⚠️ Không thể lưu: Chưa đầy đủ hiện trạng hoặc ảnh công tơ!', 'error');
        return; // Chặn hoàn toàn!
      }

      window.PCVT.executeFullSave(cleanMaKh, val, upVal);
    },

    executeFullSave: function(cleanMaKh, val, upVal) {
      if (!inspectionsMap[cleanMaKh]) inspectionsMap[cleanMaKh] = {};
      
      // Bảo vệ ghi_chu không bao giờ bị ghi đè tên nhóm công tác vào
      if (!isWorkgroupOrInspectorName(val)) {
        inspectionsMap[cleanMaKh].ghi_chu = val;
      } else if (inspectionsMap[cleanMaKh].ghi_chu && !isWorkgroupOrInspectorName(inspectionsMap[cleanMaKh].ghi_chu)) {
        // Giữ lại hiện trạng hợp lệ đã có
      } else {
        inspectionsMap[cleanMaKh].ghi_chu = '';
      }

      if (upVal && upVal.trim()) {
        inspectionsMap[cleanMaKh].nguoi_cap_nhat = upVal.trim();
      } else if (!inspectionsMap[cleanMaKh].nguoi_cap_nhat) {
        const curInsp = getCurrentInspector();
        if (curInsp) inspectionsMap[cleanMaKh].nguoi_cap_nhat = curInsp;
      }

      // Đã đủ hiện trạng và ảnh -> Tự động chuyển thành Đã kiểm tra
      const now = new Date();
      const timeStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
      inspectionsMap[cleanMaKh].trang_thai = 'Đã kiểm tra';
      if (!inspectionsMap[cleanMaKh].ngay_kiem_tra) {
        inspectionsMap[cleanMaKh].ngay_kiem_tra = timeStr;
      }
      inspectionsMap[cleanMaKh].localUpdatedAt = Date.now();

      renderKPIs();
      renderStationBanner();
      renderMobileStickyBar();

      // Cập nhật giao diện desktop
      const row = document.getElementById(`row-${cleanMaKh}`);
      if (row) {
        row.classList.add('row-completed');
        const stCol = row.querySelector('.col-status');
        if (stCol) stCol.innerHTML = '<span class="badge-status completed">✅ Đã kiểm tra</span>';
        const chk = row.querySelector('.custom-checkbox input');
        if (chk) chk.checked = true;
      }

      // Cập nhật giao diện mobile card
      const card = document.getElementById(`mcard-${cleanMaKh}`);
      const mstatus = document.getElementById(`mstatus-${cleanMaKh}`);
      const mbtn = document.getElementById(`mbtn-toggle-${cleanMaKh}`);
      if (card) {
        card.classList.add('card-completed');
        if (mstatus) mstatus.innerHTML = '<span class="badge-status completed">✅ Đã kiểm tra</span>';
        if (mbtn) {
          mbtn.className = 'btn-mobile-status-toggle completed';
          mbtn.innerHTML = '✅ ĐÃ HOÀN THÀNH KIỂM TRA';
          mbtn.setAttribute('onclick', `window.PCVT.toggleStatus('${cleanMaKh}', false)`);
        }
      }

      syncItemImmediately(cleanMaKh);
      showToast(`✅ Đã lưu và đồng bộ kết quả kiểm tra KH ${cleanMaKh}`, 'success');
    },

    copyText: function(text) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(`Đã sao chép: ${text}`, 'info');
      }).catch(() => {
        showToast(`Mã: ${text}`, 'info');
      });
    },

    goToPage: function(p) {
      currentPage = p;
      renderDataList();
      renderPagination();
      window.scrollTo({ top: 320, behavior: 'smooth' });
    },

    forceReloadFreshData: async function() {
      showLoading(true, 'Đang làm mới dữ liệu & số No từ Google Sheet...');
      try {
        await clearCustomersInIDB();
        localStorage.removeItem(STORAGE_KEY_DATASET_VER);
        await loadInitialData();
        showToast('Đã làm mới thành công toàn bộ số No theo dữ liệu mới nhất!', 'success');
      } catch (err) {
        console.error('forceReloadFreshData error:', err);
        showToast('Lỗi khi làm mới dữ liệu: ' + err.message, 'error');
        showLoading(false);
      }
    },

    scrollToTop: function() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    exportToExcel: function() {
      exportToExcel();
    },

    exportToCSV: function() {
      exportToCSV();
    },

    jumpToCustomer: function(ma_kh) {
      jumpToCustomer(ma_kh);
    },

    pollFieldUpdates: function(isManual) {
      pollFieldUpdates(isManual);
    },

    updatePhotoCellInDOM: function(ma_kh, photoUrl) {
      updatePhotoCellInDOM(ma_kh, photoUrl);
    },

    switchSyncTab: function(tab) {
      switchSyncTab(tab);
    },

    refreshSyncExportData: function() {
      return refreshSyncExportData();
    },

    mergeSyncPackage: function(rawContent) {
      return mergeSyncPackage(rawContent);
    },

    toggleSidebar: function() {
      toggleSidebar();
    },

    closeSidebar: function() {
      closeSidebar();
    },

    openSidebar: function() {
      openSidebar();
    },

    setAssignedGroupFilter: function(groupId) {
      setAssignedGroupFilter(groupId);
    },

    openAssignModal: function(preselectedGroupId) {
      openStationAssignmentModal(preselectedGroupId);
    },

    quickFilterByStation: function(id, name) {
      closeModal('modalStationAssignment');
      this.selectStation(id, name);
    },

    toggleStationAssignSelection: function(stationId, isChecked) {
      if (isChecked) {
        selectedAssignStations.add(stationId);
      } else {
        selectedAssignStations.delete(stationId);
      }
      const row = document.getElementById(`assign-row-${stationId}`);
      if (row) row.classList.toggle('selected', isChecked);
      const filtered = getFilteredStationsForAssignModal();
      updateAssignSelectionCountDisplay(filtered);
    },

    quickAssignSingleStation: function(stationId) {
      quickAssignSingleStation(stationId);
    },

    handleAssignRowClick: function(event, stationId) {
      handleAssignRowClick(event, stationId);
    },

    exportAssignments: function() {
      exportAssignments();
    }
  };

  function checkAllInCurrentStation() {
    if (!currentStationFilter) {
      showToast('Vui lòng chọn 1 trạm trước khi thực hiện!', 'info');
      return;
    }

    const stationCustomers = allCustomers.filter(c => (c.id_tram || c.ma_tram) === currentStationFilter);
    if (stationCustomers.length === 0) return;

    if (confirm(`Đánh dấu ĐÃ KIỂM TRA cho toàn bộ ${stationCustomers.length} KH trong trạm ${currentStationFilter}?`)) {
      const now = new Date();
      const timeStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
      const curInsp = getCurrentInspector();

      stationCustomers.forEach(c => {
        if (!inspectionsMap[c.ma_kh]) inspectionsMap[c.ma_kh] = {};
        inspectionsMap[c.ma_kh].trang_thai = 'Đã kiểm tra';
        if (!inspectionsMap[c.ma_kh].ngay_kiem_tra) {
          inspectionsMap[c.ma_kh].ngay_kiem_tra = timeStr;
        }
        if (!inspectionsMap[c.ma_kh].nguoi_cap_nhat && curInsp) {
          inspectionsMap[c.ma_kh].nguoi_cap_nhat = curInsp;
        }
        syncItemImmediately(c.ma_kh);
      });

      renderApp();
      showToast(`Đã hoàn thành toàn bộ khách hàng trạm ${currentStationFilter}!`, 'success');
    }
  }

  // ==========================================================================
  // EXCEL (.XLSX) & CSV EXPORT - 13 CỘT ĐỒNG BỘ GOOGLE SHEET PC VŨNG TÀU
  // ==========================================================================
  function exportToExcel() {
    if (allCustomers.length === 0) {
      showToast('Không có dữ liệu để xuất!', 'error');
      return;
    }

    showLoading(true, 'Đang tạo tệp Excel (.xlsx)... Vui lòng đợi trong giây lát');

    setTimeout(() => {
      try {
        // 13 Cột chuẩn Google Sheet PCVT (Cột M là Trạng thái có dấu "X")
        const headers = [
          'Stt', 'Mã KH', 'Tên KH', 'Địa chỉ KH', 'Địa chỉ điểm đo',
          'Mã trạm', 'Tên trạm', 'Danh số', 'Số điện thoại', 'Số No',
          'Khu vực', 'Người cập nhật', 'Trạng thái'
        ];

        const rows = [headers];

        allCustomers.forEach((c, idx) => {
          const insp = inspectionsMap[c.ma_kh] || {};
          const itemStation = c.id_tram || c.ma_tram || '';
          const sMeta = stationsMeta[itemStation];
          const sName = (sMeta && sMeta.name) || c.ten_tram || '';
          const isInspected = (insp.trang_thai === 'Đã kiểm tra');
          const statusMark = isInspected ? 'X' : '';

          rows.push([
            c.stt || (idx + 1),
            String(c.ma_kh || ''),
            String(c.ten_kh || ''),
            String(c.dia_chi_kh || ''),
            String(c.dia_chi_ddo || ''),
            String(itemStation || ''),
            String(sName || ''),
            String(c.danh_so || ''),
            String(c.sdt || ''),
            String(formatMeterNo(c.so_no) || ''),
            String(c.khu_vuc || ''),
            String(insp.nguoi_cap_nhat || c.nguoi_cap_nhat || ''),
            statusMark
          ]);
        });

        const now = new Date();
        const dateStr = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
        const filename = `Kien_Toan_HTDD_PCVT_${dateStr}.xlsx`;

        if (typeof XLSX !== 'undefined') {
          const ws = XLSX.utils.aoa_to_sheet(rows);

          // Căn chỉnh độ rộng cột chuẩn thẩm mỹ chuyên nghiệp trong Excel
          ws['!cols'] = [
            { wch: 7 },   // Stt
            { wch: 15 },  // Mã KH
            { wch: 28 },  // Tên KH
            { wch: 35 },  // Địa chỉ KH
            { wch: 35 },  // Địa chỉ điểm đo
            { wch: 12 },  // Mã trạm
            { wch: 24 },  // Tên trạm
            { wch: 12 },  // Danh số
            { wch: 14 },  // Số điện thoại
            { wch: 18 },  // Số No
            { wch: 14 },  // Khu vực
            { wch: 22 },  // Người cập nhật
            { wch: 12 }   // Trạng thái (dấu X)
          ];

          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Kiểm tra HTĐĐ');
          XLSX.writeFile(wb, filename);

          showLoading(false);
          showToast(`Đã xuất thành công tệp Excel .xlsx (${allCustomers.length.toLocaleString('vi-VN')} KH)!`, 'success');
        } else {
          // Fallback to CSV if XLSX is not loaded
          exportToCSV();
          showLoading(false);
        }
      } catch (err) {
        console.error('Export Excel error:', err);
        showLoading(false);
        showToast('Có lỗi khi tạo tệp Excel, chuyển sang tải tệp CSV dự phòng!', 'error');
        exportToCSV();
      }
    }, 100);
  }

  function exportToCSV() {
    if (allCustomers.length === 0) {
      showToast('Không có dữ liệu để xuất!', 'error');
      return;
    }

    const headers = [
      'Stt', 'Mã KH', 'Tên KH', 'Địa chỉ KH', 'Địa chỉ điểm đo',
      'Mã trạm', 'Tên trạm', 'Danh số', 'Số điện thoại', 'Số No',
      'Khu vực', 'Người cập nhật', 'Trạng thái'
    ];

    let csvContent = '\uFEFF';
    csvContent += headers.join(',') + '\r\n';

    allCustomers.forEach((c, idx) => {
      const insp = inspectionsMap[c.ma_kh] || {};
      const itemStation = c.id_tram || c.ma_tram || '';
      const sMeta = stationsMeta[itemStation];
      const sName = (sMeta && sMeta.name) || c.ten_tram || '';
      const isInspected = (insp.trang_thai === 'Đã kiểm tra');
      const statusMark = isInspected ? 'X' : '';

      const row = [
        c.stt || (idx + 1),
        escapeCSV(c.ma_kh),
        escapeCSV(c.ten_kh),
        escapeCSV(c.dia_chi_kh),
        escapeCSV(c.dia_chi_ddo),
        escapeCSV(itemStation),
        escapeCSV(sName),
        escapeCSV(c.danh_so),
        escapeCSV(c.sdt),
        escapeCSV(formatMeterNo(c.so_no)),
        escapeCSV(c.khu_vuc),
        escapeCSV(insp.nguoi_cap_nhat || c.nguoi_cap_nhat || ''),
        escapeCSV(statusMark)
      ];
      csvContent += row.join(',') + '\r\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const now = new Date();
    const dateStr = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}`;
    link.setAttribute('href', url);
    link.setAttribute('download', `Kien_Toan_HTDD_PCVT_GoogleSheet_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Đã xuất file 13 cột đồng bộ Google Sheet!', 'success');
  }

  function escapeCSV(str) {
    if (str === null || str === undefined) return '""';
    const s = String(str).replace(/"/g, '""');
    return `"${s}"`;
  }

  function handleFileImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const fileName = (file.name || '').toLowerCase();
    showLoading(true, 'Đang đọc và xử lý tệp khách hàng...');

    if ((fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) && typeof XLSX !== 'undefined') {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const csvText = XLSX.utils.sheet_to_csv(worksheet);
          const parsed = parseCSV(csvText);
          if (parsed && parsed.length > 0) {
            allCustomers = parsed;
            buildStationsMetaFromCustomers();
            await saveCustomersToIDB(allCustomers);
            applyFilters();
            renderApp();
            showLoading(false);
            showToast(`Đã nạp thành công ${parsed.length.toLocaleString('vi-VN')} KH từ file Excel .xlsx!`, 'success');
          } else {
            showLoading(false);
            showToast('Không tìm thấy dữ liệu khách hàng hợp lệ trong file Excel!', 'error');
          }
        } catch (err) {
          console.error('Read Excel error:', err);
          showLoading(false);
          showToast('Lỗi khi đọc file Excel: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const text = evt.target.result;
        const parsed = parseCSV(text);
        if (parsed && parsed.length > 0) {
          allCustomers = parsed;
          buildStationsMetaFromCustomers();
          await saveCustomersToIDB(allCustomers);
          applyFilters();
          renderApp();
          showLoading(false);
          showToast(`Đã nạp thành công toàn bộ ${parsed.length.toLocaleString('vi-VN')} KH từ tệp!`, 'success');
        } else {
          showLoading(false);
          showToast('Không tìm thấy bản ghi khách hàng hợp lệ!', 'error');
        }
      };
      reader.readAsText(file, 'utf-8');
    }
  }

  // ==========================================================================
  // REAL-TIME FIELD SYNC ENGINE (ĐỒNG BỘ HIỆN TRƯỜNG VỀ NHÀ THỜI GIAN THỰC)
  // ==========================================================================
  function playNotificationChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.38);
    } catch (e) {
      console.warn('Audio chime notice:', e);
    }
  }

  function renderLiveActivityFeed() {
    const container = document.getElementById('liveFeedList');
    const badge = document.getElementById('liveFeedBadge');
    const countToday = document.getElementById('liveCountToday');
    const lastDesc = document.getElementById('liveLastActivityText');

    if (badge) badge.textContent = liveActivityLog.length;
    if (countToday) countToday.textContent = liveActivityLog.length;

    if (liveActivityLog.length > 0 && lastDesc) {
      const latest = liveActivityLog[0];
      lastDesc.innerHTML = `Vừa nhận: KH <strong>${escapeHTML(latest.ma_kh)}</strong> (${escapeHTML(latest.nguoi_cap_nhat)}) lúc <strong>${latest.timeStr}</strong>`;
    }

    if (!container) return;
    if (liveActivityLog.length === 0) {
      container.innerHTML = `<div class="live-feed-empty">Chưa có bản ghi nào được cập nhật trong phiên làm việc này. Khi các anh ngoài hiện trường thao tác, danh sách sẽ hiển thị ngay tại đây!</div>`;
      return;
    }

    let html = '';
    liveActivityLog.forEach(item => {
      html += `
        <div class="live-feed-card">
          <div class="live-feed-left">
            <span class="live-feed-time">🕒 ${escapeHTML(item.timeStr)}</span>
            <div>
              <span class="live-feed-cust-id">KH: ${escapeHTML(item.ma_kh)}</span>
              <span style="color:#64748b; font-size:0.75rem;"> - ${escapeHTML(item.ten_kh)}</span>
              ${item.station ? `<span style="font-size:0.72rem; color:#0284c7; margin-left:4px;">⚡ ${escapeHTML(item.station)}</span>` : ''}
            </div>
            <span class="live-feed-inspector">👤 ${escapeHTML(item.nguoi_cap_nhat)}</span>
          </div>
          <button type="button" class="btn-feed-jump" onclick="window.PCVT.jumpToCustomer('${escapeHTML(item.ma_kh)}')">
            🔍 Xem KH
          </button>
        </div>
      `;
    });
    container.innerHTML = html;
  }

  function jumpToCustomer(ma_kh) {
    const globalSearchInput = document.getElementById('globalKeywordInput');
    if (globalSearchInput) {
      globalSearchInput.value = ma_kh;
      currentSearchKeyword = ma_kh;
      applyFilters();
      renderApp();

      setTimeout(() => {
        const row = document.getElementById(`row-${ma_kh}`);
        const card = document.getElementById(`mcard-${ma_kh}`);
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.classList.add('row-just-updated');
          setTimeout(() => row.classList.remove('row-just-updated'), 3500);
        }
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('row-just-updated');
          setTimeout(() => card.classList.remove('row-just-updated'), 3500);
        }
      }, 150);
    }
  }

  async function pollFieldUpdates(isManual = false) {
    const statusPill = document.getElementById('liveStatusPill');

    if (statusPill) {
      statusPill.className = 'live-status-pill syncing';
      statusPill.innerHTML = '🔄 ĐANG QUÉT CẬP NHẬT...';
    }

    const webhookUrl = getWebhookUrl();
    let isConnected = false;
    let sheetCheckedMap = new Map(); // Map: ma_kh -> updateObj

    // CHIẾN LƯỢC 1: Nếu có Webhook URL, gọi doGet lấy danh sách đồng bộ hiện có trên Google Sheet
    if (webhookUrl) {
      try {
        // Luôn lấy danh sách các bản ghi hiện có trên Log_DongBo (since=0 để so sánh đối chiếu)
        const fetchUrl = `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}action=get_updates&since=0`;
        const resp = await fetch(fetchUrl, { method: 'GET' });
        if (resp.ok) {
          const json = await resp.json();
          if (json && json.status === 'success') {
            isConnected = true;
            if (Array.isArray(json.updates)) {
              json.updates.forEach(u => {
                if (!u || !u.ma_kh) return;

                let isChecked = false;
                let idTram = String(u.id_tram || '').trim();
                let tenTram = String(u.ten_tram || '').trim();
                let danhSo = String(u.danh_so || '').trim();
                let updater = String(u.nguoi_cap_nhat || '').trim();
                let inspectDate = String(u.ngay_kiem_tra || '').trim();
                let note = String(u.ghi_chu || '').trim();
                let photo = String(u.hinh_anh || u.photo || '').trim();

                const rawStatus = String(u.trang_thai_x || u.trang_thai || '').trim();

                // Nhận diện trạng thái đã kiểm tra từ Google Sheet / Apps Script:
                // 1. Cấu trúc chuẩn có 'X' hoặc 'Đã kiểm tra'
                if (rawStatus.toUpperCase() === 'X' || rawStatus.toLowerCase() === 'đã kiểm tra' || rawStatus.toLowerCase() === 'da kiem tra') {
                  isChecked = true;
                } 
                // 2. Cấu trúc 9/10 cột trên Sheet khi Apps Script cũ đọc bị lệch cột:
                // Col 1: Mã KH, Col 2: ID trạm, Col 3 (u.trang_thai_x): Tên trạm, Col 4 (u.ngay_kiem_tra): Mã danh số, Col 5 (u.ghi_chu): Cán bộ cập nhật / Nhóm
                else if (rawStatus && rawStatus !== 'Chưa kiểm tra' && rawStatus !== '0' && rawStatus !== 'false') {
                  isChecked = true;
                  if (!idTram && updater && note) {
                    idTram = updater;       // Col 2 là ID trạm (vd "101471")
                    tenTram = rawStatus;     // Col 3 là Tên trạm (vd "Phước Bình 3")
                    danhSo = inspectDate;    // Col 4 là Mã danh số (vd "OK-001013")
                    updater = note;          // Col 5 là Nhóm công tác (vd "Nguyễn Xuân Thắng...")
                    note = '';
                    inspectDate = '';
                  }
                } 
                // 3. Mọi bản ghi tồn tại trong Log_DongBo đều là khách hàng đã được kiểm tra từ hiện trường
                else if (u.timestamp && !rawStatus) {
                  isChecked = true;
                }

                // Vệ sinh tuyệt đối: Nếu note chứa tên cán bộ / nhóm công tác thì xóa ngay và chuyển vào updater nếu updater trống
                if (isWorkgroupOrInspectorName(note)) {
                  if (!updater || updater === idTram) updater = note;
                  note = '';
                }

                if (isChecked) {
                  sheetCheckedMap.set(u.ma_kh, {
                    ma_kh: u.ma_kh,
                    id_tram: idTram,
                    ten_tram: tenTram,
                    danh_so: danhSo,
                    nguoi_cap_nhat: updater,
                    trang_thai_x: 'X',
                    trang_thai: 'Đã kiểm tra',
                    ngay_kiem_tra: inspectDate,
                    ghi_chu: note,
                    hinh_anh: photo,
                    timestamp: u.timestamp
                  });
                }
              });
            }
            // Đồng bộ phân công trạm đa thiết bị từ Webhook
            if (Array.isArray(json.station_assignments)) {
              reconcileStationAssignmentsFromCloud(json.station_assignments);
            }
            if (json.server_time) lastLivePollTimestamp = json.server_time;
          }
        }
      } catch (e) {
        console.warn('Webhook doGet poll notice, falling back to Google Sheet query:', e);
      }
    }

    // CHIẾN LƯỢC 2: Nếu chưa kết nối Webhook hoặc Webhook lỗi, quét Google Sheet GViz API
    if (!isConnected) {
      try {
        const sheetUrl = localStorage.getItem(STORAGE_KEY_SHEET_URL) || DEFAULT_SHEET_URL;
        const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        const sheetId = sheetIdMatch ? sheetIdMatch[1] : '1unVxNXZkTO_ps_HqlNIOnP05FIbU9DT4';
        
        // Quét trang Log_DongBo qua GViz (Hỗ trợ bảng 10 cột có ảnh, 9 cột mới và 6 cột cũ)
        const gvizLogUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=Log_DongBo&tq=` + encodeURIComponent("select *");
        const resp = await fetch(gvizLogUrl);
        if (resp.ok) {
          const raw = await resp.text();
          const start = raw.indexOf('{');
          const end = raw.lastIndexOf('}');
          if (start !== -1 && end !== -1) {
            const gData = JSON.parse(raw.substring(start, end + 1));
            const gCols = (gData.table && gData.table.cols) || [];
            const firstColLabel = String((gCols[0] && gCols[0].label) || '').toLowerCase().trim();

            // KIỂM TRA TÍNH HỢP LỆ: Nếu bảng trả về > 12 cột hoặc cột đầu là 'stt' -> Google Sheets trả về Sheet 1 (210k dòng)!
            if (gCols.length > 12 || firstColLabel === 'stt' || firstColLabel.indexOf('stt') !== -1) {
              console.warn('GViz query fell back to Sheet 1 instead of Log_DongBo. Ignoring to prevent false unchecking.');
            } else {
              const rows = (gData.table && gData.table.rows) || [];
              isConnected = true;

              // Xác định vị trí cột theo schema gCols (Tránh lỗi GViz bỏ cell rỗng khiến số lượng cell trong hàng bị ngắn)
              // Chuẩn 10 cột: Timestamp (0), Mã KH (1), ID trạm (2), Tên trạm (3), Mã danh số (4), Người cập nhật (5), Trạng thái (6), Ngày KT (7), Ghi chú (8), Ảnh chụp công tơ (9)
              const isOld6Col = (gCols.length <= 6);
              let colIdxMaKh = 1;
              let colIdxIdTram = isOld6Col ? -1 : 2;
              let colIdxTenTram = isOld6Col ? -1 : 3;
              let colIdxDanhSo = isOld6Col ? -1 : 4;
              let colIdxUpdater = isOld6Col ? 2 : 5;
              let colIdxTrangThai = isOld6Col ? 3 : 6;
              let colIdxNgayKt = isOld6Col ? 4 : 7;
              let colIdxNote = isOld6Col ? 5 : 8;
              let colIdxPhoto = isOld6Col ? -1 : (gCols.length >= 10 ? 9 : -1);

              // Quét nhãn cột nếu bảng có nhãn rõ ràng
              gCols.forEach((col, idx) => {
                const lbl = String((col && col.label) || '').toLowerCase().trim();
                if (lbl.includes('khách') || lbl.includes('mã kh') || lbl === 'makh') colIdxMaKh = idx;
                else if (lbl.includes('id trạm') || lbl.includes('mã trạm')) colIdxIdTram = idx;
                else if (lbl.includes('tên trạm')) colIdxTenTram = idx;
                else if (lbl.includes('danh số')) colIdxDanhSo = idx;
                else if (lbl.includes('người') || lbl.includes('cán bộ')) colIdxUpdater = idx;
                else if (lbl.includes('trạng thái')) colIdxTrangThai = idx;
                else if (lbl.includes('ngày')) colIdxNgayKt = idx;
                else if (lbl.includes('ghi chú') || lbl.includes('hiện trạng') || lbl.includes('ghi chu') || lbl.includes('hien trang')) colIdxNote = idx;
                else if (lbl.includes('ảnh') || lbl.includes('hình') || lbl.includes('photo')) colIdxPhoto = idx;
              });

              rows.forEach(r => {
                const cCells = r.c || [];
                const getCell = (idx) => (idx >= 0 && idx < cCells.length && cCells[idx] && cCells[idx].v != null) ? String(cCells[idx].v).trim() : '';

                const ma_kh = getCell(colIdxMaKh);
                if (!ma_kh) return;

                let id_tram = colIdxIdTram !== -1 ? getCell(colIdxIdTram) : '';
                let ten_tram = colIdxTenTram !== -1 ? getCell(colIdxTenTram) : '';
                let danh_so = colIdxDanhSo !== -1 ? getCell(colIdxDanhSo) : '';
                let nguoi_cap_nhat = getCell(colIdxUpdater);
                let trang_thai = getCell(colIdxTrangThai);
                let ngay_kt = getCell(colIdxNgayKt);
                let ghi_chu = colIdxNote !== -1 ? getCell(colIdxNote) : '';
                let hinh_anh = colIdxPhoto !== -1 ? getCell(colIdxPhoto) : '';

                // Làm sạch tuyệt đối: Nếu ghi_chu vô tình là tên nhóm/cán bộ công tác (do lệch cột hoặc người dùng copy paste nhầm)
                if (isWorkgroupOrInspectorName(ghi_chu)) {
                  if (!nguoi_cap_nhat) nguoi_cap_nhat = ghi_chu;
                  ghi_chu = '';
                }

                if (trang_thai.toUpperCase() === 'X' || trang_thai === 'Đã kiểm tra' || trang_thai.toLowerCase() === 'da kiem tra') {
                  sheetCheckedMap.set(ma_kh, {
                    ma_kh: ma_kh,
                    id_tram: id_tram,
                    ten_tram: ten_tram,
                    danh_so: danh_so,
                    nguoi_cap_nhat: nguoi_cap_nhat,
                    trang_thai_x: 'X',
                    trang_thai: 'Đã kiểm tra',
                    ngay_kiem_tra: ngay_kt,
                    ghi_chu: ghi_chu,
                    hinh_anh: hinh_anh
                  });
                }
              });
            }
          }
        }

        // Quét trang PhanCong_Tram qua GViz (Đồng bộ đa thiết bị)
        try {
          const gvizAssignUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=PhanCong_Tram&tq=` + encodeURIComponent("select *");
          const assignResp = await fetch(gvizAssignUrl);
          if (assignResp.ok) {
            const assignRaw = await assignResp.text();
            const aStart = assignRaw.indexOf('{');
            const aEnd = assignRaw.lastIndexOf('}');
            if (aStart !== -1 && aEnd !== -1) {
              const aData = JSON.parse(assignRaw.substring(aStart, aEnd + 1));
              const aCols = (aData.table && aData.table.cols) || [];
              const aFirstCol = String((aCols[0] && aCols[0].label) || '').toLowerCase().trim();
              if (aCols.length > 10 || aFirstCol === 'stt' || aFirstCol.indexOf('stt') !== -1) {
                console.warn('GViz query fell back to Sheet 1 instead of PhanCong_Tram. Ignoring.');
              } else {
                const aRows = (aData.table && aData.table.rows) || [];
                const cloudAssignments = [];
                aRows.forEach(r => {
                  const cCells = r.c || [];
                  const rawVals = cCells.map(c => (c && c.v != null) ? String(c.v).trim() : '');
                  if (rawVals.length >= 4 && rawVals[1]) {
                    cloudAssignments.push({
                      timestamp: rawVals[0],
                      stId: rawVals[1],
                      stName: rawVals[2] || '',
                      groupId: rawVals[3] || '',
                      groupName: rawVals[4] || '',
                      leader: rawVals[5] || '',
                      assignedAt: rawVals[6] || ''
                    });
                  }
                });
                if (cloudAssignments.length > 0) {
                  reconcileStationAssignmentsFromCloud(cloudAssignments);
                }
              }
            }
          }
        } catch (assignErr) {
          console.warn('GViz PhanCong_Tram poll notice:', assignErr);
        }
      } catch (gErr) {
        console.warn('GViz live poll notice:', gErr);
      }
    }

    // NẾU KẾT NỐI THÀNH CÔNG VỚI GOOGLE SHEET / WEBHOOK: TIẾN HÀNH ĐỐI SOÁT 2 CHIỀU (RECONCILE)
    if (isConnected) {
      let hasChanges = false;
      let newlyCheckedCount = 0;
      let revertedCount = 0;
      let photoSyncedCount = 0;
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
      const nowTs = Date.now();
      const offlineQueue = getOfflineQueue();
      const pendingMaKhSet = new Set(offlineQueue.map(q => q.ma_kh));

      // 1. TỰ ĐỘNG BỎ CHỌN CÁC KH ĐÃ BỊ XÓA BÊN THIẾT BỊ KHÁC
      // ĐIỀU KIỆN BẢO VỆ AN TOÀN TUYỆT ĐỐI:
      // - Chỉ đối soát khi sheetCheckedMap có ít nhất 1 bản ghi hợp lệ (sheetCheckedMap.size > 0). Không bao giờ xóa sạch khi danh sách cloud trống hoặc chưa tải được!
      // - KHÔNG BAO GIỜ hủy các KH vừa được kiểm tra trực tiếp trên thiết bị này trong 30 phút hoặc đang trong hàng đợi gửi (offline queue)!
      if (sheetCheckedMap.size > 0) {
        Object.keys(inspectionsMap).forEach(ma_kh => {
          if (inspectionsMap[ma_kh] && inspectionsMap[ma_kh].trang_thai === 'Đã kiểm tra') {
            const localAge = nowTs - (inspectionsMap[ma_kh].localUpdatedAt || 0);
            if (localAge < 30 * 60 * 1000) {
              return; // Vừa kiểm tra trên máy này trong vòng 30 phút -> BẢO VỆ DỮ LIỆU, KHÔNG HỦY!
            }
            if (pendingMaKhSet.has(ma_kh)) {
              return; // Đang nằm trong hàng đợi chờ gửi lên cloud -> BẢO VỆ DỮ LIỆU, KHÔNG HỦY!
            }

            if (!sheetCheckedMap.has(ma_kh)) {
              // Khách hàng này đã từng đồng bộ lên cloud trước đó nhưng nay đã bị xóa/hủy bên thiết bị khác
              inspectionsMap[ma_kh].trang_thai = 'Chưa kiểm tra';
              inspectionsMap[ma_kh].ngay_kiem_tra = '';
              hasChanges = true;
              revertedCount++;

              // Revert giao diện bảng máy tính nếu đang hiển thị
              const row = document.getElementById(`row-${ma_kh}`);
              if (row) {
                row.classList.remove('row-completed', 'row-just-updated');
                const stEl = row.querySelector('.col-status');
                if (stEl) stEl.innerHTML = '<span class="badge-status pending">⏳ Chưa kiểm tra</span>';
                const chk = row.querySelector('.custom-checkbox input');
                if (chk) chk.checked = false;
              }

              // Revert giao diện thẻ di động nếu đang hiển thị
              const card = document.getElementById(`mcard-${ma_kh}`);
              if (card) {
                card.classList.remove('card-completed', 'row-just-updated');
                const mstatus = document.getElementById(`mstatus-${ma_kh}`);
                const mbtn = document.getElementById(`mbtn-toggle-${ma_kh}`);
                if (mstatus) mstatus.innerHTML = '<span class="badge-status pending">⏳ Chưa kiểm tra</span>';
                if (mbtn) {
                  mbtn.className = 'btn-mobile-status-toggle';
                  mbtn.innerHTML = '🔘 CHẠM ĐỂ ĐÁNH DẤU HOÀN THÀNH';
                  mbtn.setAttribute('onclick', `window.PCVT.toggleStatus('${ma_kh}', true)`);
                }
              }
            }
          }
        });
      }

      // 2. CẬP NHẬT CÁC KHÁCH HÀNG MỚI ĐƯỢC KIỂM TRA TỪ HIỆN TRƯỜNG & ẢNH CHỤP
      sheetCheckedMap.forEach((item, ma_kh) => {
        if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};
        const wasCompleted = inspectionsMap[ma_kh].trang_thai === 'Đã kiểm tra';
        const curUpdater = inspectionsMap[ma_kh].nguoi_cap_nhat || '';
        const isNewCheck = !wasCompleted;
        const isNewInfo = isNewCheck || (item.nguoi_cap_nhat && item.nguoi_cap_nhat !== curUpdater);
        const hasNewPhoto = Boolean(item.hinh_anh && (!inspectionsMap[ma_kh].hinh_anh || inspectionsMap[ma_kh].hinh_anh !== item.hinh_anh));

        if (isNewInfo || hasNewPhoto) {
          inspectionsMap[ma_kh].trang_thai = 'Đã kiểm tra';
          if (item.nguoi_cap_nhat) inspectionsMap[ma_kh].nguoi_cap_nhat = item.nguoi_cap_nhat;

          // BẢO VỆ HIỆN TRẠNG (GHI CHÚ):
          // 1. Tuyệt đối không nhận tên nhóm/cán bộ vào trường ghi chú
          // 2. Nếu thiết bị này vừa lưu hoặc sửa hiện trạng trong vòng 30 phút -> Ưu tiên giữ hiện trạng của thiết bị, không bị cloud ghi đè
          const localAge = nowTs - (inspectionsMap[ma_kh].localUpdatedAt || 0);
          const hasFreshLocalNote = Boolean(inspectionsMap[ma_kh].ghi_chu && localAge < 30 * 60 * 1000 && !isWorkgroupOrInspectorName(inspectionsMap[ma_kh].ghi_chu));
          const incomingNote = String(item.ghi_chu || '').trim();

          if (incomingNote && !isWorkgroupOrInspectorName(incomingNote)) {
            if (!hasFreshLocalNote || !inspectionsMap[ma_kh].ghi_chu) {
              inspectionsMap[ma_kh].ghi_chu = incomingNote;
            }
          } else if (isWorkgroupOrInspectorName(inspectionsMap[ma_kh].ghi_chu)) {
            // Tự động làm sạch nếu dữ liệu cũ còn sót tên nhóm
            if (!inspectionsMap[ma_kh].nguoi_cap_nhat) inspectionsMap[ma_kh].nguoi_cap_nhat = inspectionsMap[ma_kh].ghi_chu;
            inspectionsMap[ma_kh].ghi_chu = '';
          }

          if (hasNewPhoto) {
            inspectionsMap[ma_kh].hinh_anh = item.hinh_anh;
            updatePhotoCellInDOM(ma_kh, item.hinh_anh);
            photoSyncedCount++;
          }
          if (!inspectionsMap[ma_kh].ngay_kiem_tra || !inspectionsMap[ma_kh].ngay_kiem_tra.includes('/')) {
            if (item.ngay_kiem_tra && item.ngay_kiem_tra.includes('/')) {
              inspectionsMap[ma_kh].ngay_kiem_tra = item.ngay_kiem_tra;
            } else {
              const d = item.timestamp ? new Date(Number(item.timestamp)) : now;
              inspectionsMap[ma_kh].ngay_kiem_tra = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
            }
          }
          inspectionsMap[ma_kh].localUpdatedAt = item.timestamp || Date.now();
          hasChanges = true;
          if (isNewCheck) newlyCheckedCount++;

          const cust = allCustomers.find(c => c.ma_kh === ma_kh) || {};
          liveActivityLog.unshift({
            timestamp: Date.now(),
            timeStr: timeStr,
            ma_kh: ma_kh,
            ten_kh: cust.ten_kh || item.ten_kh || 'Khách hàng',
            station: item.id_tram || cust.id_tram || cust.ma_tram || '',
            nguoi_cap_nhat: item.nguoi_cap_nhat || cust.nguoi_cap_nhat || 'Cán bộ hiện trường'
          });

          // Cập nhật giao diện dòng bảng
          const row = document.getElementById(`row-${ma_kh}`);
          if (row) {
            row.classList.add('row-completed', 'row-just-updated');
            const stEl = row.querySelector('.col-status');
            if (stEl) stEl.innerHTML = '<span class="badge-status completed">✅ Đã kiểm tra</span>';
            const chk = row.querySelector('.custom-checkbox input');
            if (chk) chk.checked = true;
            const upInput = document.getElementById(`updater-${ma_kh}`);
            if (upInput && item.nguoi_cap_nhat) upInput.value = item.nguoi_cap_nhat;
            setTimeout(() => row.classList.remove('row-just-updated'), 3500);
          }

          // Cập nhật giao diện thẻ di động
          const card = document.getElementById(`mcard-${ma_kh}`);
          if (card) {
            card.classList.add('card-completed', 'row-just-updated');
            const mstatus = document.getElementById(`mstatus-${ma_kh}`);
            const mbtn = document.getElementById(`mbtn-toggle-${ma_kh}`);
            if (mstatus) mstatus.innerHTML = '<span class="badge-status completed">✅ Đã kiểm tra</span>';
            if (mbtn) {
              mbtn.className = 'btn-mobile-status-toggle completed';
              mbtn.innerHTML = '✅ ĐÃ HOÀN THÀNH KIỂM TRA';
              mbtn.setAttribute('onclick', `window.PCVT.toggleStatus('${ma_kh}', false)`);
            }
            const mupdater = document.getElementById(`mupdater-${ma_kh}`);
            if (mupdater && item.nguoi_cap_nhat) mupdater.value = item.nguoi_cap_nhat;
            setTimeout(() => card.classList.remove('row-just-updated'), 3500);
          }
        }
      });

      // 3. NẾU CÓ THAY ĐỔI -> LƯU VÀ LÀM MỚI TOÀN BỘ GIAO DIỆN (GIỮ NGUYÊN TRANG ĐANG XEM)
      if (hasChanges) {
        if (liveActivityLog.length > 50) liveActivityLog = liveActivityLog.slice(0, 50);
        saveLocalInspections();
        applyFilters(true); // Giữ nguyên trang hiện tại của người dùng (trang 3, 4, ...)
        renderApp();
        renderLiveActivityFeed();

        if (newlyCheckedCount > 0) {
          if (isSoundAlertEnabled) playNotificationChime();
          showToast(`🔔 [Đồng bộ] Đã cập nhật thành công ${newlyCheckedCount} khách hàng đã kiểm tra từ Google Sheet!`, 'success');
        }
        if (revertedCount > 0) {
          showToast(`🔄 [Đồng bộ] Đã chuyển ${revertedCount} KH về "Chưa kiểm tra" theo Google Sheet`, 'info');
        }
      } else if (isManual) {
        applyFilters(true); // Giữ nguyên trang hiện tại khi quét thủ công
        renderApp();
        showToast(`✅ Đã đồng bộ hoàn tất! Hiện có ${sheetCheckedMap.size} khách hàng đã kiểm tra trên Google Sheet`, 'success');
      }
    } else if (isManual) {
      showToast('Không thể kết nối đến Webhook Google Sheet để kiểm tra!', 'warning');
    }

    if (statusPill) {
      if (isLiveSyncRunning) {
        statusPill.className = 'live-status-pill online';
        statusPill.innerHTML = '🟢 ĐANG KẾT NỐI (TỰ ĐỘNG 15S)';
      } else {
        statusPill.className = 'live-status-pill paused';
        statusPill.innerHTML = '⏸️ ĐÃ TẠM DỪNG';
      }
    }
  }

  function startLiveFieldSync() {
    if (liveSyncTimer) clearInterval(liveSyncTimer);
    isLiveSyncRunning = true;
    localStorage.setItem(STORAGE_KEY_LIVE_SYNC_ENABLED, 'true');

    const btnText = document.getElementById('btnToggleLiveSyncText');
    const btnIcon = document.getElementById('btnToggleLiveSyncIcon');
    const statusPill = document.getElementById('liveStatusPill');
    const pingDot = document.getElementById('livePingDot');

    if (btnText) btnText.textContent = 'Tạm dừng';
    if (btnIcon) btnIcon.textContent = '⏸️';
    if (statusPill) {
      statusPill.className = 'live-status-pill online';
      statusPill.textContent = '🟢 ĐANG KẾT NỐI (TỰ ĐỘNG 15S)';
    }
    if (pingDot) pingDot.classList.add('active');

    liveSyncTimer = setInterval(() => {
      if (isLiveSyncRunning && navigator.onLine) {
        pollFieldUpdates(false);
      }
    }, LIVE_SYNC_POLL_INTERVAL);
  }

  function stopLiveFieldSync() {
    if (liveSyncTimer) {
      clearInterval(liveSyncTimer);
      liveSyncTimer = null;
    }
    isLiveSyncRunning = false;
    localStorage.setItem(STORAGE_KEY_LIVE_SYNC_ENABLED, 'false');

    const btnText = document.getElementById('btnToggleLiveSyncText');
    const btnIcon = document.getElementById('btnToggleLiveSyncIcon');
    const statusPill = document.getElementById('liveStatusPill');
    const pingDot = document.getElementById('livePingDot');

    if (btnText) btnText.textContent = 'Bật theo dõi';
    if (btnIcon) btnIcon.textContent = '▶️';
    if (statusPill) {
      statusPill.className = 'live-status-pill paused';
      statusPill.textContent = '⏸️ ĐÃ TẠM DỪNG';
    }
    if (pingDot) pingDot.classList.remove('active');
  }

  // ==========================================================================
  // MULTI-DEVICE SYNC & MERGE (GỘP KẾT QUẢ ĐA THIẾT BỊ)
  // ==========================================================================
  function refreshSyncExportData() {
    const exportCodeArea = document.getElementById('syncExportCodeText');
    const exportCountBadge = document.getElementById('syncExportCount');
    const exportPhotoBadge = document.getElementById('syncExportPhotoCount');

    const compactInspections = {};
    let count = 0;
    let photoCount = 0;

    for (const [maKh, insp] of Object.entries(inspectionsMap)) {
      if (insp && (insp.trang_thai === 'Đã kiểm tra' || insp.ghi_chu || insp.hinh_anh || insp.nguoi_cap_nhat)) {
        compactInspections[maKh] = {
          t: insp.trang_thai === 'Đã kiểm tra' ? 'X' : '',
          u: insp.nguoi_cap_nhat || '',
          d: insp.ngay_kiem_tra || '',
          n: insp.ghi_chu || '',
          img: insp.hinh_anh || '',
          p: insp.hinh_anh ? 1 : 0
        };
        if (insp.trang_thai === 'Đã kiểm tra') count++;
        if (insp.hinh_anh) photoCount++;
      }
    }

    if (exportCountBadge) {
      exportCountBadge.textContent = count.toLocaleString('vi-VN');
    }
    if (exportPhotoBadge) {
      exportPhotoBadge.textContent = photoCount.toLocaleString('vi-VN');
    }

    const payload = {
      app: 'PCVT_KT',
      ver: 2,
      exportedAt: new Date().toISOString(),
      count: count,
      photoCount: photoCount,
      data: compactInspections
    };

    const jsonStr = JSON.stringify(payload);
    if (exportCodeArea) {
      exportCodeArea.value = jsonStr;
    }
    return jsonStr;
  }

  function switchSyncTab(tab) {
    const tabExport = document.getElementById('tabBtnDeviceExport');
    const tabImport = document.getElementById('tabBtnDeviceImport');
    const contentExport = document.getElementById('syncTabContentExport');
    const contentImport = document.getElementById('syncTabContentImport');

    if (tab === 'export') {
      if (tabExport) tabExport.classList.add('active');
      if (tabImport) tabImport.classList.remove('active');
      if (contentExport) contentExport.style.display = 'block';
      if (contentImport) contentImport.style.display = 'none';
      refreshSyncExportData();
    } else {
      if (tabImport) tabImport.classList.add('active');
      if (tabExport) tabExport.classList.remove('active');
      if (contentImport) contentImport.style.display = 'block';
      if (contentExport) contentExport.style.display = 'none';
      const importInput = document.getElementById('syncImportCodeText');
      if (importInput) setTimeout(() => importInput.focus(), 150);
    }
  }

  function mergeSyncPackage(rawContent) {
    if (!rawContent || typeof rawContent !== 'string' || !rawContent.trim()) {
      showToast('Nội dung mã đồng bộ trống hoặc không hợp lệ!', 'error');
      return false;
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent.trim());
    } catch (e) {
      showToast('Định dạng mã đồng bộ không đúng chuẩn JSON!', 'error');
      return false;
    }

    let incomingItems = {};
    if (parsed.app === 'PCVT_KT' && parsed.data && typeof parsed.data === 'object') {
      incomingItems = parsed.data;
    } else if (parsed.items && typeof parsed.items === 'object') {
      incomingItems = parsed.items;
    } else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      incomingItems = parsed;
    } else if (Array.isArray(parsed)) {
      parsed.forEach(item => {
        if (item && item.ma_kh) {
          incomingItems[item.ma_kh] = item;
        }
      });
    }

    const keys = Object.keys(incomingItems);
    if (keys.length === 0) {
      showToast('Không tìm thấy dữ liệu khách hàng nào trong gói đồng bộ!', 'error');
      return false;
    }

    let addedCount = 0;
    let updatedCount = 0;
    let photoAddedCount = 0;
    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    keys.forEach(maKh => {
      const inc = incomingItems[maKh];
      if (!inc) return;

      const isCompleted = (inc.t === 'X' || inc.trang_thai === 'Đã kiểm tra' || inc.trang_thai_x === 'X');
      let updater = inc.u || inc.nguoi_cap_nhat || '';
      let note = inc.n || inc.ghi_chu || '';
      if (isWorkgroupOrInspectorName(note)) {
        if (!updater) updater = note;
        note = '';
      }
      const date = inc.d || inc.ngay_kiem_tra || dateStr;
      const photo = inc.img || inc.hinh_anh || '';

      if (!inspectionsMap[maKh]) {
        inspectionsMap[maKh] = {
          trang_thai: isCompleted ? 'Đã kiểm tra' : 'Chưa kiểm tra',
          nguoi_cap_nhat: updater,
          ghi_chu: note,
          ngay_kiem_tra: date
        };
        if (photo) {
          inspectionsMap[maKh].hinh_anh = photo;
          photoAddedCount++;
        }
        if (isCompleted) addedCount++;
      } else {
        const wasCompleted = (inspectionsMap[maKh].trang_thai === 'Đã kiểm tra');
        if (isCompleted) inspectionsMap[maKh].trang_thai = 'Đã kiểm tra';
        if (updater) inspectionsMap[maKh].nguoi_cap_nhat = updater;
        if (note && !isWorkgroupOrInspectorName(note)) {
          inspectionsMap[maKh].ghi_chu = note;
        } else if (isWorkgroupOrInspectorName(inspectionsMap[maKh].ghi_chu)) {
          inspectionsMap[maKh].ghi_chu = '';
        }
        if (!inspectionsMap[maKh].ngay_kiem_tra && date) inspectionsMap[maKh].ngay_kiem_tra = date;
        if (photo) {
          inspectionsMap[maKh].hinh_anh = photo;
          photoAddedCount++;
        }

        if (isCompleted && !wasCompleted) addedCount++;
        else updatedCount++;
      }

      if (photo) {
        updatePhotoCellInDOM(maKh, photo);
      }

      // Tự động đẩy lên Google Sheet nếu Webhook đang kết nối
      syncItemImmediately(maKh);
    });

    saveLocalInspections();
    applyFilters();
    renderApp();
    playNotificationChime();

    showToast(`✅ Đã gộp thành công ${keys.length.toLocaleString('vi-VN')} khách hàng (${addedCount} KH mới kiểm tra, ${photoAddedCount} ảnh hiện trường)!`, 'success');

    // Xóa nội dung ô nhập
    const importInput = document.getElementById('syncImportCodeText');
    if (importInput) importInput.value = '';

    refreshSyncExportData();
    return true;
  }

  window.openModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.add('active');
      if (id === 'modalMultiDeviceSync') {
        refreshSyncExportData();
      }
    }
  };

  window.closeModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
  };

  function showLoading(isLoading, message = 'Đang đồng bộ dữ liệu...') {
    const loader = document.getElementById('globalLoader');
    if (loader) {
      loader.style.display = isLoading ? 'flex' : 'none';
      const label = loader.querySelector('span');
      if (label && message) label.textContent = message;
    }
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span><span>${escapeHTML(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();
