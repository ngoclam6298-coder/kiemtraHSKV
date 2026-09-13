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
  const LIVE_SYNC_POLL_INTERVAL = 15000; // Quét tự động mỗi 15 giây
  
  // IndexedDB Constants for 221.038 customers
  const IDB_NAME = 'PCVT_KIENTHOAN_FULL_DB';
  const IDB_VERSION = 1;
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
  let currentStatusFilter = 'all'; // 'all' | 'pending' | 'completed'
  let currentSearchKeyword = '';   // Free text search
  let currentPage = 1;
  const pageSize = 40;             // 40 items per page for ultra fast rendering
  let activeViewMode = 'auto';     // 'auto' | 'cards' | 'table'

  // --- Real-time Field Sync State (Giám sát hiện trường thời gian thực) ---
  let liveSyncTimer = null;
  let isLiveSyncRunning = true;
  let isSoundAlertEnabled = true;
  let liveActivityLog = [];        // Dòng thời gian các KH vừa kiểm tra ngoài hiện trường
  let lastLivePollTimestamp = 0;   // Dấu thời gian quét gần nhất

  // --- Preset Inspectors List (Thanh sổ chọn) ---
  const PRESET_INSPECTORS = [
    'Nguyễn Văn Nguyên',
    'Phạm Duy Phương',
    'Lê Gia Quốc Trung',
    'Nguyễn Đức Thành'
  ];

  // --- Preset Notes for Field Inspectors ---
  const PRESET_NOTES = [
    'Đo đếm tốt, niêm chì nguyên vẹn',
    'Đứt chì hòm công tơ',
    'Mặt kính mờ/vỡ',
    'Sai tỷ số biến dòng TI/TU',
    'Công tơ chạy sai/không hiển thị',
    'Đã thay chì mới',
    'Đã thay công tơ'
  ];

  // ==========================================================================
  // NUMBER NORMALIZATION (CONVERT 2,21E+14 -> 221000000000000)
  // ==========================================================================
  function formatMeterNo(val) {
    if (!val) return '';
    let s = String(val).trim();
    // Check if scientific notation like 2,21E+14, 2.51E+14, 2.21e14
    if (/[eE]/.test(s)) {
      try {
        const normalized = s.replace(',', '.');
        const num = Number(normalized);
        if (!isNaN(num) && isFinite(num)) {
          return BigInt(Math.round(num)).toString();
        }
      } catch (e) {
        console.warn('formatMeterNo error:', e);
      }
    }
    return s;
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

    const isPreset = PRESET_INSPECTORS.includes(trimmed);

    if (sel) {
      if (isPreset) {
        sel.value = trimmed;
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

  function syncItemImmediately(ma_kh) {
    // 1. Instant local persistence
    saveLocalInspections();

    // 2. Broadcast to other open tabs
    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'sync_customer',
          ma_kh: ma_kh,
          inspection: inspectionsMap[ma_kh]
        });
      } catch (e) {}
    }

    // 3. Webhook Real-time Sync to Google Sheet
    const webhookUrl = getWebhookUrl();
    const insp = inspectionsMap[ma_kh] || {};
    const currentInsp = getCurrentInspector();
    const isCompleted = (insp.trang_thai === 'Đã kiểm tra');
    const itemPayload = {
      action: 'update_customer',
      ma_kh: ma_kh,
      nguoi_cap_nhat: insp.nguoi_cap_nhat || currentInsp || '',
      trang_thai: insp.trang_thai || 'Chưa kiểm tra',
      trang_thai_x: isCompleted ? 'X' : '',
      ngay_kiem_tra: insp.ngay_kiem_tra || '',
      ghi_chu: insp.ghi_chu || '',
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
      renderKPIs();
      renderStationBanner();
      renderMobileStickyBar();

      const isCompleted = data.inspection && data.inspection.trang_thai === 'Đã kiểm tra';
      const upVal = (data.inspection && data.inspection.nguoi_cap_nhat) || '';
      const isPreset = PRESET_INSPECTORS.includes(upVal);
      const selVal = isPreset ? upVal : (upVal ? '__custom__' : '');

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
        if (noteInput && data.inspection) noteInput.value = data.inspection.ghi_chu || '';

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
        if (mnote && data.inspection) mnote.value = data.inspection.ghi_chu || '';
        if (mselUp) mselUp.value = selVal;
        if (mupdater) {
          mupdater.value = upVal;
          mupdater.style.display = (!isPreset && upVal) ? 'block' : 'none';
        }
      }
    }
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  document.addEventListener('DOMContentLoaded', async () => {
    loadLocalInspections();

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
    await loadInitialData();

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

  // ==========================================================================
  // DATA LOADING & STORAGE
  // ==========================================================================
  function loadLocalInspections() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_INSPECTIONS);
      if (stored) inspectionsMap = JSON.parse(stored);
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
    showLoading(true, 'Đang tải danh mục 1.698 trạm biến áp...');

    // 1. Load pre-built stations directory
    try {
      const stResp = await fetch('data/kienthoan_stations.json');
      if (stResp.ok) {
        stationsMeta = await stResp.json();
      }
    } catch (e) {
      console.warn('Stations meta loading fallback:', e);
    }

    // 2. Check IndexedDB cache first
    showLoading(true, 'Đang kiểm tra bộ nhớ đệm khách hàng...');
    const cachedCustomers = await getCustomersFromIDB();

    if (cachedCustomers && cachedCustomers.length >= 200000) {
      allCustomers = cachedCustomers;
      buildStationsMetaFromCustomers();
      applyFilters();
      renderApp();
      showLoading(false);
      showToast(`Đã nạp toàn bộ ${allCustomers.length.toLocaleString('vi-VN')} khách hàng từ bộ nhớ!`, 'success');
      return;
    }

    // 3. Load full dataset from data/kienthoan_sheet.csv.gz (6.8MB) or .csv
    showLoading(true, 'Đang nạp toàn bộ 221.038 khách hàng từ Google Sheet...');
    let csvText = '';

    try {
      // Try gzipped CSV first (super fast 6.8MB download)
      if (typeof DecompressionStream !== 'undefined') {
        const gzResp = await fetch('data/kienthoan_sheet.csv.gz');
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
        const rawResp = await fetch('data/kienthoan_sheet.csv');
        if (rawResp.ok) {
          csvText = await rawResp.text();
        }
      } catch (rawErr) {
        console.warn('Raw CSV fetch error:', rawErr);
      }
    }

    if (csvText && csvText.length > 1000) {
      showLoading(true, 'Đang xử lý dữ liệu 221.038 khách hàng...');
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

        // Save to IndexedDB in background
        setTimeout(async () => {
          await saveCustomersToIDB(allCustomers);
          console.log('Saved all 221,038 customers to IndexedDB cache.');
        }, 100);
        return;
      }
    }

    // 4. Fallback to sample if files not available
    try {
      const resp = await fetch('data/kienthoan_sample.json');
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

  // Fast line tokenizer for 221,038 records
  function parseCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    const total = lines.length;
    if (total < 2) return [];

    const result = [];
    let isFirst = true;

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

      // Skip header row
      if (isFirst) {
        isFirst = false;
        const col0 = (cols[0] || '').toLowerCase();
        const col1 = (cols[1] || '').toLowerCase();
        if (col0.includes('stt') || col1.includes('mã kh') || col1.includes('makh')) {
          continue;
        }
      }

      const stt = cols[0] || (result.length + 1);
      const ma_kh = cols[1] || '';
      const ten_kh = cols[2] || '';
      const dia_chi_kh = cols[3] || '';
      const dia_chi_ddo = cols[4] || '';
      const ma_tram = cols[5] || '';
      const ten_tram = cols[6] || '';
      const danh_so = cols[7] || '';
      const sdt = cols[8] || '';
      const so_no = formatMeterNo(cols[9] || '');
      const khu_vuc = cols[10] || '';
      const nguoi_cap_nhat = cols[11] || '';
      const trang_thai_sheet = (cols[12] || '').trim();

      if (!ma_kh && !ten_kh) continue;

      // Đồng bộ từ Google Sheet: Cột M ("Trạng thái") có dấu "X"
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
  function applyFilters() {
    const kw = currentSearchKeyword.toLowerCase().trim();
    const stationFilter = currentStationFilter.trim();
    const areaFilter = currentAreaFilter.trim();

    filteredCustomers = allCustomers.filter(item => {
      const itemStation = item.id_tram || item.ma_tram || '';
      if (stationFilter && itemStation !== stationFilter) return false;
      if (areaFilter && item.khu_vuc !== areaFilter) return false;

      const insp = inspectionsMap[item.ma_kh] || {};
      const isCompleted = insp.trang_thai === 'Đã kiểm tra';
      if (currentStatusFilter === 'completed' && !isCompleted) return false;
      if (currentStatusFilter === 'pending' && isCompleted) return false;

      // Global search across all 12 fields
      if (kw) {
        const stationName = (stationsMeta[itemStation] && stationsMeta[itemStation].name) || item.ten_tram || '';
        const match = 
          (item.ma_kh && item.ma_kh.toLowerCase().includes(kw)) ||
          (item.ten_kh && item.ten_kh.toLowerCase().includes(kw)) ||
          (itemStation && itemStation.toLowerCase().includes(kw)) ||
          (stationName && stationName.toLowerCase().includes(kw)) ||
          (item.dia_chi_ddo && item.dia_chi_ddo.toLowerCase().includes(kw)) ||
          (item.dia_chi_kh && item.dia_chi_kh.toLowerCase().includes(kw)) ||
          (item.so_no && item.so_no.toLowerCase().includes(kw)) ||
          (item.danh_so && item.danh_so.toLowerCase().includes(kw)) ||
          (item.sdt && item.sdt.toLowerCase().includes(kw)) ||
          (item.khu_vuc && item.khu_vuc.toLowerCase().includes(kw));
        if (!match) return false;
      }

      return true;
    });

    currentPage = 1;
  }

  // ==========================================================================
  // RENDERING (DUAL ENGINE: TABLE & MOBILE CARDS)
  // ==========================================================================
  function renderApp() {
    renderKPIs();
    renderStationBanner();
    renderAreaDropdown();
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
    const stationsCount = Object.keys(stationsMeta).length || 1698;

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

      let tagsHtmlDesktop = '';
      PRESET_NOTES.slice(0, 3).forEach(tag => {
        tagsHtmlDesktop += `<button type="button" class="btn-tag" onclick="window.PCVT.addTagNote('${escapeHTML(c.ma_kh)}', '${escapeHTML(tag)}')">+ ${escapeHTML(tag)}</button>`;
      });

      const phoneLink = c.sdt
        ? `<a href="tel:${escapeHTML(c.sdt)}" style="color:#2563eb; text-decoration:none; font-weight:600;" title="Gọi điện">📞 ${escapeHTML(c.sdt)}</a>`
        : '<span style="color:var(--text-light)">---</span>';

      const currentUpdater = insp.nguoi_cap_nhat || c.nguoi_cap_nhat || '';
      const isPreset = PRESET_INSPECTORS.includes(currentUpdater);
      const isCustom = Boolean(currentUpdater && !isPreset);

      let updaterSelectOptions = `<option value="">-- Chọn cán bộ --</option>`;
      PRESET_INSPECTORS.forEach(p => {
        updaterSelectOptions += `<option value="${escapeHTML(p)}" ${currentUpdater === p ? 'selected' : ''}>${escapeHTML(p)}</option>`;
      });
      updaterSelectOptions += `<option value="__custom__" ${isCustom ? 'selected' : ''}>✏️ Khác (Tự nhập)...</option>`;

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
            <span class="badge-meter" title="Số No công tơ">${escapeHTML(formatMeterNo(c.so_no) || '---')}</span>
          </td>
          <td class="col-station" title="${escapeHTML(stationDisplay)}">
            <strong>${escapeHTML(itemStation || '---')}</strong>
            ${stationName ? `<div style="font-size:0.75rem; color:var(--text-muted);">${escapeHTML(stationName)}</div>` : ''}
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
              <input type="text" class="note-input" id="note-${escapeHTML(c.ma_kh)}" 
                     value="${escapeHTML(insp.ghi_chu || '')}" 
                     placeholder="Ghi chú hiện trạng..."
                     onchange="window.PCVT.updateNote('${escapeHTML(c.ma_kh)}', this.value)">
              <div class="note-tags-quick">${tagsHtmlDesktop}</div>
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
      
      let mobileTagsHtml = '';
      PRESET_NOTES.forEach(tag => {
        mobileTagsHtml += `<button type="button" class="btn-tag" onclick="window.PCVT.addTagNote('${escapeHTML(c.ma_kh)}', '${escapeHTML(tag)}')">+ ${escapeHTML(tag)}</button>`;
      });

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
              ${c.so_no ? `<span class="badge-meter" title="Số No công tơ">🔢 Số No: <strong>${escapeHTML(formatMeterNo(c.so_no))}</strong></span>` : ''}
              ${c.danh_so ? `<span style="font-size:0.72rem; background:#f1f5f9; padding:2px 6px; border-radius:4px; color:#475569;">DS: ${escapeHTML(c.danh_so)}</span>` : ''}
            </div>
          </div>

          <!-- Technical & Address Details -->
          <div class="mobile-meta-grid">
            <div class="mobile-meta-item">
              <strong>⚡ Trạm:</strong>
              <span>${escapeHTML(itemStation || '---')} ${stationName ? `(${escapeHTML(stationName)})` : ''}</span>
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
              <input type="text" class="note-input" id="mnote-${escapeHTML(c.ma_kh)}" 
                     value="${escapeHTML(insp.ghi_chu || '')}" 
                     placeholder="Ghi chú hiện trạng (niêm chì, TU/TI, tủ điện)..."
                     onchange="window.PCVT.updateNote('${escapeHTML(c.ma_kh)}', this.value)">
              <div class="mobile-note-chips">${mobileTagsHtml}</div>
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
        const sheetUrl = localStorage.getItem(STORAGE_KEY_SHEET_URL) || DEFAULT_SHEET_URL;
        await syncFromGoogleSheet(sheetUrl, true);
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
        const scriptCode = `// GOOGLE APPS SCRIPT CHO HỆ THỐNG KIỆN TOÀN HTĐĐ PC VŨNG TÀU (ĐỒNG BỘ 1 HÀNG DUY NHẤT & TỰ ĐỘNG XÓA KHI HỦY)
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    var data = JSON.parse(e.postData.contents);
    var maKH = String(data.ma_kh || '').trim();
    var nguoiCapNhat = String(data.nguoi_cap_nhat || '').trim();
    var trangThaiX = (data.trang_thai === 'Đã kiểm tra' || data.trang_thai_x === 'X') ? 'X' : '';
    var ghiChu = String(data.ghi_chu || '').trim();
    var ngayKT = data.ngay_kiem_tra || Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm");

    if (!maKH) return ContentService.createTextOutput(JSON.stringify({status: 'no_makh'}));

    // =========================================================================
    // 1. CẬP NHẬT TRANG CHÍNH (CỘT L: NGƯỜI CẬP NHẬT, CỘT M: TRẠNG THÁI DẤU X)
    // =========================================================================
    var rowIndex = -1;
    var rangeB = sheet.getRange("B:B");
    var foundCell = rangeB.createTextFinder(maKH).matchEntireCell(true).findNext();
    if (foundCell) {
      rowIndex = foundCell.getRow();
      if (trangThaiX === 'X') {
        sheet.getRange(rowIndex, 12).setValue(nguoiCapNhat); // Cột L: Người cập nhật
        sheet.getRange(rowIndex, 13).setValue('X');          // Cột M: Trạng thái dấu X
      } else {
        sheet.getRange(rowIndex, 12).setValue('');           // Xóa Cột L
        sheet.getRange(rowIndex, 13).setValue('');           // Xóa Cột M (xem như chưa thực hiện)
      }
    }

    // =========================================================================
    // 2. CẬP NHẬT TRANG NHẬT KÝ (Log_DongBo): GHI ĐÚNG 1 HÀNG, XÓA NẾU HỦY
    // =========================================================================
    var logSheet = ss.getSheetByName('Log_DongBo');
    if (!logSheet) {
      logSheet = ss.insertSheet('Log_DongBo');
      logSheet.appendRow(['Timestamp', 'Mã KH', 'Người cập nhật', 'Trạng thái', 'Ngày KT', 'Ghi chú']);
    }

    // Tìm tất cả dòng chứa Mã KH này trong trang Log_DongBo
    var logLastRow = logSheet.getLastRow();
    var existingRows = [];
    if (logLastRow > 1) {
      var logFinder = logSheet.getRange(2, 2, logLastRow - 1, 1).createTextFinder(maKH).matchEntireCell(true).findAll();
      for (var f = 0; f < logFinder.length; f++) {
        existingRows.push(logFinder[f].getRow());
      }
    }

    if (trangThaiX === 'X') {
      var rowData = [new Date().getTime(), maKH, nguoiCapNhat, 'X', ngayKT, ghiChu];
      if (existingRows.length > 0) {
        // Đã có -> Ghi đè vào đúng 1 hàng duy nhất
        logSheet.getRange(existingRows[0], 1, 1, 6).setValues([rowData]);
        // Nếu trước đó lỡ có nhiều dòng trùng thì xóa bỏ các dòng thừa
        for (var d = existingRows.length - 1; d >= 1; d--) {
          logSheet.deleteRow(existingRows[d]);
        }
      } else {
        // Chưa có -> Thêm mới 1 hàng duy nhất
        logSheet.appendRow(rowData);
      }
    } else {
      // Chuyển sang CHƯA THỰC HIỆN -> XÓA DÒNG ĐÓ ĐI (Xem như chưa thực hiện)
      if (existingRows.length > 0) {
        for (var r = existingRows.length - 1; r >= 0; r--) {
          logSheet.deleteRow(existingRows[r]);
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      row: rowIndex,
      ma_kh: maKH,
      trang_thai: trangThaiX,
      action: (trangThaiX === 'X') ? 'saved' : 'deleted',
      server_time: new Date().getTime()
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
    var since = Number((e && e.parameter && e.parameter.since) || 0);
    var logSheet = ss.getSheetByName('Log_DongBo');
    var updates = [];

    if (logSheet && logSheet.getLastRow() > 1) {
      var data = logSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var rowTime = Number(data[i][0]);
        if (rowTime > since) {
          updates.push({
            timestamp: rowTime,
            ma_kh: String(data[i][1]),
            nguoi_cap_nhat: String(data[i][2]),
            trang_thai_x: String(data[i][3]),
            ngay_kiem_tra: String(data[i][4]),
            ghi_chu: String(data[i][5])
          });
        }
      }
    } else {
      var sheet = ss.getActiveSheet();
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        var vals = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
        for (var j = 0; j < vals.length; j++) {
          if (String(vals[j][12] || '').trim().toUpperCase() === 'X') {
            updates.push({
              ma_kh: String(vals[j][1]),
              nguoi_cap_nhat: String(vals[j][11] || ''),
              trang_thai_x: 'X',
              timestamp: new Date().getTime()
            });
          }
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      count: updates.length,
      server_time: new Date().getTime(),
      updates: updates
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
  var seen = {};
  var rowsToDelete = [];

  for (var i = 1; i < data.length; i++) {
    var maKH = String(data[i][1]).trim();
    var status = String(data[i][3]).trim();
    if (status !== 'X' || seen[maKH] || maKH.indexOf('TEST_PING') !== -1) {
      rowsToDelete.push(i + 1);
    } else {
      seen[maKH] = true;
    }
  }

  for (var k = rowsToDelete.length - 1; k >= 0; k--) {
    logSheet.deleteRow(rowsToDelete[k]);
  }
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
      btnQuickScan.addEventListener('click', () => {
        showToast('Đang quét trực tiếp từ Google Sheet...', 'info');
        pollFieldUpdates(true);
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
    currentStatusFilter = 'all';
    currentSearchKeyword = '';

    const sInput = document.getElementById('searchStationInput');
    if (sInput) sInput.value = '';
    const aSelect = document.getElementById('filterAreaSelect');
    if (aSelect) aSelect.value = '';
    const gInput = document.getElementById('globalKeywordInput');
    if (gInput) gInput.value = '';
    const clearBtn = document.getElementById('btnClearStation');
    if (clearBtn) clearBtn.style.display = 'none';

    document.querySelectorAll('.status-tab-btn').forEach(b => {
      b.classList.remove('active');
      if (b.getAttribute('data-status') === 'all') b.classList.add('active');
    });

    applyFilters();
    renderApp();
    showToast('Đã xóa tất cả bộ lọc', 'info');
  }

  // ==========================================================================
  // CUSTOMER INTERACTION HANDLERS (EXPOSED ON window.PCVT)
  // ==========================================================================
  window.PCVT = {
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
      if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};

      const now = new Date();
      const timeStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

      if (isChecked) {
        inspectionsMap[ma_kh].trang_thai = 'Đã kiểm tra';
        inspectionsMap[ma_kh].ngay_kiem_tra = timeStr;
        if (!inspectionsMap[ma_kh].nguoi_cap_nhat) {
          const curInsp = getCurrentInspector();
          if (curInsp) {
            inspectionsMap[ma_kh].nguoi_cap_nhat = curInsp;
            const isPreset = PRESET_INSPECTORS.includes(curInsp);
            const selVal = isPreset ? curInsp : '__custom__';

            const dSel = document.getElementById(`sel-updater-${ma_kh}`);
            const mSel = document.getElementById(`msel-updater-${ma_kh}`);
            if (dSel) dSel.value = selVal;
            if (mSel) mSel.value = selVal;

            const dUp = document.getElementById(`updater-${ma_kh}`);
            const mUp = document.getElementById(`mupdater-${ma_kh}`);
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
        inspectionsMap[ma_kh].trang_thai = 'Chưa kiểm tra';
      }

      renderKPIs();
      renderStationBanner();
      renderMobileStickyBar();

      const row = document.getElementById(`row-${ma_kh}`);
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

      const card = document.getElementById(`mcard-${ma_kh}`);
      const mstatus = document.getElementById(`mstatus-${ma_kh}`);
      const mbtn = document.getElementById(`mbtn-toggle-${ma_kh}`);
      if (card) {
        if (isChecked) {
          card.classList.add('card-completed');
          if (mstatus) mstatus.innerHTML = '<span class="badge-status completed">✅ Đã kiểm tra</span>';
          if (mbtn) {
            mbtn.className = 'btn-mobile-status-toggle completed';
            mbtn.innerHTML = '✅ ĐÃ HOÀN THÀNH KIỂM TRA';
            mbtn.setAttribute('onclick', `window.PCVT.toggleStatus('${ma_kh}', false)`);
          }
        } else {
          card.classList.remove('card-completed');
          if (mstatus) mstatus.innerHTML = '<span class="badge-status pending">⏳ Chưa kiểm tra</span>';
          if (mbtn) {
            mbtn.className = 'btn-mobile-status-toggle';
            mbtn.innerHTML = '🔘 CHẠM ĐỂ ĐÁNH DẤU HOÀN THÀNH';
            mbtn.setAttribute('onclick', `window.PCVT.toggleStatus('${ma_kh}', true)`);
          }
        }
      }

      syncItemImmediately(ma_kh);
      showToast(isChecked ? `Đã hoàn thành kiểm tra KH ${ma_kh}` : `Đã chuyển KH ${ma_kh} về Chưa kiểm tra`, 'success');
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

    updateNote: function(ma_kh, value) {
      if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};
      inspectionsMap[ma_kh].ghi_chu = value;
      syncItemImmediately(ma_kh);

      const deskInput = document.getElementById(`note-${ma_kh}`);
      const mobInput = document.getElementById(`mnote-${ma_kh}`);
      if (deskInput && deskInput.value !== value) deskInput.value = value;
      if (mobInput && mobInput.value !== value) mobInput.value = value;
    },

    updateUpdater: function(ma_kh, value) {
      if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};
      const trimmed = (value || '').trim();
      inspectionsMap[ma_kh].nguoi_cap_nhat = trimmed;
      syncItemImmediately(ma_kh);

      const isPreset = PRESET_INSPECTORS.includes(trimmed);
      const selVal = isPreset ? trimmed : (trimmed ? '__custom__' : '');

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
          saveLocalInspections();

          const deskCell = document.getElementById(`photo-cell-${ma_kh}`);
          if (deskCell) {
            deskCell.innerHTML = `
              <div class="photo-box">
                <div class="photo-preview-wrap" onclick="window.PCVT.viewPhoto('${escapeHTML(ma_kh)}')">
                  <img src="${compressedBase64}" class="photo-thumbnail" alt="Ảnh HTĐĐ">
                  <button type="button" class="btn-remove-photo" onclick="event.stopPropagation(); window.PCVT.removePhoto('${escapeHTML(ma_kh)}')" title="Xóa ảnh">✕</button>
                </div>
              </div>
            `;
          }

          const mobCell = document.getElementById(`mphoto-cell-${ma_kh}`);
          if (mobCell) {
            mobCell.innerHTML = `
              <div style="display:flex; align-items:center; gap:0.75rem;">
                <div class="photo-preview-wrap" onclick="window.PCVT.viewPhoto('${escapeHTML(ma_kh)}')">
                  <img src="${compressedBase64}" style="width:54px; height:54px; border-radius:8px; object-fit:cover; border:1px solid #cbd5e1;" alt="Ảnh công tơ">
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <span style="font-size:0.75rem; color:#059669; font-weight:700;">✅ Đã chụp ảnh</span>
                  <button type="button" style="background:#fee2e2; color:#dc2626; border:none; padding:3px 8px; border-radius:4px; font-size:0.75rem; font-weight:600; cursor:pointer;" onclick="window.PCVT.removePhoto('${escapeHTML(ma_kh)}')">✕ Xóa ảnh</button>
                </div>
              </div>
              <button type="button" class="btn-row-save" style="min-height:42px; padding:0 1rem; border-radius:8px;" onclick="window.PCVT.saveRow('${escapeHTML(ma_kh)}')">
                💾 Lưu
              </button>
            `;
          }

          showToast(`Đã lưu ảnh hiện trường KH ${ma_kh}`, 'success');
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    },

    removePhoto: function(ma_kh) {
      if (confirm('Bạn có chắc chắn muốn xóa ảnh này không?')) {
        if (inspectionsMap[ma_kh]) {
          delete inspectionsMap[ma_kh].hinh_anh;
          saveLocalInspections();
        }

        const deskCell = document.getElementById(`photo-cell-${ma_kh}`);
        if (deskCell) {
          deskCell.innerHTML = `
            <div class="photo-box">
              <label class="btn-upload-photo" title="Tải ảnh hoặc chụp từ camera">
                <input type="file" accept="image/*" capture="environment" style="display:none" onchange="window.PCVT.handlePhotoUpload(this, '${escapeHTML(ma_kh)}')">
                📷 Thêm ảnh
              </label>
            </div>
          `;
        }

        const mobCell = document.getElementById(`mphoto-cell-${ma_kh}`);
        if (mobCell) {
          mobCell.innerHTML = `
            <label class="btn-mobile-camera">
              <input type="file" accept="image/*" capture="environment" style="display:none" onchange="window.PCVT.handlePhotoUpload(this, '${escapeHTML(ma_kh)}')">
              📷 Chụp ảnh công tơ
            </label>
            <button type="button" class="btn-row-save" style="min-height:42px; padding:0 1rem; border-radius:8px;" onclick="window.PCVT.saveRow('${escapeHTML(ma_kh)}')">
              💾 Lưu
            </button>
          `;
        }

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
      const deskInput = document.getElementById(`note-${ma_kh}`);
      const mobInput = document.getElementById(`mnote-${ma_kh}`);
      const val = (deskInput && deskInput.value) || (mobInput && mobInput.value) || '';

      const deskUp = document.getElementById(`updater-${ma_kh}`);
      const mobUp = document.getElementById(`mupdater-${ma_kh}`);
      const upVal = (deskUp && deskUp.value) || (mobUp && mobUp.value) || '';

      if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};
      inspectionsMap[ma_kh].ghi_chu = val;
      if (upVal) inspectionsMap[ma_kh].nguoi_cap_nhat = upVal.trim();

      syncItemImmediately(ma_kh);
      showToast(`Đã lưu và đồng bộ kết quả kiểm tra KH ${ma_kh}`, 'success');
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

    resetFilters: resetFilters,

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

    switchSyncTab: function(tab) {
      switchSyncTab(tab);
    },

    refreshSyncExportData: function() {
      return refreshSyncExportData();
    },

    mergeSyncPackage: function(rawContent) {
      return mergeSyncPackage(rawContent);
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

    let newUpdates = [];
    const webhookUrl = getWebhookUrl();

    // Chiến lược 1: Nếu có Webhook URL, gọi doGet(e) nhận các thay đổi mới
    if (webhookUrl) {
      try {
        const fetchUrl = `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}action=get_updates&since=${lastLivePollTimestamp}`;
        const resp = await fetch(fetchUrl, { method: 'GET' });
        if (resp.ok) {
          const json = await resp.json();
          if (json && json.updates && Array.isArray(json.updates) && json.updates.length > 0) {
            newUpdates = json.updates;
            if (json.server_time) lastLivePollTimestamp = json.server_time;
          }
        }
      } catch (e) {
        console.warn('Webhook doGet poll notice, falling back to Google Sheet query:', e);
      }
    }

    // Chiến lược 2: Trực tiếp quét Google Sheet qua Google Visualization API (cực nhanh, chỉ trả về các dòng có dấu X)
    if (newUpdates.length === 0) {
      try {
        const sheetUrl = localStorage.getItem(STORAGE_KEY_SHEET_URL) || DEFAULT_SHEET_URL;
        const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        const gidMatch = sheetUrl.match(/[#&?]gid=([0-9]+)/);
        const sheetId = sheetIdMatch ? sheetIdMatch[1] : '1unVxNXZkTO_ps_HqlNIOnP05FIbU9DT4';
        const gid = gidMatch ? gidMatch[1] : '1392868293';

        const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}&tq=` + encodeURIComponent("select B, L, M where M is not null and M != ''");
        const resp = await fetch(gvizUrl);
        if (resp.ok) {
          const raw = await resp.text();
          const start = raw.indexOf('{');
          const end = raw.lastIndexOf('}');
          if (start !== -1 && end !== -1) {
            const gData = JSON.parse(raw.substring(start, end + 1));
            const rows = (gData.table && gData.table.rows) || [];
            rows.forEach(r => {
              const cCells = r.c || [];
              const ma_kh = (cCells[0] && cCells[0].v != null) ? String(cCells[0].v).trim() : '';
              const nguoi_cap_nhat = (cCells[1] && cCells[1].v != null) ? String(cCells[1].v).trim() : '';
              const trang_thai_m = (cCells[2] && cCells[2].v != null) ? String(cCells[2].v).trim() : '';

              if (ma_kh && trang_thai_m.toUpperCase() === 'X') {
                const currentStatus = inspectionsMap[ma_kh] ? inspectionsMap[ma_kh].trang_thai : '';
                const currentUpdater = inspectionsMap[ma_kh] ? inspectionsMap[ma_kh].nguoi_cap_nhat : '';
                
                if (currentStatus !== 'Đã kiểm tra' || (nguoi_cap_nhat && currentUpdater !== nguoi_cap_nhat)) {
                  newUpdates.push({
                    ma_kh: ma_kh,
                    nguoi_cap_nhat: nguoi_cap_nhat,
                    trang_thai_x: 'X',
                    timestamp: Date.now()
                  });
                }
              }
            });
          }
        }
      } catch (gErr) {
        console.warn('GViz live poll notice:', gErr);
      }
    }

    // Xử lý các bản ghi mới từ hiện trường
    if (newUpdates.length > 0) {
      let newlyCheckedCount = 0;
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;

      newUpdates.forEach(item => {
        const ma_kh = item.ma_kh;
        if (!ma_kh) return;

        if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};
        const wasCompleted = inspectionsMap[ma_kh].trang_thai === 'Đã kiểm tra';
        inspectionsMap[ma_kh].trang_thai = 'Đã kiểm tra';
        if (item.nguoi_cap_nhat) inspectionsMap[ma_kh].nguoi_cap_nhat = item.nguoi_cap_nhat;
        if (item.ghi_chu) inspectionsMap[ma_kh].ghi_chu = item.ghi_chu;
        if (!inspectionsMap[ma_kh].ngay_kiem_tra) {
          inspectionsMap[ma_kh].ngay_kiem_tra = item.ngay_kiem_tra || `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
        }

        if (!wasCompleted) newlyCheckedCount++;

        const cust = allCustomers.find(c => c.ma_kh === ma_kh) || {};
        
        liveActivityLog.unshift({
          timestamp: Date.now(),
          timeStr: timeStr,
          ma_kh: ma_kh,
          ten_kh: cust.ten_kh || item.ten_kh || 'Khách hàng',
          station: cust.id_tram || cust.ma_tram || item.station || '',
          nguoi_cap_nhat: item.nguoi_cap_nhat || cust.nguoi_cap_nhat || 'Cán bộ hiện trường'
        });

        // Cập nhật dòng bảng nếu đang mở trang này
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

        // Cập nhật thẻ di động nếu đang mở trang này
        const card = document.getElementById(`mcard-${ma_kh}`);
        if (card) {
          card.classList.add('card-completed', 'row-just-updated');
          const mstatus = document.getElementById(`mstatus-${ma_kh}`);
          const mbtn = document.getElementById(`mbtn-toggle-${ma_kh}`);
          if (mstatus) mstatus.innerHTML = '<span class="badge-status completed">✅ Đã kiểm tra</span>';
          if (mbtn) {
            mbtn.className = 'btn-mobile-status-toggle completed';
            mbtn.innerHTML = '✅ ĐÃ HOÀN THÀNH KIỂM TRA';
          }
          const mupdater = document.getElementById(`mupdater-${ma_kh}`);
          if (mupdater && item.nguoi_cap_nhat) mupdater.value = item.nguoi_cap_nhat;
          setTimeout(() => card.classList.remove('row-just-updated'), 3500);
        }
      });

      if (liveActivityLog.length > 50) {
        liveActivityLog = liveActivityLog.slice(0, 50);
      }

      saveLocalInspections();
      renderKPIs();
      renderStationBanner();
      renderMobileStickyBar();
      renderLiveActivityFeed();

      if (isSoundAlertEnabled) {
        playNotificationChime();
      }

      const latest = liveActivityLog[0];
      showToast(`🔔 [Hiện trường] ${latest.nguoi_cap_nhat} vừa cập nhật KH ${latest.ma_kh} (${newUpdates.length} bản ghi mới)`, 'success');
    } else if (isManual) {
      showToast('Dữ liệu hiện trường đã ở trạng thái mới nhất!', 'info');
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

    const compactInspections = {};
    let count = 0;

    for (const [maKh, insp] of Object.entries(inspectionsMap)) {
      if (insp && (insp.trang_thai === 'Đã kiểm tra' || insp.ghi_chu || insp.hinh_anh || insp.nguoi_cap_nhat)) {
        compactInspections[maKh] = {
          t: insp.trang_thai === 'Đã kiểm tra' ? 'X' : '',
          u: insp.nguoi_cap_nhat || '',
          d: insp.ngay_kiem_tra || '',
          n: insp.ghi_chu || '',
          p: insp.hinh_anh ? 1 : 0
        };
        if (insp.trang_thai === 'Đã kiểm tra') count++;
      }
    }

    if (exportCountBadge) {
      exportCountBadge.textContent = count.toLocaleString('vi-VN');
    }

    const payload = {
      app: 'PCVT_KT',
      ver: 2,
      exportedAt: new Date().toISOString(),
      count: count,
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
    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    keys.forEach(maKh => {
      const inc = incomingItems[maKh];
      if (!inc) return;

      const isCompleted = (inc.t === 'X' || inc.trang_thai === 'Đã kiểm tra' || inc.trang_thai_x === 'X');
      const updater = inc.u || inc.nguoi_cap_nhat || '';
      const note = inc.n || inc.ghi_chu || '';
      const date = inc.d || inc.ngay_kiem_tra || dateStr;

      if (!inspectionsMap[maKh]) {
        inspectionsMap[maKh] = {
          trang_thai: isCompleted ? 'Đã kiểm tra' : 'Chưa kiểm tra',
          nguoi_cap_nhat: updater,
          ghi_chu: note,
          ngay_kiem_tra: date
        };
        if (isCompleted) addedCount++;
      } else {
        const wasCompleted = (inspectionsMap[maKh].trang_thai === 'Đã kiểm tra');
        if (isCompleted) inspectionsMap[maKh].trang_thai = 'Đã kiểm tra';
        if (updater) inspectionsMap[maKh].nguoi_cap_nhat = updater;
        if (note) inspectionsMap[maKh].ghi_chu = note;
        if (!inspectionsMap[maKh].ngay_kiem_tra && date) inspectionsMap[maKh].ngay_kiem_tra = date;

        if (isCompleted && !wasCompleted) addedCount++;
        else updatedCount++;
      }

      // Tự động đẩy lên Google Sheet nếu Webhook đang kết nối
      syncItemImmediately(maKh);
    });

    saveLocalInspections();
    applyFilters();
    renderApp();
    playNotificationChime();

    showToast(`✅ Đã gộp thành công ${keys.length.toLocaleString('vi-VN')} khách hàng (${addedCount} khách hàng mới đã kiểm tra)!`, 'success');

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
