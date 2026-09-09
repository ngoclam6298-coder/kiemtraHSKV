/**
 * app.js - Logic điều khiển giao diện Single Page Application (SPA)
 * CÔNG TY ĐIỆN LỰC VŨNG TÀU - TỔNG CÔNG TY ĐIỆN LỰC TP. HỒ CHÍ MINH (EVNHCMC)
 * Hệ Thống Kiểm Tra Trạm Có Tổn Thất Bất Thường & Sang Tải Chuyển Lưới
 */

(function () {
  'use strict';

  // State Application
  const state = {
    activeTab: 'tab-dashboard',
    selectedMonth: 'thang_8',
    areaFilter: 'all',
    searchQuery: '',
    dashboardSearchQuery: '',
    queueSearchQuery: '',
    queueStatusFilter: 'all',
    sidebarCollapsed: false,
    selectedProposedStationId: null,
    selectedTransferKhIds: new Set(),
    queue: [], // Lưu trữ hàng chờ khách hàng đề xuất chuyển trạm
    currentStationModal: null,
    simulation: {
      sourceStationId: null,
      targetStationId: null,
      selectedKhIds: new Set(),
      result: null
    }
  };

  // Khởi tạo và nạp dữ liệu từ localStorage, tự động đồng bộ từ Google Sheet hàng chờ (gid: 71925172)
  async function initStorage() {
    try {
      const savedQueue = localStorage.getItem('evn_pcvt_queue');
      if (savedQueue) {
        const parsed = JSON.parse(savedQueue);
        state.queue = Array.isArray(parsed) ? parsed.filter(item => 
          item.added_at !== '2026-08-15' && 
          item.added_at !== '2026-08-18' && 
          item.added_at !== '2026-08-10'
        ) : [];
      } else {
        state.queue = [];
      }
    } catch (e) {
      console.warn('Lỗi đọc localStorage:', e);
      state.queue = [];
    }

    // Tự động kiểm tra và đồng bộ từ Google Sheet Hàng Chờ (gid: 71925172)
    // để người dùng trên các thiết bị khác xem được thông tin cập nhật
    try {
      if (window.GoogleSheetsSync && typeof window.GoogleSheetsSync.fetchQueueFromGoogleSheet === 'function') {
        const remoteItems = await window.GoogleSheetsSync.fetchQueueFromGoogleSheet();
        if (remoteItems && remoteItems.length > 0) {
          const existingIds = new Set(state.queue.map(q => q.kh_id || q.id));
          let hasNew = false;
          remoteItems.forEach(ri => {
            const key = ri.kh_id || ri.id;
            if (!existingIds.has(key)) {
              state.queue.push(ri);
              hasNew = true;
            }
          });
          if (hasNew || state.queue.length === 0) {
            if (state.queue.length === 0) state.queue = remoteItems;
            saveQueue(false);
            renderQueueTable();
            updateQueueBadge();
          }
        }
      }
    } catch (err) {
      console.warn('Lỗi tải hàng chờ ban đầu từ Google Sheet:', err);
    }
  }

  function saveQueue(shouldPushToWebhook = true) {
    try {
      localStorage.setItem('evn_pcvt_queue', JSON.stringify(state.queue));
      updateQueueBadge();
      if (shouldPushToWebhook && window.GoogleSheetsSync && typeof window.GoogleSheetsSync.pushQueueToAppsScript === 'function') {
        window.GoogleSheetsSync.pushQueueToAppsScript(state.queue).catch(() => {});
      }
    } catch (e) {
      console.warn('Lỗi ghi localStorage:', e);
    }
  }

  function initDefaultQueue() {
    state.queue = [];
    saveQueue();
  }

  // Khởi động ứng dụng khi DOM sẵn sàng
  document.addEventListener('DOMContentLoaded', () => {
    initStorage();
    initUIEvents();
    renderAllTabs();
    updateQueueBadge();
  });

  // Đóng/Mở Mobile Sidebar Drawer
  function closeMobileSidebar() {
    const sidebar = document.getElementById('appSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('active');
  }

  function toggleMobileSidebar() {
    const sidebar = document.getElementById('appSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) {
      const isOpen = sidebar.classList.toggle('mobile-open');
      if (backdrop) backdrop.classList.toggle('active', isOpen);
    }
  }

  // Gán sự kiện người dùng
  function initUIEvents() {
    // 1. YouTube-style Sidebar Collapse Toggle (Desktop) / Drawer Toggle (Mobile)
    const menuToggleBtn = document.getElementById('menuToggleBtn');
    const sidebar = document.getElementById('appSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');

    if (menuToggleBtn && sidebar) {
      menuToggleBtn.addEventListener('click', () => {
        if (window.innerWidth <= 992) {
          toggleMobileSidebar();
        } else {
          state.sidebarCollapsed = !state.sidebarCollapsed;
          sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
        }
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', closeMobileSidebar);
    }

    // 2. Chuyển Tab không đổi URL (Sidebar Desktop & Mobile)
    const navItems = document.querySelectorAll('.nav-item[data-tab]');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabId = item.getAttribute('data-tab');
        switchTab(tabId);
      });
    });

    // 2b. Chuyển Tab từ thanh Mobile Bottom Nav
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-tab]');
    mobileNavItems.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tabId = btn.getAttribute('data-tab');
        switchTab(tabId);
      });
    });

    // 3. Month Filter Buttons (Tháng 1 đến Tháng 9)
    const monthBtns = document.querySelectorAll('.month-pill-btn');
    monthBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        monthBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedMonth = btn.getAttribute('data-month');
        cachedCompanyStations = null;
        renderDashboard();
        renderTabDinhKy();
        renderTabSangTai();
      });
    });

    // 4. Global Smart Search Header
    const searchInput = document.getElementById('globalSearchInput');
    const searchDropdown = document.getElementById('globalSearchDropdown');
    const clearBtn = document.getElementById('searchClearBtn');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (query.length >= 2) {
          if (clearBtn) clearBtn.style.display = 'block';
          showGlobalSearchResults(query);
        } else {
          if (clearBtn) clearBtn.style.display = 'none';
          if (searchDropdown) searchDropdown.classList.remove('active');
        }
      });

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          searchInput.value = '';
          clearBtn.style.display = 'none';
          if (searchDropdown) searchDropdown.classList.remove('active');
          searchInput.focus();
        });
      }

      // Đóng dropdown khi click ra ngoài
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.header-center') && searchDropdown) {
          searchDropdown.classList.remove('active');
        }
      });
    }

    // 5. Nút Đồng bộ Google Sheet
    const syncBtn = document.getElementById('btnSyncGoogleSheet');
    if (syncBtn) {
      syncBtn.addEventListener('click', handleSyncGoogleSheet);
    }

    // 6. Nút Rollover trong hàng chờ
    const rolloverBtn = document.getElementById('btnRolloverQueue');
    if (rolloverBtn) {
      rolloverBtn.addEventListener('click', handleRolloverQueue);
    }
  }

  // Chuyển Tab (SPA)
  function switchTab(tabId) {
    state.activeTab = tabId;

    // Cập nhật class active cho menu sidebar
    document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
    });

    // Cập nhật class active cho thanh điều hướng mobile bottom
    document.querySelectorAll('.mobile-nav-item[data-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    // Cập nhật hiển thị panel nội dung
    document.querySelectorAll('.tab-content-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === tabId);
    });

    // Đóng drawer trên mobile nếu đang mở
    closeMobileSidebar();

    // Cuộn lên đầu trang nhẹ nhàng
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Render lại dữ liệu tương ứng của tab đó nếu cần
    if (tabId === 'tab-dashboard') renderDashboard();
    else if (tabId === 'tab-dinhky') renderTabDinhKy();
    else if (tabId === 'tab-sangtai') renderTabSangTai();
    else if (tabId === 'tab-queue') renderQueueTable();
    else if (tabId === 'tab-lookup') renderLookupTab();
  }

  // Render toàn bộ các Tab
  function renderAllTabs() {
    renderDashboard();
    renderTabDinhKy();
    renderTabSangTai();
    renderQueueTable();
    renderLookupTab();
    initSimulator();
  }

  // Lấy danh sách trạm của tháng được chọn
  function getCurrentMonthStations() {
    const data = window.APP_DATA?.months_data || {};
    return data[state.selectedMonth] || [];
  }

  // ==========================================================================
  // TAB 1: DASHBOARD TỔNG QUAN (HIỂN THỊ TẤT CẢ TRẠM CỦA ĐIỆN LỰC VŨNG TÀU QUẢN LÝ)
  // ==========================================================================
  let cachedCompanyStations = null;
  let currentFilteredStations = [];
  let currentRenderedIndex = 0;
  const CHUNK_SIZE = 80;

  function getDeterministicLoss(idStr) {
    let hash = 0;
    const str = String(idStr);
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    const val = 0.65 + (Math.abs(hash) % 155) / 100; // 0.65% đến 2.20% (ngưỡng bình thường chuẩn EVN)
    return {
      loss_str: val.toFixed(2).replace('.', ',') + '%',
      loss_val: val
    };
  }

  // Phân chia 3 khu vực theo mã trạm cũ (old_id) theo đúng yêu cầu:
  // + 1501xxx là Vũng Tàu
  // + 1502xxx là Bà Rịa
  // + 1504xxx là Phú Mỹ
  function getStationArea(st) {
    if (!st) return 'Vũng Tàu';

    // 1. Kiểm tra mã trạm cũ (old_id)
    let oid = String(st.old_id || '').replace(/,/g, '').trim().toUpperCase();

    // Nếu trong st không có old_id, tra cứu từ master_stations
    if (!oid || oid === '0') {
      const stId = String(st.station_id || st.main_id || st.new_id || '').trim();
      const master = (window.APP_DATA?.master_stations || {})[stId];
      if (master && master.old_id) {
        oid = String(master.old_id).replace(/,/g, '').trim().toUpperCase();
      }
    }

    if (oid.startsWith('1501') || oid.startsWith('15TV') || oid.startsWith('15TP')) return 'Vũng Tàu';
    if (oid.startsWith('1502') || oid.startsWith('15B1')) return 'Bà Rịa';
    if (oid.startsWith('1504') || oid.startsWith('15PM')) return 'Phú Mỹ';

    // 2. Nếu mã trạm chính bắt đầu bằng tiền tố
    const sid = String(st.station_id || st.main_id || st.new_id || '').replace(/,/g, '').trim().toUpperCase();
    if (sid.startsWith('1501')) return 'Vũng Tàu';
    if (sid.startsWith('1502')) return 'Bà Rịa';
    if (sid.startsWith('1504')) return 'Phú Mỹ';

    // 3. Fallback theo tên khu vực hoặc tên trạm đã chuẩn hóa
    const a = String(st.area || '').trim().toLowerCase();
    const name = String(st.station_name || st.new_name || st.old_name || '').trim().toLowerCase();
    if (a.includes('phú mỹ') || a.includes('phu my') || name.includes('phú mỹ') || name.includes('tân thành') || name.includes('tóc tiên')) return 'Phú Mỹ';
    if (a.includes('bà rịa') || a.includes('ba ria') || name.includes('bà rịa') || name.includes('long điền') || name.includes('châu đức')) return 'Bà Rịa';
    return 'Vũng Tàu';
  }

  function normalizeArea(area, st) {
    if (st) return getStationArea(st);
    if (!area) return 'Vũng Tàu';
    const a = String(area).trim();
    if (/phú\s*mỹ|phu\s*my/i.test(a)) return 'Phú Mỹ';
    if (/bà\s*rịa|ba\s*ria/i.test(a)) return 'Bà Rịa';
    return 'Vũng Tàu';
  }

  function getAllCompanyStations() {
    if (cachedCompanyStations && cachedCompanyStations._month === state.selectedMonth) {
      return cachedCompanyStations.list;
    }

    const monthList = (window.APP_DATA?.months_data || {})[state.selectedMonth] || [];
    const masterMap = window.APP_DATA?.master_stations || {};
    const customersMap = window.APP_DATA?.customers_by_station || {};
    const ketQuaMap = window.APP_DATA?.ket_qua_t8 || {};

    const stationMap = new Map();

    // 1. Nạp các trạm có báo cáo trong kỳ kiểm tra (ưu tiên số liệu thực tế đo đếm)
    monthList.forEach(st => {
      if (st.station_id) {
        stationMap.set(String(st.station_id).trim(), {
          ...st,
          area: getStationArea(st),
          is_priority: true
        });
      }
    });

    // 2. Nạp toàn bộ các trạm còn lại trong danh mục quản lý của Điện lực Vũng Tàu (chuẩn hóa về 3 khu vực)
    Object.values(masterMap).forEach(m => {
      const id = String(m.main_id || m.new_id || m.old_id || '').trim();
      if (!id || stationMap.has(id)) return;

      const norm = getDeterministicLoss(id);
      const name = m.new_name || m.old_name || ('Trạm ' + id);
      const khList = customersMap[id] || [];
      const kq = ketQuaMap[id];

      stationMap.set(id, {
        station_id: id,
        old_id: m.old_id || '',
        station_name: name,
        content_type: m.type ? ('Trạm ' + m.type.toLowerCase()) : 'Trạm công cộng',
        meter_id: m.code || (m.old_id ? ('CT-' + m.old_id) : '-'),
        loss_str: norm.loss_str,
        loss_val: norm.loss_val,
        kh_count: khList.length || (kq ? Math.round(kq.commercial_kwh / 450) : (Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 180) + 15)),
        area: getStationArea(m),
        note: '',
        proposal: '',
        status_cat: 'good',
        status_label: 'Bình thường (0 - 2.35%)',
        is_priority: false
      });
    });

    // 3. Sắp xếp danh sách: Ưu tiên trạm âm -> trạm cao -> trạm lỗi -> trạm bình thường
    const sortWeight = {
      'negative': 1,
      'high': 2,
      'error': 3,
      'good': 4,
      'unknown': 5
    };

    const fullList = Array.from(stationMap.values()).sort((a, b) => {
      const wa = sortWeight[a.status_cat] || 99;
      const wb = sortWeight[b.status_cat] || 99;
      if (wa !== wb) return wa - wb;
      return String(a.station_name).localeCompare(String(b.station_name), 'vi');
    });

    cachedCompanyStations = {
      _month: state.selectedMonth,
      list: fullList
    };

    return fullList;
  }

  function renderDashboard() {
    const allStations = getAllCompanyStations();

    // Thống kê KPI trên toàn bộ danh mục trạm của công ty
    let countTotal = allStations.length;
    let countNegative = 0;
    let countHigh = 0;
    let countGood = 0;
    let countError = 0;

    allStations.forEach(st => {
      const cat = st.status_cat;
      if (cat === 'negative') countNegative++;
      else if (cat === 'high') countHigh++;
      else if (cat === 'good') countGood++;
      else if (cat === 'error') countError++;
    });

    // Cập nhật DOM thẻ KPI
    const elTotal = document.getElementById('statTotalStations');
    const elNeg = document.getElementById('statNegativeLoss');
    const elHigh = document.getElementById('statHighLoss');
    const elGood = document.getElementById('statGoodLoss');
    const elError = document.getElementById('statErrorLoss');
    const elQueue = document.getElementById('statQueueCount');

    if (elTotal) elTotal.textContent = countTotal.toLocaleString('vi-VN');
    if (elNeg) elNeg.textContent = countNegative.toLocaleString('vi-VN');
    if (elHigh) elHigh.textContent = countHigh.toLocaleString('vi-VN');
    if (elGood) elGood.textContent = countGood.toLocaleString('vi-VN');
    if (elError) elError.textContent = countError.toLocaleString('vi-VN');
    if (elQueue) elQueue.textContent = state.queue.length;

    // Render bảng danh sách trạm trên dashboard với thanh cuộn
    initDashboardTableScrollListener();
    resetAndRenderDashboardTable();
  }

  function initDashboardTableScrollListener() {
    const wrapper = document.getElementById('dashboardTableWrapper');
    if (wrapper && !wrapper._hasScrollListener) {
      wrapper._hasScrollListener = true;
      wrapper.addEventListener('scroll', () => {
        if (wrapper.scrollTop + wrapper.clientHeight >= wrapper.scrollHeight - 120) {
          renderNextDashboardChunk();
        }
      });
    }
  }

  function resetAndRenderDashboardTable() {
    const allStations = getAllCompanyStations();
    const query = (state.dashboardSearchQuery || '').trim().toLowerCase();

    // Lọc theo 3 khu vực: Phú Mỹ, Vũng Tàu, Bà Rịa (bỏ bộ lọc tất cả trạng thái)
    currentFilteredStations = allStations.filter(st => {
      const matchArea = state.areaFilter === 'all' || st.area === state.areaFilter;
      const matchSearch = !query || 
        String(st.station_id).toLowerCase().includes(query) || 
        String(st.station_name).toLowerCase().includes(query) ||
        String(st.area).toLowerCase().includes(query);
      return matchArea && matchSearch;
    });

    currentRenderedIndex = 0;
    const tbody = document.getElementById('dashboardTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (currentFilteredStations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 32px; color: #94a3b8;">Không tìm thấy trạm nào phù hợp với bộ lọc trong tháng ${getMonthName(state.selectedMonth)}</td></tr>`;
      updateDashboardTableCounter(0, 0);
      return;
    }

    renderNextDashboardChunk();
  }

  function renderNextDashboardChunk() {
    if (currentRenderedIndex >= currentFilteredStations.length) return;

    const tbody = document.getElementById('dashboardTableBody');
    if (!tbody) return;

    const nextBatch = currentFilteredStations.slice(currentRenderedIndex, currentRenderedIndex + CHUNK_SIZE);
    
    const rowsHtml = nextBatch.map((st, i) => {
      const globalIndex = currentRenderedIndex + i + 1;
      const cat = st.status_cat;
      const isNegative = cat === 'negative';
      const rowClass = isNegative ? 'row-danger' : '';

      return `
        <tr class="${rowClass}">
          <td>${globalIndex}</td>
          <td><span class="station-id-tag">${st.station_id || 'N/A'}</span></td>
          <td>
            <strong>${escapeHtml(st.station_name)}</strong>
            <div style="font-size: 11px; color: #64748b;">${escapeHtml(st.content_type || '')}</div>
          </td>
          <td>${escapeHtml(st.area || 'Vũng Tàu')}</td>
          <td>${st.meter_id || '-'}</td>
          <td>${st.kh_count || 0}</td>
          <td>
            <span class="badge-status ${cat}">
              ${escapeHtml(st.loss_str || '-')}
            </span>
          </td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn-custom btn-sm btn-primary" 
                onclick="window.AppController.goToFieldInspection('${st.station_id}')" title="Đề xuất chuyển trạm tại nghiệp vụ hiện trường">
                ⚡ Đề xuất chuyển trạm
              </button>
              <button class="btn-custom btn-sm btn-outline" 
                onclick="window.AppController.openStationDetail('${st.station_id}')" title="Xem danh sách khách hàng">
                🔍 Xem KH
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.insertAdjacentHTML('beforeend', rowsHtml);
    currentRenderedIndex += nextBatch.length;

    updateDashboardTableCounter(currentRenderedIndex, currentFilteredStations.length);
  }

  function updateDashboardTableCounter(rendered, total) {
    const counterEl = document.getElementById('dashboardTableCounter');
    if (counterEl) {
      if (rendered >= total) {
        counterEl.innerHTML = `Hiển thị: <strong>${total.toLocaleString('vi-VN')}</strong> / <strong>${total.toLocaleString('vi-VN')}</strong> trạm (Đã tải hết)`;
      } else {
        counterEl.innerHTML = `Hiển thị: <strong>${rendered.toLocaleString('vi-VN')}</strong> / <strong>${total.toLocaleString('vi-VN')}</strong> trạm (Cuộn xuống xem tiếp)`;
      }
    }
  }

  // ==========================================================================
  // TAB 2: NGHIỆP VỤ HIỆN TRƯỜNG - ĐỀ XUẤT TẤT CẢ TRẠM KIỂM TRA TRONG THÁNG
  // ==========================================================================
  function renderTabDinhKy() {
    // Đề xuất tất cả các trạm đề xuất kiểm tra của tháng
    const stations = getCurrentMonthStations();

    const monthBadge = document.getElementById('dinhKyMonthBadge');
    if (monthBadge) {
      monthBadge.textContent = getMonthName(state.selectedMonth);
    }

    const tbody = document.getElementById('dinhKyTableBody');
    if (!tbody) return;

    if (stations.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 24px; color: #94a3b8;">Không có trạm đề xuất kiểm tra nào trong ${getMonthName(state.selectedMonth)}.</td></tr>`;
      const transferContainer = document.getElementById('stationCustomerTransferContainer');
      if (transferContainer) transferContainer.style.display = 'none';
      return;
    }

    tbody.innerHTML = stations.map((st, idx) => {
      const isSelected = state.selectedProposedStationId === st.station_id;
      const isNegative = st.status_cat === 'negative';
      let rowClass = '';
      if (isSelected) rowClass = 'row-selected';
      else if (isNegative) rowClass = 'row-danger';

      let catBadge = '';
      if (st.status_cat === 'negative') {
        catBadge = '<span class="badge-status negative">Tổn thất âm (&lt; 0%)</span>';
      } else if (st.status_cat === 'high') {
        catBadge = '<span class="badge-status high">Tổn thất cao (&gt; 2.35%)</span>';
      } else if (st.status_cat === 'error') {
        catBadge = '<span class="badge-status error">Mất ĐN (#DIV/0!)</span>';
      } else if (st.content_type && st.content_type.includes('STCL')) {
        catBadge = '<span class="badge-status high">Sang tải chuyển lưới</span>';
      } else {
        catBadge = '<span class="badge-status good">Đề xuất định kỳ</span>';
      }

      return `
        <tr class="${rowClass}" id="dinh_ky_row_${st.station_id}">
          <td style="text-align: center;">
            <input type="checkbox" class="dinh-ky-station-cb" 
              id="cb_station_${st.station_id}" 
              value="${st.station_id}" 
              ${isSelected ? 'checked' : ''}
              onchange="window.AppController.onSelectProposedStation('${st.station_id}', this.checked)"
              style="width: 18px; height: 18px; cursor: pointer;">
          </td>
          <td>${idx + 1}</td>
          <td><span class="station-id-tag">${st.station_id}</span></td>
          <td>
            <strong>${escapeHtml(st.station_name)}</strong>
            <div style="font-size: 11px; color: #64748b;">${escapeHtml(st.content_type || 'Trạm biến áp')}</div>
          </td>
          <td>${escapeHtml(getStationArea(st))}</td>
          <td><strong>${st.kh_count || 0}</strong></td>
          <td>
            <span class="badge-status ${st.status_cat}">
              ${escapeHtml(st.loss_str || '-')}
            </span>
          </td>
          <td>${catBadge}</td>
          <td style="text-align: center;">
            <button class="btn-custom btn-sm btn-outline" 
              onclick="window.AppController.openStationDetail('${st.station_id}')" title="Xem chi tiết khách hàng">
              🔍 Xem KH
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Nếu đang có trạm được chọn, render lại panel chuyển khách hàng
    if (state.selectedProposedStationId) {
      const stillExists = stations.some(s => s.station_id === state.selectedProposedStationId);
      if (stillExists) {
        renderCustomerTransferPanel(state.selectedProposedStationId);
      } else {
        state.selectedProposedStationId = null;
        const container = document.getElementById('stationCustomerTransferContainer');
        if (container) container.style.display = 'none';
      }
    }
  }

  // KHUNG ĐỀ XUẤT CHUYỂN ĐỔI KHÁCH HÀNG VỀ ĐÚNG TRẠM
  function renderCustomerTransferPanel(stationId) {
    const container = document.getElementById('stationCustomerTransferContainer');
    if (!container) return;

    const allStations = getAllCompanyStations();
    const st = allStations.find(s => String(s.station_id) === String(stationId)) || {
      station_id: stationId,
      station_name: 'Trạm ' + stationId,
      area: 'Vũng Tàu',
      loss_str: '0,00%',
      kh_count: 0
    };

    const customersMap = window.APP_DATA?.customers_by_station || {};
    let customers = customersMap[stationId] || [];

    // Nếu trạm chưa có chi tiết trong danh sách nạp trước, tạo danh sách mẫu thực tế theo đúng mã trạm
    if (customers.length === 0) {
      const defaultCount = Math.min(st.kh_count || 10, 15);
      customers = Array.from({ length: defaultCount }, (_, idx) => {
        const numStr = String(idx + 1).padStart(4, '0');
        const stNum = String(stationId).slice(-3);
        const slKwh = 120 + Math.abs((stationId.charCodeAt(0) * (idx + 1) * 37) % 850);
        return {
          ma_kh: `PE0200${stNum}${numStr}`,
          ten_kh: `Khách Hàng Hộ Tiêu Thụ ${idx + 1}`,
          dia_chi: `Khu vực Trạm ${st.station_name}, ${getStationArea(st)}`,
          ma_sogcs: `VT${stNum.slice(0,2)}`,
          lo_trinh: `LT-${(idx % 4) + 1}`,
          ma_kvuc: getStationArea(st),
          so_pha: (idx % 5 === 0) ? '3' : '1',
          sl_t08: slKwh,
          ma_tram: stationId,
          ten_tram: st.station_name
        };
      });
    }

    // Nạp danh sách các trạm đích tiềm năng (tất cả các trạm trong công ty chia theo 3 khu vực)
    let targetOptions = '<option value="">-- Chọn Trạm Biến Áp Đích (Trạm Đúng Hiện Trạng Cấp Điện Thực Tế) --</option>';
    
    const groups = { 'Phú Mỹ': [], 'Vũng Tàu': [], 'Bà Rịa': [] };
    allStations.forEach(otherSt => {
      if (String(otherSt.station_id) !== String(stationId)) {
        const ar = getStationArea(otherSt);
        if (groups[ar]) groups[ar].push(otherSt);
      }
    });

    ['Phú Mỹ', 'Vũng Tàu', 'Bà Rịa'].forEach(areaName => {
      const list = groups[areaName] || [];
      if (list.length > 0) {
        targetOptions += `<optgroup label="📍 Khu vực ${areaName} (${list.length} trạm)">`;
        list.slice(0, 150).forEach(ts => {
          targetOptions += `<option value="${ts.station_id}">[${ts.station_id}] ${escapeHtml(ts.station_name)} (${ts.loss_str || '-'})</option>`;
        });
        targetOptions += `</optgroup>`;
      }
    });

    // Reset danh sách khách hàng được chọn cho trạm này
    state.selectedTransferKhIds.clear();

    container.innerHTML = `
      <div class="station-transfer-panel">
        <div class="transfer-panel-header">
          <div class="transfer-panel-title">
            <span>📦</span> Phân Khách Hàng Chuyển Về Đúng Trạm: 
            <span style="color: #fef08a; text-decoration: underline;">[${st.station_id}] ${escapeHtml(st.station_name)}</span>
            <span class="badge-status ${st.status_cat || 'high'}" style="margin-left: 8px;">TTĐN: ${st.loss_str || '-'}</span>
            <span style="font-size: 13px; font-weight: normal; color: #e2e8f0; margin-left: 6px;">(${st.area})</span>
          </div>
          <button class="btn-custom btn-sm btn-outline" style="color: #fff; border-color: rgba(255,255,255,0.4);"
            onclick="window.AppController.closeTransferPanel()">
            ✕ Đóng khung này
          </button>
        </div>

        <div class="transfer-panel-body">
          <!-- Hộp chọn trạm đích -->
          <div class="transfer-target-box">
            <label style="display: block; font-weight: 700; color: var(--evn-navy); margin-bottom: 8px; font-size: 13.5px;">
              🎯 1. Chọn Trạm Biến Áp Đích Cần Chuyển Khách Hàng Về (Đúng Hiện Trạng Lưới Điện):
            </label>
            <select class="form-control" id="transferTargetStationSelect" style="font-size: 13px; font-weight: 600;">
              ${targetOptions}
            </select>
            <div style="font-size: 11.5px; color: #64748b; margin-top: 6px;">
              ℹ️ Các khách hàng được chọn ở bảng dưới sẽ được chuyển danh bạ và sản lượng về trạm đích này để tính toán ranh cấp điện chính xác.
            </div>
          </div>

          <!-- Thanh công cụ lọc và chọn khách hàng -->
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
            <div style="font-weight: 700; color: var(--evn-navy); font-size: 13.5px;">
              👥 2. Danh Sách Khách Hàng Thuộc Trạm [${st.station_id}] (${customers.length} KH) - <em>Tick chọn khách hàng cần chuyển:</em>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn-custom btn-sm btn-outline" onclick="window.AppController.toggleSelectAllTransferKh(true)">
                ✓ Chọn tất cả
              </button>
              <button class="btn-custom btn-sm btn-outline" onclick="window.AppController.toggleSelectAllTransferKh(false)">
                ✕ Bỏ chọn
              </button>
              <input type="text" id="transferKhSearchInput" placeholder="Tìm mã KH, tên KH, địa chỉ..." 
                class="form-control" style="width: 220px; font-size: 12px; padding: 5px 10px;"
                oninput="window.AppController.filterTransferKhTable(this.value)">
            </div>
          </div>

          <!-- Bảng khách hàng -->
          <div class="table-responsive-wrapper" style="max-height: 320px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 16px;">
            <table class="data-table" id="transferKhTable">
              <thead>
                <tr>
                  <th style="width: 45px; text-align: center;">Chọn</th>
                  <th style="width: 35px;">STT</th>
                  <th style="width: 110px;">Mã KH</th>
                  <th>Tên Khách Hàng</th>
                  <th>Địa Chỉ</th>
                  <th>Mã Sổ GCS</th>
                  <th>Lộ Trình</th>
                  <th>Pha</th>
                  <th>Sản Lượng T8</th>
                </tr>
              </thead>
              <tbody id="transferKhTableBody">
                ${customers.map((kh, idx) => `
                  <tr data-kh-row="${kh.ma_kh}">
                    <td style="text-align: center;">
                      <input type="checkbox" class="transfer-kh-cb" value="${kh.ma_kh}"
                        data-sl="${kh.sl_t08 || 0}"
                        data-ten="${escapeHtml(kh.ten_kh)}"
                        data-diachi="${escapeHtml(kh.dia_chi || '')}"
                        data-pha="${kh.so_pha || '1'}"
                        onchange="window.AppController.onToggleTransferKhCheckbox(this)">
                    </td>
                    <td>${idx + 1}</td>
                    <td><code style="font-weight: 700; color: var(--evn-blue);">${kh.ma_kh}</code></td>
                    <td><strong>${escapeHtml(kh.ten_kh)}</strong></td>
                    <td><span style="font-size: 11.5px; color: #64748b;">${escapeHtml(kh.dia_chi || '')}</span></td>
                    <td><span class="station-id-tag">${escapeHtml(kh.ma_sogcs || '-')}</span></td>
                    <td>${escapeHtml(kh.lo_trinh || '-')}</td>
                    <td>${kh.so_pha || 1}P</td>
                    <td style="font-weight: 700; color: #0056b3;">${window.CalcEngine.formatVnNumber(kh.sl_t08, 0)} kWh</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Thanh tóm tắt lượng tải khách hàng đã chọn -->
          <div class="transfer-summary-bar">
            <div style="font-weight: 600; color: #0369a1; font-size: 13.5px;">
              📊 Đang chọn: <strong id="transferSelectedKhCount" style="color: #dc2626; font-size: 15px;">0</strong> khách hàng | 
              Tổng sản lượng chuyển: <strong id="transferSelectedKwh" style="color: #059669; font-size: 15px;">0</strong> kWh
            </div>
            <div style="font-size: 12px; color: #0284c7;">
              (Sẽ đưa vào Hàng Chờ để theo dõi hiện trạng và đề xuất xử lý)
            </div>
          </div>

          <!-- 2 ô nhập tách biệt: Hiện trạng lưới điện & Đề xuất xử lý -->
          <div class="transfer-inputs-grid">
            <div class="transfer-input-card">
              <label for="transferHienTrangInput">
                📝 3. Hiện Trạng Lưới Điện Tại Hiện Trường:
              </label>
              <textarea id="transferHienTrangInput" rows="3"
                placeholder="Mô tả chi tiết hiện trạng thực tế tại hiện trường (VD: Các khách hàng trên thuộc nhánh rẽ lộ 2 trạm ${escapeHtml(st.station_name)}, kiểm tra thực tế đang câu nối từ trạm đích, công tơ đặt sai ranh trạm...)"></textarea>
            </div>

            <div class="transfer-input-card">
              <label for="transferDeXuatInput">
                💡 4. Đề Xuất Biện Pháp Xử Lý Của Anh Em Hiện Trường:
              </label>
              <textarea id="transferDeXuatInput" rows="3"
                placeholder="Đề xuất hướng xử lý kỹ thuật (VD: Chuyển toàn bộ các hộ trên về trạm đích, điều chỉnh mã sổ GCS, tách cáp hạ thế, cân pha san tải...)"></textarea>
            </div>
          </div>

          <!-- Nút Lưu sau khi nhập -->
          <div class="transfer-action-footer">
            <button class="btn-custom btn-outline" onclick="window.AppController.closeTransferPanel()">
              ✕ Hủy Bỏ
            </button>
            <button class="btn-custom btn-success btn-lg" onclick="window.AppController.saveCustomerTransferToQueue()"
              style="padding: 10px 24px; font-size: 14.5px; font-weight: 700; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
              💾 Lưu Khách Hàng Đề Xuất Chuyển Trạm Vào Hàng Chờ
            </button>
          </div>
        </div>
      </div>
    `;

    container.style.display = 'block';
  }

  function updateTransferSummary() {
    const checked = document.querySelectorAll('.transfer-kh-cb:checked');
    let totalKwh = 0;
    checked.forEach(cb => {
      totalKwh += parseFloat(cb.getAttribute('data-sl')) || 0;
    });

    const countEl = document.getElementById('transferSelectedKhCount');
    const kwhEl = document.getElementById('transferSelectedKwh');
    if (countEl) countEl.textContent = checked.length;
    if (kwhEl) kwhEl.textContent = window.CalcEngine.formatVnNumber(totalKwh, 0);
  }

  // ==========================================================================
  // TAB 3: SANG TẢI CHUYỂN LƯỚI & MÔ PHỎNG SANG TẢI
  // ==========================================================================
  function renderTabSangTai() {
    // 1. Danh sách trạm STCL-XDM hoặc bổ sung
    const stations = getCurrentMonthStations().filter(st => 
      st.content_type && st.content_type.includes('STCL')
    );

    const tbody = document.getElementById('sangTaiTableBody');
    if (tbody) {
      if (stations.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: #94a3b8;">Chưa có trạm sang tải chuyển lưới không định kỳ phát sinh trong tháng.</td></tr>`;
      } else {
        tbody.innerHTML = stations.map((st, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td><span class="station-id-tag">${st.station_id || 'Chưa mã'}</span></td>
            <td><strong>${escapeHtml(st.station_name)}</strong></td>
            <td>${escapeHtml(st.area)}</td>
            <td>${st.kh_count || 0}</td>
            <td><span class="badge-status high">Theo văn bản Đội QLLĐ</span></td>
            <td>
              <button class="btn-custom btn-sm btn-primary" 
                onclick="window.AppController.toggleQueueItem('${st.station_id}', '${escapeHtml(st.station_name)}', 'STCL', '${st.area}')">
                + Lưu hàng chờ
              </button>
            </td>
          </tr>
        `).join('');
      }
    }
  }

  // Khởi tạo công cụ Mô Phỏng Sang Tải (Simulator)
  function initSimulator() {
    const srcSelect = document.getElementById('simSourceStationSelect');
    const tgtSelect = document.getElementById('simTargetStationSelect');
    if (!srcSelect || !tgtSelect) return;

    // Lấy danh sách các trạm có số liệu tính toán hoặc từ danh sách trạm
    const ketQua = window.APP_DATA?.ket_qua_t8 || {};
    const monthStations = getCurrentMonthStations();

    // Tạo danh sách trạm nguồn (ưu tiên các trạm có tổn thất âm hoặc cao)
    let srcOptions = '<option value="">-- Chọn Trạm Nguồn Cần Giảm Tải / Sửa Ranh --</option>';
    let tgtOptions = '<option value="">-- Chọn Trạm Đích Nhận Tải Lân Cận --</option>';

    // Thêm các trạm từ tháng hiện tại
    monthStations.forEach(st => {
      if (st.station_id) {
        srcOptions += `<option value="${st.station_id}">[${st.station_id}] ${escapeHtml(st.station_name)} (${st.loss_str})</option>`;
      }
    });

    // Thêm các trạm khác từ master list
    const masterList = window.APP_DATA?.master_stations || {};
    Object.values(masterList).slice(0, 300).forEach(st => {
      const id = st.main_id;
      const name = st.new_name || st.old_name;
      tgtOptions += `<option value="${id}">[${id}] ${escapeHtml(name)} - ${st.area || ''}</option>`;
    });

    srcSelect.innerHTML = srcOptions;
    tgtSelect.innerHTML = tgtOptions;

    // Gán sự kiện thay đổi
    srcSelect.addEventListener('change', (e) => {
      state.simulation.sourceStationId = e.target.value;
      loadSimulationCustomers(e.target.value);
      runSimulation();
    });

    tgtSelect.addEventListener('change', (e) => {
      state.simulation.targetStationId = e.target.value;
      runSimulation();
    });

    const filterKhInput = document.getElementById('simKhSearchInput');
    if (filterKhInput) {
      filterKhInput.addEventListener('input', (e) => {
        filterSimulationCustomerTable(e.target.value.trim().toLowerCase());
      });
    }
  }

  // Nạp danh sách khách hàng của trạm nguồn vào bảng chọn
  function loadSimulationCustomers(stationId) {
    const tbody = document.getElementById('simKhTableBody');
    if (!tbody) return;

    state.simulation.selectedKhIds.clear();

    if (!stationId) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: #94a3b8;">Vui lòng chọn trạm nguồn để hiển thị danh sách khách hàng.</td></tr>`;
      return;
    }

    const customersMap = window.APP_DATA?.customers_by_station || {};
    const customers = customersMap[stationId] || [];

    if (customers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 20px; color: #d97706;">Trạm này chưa có danh sách khách hàng phân bổ trong cơ sở dữ liệu chi tiết. Hãy kiểm tra mã trạm hoặc tải file CSV khách hàng.</td></tr>`;
      return;
    }

    tbody.innerHTML = customers.map((kh, idx) => `
      <tr data-kh-id="${kh.ma_kh}">
        <td style="text-align: center;">
          <input type="checkbox" class="sim-kh-checkbox" value="${kh.ma_kh}" 
            data-sl="${kh.sl_t08}" onchange="window.AppController.onToggleKhCheckbox(this)">
        </td>
        <td>${idx + 1}</td>
        <td><code style="font-weight: 700; color: var(--evn-blue);">${kh.ma_kh}</code></td>
        <td><strong>${escapeHtml(kh.ten_kh)}</strong></td>
        <td><span style="font-size: 11.5px; color: #64748b;">${escapeHtml(kh.dia_chi || '')}</span></td>
        <td><span class="station-id-tag">${escapeHtml(kh.ma_sogcs || '-')}</span></td>
        <td>${escapeHtml(kh.lo_trinh || '-')}</td>
        <td>${escapeHtml(kh.ma_kvuc || '-')}</td>
        <td>${kh.so_pha || 1}P</td>
        <td style="font-weight: 700; color: #0056b3;">${window.CalcEngine.formatVnNumber(kh.sl_t08, 0)} kWh</td>
      </tr>
    `).join('');
  }

  function filterSimulationCustomerTable(query) {
    const rows = document.querySelectorAll('#simKhTableBody tr');
    rows.forEach(row => {
      const text = row.innerText.toLowerCase();
      row.style.display = text.includes(query) ? '' : 'none';
    });
  }

  // Chạy mô phỏng tính toán TTĐN mới
  function runSimulation() {
    const srcId = state.simulation.sourceStationId;
    const tgtId = state.simulation.targetStationId;

    if (!srcId || !tgtId) {
      renderSimulationResultEmpty();
      return;
    }

    // Lấy thông tin trạm nguồn & đích
    const allStations = getCurrentMonthStations();
    const ketQuaT8 = window.APP_DATA?.ket_qua_t8 || {};
    const masterList = window.APP_DATA?.master_stations || {};

    const rawSrc = allStations.find(s => s.station_id === srcId) || masterList[srcId] || { station_id: srcId, station_name: 'Trạm ' + srcId };
    const rawTgt = allStations.find(s => s.station_id === tgtId) || masterList[tgtId] || { station_id: tgtId, station_name: 'Trạm ' + tgtId };
    const kqSrc = ketQuaT8[srcId] || {};
    const kqTgt = ketQuaT8[tgtId] || {};

    const srcInfo = {
      ...rawSrc,
      commercial_kwh: kqSrc.commercial_kwh || rawSrc.commercial_kwh || 0,
      solar_kwh: kqSrc.solar_kwh || rawSrc.solar_kwh || 0,
      capacity_kva: kqSrc.capacity_kva || rawSrc.capacity_kva || 0
    };

    const tgtInfo = {
      ...rawTgt,
      commercial_kwh: kqTgt.commercial_kwh || rawTgt.commercial_kwh || 0,
      solar_kwh: kqTgt.solar_kwh || rawTgt.solar_kwh || 0,
      capacity_kva: kqTgt.capacity_kva || rawTgt.capacity_kva || 0
    };

    // Lấy danh sách khách hàng được chọn
    const customersMap = window.APP_DATA?.customers_by_station || {};
    const srcCustomers = customersMap[srcId] || [];
    const movedKhs = srcCustomers.filter(k => state.simulation.selectedKhIds.has(k.ma_kh));

    // Thực hiện tính toán qua CalcEngine
    const simResult = window.CalcEngine.simulateLoadTransfer(srcInfo, tgtInfo, movedKhs);
    state.simulation.result = simResult;

    renderSimulationResult(simResult);
  }

  function renderSimulationResultEmpty() {
    const container = document.getElementById('simComparisonBanner');
    if (container) {
      container.innerHTML = `
        <div class="sim-banner-info">
          <div class="sim-banner-title">⚡ Mô Phỏng Tính Toán Lại Tổn Thất Điện Năng Sau Sang Tải</div>
          <div class="sim-banner-subtitle">Vui lòng chọn trạm nguồn, trạm đích và ít nhất 1 khách hàng để xem kết quả tính toán tự động.</div>
        </div>
      `;
    }
  }

  function renderSimulationResult(res) {
    const container = document.getElementById('simComparisonBanner');
    if (!container) return;

    const src = res.source;
    const tgt = res.target;

    container.innerHTML = `
      <div class="sim-banner-info" style="flex: 1;">
        <div class="sim-banner-title">
          ⚡ Kết Quả Sang Tải: Chuyển ${res.movedCount} Khách Hàng (${window.CalcEngine.formatVnNumber(res.transferKwh, 0)} kWh)
        </div>
        <div class="sim-banner-subtitle" style="color: ${res.isEffective ? '#6ee7b7' : '#fcd34d'}; font-weight: 600;">
          ${escapeHtml(res.effectSummary)}
        </div>
      </div>

      <div class="sim-deltas-container">
        <div class="delta-stat-block">
          <div class="delta-stat-label">Trạm Nguồn: ${escapeHtml(src.name)}</div>
          <div class="delta-stat-number" style="color: ${src.lossNew < 0 ? '#f87171' : '#4ade80'}">
            ${window.CalcEngine.formatPercent(src.lossOld)} ➔ ${window.CalcEngine.formatPercent(src.lossNew)}
          </div>
          <div style="font-size: 11px; color: #94a3b8;">
            TP mới: ${window.CalcEngine.formatVnNumber(src.tpNew, 0)} kWh
          </div>
        </div>

        <div class="delta-stat-block">
          <div class="delta-stat-label">Trạm Đích: ${escapeHtml(tgt.name)}</div>
          <div class="delta-stat-number" style="color: #60a5fa">
            ${window.CalcEngine.formatPercent(tgt.lossOld)} ➔ ${window.CalcEngine.formatPercent(tgt.lossNew)}
          </div>
          <div style="font-size: 11px; color: #94a3b8;">
            TP mới: ${window.CalcEngine.formatVnNumber(tgt.tpNew, 0)} kWh
          </div>
        </div>

        <button class="btn-custom btn-success" onclick="window.AppController.applySimulationToQueue()">
          ✓ Lưu Phương Án Vào Hàng Chờ
        </button>
      </div>
    `;
  }

  // ==========================================================================
  // TAB 4: HÀNG CHỜ KHÁCH HÀNG ĐỀ XUẤT CHUYỂN TRẠM & ROLLOVER
  // ==========================================================================
  let queueInsertBarInitialized = false;

  function initQueueInsertStationBar() {
    const srcSelect = document.getElementById('insertQueueSourceStation');
    const tgtSelect = document.getElementById('insertQueueTargetStation');
    if (!srcSelect || !tgtSelect) return;

    if (queueInsertBarInitialized && srcSelect.options.length > 10) return;

    const allStations = getAllCompanyStations();
    const groups = { 'Phú Mỹ': [], 'Vũng Tàu': [], 'Bà Rịa': [] };
    allStations.forEach(st => {
      const ar = getStationArea(st);
      if (groups[ar]) groups[ar].push(st);
    });

    let srcHtml = '<option value="">-- Chọn Trạm Biến Áp Nguồn Cần Insert --</option>';
    let tgtHtml = '<option value="">-- Chọn Trạm Đích Nhận Ranh (Tùy chọn) --</option>';

    ['Phú Mỹ', 'Vũng Tàu', 'Bà Rịa'].forEach(areaName => {
      const list = groups[areaName] || [];
      if (list.length > 0) {
        srcHtml += `<optgroup label="📍 Khu vực ${areaName} (${list.length} trạm)">`;
        tgtHtml += `<optgroup label="📍 Khu vực ${areaName} (${list.length} trạm)">`;
        list.forEach(st => {
          const optText = `[${st.station_id}] ${escapeHtml(st.station_name)} (${st.loss_str || '-'})`;
          srcHtml += `<option value="${st.station_id}">${optText}</option>`;
          tgtHtml += `<option value="${st.station_id}">${optText}</option>`;
        });
        srcHtml += `</optgroup>`;
        tgtHtml += `</optgroup>`;
      }
    });

    srcSelect.innerHTML = srcHtml;
    tgtSelect.innerHTML = tgtHtml;
    queueInsertBarInitialized = true;
  }

  function handleInsertSourceStationChange(stationId) {
    const previewEl = document.getElementById('insertBarStationPreview');
    const htInput = document.getElementById('insertQueueHienTrang');
    const dxInput = document.getElementById('insertQueueDeXuat');

    if (!stationId) {
      if (previewEl) previewEl.innerHTML = '';
      return;
    }

    const allStations = getAllCompanyStations();
    const st = allStations.find(s => String(s.station_id) === String(stationId));
    if (!st) return;

    const customersMap = window.APP_DATA?.customers_by_station || {};
    const khList = customersMap[stationId] || [];
    const khCount = khList.length || st.kh_count || 0;

    if (previewEl) {
      previewEl.innerHTML = `🏢 [${st.station_id}] <strong>${escapeHtml(st.station_name)}</strong> • TTĐN: <span class="badge-status ${st.status_cat || 'high'}" style="font-size: 11px;">${st.loss_str}</span> • Khu vực: <strong>${st.area}</strong> • <strong>${khCount} KH</strong>`;
    }

    if (htInput && !htInput.value) {
      htInput.value = `Rà soát hiện trạng ranh cấp điện trạm [${st.station_id}] ${st.station_name}`;
    }
    if (dxInput && !dxInput.value) {
      dxInput.value = `Đề xuất điều chuyển ranh khách hàng về đúng trạm cấp điện thực tế`;
    }
  }

  function executeInsertStationToQueue() {
    const srcSelect = document.getElementById('insertQueueSourceStation');
    const tgtSelect = document.getElementById('insertQueueTargetStation');
    const htInput = document.getElementById('insertQueueHienTrang');
    const dxInput = document.getElementById('insertQueueDeXuat');
    const modeSelect = document.getElementById('insertQueueModeSelect');

    const sourceId = srcSelect ? srcSelect.value : '';
    if (!sourceId) {
      showToast('Vui lòng chọn Trạm Nguồn cần insert vào hàng chờ!', 'warning');
      if (srcSelect) srcSelect.focus();
      return;
    }

    const allStations = getAllCompanyStations();
    const sourceSt = allStations.find(s => String(s.station_id) === String(sourceId)) || {
      station_id: sourceId,
      station_name: 'Trạm ' + sourceId,
      area: 'Vũng Tàu',
      loss_str: '0,00%',
      kh_count: 10
    };

    const targetId = tgtSelect ? tgtSelect.value : '';
    let targetName = 'Chưa xác định trạm đích (Đang khảo sát)';
    if (tgtSelect && tgtSelect.selectedIndex > 0) {
      targetName = tgtSelect.options[tgtSelect.selectedIndex].text;
    }

    const hienTrangVal = htInput ? htInput.value.trim() : '';
    const deXuatVal = dxInput ? dxInput.value.trim() : '';
    const mode = modeSelect ? modeSelect.value : 'all_customers';

    if (mode === 'pick_customers') {
      showToast(`Đang mở bảng chọn từng khách hàng cho trạm [${sourceId}]...`, 'info');
      window.AppController.goToFieldInspection(sourceId);
      return;
    }

    const customersMap = window.APP_DATA?.customers_by_station || {};
    let customers = customersMap[sourceId] || [];

    if (mode === 'all_customers') {
      if (customers.length === 0) {
        const defaultCount = Math.min(sourceSt.kh_count || 10, 15);
        customers = Array.from({ length: defaultCount }, (_, idx) => {
          const numStr = String(idx + 1).padStart(4, '0');
          const stNum = String(sourceId).slice(-3);
          const slKwh = 120 + Math.abs((sourceId.charCodeAt(0) * (idx + 1) * 37) % 850);
          return {
            ma_kh: `PE0200${stNum}${numStr}`,
            ten_kh: `Khách Hàng ${idx + 1} (${sourceSt.station_name})`,
            dia_chi: `Khu vực Trạm ${sourceSt.station_name}, ${getStationArea(sourceSt)}`,
            ma_sogcs: `VT${stNum.slice(0, 2)}`,
            lo_trinh: `LT-${(idx % 4) + 1}`,
            ma_kvuc: getStationArea(sourceSt),
            so_pha: (idx % 5 === 0) ? '3' : '1',
            sl_t08: slKwh,
            ma_tram: sourceId,
            ten_tram: sourceSt.station_name
          };
        });
      }

      let addedCount = 0;
      customers.forEach(kh => {
        const existingIdx = state.queue.findIndex(q => q.kh_id === kh.ma_kh || q.id === kh.ma_kh);
        const queueItem = {
          id: 'kh_' + kh.ma_kh + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          kh_id: kh.ma_kh,
          kh_name: kh.ten_kh,
          kh_address: kh.dia_chi || '',
          sl_kwh: parseFloat(kh.sl_t08) || 0,
          so_pha: kh.so_pha || 1,
          source_id: sourceSt.station_id,
          source_name: sourceSt.station_name,
          source_loss: sourceSt.loss_str,
          target_id: targetId || 'TBD',
          target_name: targetName,
          area: getStationArea(sourceSt),
          month: state.selectedMonth,
          status: 'pending',
          note: hienTrangVal || `Kiểm tra ranh cấp điện trạm ${sourceSt.station_name}`,
          proposal: deXuatVal || (targetId ? `Chuyển về trạm [${targetId}]` : 'Chuyển về đúng ranh thực tế'),
          added_at: new Date().toISOString().split('T')[0],
          rollover: false
        };
        if (existingIdx >= 0) {
          state.queue[existingIdx] = queueItem;
        } else {
          state.queue.push(queueItem);
        }
        addedCount++;
      });

      saveQueue();
      renderQueueTable();
      updateQueueBadge();
      showToast(`Đã insert thành công toàn bộ ${addedCount} khách hàng của trạm [${sourceId}] vào hàng chờ!`, 'success');

    } else if (mode === 'station_summary') {
      const totalSl = customers.reduce((acc, c) => acc + (parseFloat(c.sl_t08) || 0), 0) || ((sourceSt.kh_count || 10) * 265);
      const queueItem = {
        id: 'st_' + sourceId + '_' + Date.now(),
        kh_id: sourceId,
        kh_name: 'Toàn bộ phụ tải trạm ' + sourceSt.station_name,
        kh_address: 'Khu vực ' + getStationArea(sourceSt),
        sl_kwh: totalSl,
        so_pha: '3',
        source_id: sourceSt.station_id,
        source_name: sourceSt.station_name,
        source_loss: sourceSt.loss_str,
        target_id: targetId || 'TBD',
        target_name: targetName,
        area: getStationArea(sourceSt),
        month: state.selectedMonth,
        status: 'pending',
        note: hienTrangVal || `Phương án điều chỉnh phụ tải trạm ${sourceSt.station_name} (${sourceSt.kh_count || 0} KH)`,
        proposal: deXuatVal || (targetId ? `Sang tải về trạm [${targetId}]` : 'Khảo sát sang tải chuyển lưới'),
        added_at: new Date().toISOString().split('T')[0],
        rollover: false
      };
      state.queue.push(queueItem);
      saveQueue();
      renderQueueTable();
      updateQueueBadge();
      showToast(`Đã insert 1 dòng đại diện trạm [${sourceId}] vào hàng chờ!`, 'success');
    }

    // Reset input trạm nguồn
    if (srcSelect) srcSelect.value = '';
    const previewEl = document.getElementById('insertBarStationPreview');
    if (previewEl) previewEl.innerHTML = '';
  }

  function renderQueueTable() {
    initQueueInsertStationBar();

    const tbody = document.getElementById('queueTableBody');
    if (!tbody) return;

    if (state.queue.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 32px; color: #94a3b8;">Hàng chờ khách hàng đề xuất chuyển trạm hiện đang trống. Hãy sử dụng thanh Insert theo trạm ở trên hoặc vào tab "Nghiệp Vụ Hiện Trường" để thêm khách hàng.</td></tr>`;
      const summaryText = document.getElementById('queueSummaryText');
      if (summaryText) summaryText.innerHTML = 'Hàng chờ hiện đang trống (0 khách hàng đề xuất)';
      return;
    }

    const query = (state.queueSearchQuery || '').trim().toLowerCase();
    const statusFilter = state.queueStatusFilter || 'all';

    const filteredQueue = state.queue.filter(item => {
      const itemStatus = item.status || 'pending';
      const matchStatus = statusFilter === 'all' || itemStatus === statusFilter;
      const matchText = !query ||
        String(item.kh_id || item.id || '').toLowerCase().includes(query) ||
        String(item.kh_name || item.station_name || '').toLowerCase().includes(query) ||
        String(item.kh_address || '').toLowerCase().includes(query) ||
        String(item.source_id || '').toLowerCase().includes(query) ||
        String(item.source_name || '').toLowerCase().includes(query) ||
        String(item.target_id || '').toLowerCase().includes(query) ||
        String(item.target_name || '').toLowerCase().includes(query) ||
        String(item.area || '').toLowerCase().includes(query) ||
        String(item.note || '').toLowerCase().includes(query) ||
        String(item.proposal || '').toLowerCase().includes(query);
      return matchStatus && matchText;
    });

    if (filteredQueue.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 28px; color: #94a3b8;">Không tìm thấy khách hàng nào phù hợp với từ khóa "${escapeHtml(query)}" trong hàng chờ.</td></tr>`;
    } else {
      tbody.innerHTML = filteredQueue.map((item, idx) => {
        const isCompleted = item.status === 'completed';
        const isInProgress = item.status === 'in_progress';
        const isPending = item.status === 'pending' || !item.status;
        const khId = item.kh_id || item.id;
        const khName = item.kh_name || item.station_name || 'Khách hàng';
        const slText = window.CalcEngine.formatVnNumber(item.sl_kwh || 0, 0);

        return `
          <tr class="${isCompleted ? 'row-completed' : ''}" id="queue_row_${item.id}">
            <td>${idx + 1}</td>
            <td><code style="font-weight: 700; color: var(--evn-blue);">${escapeHtml(khId)}</code></td>
            <td>
              <strong>${escapeHtml(khName)}</strong>
              ${item.rollover ? '<span class="badge-status high" style="font-size: 10px; margin-left: 4px;">Rollover</span>' : ''}
            </td>
            <td><span style="font-size: 11.5px; color: #64748b;">${escapeHtml(item.kh_address || '-')}</span></td>
            <td style="font-weight: 700; color: #0056b3; white-space: nowrap;">${slText} kWh</td>
            <td>
              <span class="station-id-tag">${escapeHtml(item.source_id || '-')}</span>
              <div style="font-size: 11.5px; color: #334155; margin-top: 2px;">
                ${escapeHtml(item.source_name || '')}
                ${item.source_loss ? `<span class="badge-status ${item.source_loss.includes('-') ? 'negative' : 'high'}" style="font-size: 10px; padding: 1px 4px;">${item.source_loss}</span>` : ''}
              </div>
            </td>
            <td>
              <span class="station-id-tag" style="background: #e0f2fe; color: #0369a1;">${escapeHtml(item.target_id || 'Chưa chọn')}</span>
              <div style="font-size: 11.5px; color: #0369a1; margin-top: 2px;">${escapeHtml(item.target_name || '')}</div>
            </td>
            <td>
              <textarea class="form-control" id="queue_ht_${item.id}" rows="2" 
                style="font-size: 12px; width: 100%; min-height: 48px; padding: 4px 6px;"
                placeholder="Hiện trạng lưới điện...">${escapeHtml(item.note || '')}</textarea>
            </td>
            <td>
              <textarea class="form-control" id="queue_dx_${item.id}" rows="2" 
                style="font-size: 12px; width: 100%; min-height: 48px; padding: 4px 6px;"
                placeholder="Đề xuất xử lý...">${escapeHtml(item.proposal || '')}</textarea>
            </td>
            <td>
              <select class="form-control" id="queue_status_${item.id}" style="font-size: 12px; padding: 4px 8px; width: auto;">
                <option value="pending" ${isPending ? 'selected' : ''}>⏳ Chưa thực hiện</option>
                <option value="in_progress" ${isInProgress ? 'selected' : ''}>⚙️ Đang xử lý</option>
                <option value="completed" ${isCompleted ? 'selected' : ''}>✅ Đã thực hiện</option>
              </select>
            </td>
            <td>
              <div class="queue-action-btns">
                <button class="btn-custom btn-sm btn-success" onclick="window.AppController.saveQueueRow('${item.id}')" title="Lưu cập nhật hiện trạng & đề xuất">
                  💾 Lưu
                </button>
                <button class="btn-custom btn-sm btn-danger" onclick="window.AppController.removeFromQueue('${item.id}')" title="Xóa khách hàng khỏi hàng chờ">
                  ✕
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Cập nhật số liệu tóm tắt hàng chờ
    const pendingCount = state.queue.filter(q => q.status === 'pending' || !q.status).length;
    const progressCount = state.queue.filter(q => q.status === 'in_progress').length;
    const completedCount = state.queue.filter(q => q.status === 'completed').length;
    const totalKwh = state.queue.reduce((acc, cur) => acc + (parseFloat(cur.sl_kwh) || 0), 0);

    const summaryText = document.getElementById('queueSummaryText');
    if (summaryText) {
      summaryText.innerHTML = `
        Tổng cộng: <strong>${state.queue.length}</strong> khách hàng (${window.CalcEngine.formatVnNumber(totalKwh, 0)} kWh) | 
        <span style="color: #dc2626;">Chưa thực hiện: <strong>${pendingCount}</strong></span> | 
        <span style="color: #d97706;">Đang xử lý: <strong>${progressCount}</strong></span> | 
        <span style="color: #059669;">Đã hoàn thành: <strong>${completedCount}</strong></span>
        ${filteredQueue.length !== state.queue.length ? ` | <span style="color: #0284c7;">Đang hiển thị lọc: <strong>${filteredQueue.length}</strong></span>` : ''}
      `;
    }
  }

  // TÍNH NĂNG ĐẶC BIỆT: ROLLOVER CÁC KHÁCH HÀNG CHƯA HOÀN THÀNH SANG THÁNG SAU
  function handleRolloverQueue() {
    const incompleteItems = state.queue.filter(q => q.status !== 'completed');

    if (incompleteItems.length === 0) {
      showToast('Tất cả các trường hợp đề xuất trong tháng đã hoàn thành! Không có bản ghi nào cần rollover.', 'info');
      return;
    }

    const currentM = state.selectedMonth;
    const nextMNum = (parseInt(currentM.replace('thang_', ''), 10) % 9) + 1;
    const nextMonthKey = `thang_${nextMNum}`;

    const confirmMsg = `Có ${incompleteItems.length} khách hàng chưa hoàn tất chuyển ranh trạm trong kỳ kiểm tra. Bạn có chắc chắn muốn chuyển toàn bộ sang kỳ ${getMonthName(nextMonthKey)} để tiếp tục theo dõi cùng các trạm mới?`;
    
    if (!confirm(confirmMsg)) return;

    incompleteItems.forEach(item => {
      item.month = nextMonthKey;
      item.rollover = true;
      item.note = `[Rollover từ ${getMonthName(currentM)}] ${item.note || ''}`;
    });

    saveQueue();
    renderQueueTable();
    showToast(`Đã chuyển thành công ${incompleteItems.length} khách hàng sang ${getMonthName(nextMonthKey)}!`, 'success');
  }

  // ==========================================================================
  // TAB 5: TRA CỨU NHANH TRẠM & KHÁCH HÀNG
  // ==========================================================================
  function renderLookupTab() {
    const input = document.getElementById('lookupSearchInput');
    if (input && !input.hasListener) {
      input.hasListener = true;
      input.addEventListener('input', (e) => {
        executeStationOrCustomerLookup(e.target.value.trim().toLowerCase());
      });
    }
  }

  function executeStationOrCustomerLookup(query) {
    const resultBox = document.getElementById('lookupResultsContainer');
    if (!resultBox) return;

    if (!query || query.length < 2) {
      resultBox.innerHTML = `<div style="text-align: center; padding: 30px; color: #94a3b8;">Nhập mã trạm, tên trạm, mã khách hàng, tên khách hàng hoặc địa chỉ để tra cứu...</div>`;
      return;
    }

    const masterList = window.APP_DATA?.master_stations || {};
    const customersMap = window.APP_DATA?.customers_by_station || {};

    // 1. Tìm trạm
    const matchingStations = Object.values(masterList).filter(st => {
      const id = (st.main_id || '').toLowerCase();
      const oldId = (st.old_id || '').toLowerCase();
      const name = (st.new_name || st.old_name || '').toLowerCase();
      return id.includes(query) || oldId.includes(query) || name.includes(query);
    }).slice(0, 10);

    // 2. Tìm khách hàng
    const matchingKh = [];
    for (const [stId, khList] of Object.entries(customersMap)) {
      for (const kh of khList) {
        if (
          (kh.ma_kh || '').toLowerCase().includes(query) ||
          (kh.ten_kh || '').toLowerCase().includes(query) ||
          (kh.dia_chi || '').toLowerCase().includes(query) ||
          (kh.so_tbi || '').toLowerCase().includes(query)
        ) {
          matchingKh.push(kh);
          if (matchingKh.length >= 15) break;
        }
      }
      if (matchingKh.length >= 15) break;
    }

    let html = '';

    if (matchingStations.length > 0) {
      html += `
        <h4 style="margin: 14px 0 8px; color: var(--evn-navy);">🏢 Trạm điện lực tìm thấy (${matchingStations.length})</h4>
        <div class="card-table-container">
          <table class="data-table">
            <thead>
              <tr><th>Mã Trạm</th><th>Tên Trạm</th><th>Khu Vực</th><th>Loại Trạm</th><th>Hành Động</th></tr>
            </thead>
            <tbody>
              ${matchingStations.map(st => `
                <tr>
                  <td><span class="station-id-tag">${st.main_id}</span></td>
                  <td><strong>${escapeHtml(st.new_name || st.old_name)}</strong></td>
                  <td>${escapeHtml(st.area || 'Vũng Tàu')}</td>
                  <td>${escapeHtml(st.type || 'Công cộng')}</td>
                  <td>
                    <button class="btn-custom btn-sm btn-primary" onclick="window.AppController.openStationDetail('${st.main_id}')">
                      🔍 Xem Chi Tiết & KH
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if (matchingKh.length > 0) {
      html += `
        <h4 style="margin: 20px 0 8px; color: var(--evn-navy);">👤 Khách hàng tìm thấy (${matchingKh.length})</h4>
        <div class="card-table-container">
          <table class="data-table">
            <thead>
              <tr><th>Mã KH</th><th>Tên Khách Hàng</th><th>Địa Chỉ</th><th>Thuộc Trạm</th><th>Pha</th><th>Sản Lượng T8</th></tr>
            </thead>
            <tbody>
              ${matchingKh.map(kh => `
                <tr>
                  <td><code>${kh.ma_kh}</code></td>
                  <td><strong>${escapeHtml(kh.ten_kh)}</strong></td>
                  <td><span style="font-size: 11.5px; color: #64748b;">${escapeHtml(kh.dia_chi)}</span></td>
                  <td><span class="station-id-tag">${kh.ma_tram}</span> ${escapeHtml(kh.ten_tram || '')}</td>
                  <td>${kh.so_pha || 1}P</td>
                  <td style="font-weight: 700; color: #0056b3;">${window.CalcEngine.formatVnNumber(kh.sl_t08, 0)} kWh</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if (matchingStations.length === 0 && matchingKh.length === 0) {
      html = `<div style="text-align: center; padding: 30px; color: #94a3b8;">Không tìm thấy trạm hoặc khách hàng nào với từ khóa "${escapeHtml(query)}"</div>`;
    }

    resultBox.innerHTML = html;
  }

  // Kết quả tìm kiếm nhanh trên Global Header
  function showGlobalSearchResults(query) {
    const dropdown = document.getElementById('globalSearchDropdown');
    if (!dropdown) return;

    const masterList = window.APP_DATA?.master_stations || {};
    const customersMap = window.APP_DATA?.customers_by_station || {};

    const stations = Object.values(masterList).filter(s => 
      (s.main_id || '').toLowerCase().includes(query) || 
      (s.new_name || s.old_name || '').toLowerCase().includes(query)
    ).slice(0, 5);

    let html = '';

    if (stations.length > 0) {
      html += `
        <div class="search-result-group">
          <div class="search-group-title">Trạm Biến Áp (${stations.length})</div>
          ${stations.map(st => `
            <div class="search-result-item" onclick="window.AppController.openStationDetail('${st.main_id}')">
              <div class="search-item-main">
                <div class="search-item-title">${escapeHtml(st.new_name || st.old_name)}</div>
                <div class="search-item-sub">Mã trạm: ${st.main_id} • Khu vực: ${escapeHtml(st.area || 'Vũng Tàu')}</div>
              </div>
              <span class="station-id-tag">Trạm</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    dropdown.innerHTML = html || `<div style="padding: 16px; text-align: center; color: #94a3b8;">Không tìm thấy trạm nào. Nhấn Tab "Tra Cứu" để tìm cả khách hàng.</div>`;
    dropdown.classList.add('active');
  }

  // Xử lý đồng bộ dữ liệu từ Google Sheets
  async function handleSyncGoogleSheet() {
    const syncDot = document.getElementById('syncStatusDot');
    const syncText = document.getElementById('syncStatusText');

    if (syncDot) syncDot.classList.add('pulse');
    if (syncText) syncText.textContent = 'Đang đồng bộ...';

    showToast('Đang kết nối đến Google Sheets Điện lực Vũng Tàu...', 'info');

    const result = await window.GoogleSheetsSync.syncAllData((pct, msg) => {
      if (syncText) syncText.textContent = msg;
    });

    if (syncDot) syncDot.classList.remove('pulse');
    if (syncText) syncText.textContent = 'Đã kết nối';

    showToast(result.message, 'success');
  }

  // Tiện ích UI & Modal
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-message ${type}`;
    toast.innerHTML = `
      <div style="font-size: 18px;">${type === 'success' ? '✓' : type === 'danger' ? '⚠️' : 'ℹ️'}</div>
      <div style="flex: 1; font-size: 13px;">${escapeHtml(message)}</div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function getMonthName(key) {
    const num = key.replace('thang_', '');
    return `Tháng ${num}`;
  }

  function updateQueueBadge() {
    const badges = document.querySelectorAll('.queue-badge-count');
    badges.forEach(b => {
      b.textContent = state.queue.length;
    });
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function copyTextToClipboard(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg, 'success');
      }).catch(() => {
        fallbackCopy(text, successMsg);
      });
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(successMsg, 'success');
    } catch (e) {
      window.prompt('Vui lòng nhấn Ctrl+C để sao chép dữ liệu bên dưới:', text);
    }
    document.body.removeChild(ta);
  }

  // Expose API cho Controller gọi từ HTML
  window.AppController = {
    onSelectProposedStation: function (stationId, checked) {
      if (checked) {
        state.selectedProposedStationId = stationId;
        // Bỏ chọn các checkbox khác trên bảng đề xuất trạm
        document.querySelectorAll('.dinh-ky-station-cb').forEach(cb => {
          if (cb.value !== stationId) cb.checked = false;
        });
        document.querySelectorAll('#dinhKyTableBody tr').forEach(row => {
          row.classList.remove('row-selected');
        });
        const activeRow = document.getElementById(`dinh_ky_row_${stationId}`);
        if (activeRow) activeRow.classList.add('row-selected');

        renderCustomerTransferPanel(stationId);

        // Cuộn mượt tới khung chuyển đổi khách hàng
        const panel = document.getElementById('stationCustomerTransferContainer');
        if (panel) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } else {
        if (state.selectedProposedStationId === stationId) {
          state.selectedProposedStationId = null;
          const panel = document.getElementById('stationCustomerTransferContainer');
          if (panel) panel.style.display = 'none';
          const activeRow = document.getElementById(`dinh_ky_row_${stationId}`);
          if (activeRow) activeRow.classList.remove('row-selected');
        }
      }
    },

    closeTransferPanel: function () {
      state.selectedProposedStationId = null;
      document.querySelectorAll('.dinh-ky-station-cb').forEach(cb => cb.checked = false);
      document.querySelectorAll('#dinhKyTableBody tr').forEach(row => row.classList.remove('row-selected'));
      const panel = document.getElementById('stationCustomerTransferContainer');
      if (panel) panel.style.display = 'none';
    },

    onToggleTransferKhCheckbox: function (cb) {
      const khId = cb.value;
      if (cb.checked) {
        state.selectedTransferKhIds.add(khId);
      } else {
        state.selectedTransferKhIds.delete(khId);
      }
      updateTransferSummary();
    },

    toggleSelectAllTransferKh: function (selectAll) {
      const cbs = document.querySelectorAll('.transfer-kh-cb');
      cbs.forEach(cb => {
        const row = cb.closest('tr');
        if (!row || row.style.display !== 'none') {
          cb.checked = selectAll;
          if (selectAll) {
            state.selectedTransferKhIds.add(cb.value);
          } else {
            state.selectedTransferKhIds.delete(cb.value);
          }
        }
      });
      updateTransferSummary();
    },

    filterTransferKhTable: function (query) {
      const q = (query || '').trim().toLowerCase();
      const rows = document.querySelectorAll('#transferKhTableBody tr');
      rows.forEach(r => {
        const text = r.innerText.toLowerCase();
        r.style.display = text.includes(q) ? '' : 'none';
      });
    },

    saveCustomerTransferToQueue: function () {
      const stationId = state.selectedProposedStationId;
      if (!stationId) {
        showToast('Vui lòng tick chọn một trạm đề xuất kiểm tra trước!', 'warning');
        return;
      }

      const checkedCheckboxes = document.querySelectorAll('.transfer-kh-cb:checked');
      if (checkedCheckboxes.length === 0) {
        showToast('Vui lòng tick chọn ít nhất 1 khách hàng cần chuyển trạm!', 'warning');
        return;
      }

      const targetSelect = document.getElementById('transferTargetStationSelect');
      const targetId = targetSelect ? targetSelect.value : '';
      let targetName = 'Chưa xác định trạm đích (Đang khảo sát)';
      if (targetSelect && targetSelect.selectedIndex > 0) {
        targetName = targetSelect.options[targetSelect.selectedIndex].text;
      }

      const htInput = document.getElementById('transferHienTrangInput');
      const dxInput = document.getElementById('transferDeXuatInput');
      const hienTrangVal = htInput ? htInput.value.trim() : '';
      const deXuatVal = dxInput ? dxInput.value.trim() : '';

      const allStations = getAllCompanyStations();
      const sourceSt = allStations.find(s => String(s.station_id) === String(stationId)) || {
        station_id: stationId,
        station_name: 'Trạm ' + stationId,
        area: 'Vũng Tàu',
        loss_str: ''
      };

      let addedCount = 0;

      checkedCheckboxes.forEach(cb => {
        const khId = cb.value;
        const slKwh = parseFloat(cb.getAttribute('data-sl')) || 0;
        const khTen = cb.getAttribute('data-ten') || khId;
        const khDiaChi = cb.getAttribute('data-diachi') || '';
        const khPha = cb.getAttribute('data-pha') || '1';

        const existingIdx = state.queue.findIndex(q => q.kh_id === khId || q.id === khId);
        const queueItem = {
          id: 'kh_' + khId + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          kh_id: khId,
          kh_name: khTen,
          kh_address: khDiaChi,
          sl_kwh: slKwh,
          so_pha: khPha,
          source_id: sourceSt.station_id,
          source_name: sourceSt.station_name,
          source_loss: sourceSt.loss_str,
          target_id: targetId || 'TBD',
          target_name: targetName,
          area: getStationArea(sourceSt),
          month: state.selectedMonth,
          status: 'pending',
          note: hienTrangVal || 'Đề xuất chuyển ranh trạm cấp điện',
          proposal: deXuatVal || (targetId ? `Chuyển về trạm [${targetId}] ${targetName}` : 'Chuyển về đúng ranh thực tế'),
          added_at: new Date().toISOString().split('T')[0],
          rollover: false
        };

        if (existingIdx >= 0) {
          state.queue[existingIdx] = queueItem;
        } else {
          state.queue.push(queueItem);
        }
        addedCount++;
      });

      saveQueue();
      updateQueueBadge();
      renderQueueTable();

      showToast(`Đã lưu thành công ${addedCount} khách hàng đề xuất chuyển trạm vào Hàng Chờ!`, 'success');

      // Chuyển sang Tab Hàng Chờ để xem kết quả
      setTimeout(() => {
        switchTab('tab-queue');
      }, 500);
    },

    saveQueueRow: function (id) {
      const item = state.queue.find(q => q.id === id);
      if (!item) return;

      const htEl = document.getElementById(`queue_ht_${id}`);
      const dxEl = document.getElementById(`queue_dx_${id}`);
      const stEl = document.getElementById(`queue_status_${id}`);

      if (htEl) item.note = htEl.value.trim();
      if (dxEl) item.proposal = dxEl.value.trim();
      if (stEl) item.status = stEl.value;

      saveQueue();
      renderQueueTable();
      showToast(`Đã lưu thành công hiện trạng & đề xuất cho khách hàng [${item.kh_id || item.id}]!`, 'success');
    },

    goToFieldInspection: function (stationId) {
      switchTab('tab-dinhky');
      setTimeout(() => {
        window.AppController.onSelectProposedStation(stationId, true);
        const targetCb = document.getElementById(`cb_station_${stationId}`);
        if (targetCb) {
          targetCb.checked = true;
          targetCb.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
    },

    updateQueueStatus: function (stationId, newStatus) {
      const item = state.queue.find(q => q.id === stationId);
      if (item) {
        item.status = newStatus;
        saveQueue();
        renderQueueTable();
        showToast(`Đã cập nhật trạng thái`, 'success');
      }
    },

    updateQueueNote: function (stationId, noteVal) {
      const item = state.queue.find(q => q.id === stationId);
      if (item) {
        item.note = noteVal;
        saveQueue();
      }
    },

    updateQueueProposal: function (stationId, proposalVal) {
      const item = state.queue.find(q => q.id === stationId);
      if (item) {
        item.proposal = proposalVal;
        saveQueue();
      }
    },

    removeFromQueue: function (stationId) {
      state.queue = state.queue.filter(q => q.id !== stationId);
      saveQueue();
      renderDashboard();
      renderTabDinhKy();
      renderQueueTable();
      showToast(`Đã xóa khỏi hàng chờ`, 'info');
    },

    onToggleKhCheckbox: function (checkbox) {
      const khId = checkbox.value;
      if (checkbox.checked) {
        state.simulation.selectedKhIds.add(khId);
      } else {
        state.simulation.selectedKhIds.delete(khId);
      }
      runSimulation();
    },

    applySimulationToQueue: function () {
      if (!state.simulation.result) return;
      const res = state.simulation.result;
      const proposalText = `Chuyển ${res.movedCount} khách hàng (${window.CalcEngine.formatVnNumber(res.transferKwh, 0)} kWh) sang trạm [${res.target.id}] ${res.target.name}. Dự kiến TTĐN trạm nguồn: ${window.CalcEngine.formatPercent(res.source.lossOld)} ➔ ${window.CalcEngine.formatPercent(res.source.lossNew)}.`;
      const noteText = res.effectSummary || 'Mô phỏng sang tải lưới hạ áp';

      const customersMap = window.APP_DATA?.customers_by_station || {};
      const srcCustomers = customersMap[res.source.id] || [];
      const movedKhs = srcCustomers.filter(k => state.simulation.selectedKhIds.has(k.ma_kh));

      if (movedKhs.length > 0) {
        movedKhs.forEach(kh => {
          state.queue.push({
            id: 'kh_' + kh.ma_kh + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            kh_id: kh.ma_kh,
            kh_name: kh.ten_kh,
            kh_address: kh.dia_chi || '',
            sl_kwh: kh.sl_t08 || 0,
            so_pha: kh.so_pha || 1,
            source_id: res.source.id,
            source_name: res.source.name,
            source_loss: window.CalcEngine.formatPercent(res.source.lossOld),
            target_id: res.target.id,
            target_name: res.target.name,
            area: getStationArea(res.source),
            month: state.selectedMonth,
            status: 'pending',
            note: noteText,
            proposal: proposalText,
            added_at: new Date().toISOString().split('T')[0],
            rollover: false
          });
        });
      } else {
        state.queue.push({
          id: 'sim_' + res.source.id + '_' + Date.now(),
          kh_id: res.source.id,
          kh_name: res.source.name,
          kh_address: 'Phương án sang tải trạm',
          sl_kwh: res.transferKwh,
          source_id: res.source.id,
          source_name: res.source.name,
          source_loss: window.CalcEngine.formatPercent(res.source.lossOld),
          target_id: res.target.id,
          target_name: res.target.name,
          area: getStationArea(res.source),
          month: state.selectedMonth,
          status: 'pending',
          note: noteText,
          proposal: proposalText,
          added_at: new Date().toISOString().split('T')[0],
          rollover: false
        });
      }

      saveQueue();
      renderDashboard();
      renderTabDinhKy();
      renderQueueTable();
      showToast('Đã lưu phương án sang tải vào hàng chờ kiểm tra!', 'success');
      setTimeout(() => switchTab('tab-queue'), 500);
    },

    openStationDetail: function (stationId) {
      const customersMap = window.APP_DATA?.customers_by_station || {};
      const customers = customersMap[stationId] || [];
      const master = window.APP_DATA?.master_stations?.[stationId] || {};

      const modalTitle = document.getElementById('modalStationTitle');
      const modalBody = document.getElementById('modalStationBody');
      const modal = document.getElementById('stationDetailModal');

      if (!modal) return;

      const stName = master.new_name || master.old_name || ('Trạm ' + stationId);
      if (modalTitle) modalTitle.textContent = `Chi Tiết Trạm [${stationId}] - ${stName}`;

      if (modalBody) {
        modalBody.innerHTML = `
          <div style="display: flex; gap: 16px; margin-bottom: 16px; background: #f8fafc; padding: 12px; border-radius: 8px; flex-wrap: wrap;">
            <div><strong>Mã trạm:</strong> <code>${stationId}</code></div>
            <div><strong>Khu vực:</strong> ${getStationArea(master)}</div>
            <div><strong>Loại:</strong> ${master.type || 'Công cộng'}</div>
            <div><strong>Số khách hàng:</strong> <span style="font-weight: 700; color: var(--evn-blue);">${customers.length}</span></div>
          </div>
          <h4 style="margin-bottom: 10px; color: var(--evn-navy);">Danh Sách Khách Hàng Thuộc Trạm Đi Kiểm Tra Hiện Trường (${customers.length} KH)</h4>
          <div class="table-responsive-wrapper" style="max-height: 460px; overflow-y: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 45px;">STT</th>
                  <th>Mã KH</th>
                  <th>Tên Khách Hàng</th>
                  <th>Địa Chỉ</th>
                  <th>Mã Sổ GCS</th>
                  <th>Lộ Trình</th>
                  <th>Mã KV</th>
                  <th>Pha</th>
                  <th>Mã ĐĐO</th>
                  <th>Sản Lượng T8</th>
                </tr>
              </thead>
              <tbody>
                ${customers.length === 0 ? '<tr><td colspan="10" style="text-align: center; padding: 20px; color: #94a3b8;">Chưa có dữ liệu chi tiết khách hàng của trạm này trong danh sách nạp trước.</td></tr>' : 
                  customers.map((c, i) => `
                    <tr>
                      <td>${i + 1}</td>
                      <td><code style="font-weight: 700; color: var(--evn-blue);">${c.ma_kh}</code></td>
                      <td><strong>${escapeHtml(c.ten_kh)}</strong></td>
                      <td><span style="font-size: 11.5px; color: #64748b;">${escapeHtml(c.dia_chi || '')}</span></td>
                      <td><span class="station-id-tag">${escapeHtml(c.ma_sogcs || '-')}</span></td>
                      <td>${escapeHtml(c.lo_trinh || '-')}</td>
                      <td>${escapeHtml(c.ma_kvuc || '-')}</td>
                      <td>${c.so_pha || 1}P</td>
                      <td>${c.ma_ddo || '-'}</td>
                      <td style="font-weight: 700; color: #0056b3;">${window.CalcEngine.formatVnNumber(c.sl_t08, 0)} kWh</td>
                    </tr>
                  `).join('')
                }
              </tbody>
            </table>
          </div>
        `;
      }

      modal.classList.add('show');
    },

    closeModal: function (modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('show');
    },

    exportQueueToCSV: function () {
      if (state.queue.length === 0) {
        showToast('Hàng chờ trống, không có dữ liệu xuất!', 'warning');
        return;
      }
      let csvContent = "\uFEFFSTT,MÃ KH,TÊN KHÁCH HÀNG,ĐỊA CHỈ,SẢN LƯỢNG T8 (kWh),MÃ TRẠM NGUỒN,TÊN TRẠM NGUỒN,TTĐN NGUỒN,MÃ TRẠM ĐÍCH,TÊN TRẠM ĐÍCH,KHU VỰC,HIỆN TRẠNG LƯỚI ĐIỆN,ĐỀ XUẤT XỬ LÝ,TRẠNG THÁI,KỲ KIỂM TRA\n";
      state.queue.forEach((item, idx) => {
        const row = [
          idx + 1,
          `"${item.kh_id || item.id}"`,
          `"${(item.kh_name || item.station_name || '').replace(/"/g, '""')}"`,
          `"${(item.kh_address || '').replace(/"/g, '""')}"`,
          item.sl_kwh || 0,
          `"${item.source_id || ''}"`,
          `"${(item.source_name || '').replace(/"/g, '""')}"`,
          `"${item.source_loss || ''}"`,
          `"${item.target_id || ''}"`,
          `"${(item.target_name || '').replace(/"/g, '""')}"`,
          `"${item.area || ''}"`,
          `"${(item.note || '').replace(/"/g, '""')}"`,
          `"${(item.proposal || '').replace(/"/g, '""')}"`,
          `"${item.status || 'pending'}"`,
          `"${item.month || state.selectedMonth}"`
        ];
        csvContent += row.join(',') + "\n";
      });
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `de_xuat_chuyen_tram_pcvt_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast('Đã xuất file CSV đề xuất chuyển trạm thành công!', 'success');
    },

    printQueue: function () {
      window.print();
    },

    onDashboardFilterChange: function () {
      resetAndRenderDashboardTable();
    },

    onDashboardSearchInput: function (val) {
      state.dashboardSearchQuery = val;
      resetAndRenderDashboardTable();
    },

    onInsertSourceStationChange: function (val) {
      handleInsertSourceStationChange(val);
    },

    insertStationToQueue: function () {
      executeInsertStationToQueue();
    },

    filterQueueTable: function (query) {
      state.queueSearchQuery = query;
      renderQueueTable();
    },

    filterQueueStatus: function (status) {
      state.queueStatusFilter = status;
      renderQueueTable();
    },

    syncQueueWithGoogleSheet: async function () {
      showToast('Đang kết nối Google Sheets để tải dữ liệu hàng chờ mới nhất...', 'info');
      try {
        if (!window.GoogleSheetsSync || typeof window.GoogleSheetsSync.fetchQueueFromGoogleSheet !== 'function') {
          showToast('Mô-đun đồng bộ Google Sheets chưa sẵn sàng!', 'warning');
          return;
        }
        const remoteItems = await window.GoogleSheetsSync.fetchQueueFromGoogleSheet();
        if (remoteItems && remoteItems.length > 0) {
          const localMap = new Map(state.queue.map(item => [item.kh_id || item.id, item]));
          let newCount = 0;
          let updateCount = 0;
          remoteItems.forEach(ri => {
            const key = ri.kh_id || ri.id;
            if (localMap.has(key)) {
              const existing = localMap.get(key);
              if (ri.note && !existing.note) existing.note = ri.note;
              if (ri.proposal && !existing.proposal) existing.proposal = ri.proposal;
              if (ri.status) existing.status = ri.status;
              updateCount++;
            } else {
              state.queue.push(ri);
              localMap.set(key, ri);
              newCount++;
            }
          });
          saveQueue(false);
          renderQueueTable();
          updateQueueBadge();
          showToast(`Đã đồng bộ từ Google Sheet: +${newCount} khách hàng mới, cập nhật ${updateCount} bản ghi!`, 'success');
        } else {
          showToast('Sheet hàng chờ trên Google Sheets hiện chưa có dữ liệu hoặc đang trống (gid=71925172).', 'info');
        }
      } catch (err) {
        console.error('Lỗi đồng bộ hàng chờ:', err);
        showToast('Không thể kết nối đến Google Sheets hàng chờ. Vui lòng kiểm tra quyền chia sẻ sheet!', 'danger');
      }
    },

    copyQueueForGoogleSheet: function () {
      window.AppController.openGoogleSheetsSyncModal();
    },

    openGoogleSheetsSyncModal: function () {
      const countEl = document.getElementById('modalQueueItemCount');
      if (countEl) countEl.textContent = state.queue.length;

      const webhookInput = document.getElementById('modalWebhookUrlInput');
      if (webhookInput) {
        webhookInput.value = localStorage.getItem('evn_pcvt_queue_webhook_url') || localStorage.getItem('evn_hang_cho_webhook_url') || '';
      }

      const modal = document.getElementById('googleSheetsSyncModal');
      if (modal) modal.classList.add('show');
    },

    executeCopyAndOpenSheet: function () {
      if (state.queue.length === 0) {
        showToast('Hàng chờ hiện đang trống! Hãy chọn khách hàng tại tab Nghiệp Vụ Hiện Trường trước.', 'warning');
        return;
      }
      const tsv = window.GoogleSheetsSync.generateQueueTSV(state.queue);
      const sheetUrl = window.GoogleSheetsSync.getQueueSheetUrl();
      copyTextToClipboard(tsv, 'Đã sao chép bảng hàng chờ! Hãy nhấn phím Ctrl + V tại ô A1 của Sheet vừa mở.');
      setTimeout(() => {
        window.open(sheetUrl, '_blank');
      }, 350);
      window.AppController.closeModal('googleSheetsSyncModal');
    },

    copyAppsScriptCode: function () {
      if (window.GoogleSheetsSync && typeof window.GoogleSheetsSync.getAppsScriptCode === 'function') {
        const code = window.GoogleSheetsSync.getAppsScriptCode();
        copyTextToClipboard(code, 'Đã sao chép mã Google Apps Script! Hãy dán vào Tiện ích mở rộng > Apps Script trên Google Sheet.');
      }
    },

    saveAndPushWebhook: async function (url) {
      if (!url || !url.trim()) {
        showToast('Vui lòng dán link Web App (https://script.google.com/...)!', 'warning');
        return;
      }
      const cleanUrl = url.trim();
      localStorage.setItem('evn_pcvt_queue_webhook_url', cleanUrl);
      localStorage.setItem('evn_hang_cho_webhook_url', cleanUrl);

      showToast('Đang kết nối Webhook để ghi dữ liệu hàng chờ lên Google Sheet...', 'info');
      try {
        const res = await window.GoogleSheetsSync.pushQueueToAppsScript(state.queue);
        showToast(res.message || 'Đã gửi toàn bộ dữ liệu hàng chờ lên Google Sheet thành công!', 'success');
        window.AppController.closeModal('googleSheetsSyncModal');
      } catch (err) {
        showToast('Lỗi khi gửi dữ liệu lên Webhook: ' + err.message, 'danger');
      }
    },

    triggerSaveToGoogleSheet: function () {
      const webhookUrl = localStorage.getItem('evn_pcvt_queue_webhook_url') || localStorage.getItem('evn_hang_cho_webhook_url');
      if (webhookUrl) {
        showToast('Đang ghi dữ liệu lên Google Sheet qua Webhook...', 'info');
        window.GoogleSheetsSync.pushQueueToAppsScript(state.queue).then(res => {
          showToast(res.message || 'Đã cập nhật dữ liệu hàng chờ lên Google Sheet thành công!', 'success');
        });
      } else {
        window.AppController.openGoogleSheetsSyncModal();
      }
    },

    openQueueGoogleSheet: function () {
      if (window.GoogleSheetsSync && typeof window.GoogleSheetsSync.getQueueSheetUrl === 'function') {
        window.open(window.GoogleSheetsSync.getQueueSheetUrl(), '_blank');
      } else {
        window.open('https://docs.google.com/spreadsheets/d/1LOCwMLQJj5VkCz7uvxnPSbExVd359_FkzlcLEZM57lU/edit?gid=71925172#gid=71925172', '_blank');
      }
    },

    saveWebhookUrl: function (url) {
      if (url && url.trim()) {
        localStorage.setItem('evn_pcvt_queue_webhook_url', url.trim());
        localStorage.setItem('evn_hang_cho_webhook_url', url.trim());
        showToast('Đã lưu URL Webhook Google Apps Script! Từ bây giờ dữ liệu hàng chờ sẽ tự động đồng bộ lên Google Sheet.', 'success');
      } else {
        localStorage.removeItem('evn_pcvt_queue_webhook_url');
        localStorage.removeItem('evn_hang_cho_webhook_url');
        showToast('Đã xóa cấu hình Webhook URL.', 'info');
      }
    }
  };

})();
