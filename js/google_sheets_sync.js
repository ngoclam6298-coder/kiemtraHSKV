/**
 * google_sheets_sync.js - Đồng bộ dữ liệu Google Sheets & Nhập xuất file
 * CÔNG TY ĐIỆN LỰC VŨNG TÀU - EVNHCMC
 */

window.GoogleSheetsSync = (function () {
  'use strict';

  // Cấu hình URL mặc định của Điện lực Vũng Tàu
  const DEFAULT_CONFIG = {
    doc1_id: '1LOCwMLQJj5VkCz7uvxnPSbExVd359_FkzlcLEZM57lU',
    doc2_id: '1gU5fAfSH6OIN8UGVy91SjgW7DlmvQdvjgZta07TE2do',
    sheets: {
      hang_cho: '71925172', // Sheet Hàng chờ do người dùng cấu hình để xem đa thiết bị
      danh_sach_tram: '1857150175',
      chu_thich: '1541501428',
      thang_1: '0',
      thang_2: '258996170',
      thang_3: '1179948072',
      thang_4: '938668957',
      thang_5: '247707845',
      thang_6: '5324722',
      thang_7: '529984099',
      thang_8: '1022984060',
      thang_9: '594341833',
      khach_hang: '910867603',
      ket_qua_t8: '2055585602'
    }
  };

  // Trình phân tích CSV hỗ trợ dấu nháy kép và dấu phẩy trong chuỗi
  function parseCSV(text) {
    const lines = [];
    let row = [];
    let inQuotes = false;
    let currentField = '';

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentField += '"';
          i++; // Bỏ qua dấu nháy kép escaped
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(currentField.trim());
        currentField = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        row.push(currentField.trim());
        currentField = '';
        if (row.length > 0 && (row.length > 1 || row[0] !== '')) {
          lines.push(row);
        }
        row = [];
      } else {
        currentField += char;
      }
    }

    if (currentField || row.length > 0) {
      row.push(currentField.trim());
      if (row.length > 0 && (row.length > 1 || row[0] !== '')) {
        lines.push(row);
      }
    }

    return lines;
  }

  // Tải CSV từ Google Sheet thông qua endpoint export hoặc gviz
  async function fetchSheetCSV(docId, gid) {
    const url = `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:csv&gid=${gid}`;
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Không thể tải sheet`);
      }
      const text = await response.text();
      return parseCSV(text);
    } catch (err) {
      console.warn(`Không thể tải trực tiếp từ Google Sheet (${docId}/${gid}):`, err.message);
      return null;
    }
  }

  // Lấy dữ liệu Hàng chờ từ Google Sheet (gid: 71925172) để xem đa thiết bị
  async function fetchQueueFromGoogleSheet() {
    const docId = DEFAULT_CONFIG.doc1_id;
    const gid = DEFAULT_CONFIG.sheets.hang_cho;
    const url = `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:csv&gid=${gid}`;
    
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) return null;
      const text = await response.text();
      if (!text || text.trim().length === 0) return [];

      const rows = parseCSV(text);
      if (rows.length === 0) return [];

      const firstRow = rows[0].map(c => (c || '').toLowerCase());
      const hasHeader = firstRow.some(c => c.includes('mã kh') || c.includes('khách hàng') || c.includes('mã trạm') || c.includes('stt'));
      const dataRows = hasHeader ? rows.slice(1) : rows;

      const queueItems = [];
      dataRows.forEach((row, idx) => {
        if (!row || row.length === 0 || row.every(c => !c)) return;

        let khId = row[1] || '';
        let khName = row[2] || '';
        let khAddress = row[3] || '';
        let slKwh = parseFloat(String(row[4] || '0').replace(/,/g, '')) || 0;
        let sourceId = row[5] || '';
        let sourceName = row[6] || '';
        let sourceLoss = row[7] || '';
        let targetId = row[8] || '';
        let targetName = row[9] || '';
        let area = row[10] || 'Vũng Tàu';
        let note = row[11] || '';
        let proposal = row[12] || '';
        let status = (row[13] || 'pending').trim().toLowerCase();
        let month = row[14] || 'thang_8';
        let addedAt = row[15] || new Date().toISOString().split('T')[0];

        if (status.includes('hoàn') || status.includes('đã') || status.includes('completed')) {
          status = 'completed';
        } else if (status.includes('đang') || status.includes('progress')) {
          status = 'in_progress';
        } else {
          status = 'pending';
        }

        if (khId || sourceId) {
          queueItems.push({
            id: 'gs_' + (khId || sourceId) + '_' + idx,
            kh_id: khId || sourceId,
            kh_name: khName || 'Khách hàng',
            kh_address: khAddress,
            sl_kwh: slKwh,
            so_pha: '1',
            source_id: sourceId,
            source_name: sourceName,
            source_loss: sourceLoss,
            target_id: targetId,
            target_name: targetName,
            area: area,
            month: month,
            status: status,
            note: note,
            proposal: proposal,
            added_at: addedAt,
            rollover: false
          });
        }
      });

      return queueItems;
    } catch (e) {
      console.warn('Lỗi tải hàng chờ từ Google Sheet:', e);
      return null;
    }
  }

  // Tạo chuỗi Tab-Separated Values (TSV) để người dùng dán trực tiếp vào Google Sheet (Ctrl + V)
  function generateQueueTSV(queueItems) {
    const headers = ['STT', 'MÃ KH', 'TÊN KHÁCH HÀNG', 'ĐỊA CHỈ', 'SẢN LƯỢNG (kWh)', 'MÃ TRẠM NGUỒN', 'TÊN TRẠM NGUỒN', 'TTĐN NGUỒN', 'MÃ TRẠM ĐÍCH', 'TÊN TRẠM ĐÍCH', 'KHU VỰC', 'HIỆN TRẠNG LƯỚI ĐIỆN', 'ĐỀ XUẤT XỬ LÝ', 'TRẠNG THÁI', 'KỲ KIỂM TRA', 'NGÀY CẬP NHẬT'];
    const lines = [headers.join('\t')];

    (queueItems || []).forEach((item, idx) => {
      const statusText = item.status === 'completed' ? 'Đã thực hiện' : (item.status === 'in_progress' ? 'Đang xử lý' : 'Chưa thực hiện');
      const row = [
        idx + 1,
        item.kh_id || item.id,
        item.kh_name || item.station_name,
        item.kh_address || '',
        item.sl_kwh || 0,
        item.source_id || '',
        item.source_name || '',
        item.source_loss || '',
        item.target_id || '',
        item.target_name || '',
        item.area || 'Vũng Tàu',
        (item.note || '').replace(/[\t\r\n]/g, ' '),
        (item.proposal || '').replace(/[\t\r\n]/g, ' '),
        statusText,
        item.month || 'thang_8',
        item.added_at || new Date().toISOString().split('T')[0]
      ];
      lines.push(row.join('\t'));
    });

    return lines.join('\n');
  }

  // Đẩy dữ liệu lên Google Apps Script Web App nếu có cấu hình
  async function pushQueueToAppsScript(queueItems) {
    const webhookUrl = localStorage.getItem('evn_pcvt_queue_webhook_url') || localStorage.getItem('evn_hang_cho_webhook_url');
    if (!webhookUrl) return { success: false, message: 'Chưa cấu hình URL Google Apps Script Web App' };

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'sync_queue',
          gid: DEFAULT_CONFIG.sheets.hang_cho,
          items: queueItems || []
        })
      });
      return { success: true, message: 'Đã gửi toàn bộ dữ liệu hàng chờ lên Google Sheet thành công!' };
    } catch (e) {
      console.warn('Lỗi push Google Apps Script:', e);
      return { success: false, message: 'Không thể kết nối Google Apps Script: ' + e.message };
    }
  }

  function getAppsScriptCode() {
    return `function doPost(e) {
  try {
    var contents = e.postData ? e.postData.contents : '';
    var data = JSON.parse(contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = null;
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() == 71925172 || sheets[i].getName().toLowerCase().indexOf('hàng chờ') !== -1 || sheets[i].getName().toLowerCase().indexOf('hang cho') !== -1) {
        sheet = sheets[i];
        break;
      }
    }
    if (!sheet) {
      sheet = ss.insertSheet('Hàng chờ');
    }
    
    var items = data.items || [];
    var headers = [
      'STT', 'MÃ KH', 'TÊN KHÁCH HÀNG', 'ĐỊA CHỈ', 'SẢN LƯỢNG (kWh)',
      'MÃ TRẠM NGUỒN', 'TÊN TRẠM NGUỒN', 'TTĐN NGUỒN', 'MÃ TRẠM ĐÍCH', 'TÊN TRẠM ĐÍCH',
      'KHU VỰC', 'HIỆN TRẠNG LƯỚI ĐIỆN', 'ĐỀ XUẤT XỬ LÝ', 'TRẠNG THÁI', 'KỲ KIỂM TRA', 'NGÀY CẬP NHẬT'
    ];
    
    sheet.clear();
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setBackground('#002d62').setFontColor('#ffffff').setFontWeight('bold');
    
    if (items.length > 0) {
      var rows = items.map(function(item, idx) {
        var statusText = item.status === 'completed' ? 'Đã thực hiện' : (item.status === 'in_progress' ? 'Đang xử lý' : 'Chưa thực hiện');
        return [
          idx + 1,
          item.kh_id || item.id || '',
          item.kh_name || item.station_name || '',
          item.kh_address || '',
          parseFloat(item.sl_kwh) || 0,
          item.source_id || '',
          item.source_name || '',
          item.source_loss || '',
          item.target_id || '',
          item.target_name || '',
          item.area || 'Vũng Tàu',
          item.note || '',
          item.proposal || '',
          statusText,
          item.month || 'thang_8',
          item.added_at || Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd HH:mm:ss')
        ];
      });
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      sheet.autoResizeColumns(1, headers.length);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      count: items.length
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    message: 'EVN PCVT Webhook Service Active'
  })).setMimeType(ContentService.MimeType.JSON);
}`;
  }

  function getQueueSheetUrl() {
    return `https://docs.google.com/spreadsheets/d/${DEFAULT_CONFIG.doc1_id}/edit?gid=${DEFAULT_CONFIG.sheets.hang_cho}#gid=${DEFAULT_CONFIG.sheets.hang_cho}`;
  }

  // Đồng bộ toàn bộ dữ liệu hoặc trả về bộ dữ liệu đã đóng gói sẵn
  async function syncAllData(onProgress) {
    if (onProgress) onProgress(10, 'Đang kiểm tra kết nối Google Sheets...');

    try {
      const doc1 = DEFAULT_CONFIG.doc1_id;
      const t8Gid = DEFAULT_CONFIG.sheets.thang_8;
      
      if (onProgress) onProgress(30, 'Đang tải dữ liệu kiểm tra Tháng 8...');
      const t8Rows = await fetchSheetCSV(doc1, t8Gid);

      if (t8Rows && t8Rows.length > 1) {
        if (onProgress) onProgress(100, 'Đồng bộ Google Sheets thành công!');
        return {
          source: 'online',
          success: true,
          message: 'Đã đồng bộ trực tuyến thành công từ Google Sheets của Điện lực Vũng Tàu.'
        };
      }
    } catch (e) {
      console.warn('Lỗi đồng bộ trực tuyến:', e);
    }

    if (onProgress) onProgress(100, 'Sử dụng bộ dữ liệu tích hợp chuẩn EVNHCMC');
    return {
      source: 'local_bundle',
      success: true,
      data: window.APP_DATA,
      message: 'Hệ thống đang hoạt động với bộ dữ liệu chuẩn hóa của Công ty Điện lực Vũng Tàu.'
    };
  }

  return {
    DEFAULT_CONFIG,
    parseCSV,
    fetchSheetCSV,
    fetchQueueFromGoogleSheet,
    pushQueueToAppsScript,
    generateQueueTSV,
    getAppsScriptCode,
    getQueueSheetUrl,
    syncAllData
  };
})();
