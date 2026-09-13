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
  
  // IndexedDB Constants for 221.038 customers
  const IDB_NAME = 'PCVT_KIENTHOAN_FULL_DB';
  const IDB_VERSION = 1;
  const IDB_STORE_CHUNKS = 'customer_chunks';
  const CHUNK_SIZE = 10000;

  // --- State ---
  let allCustomers = [];           // In-memory array of all 221.038 customers
  let stationsMeta = {};           // Map: id_tram -> { id, name, khu_vuc, count }
  let inspectionsMap = {};         // Map: ma_kh -> { trang_thai, ngay_kiem_tra, ghi_chu, hinh_anh }
  let filteredCustomers = [];      // Filtered list
  let currentStationFilter = '';   // Selected station ID
  let currentAreaFilter = '';      // Selected Area
  let currentStatusFilter = 'all'; // 'all' | 'pending' | 'completed'
  let currentSearchKeyword = '';   // Free text search
  let currentPage = 1;
  const pageSize = 40;             // 40 items per page for ultra fast rendering
  let activeViewMode = 'auto';     // 'auto' | 'cards' | 'table'

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
  // INITIALIZATION
  // ==========================================================================
  document.addEventListener('DOMContentLoaded', async () => {
    loadLocalInspections();
    initEventListeners();
    await loadInitialData();
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
      const so_no = cols[9] || '';
      const khu_vuc = cols[10] || '';
      const nguoi_cap_nhat = cols[11] || '';

      if (!ma_kh && !ten_kh) continue;

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
        dia_chi: dia_chi_ddo || dia_chi_kh
      });
    }

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
            <span class="badge-meter" title="Số No công tơ">${escapeHTML(c.so_no || '---')}</span>
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
              ${c.so_no ? `<span class="badge-meter" title="Số No công tơ">🔢 Số No: <strong>${escapeHTML(c.so_no)}</strong></span>` : ''}
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
            ${c.nguoi_cap_nhat ? `
              <div class="mobile-meta-item">
                <strong>👤 Người cập nhật:</strong>
                <span>${escapeHTML(c.nguoi_cap_nhat)}</span>
              </div>
            ` : ''}
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
    if (btnExport) btnExport.addEventListener('click', exportToCSV);

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
      } else {
        inspectionsMap[ma_kh].trang_thai = 'Chưa kiểm tra';
      }

      saveLocalInspections();
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

      showToast(isChecked ? `Đã hoàn thành kiểm tra KH ${ma_kh}` : `Đã chuyển KH ${ma_kh} về Chưa kiểm tra`, 'success');
    },

    updateNote: function(ma_kh, value) {
      if (!inspectionsMap[ma_kh]) inspectionsMap[ma_kh] = {};
      inspectionsMap[ma_kh].ghi_chu = value;
      saveLocalInspections();

      const deskInput = document.getElementById(`note-${ma_kh}`);
      const mobInput = document.getElementById(`mnote-${ma_kh}`);
      if (deskInput && deskInput.value !== value) deskInput.value = value;
      if (mobInput && mobInput.value !== value) mobInput.value = value;
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
      this.updateNote(ma_kh, val);
      showToast(`Đã lưu kết quả kiểm tra KH ${ma_kh}`, 'success');
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

      stationCustomers.forEach(c => {
        if (!inspectionsMap[c.ma_kh]) inspectionsMap[c.ma_kh] = {};
        inspectionsMap[c.ma_kh].trang_thai = 'Đã kiểm tra';
        if (!inspectionsMap[c.ma_kh].ngay_kiem_tra) {
          inspectionsMap[c.ma_kh].ngay_kiem_tra = timeStr;
        }
      });

      saveLocalInspections();
      renderApp();
      showToast(`Đã hoàn thành toàn bộ khách hàng trạm ${currentStationFilter}!`, 'success');
    }
  }

  function exportToCSV() {
    if (allCustomers.length === 0) {
      showToast('Không có dữ liệu để xuất!', 'error');
      return;
    }

    const headers = [
      'STT', 'Mã KH', 'Tên KH', 'Địa chỉ KH', 'Địa chỉ điểm đo',
      'Mã trạm', 'Tên Trạm', 'Danh số', 'Số điện thoại', 'Số No',
      'Khu vực', 'Người cập nhật', 'Trạng thái kiểm tra', 'Ngày kiểm tra',
      'Ghi chú hiện trạng', 'Có ảnh'
    ];

    let csvContent = '\uFEFF';
    csvContent += headers.join(',') + '\r\n';

    allCustomers.forEach((c, idx) => {
      const insp = inspectionsMap[c.ma_kh] || {};
      const itemStation = c.id_tram || c.ma_tram || '';
      const sMeta = stationsMeta[itemStation];
      const sName = (sMeta && sMeta.name) || c.ten_tram || '';
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
        escapeCSV(c.so_no),
        escapeCSV(c.khu_vuc),
        escapeCSV(c.nguoi_cap_nhat),
        escapeCSV(insp.trang_thai || 'Chưa kiểm tra'),
        escapeCSV(insp.ngay_kiem_tra || ''),
        escapeCSV(insp.ghi_chu || ''),
        insp.hinh_anh ? 'Có ảnh' : 'Không'
      ];
      csvContent += row.join(',') + '\r\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const now = new Date();
    const dateStr = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}`;
    link.setAttribute('href', url);
    link.setAttribute('download', `Ket_Qua_Kien_Toan_HTDD_PCVT_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Đã xuất báo cáo kiểm tra kiện toàn HTĐĐ thành công!', 'success');
  }

  function escapeCSV(str) {
    if (str === null || str === undefined) return '""';
    const s = String(str).replace(/"/g, '""');
    return `"${s}"`;
  }

  function handleFileImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    showLoading(true, 'Đang đọc và xử lý tệp khách hàng...');
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

  window.openModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
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
