/**
 * =========================================================================================
 * GOOGLE APPS SCRIPT - THU THẬP GIS HẠ THẾ PC VŨNG TÀU (PCVT)
 * File: Code.gs
 * Mục đích: API Backend đồng bộ 3 Sheet dữ liệu tương ứng 3 Phòng/Đội
 * Spreadsheet URL: https://docs.google.com/spreadsheets/d/1uXozLAoqevpVxiqbHnfaM6BsSHASoSatp3aDwpo9_e4/edit?gid=0#gid=0
 * =========================================================================================
 * 
 * HƯỚNG DẪN CẤU HÌNH MÃ PIN TRONG SCRIPT PROPERTIES:
 * 1. Trên giao diện Apps Script, bấm vào biểu tượng "Bánh răng" (Project Settings / Cài đặt dự án) ở menu bên trái.
 * 2. Cuộn xuống mục "Script Properties" (Thuộc tính tập lệnh).
 * 3. Bấm "Add script property" (Thêm thuộc tính tập lệnh):
 *    - Property: PIN_CODE
 *    - Value: 1111 (hoặc mã PIN quản lý tùy ý bạn muốn đặt)
 * 4. Bấm "Save script properties" (Lưu thuộc tính tập lệnh).
 *    * Nếu chưa đặt trong Script Properties, hệ thống sẽ mặc định dùng mã PIN là: 1111
 * =========================================================================================
 */

const SPREADSHEET_ID = "1uXozLAoqevpVxiqbHnfaM6BsSHASoSatp3aDwpo9_e4";
const SHEET_LOG_NAME = "Nhật ký";   // Sheet ghi nhật ký thao tác
const DEFAULT_PIN = "1111";

// Cấu hình 3 phòng / đội tương ứng 3 sheet dữ liệu trong Google Sheet
const TEAM_CONFIG = [
  { 
    key: 'kinh_doanh', 
    name: 'Phòng Kinh Doanh', 
    sheetName: 'Kinh doanh',
    keywords: ['kinh doanh', 'kinhdoanh', 'pkd', 'kd', 'phong kinh doanh'] 
  },
  { 
    key: 'do_dem', 
    name: 'Đội Quản lý hệ thống đo đếm', 
    sheetName: 'Đội Quản lý HTĐĐ',
    keywords: ['doi quan ly htdd', 'htdd', 'do dem', 'dodem', 'he thong do dem', 'dd'] 
  },
  { 
    key: 'thu_ghi', 
    name: 'Đội quản lý thu ghi', 
    sheetName: 'Đội Quản lý Thu Ghi',
    keywords: ['doi quan ly thu ghi', 'thu ghi', 'thughi', 'qltg', 'tg'] 
  }
];

/**
 * Lấy đối tượng Spreadsheet
 */
function getSpreadsheet() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {
    // Không phải container-bound
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * Lấy mã PIN từ Script Properties hoặc giá trị mặc định
 */
function getSystemPin() {
  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const pin = scriptProps.getProperty("PIN_CODE");
    if (pin && pin.trim() !== "") {
      return pin.trim();
    }
  } catch (e) {
    Logger.log("Lỗi đọc PIN từ Script Properties: " + e.message);
  }
  return DEFAULT_PIN;
}

/**
 * Chuẩn hóa chuỗi để so sánh (bỏ dấu tiếng Việt, chữ thường, bỏ khoảng trắng thừa)
 */
function normalizeStr(str) {
  if (str === null || str === undefined) return "";
  return str.toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Tự động ánh xạ 3 sheet dữ liệu tương ứng 3 phòng/đội
 */
function getTeamSheetMapping(ss) {
  const allSheets = ss.getSheets().filter(s => s.getName() !== SHEET_LOG_NAME);
  const mapping = {};
  const usedSheetNames = new Set();

  // 1. Kiểm tra chính xác theo tên sheet đã định nghĩa
  TEAM_CONFIG.forEach(t => {
    if (t.sheetName) {
      const exactSheet = ss.getSheetByName(t.sheetName);
      if (exactSheet) {
        mapping[t.key] = exactSheet;
        usedSheetNames.add(exactSheet.getName());
      }
    }
  });

  // 2. Tìm theo từ khóa nếu tên sheet có biến thể
  TEAM_CONFIG.forEach(t => {
    if (mapping[t.key]) return;
    for (let i = 0; i < allSheets.length; i++) {
      const s = allSheets[i];
      if (usedSheetNames.has(s.getName())) continue;
      const norm = normalizeStr(s.getName());
      const matched = t.keywords.some(kw => norm.includes(normalizeStr(kw)));
      if (matched) {
        mapping[t.key] = s;
        usedSheetNames.add(s.getName());
        break;
      }
    }
  });

  // 3. Nếu tên Sheet không chứa từ khóa, gán theo thứ tự các sheet còn lại
  const remainingSheets = allSheets.filter(s => !usedSheetNames.has(s.getName()));
  let remIdx = 0;
  TEAM_CONFIG.forEach(t => {
    if (!mapping[t.key] && remIdx < remainingSheets.length) {
      mapping[t.key] = remainingSheets[remIdx];
      remIdx++;
    }
  });

  return mapping;
}

/**
 * Xác định vị trí các cột theo tên tiêu đề (Dòng 1)
 * Tự động tạo thêm cột phụ nếu chưa có: "Khóa", "Người nhập", "Thời gian nhập"
 */
function getColumnMapping(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  
  const map = {
    stt: -1,
    ma_tram: -1,
    id_tram_moi: -1,
    ten_tram_moi: -1,
    tong: -1,
    so_luong_hoan_thanh: -1,
    xoa: -1,
    trang_thai: -1,
    ngay_hoan_thanh: -1,
    khu_vuc: -1,
    khoa: -1,
    so_lan_sua: -1,
    nguoi_nhap: -1,
    thoi_gian_nhap: -1
  };

  headers.forEach((h, idx) => {
    const norm = normalizeStr(h);
    if (!norm) return;

    if (norm === "stt" || norm === "sothutu") map.stt = idx + 1;
    else if (norm === "matram" || norm === "matrambienap") map.ma_tram = idx + 1;
    else if (norm.includes("idtrammoi") || norm === "idtram") map.id_tram_moi = idx + 1;
    else if (norm.includes("tentram") || norm.includes("trentram")) map.ten_tram_moi = idx + 1;
    else if (norm === "tong" || norm === "tongso") map.tong = idx + 1;
    else if (norm.includes("soluonghoanthanh") || norm === "slhoanthanh") map.so_luong_hoan_thanh = idx + 1;
    else if (norm === "xoa" || norm === "daxoa") map.xoa = idx + 1;
    else if (norm === "trangthai" || norm === "tinhtrang") map.trang_thai = idx + 1;
    else if (norm.includes("ngayhoanthanh") || norm.includes("ngayht")) map.ngay_hoan_thanh = idx + 1;
    else if (norm.includes("khuvuc") || norm.includes("donvi") || norm.includes("doi")) map.khu_vuc = idx + 1;
    else if (norm === "khoa" || norm === "dakhoa" || norm === "islocked") map.khoa = idx + 1;
    else if (norm.includes("solansua") || norm.includes("solanedit") || norm === "sua") map.so_lan_sua = idx + 1;
    else if (norm.includes("nguoinhap") || norm.includes("nguoithuchien")) map.nguoi_nhap = idx + 1;
    else if (norm.includes("thoigiannhap") || norm.includes("thoigiancapnhat")) map.thoi_gian_nhap = idx + 1;
  });

  // Tự động thêm cột phụ vào cuối bảng nếu chưa có
  let currentMaxCol = sheet.getLastColumn();
  const missingCols = [];
  if (map.khoa === -1) missingCols.push({ key: "khoa", title: "Khóa" });
  if (map.so_lan_sua === -1) missingCols.push({ key: "so_lan_sua", title: "Số lần sửa" });
  if (map.nguoi_nhap === -1) missingCols.push({ key: "nguoi_nhap", title: "Người nhập" });
  if (map.thoi_gian_nhap === -1) missingCols.push({ key: "thoi_gian_nhap", title: "Thời gian nhập" });

  if (missingCols.length > 0) {
    missingCols.forEach(col => {
      currentMaxCol++;
      sheet.getRange(1, currentMaxCol).setValue(col.title);
      sheet.getRange(1, currentMaxCol).setFontWeight("bold");
      map[col.key] = currentMaxCol;
    });
  }

  return map;
}

/**
 * Đảm bảo Sheet "Nhật ký" tồn tại với đúng cấu trúc
 */
function getOrCreateLogSheet(ss) {
  let logSheet = ss.getSheetByName(SHEET_LOG_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(SHEET_LOG_NAME);
    const headers = [
      "Thời gian",
      "Phòng / Đội",
      "Mã trạm",
      "Hành động",
      "Giá trị cũ",
      "Giá trị mới",
      "Người thực hiện"
    ];
    logSheet.appendRow(headers);
    const headerRange = logSheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#005baa");
    headerRange.setFontColor("#ffffff");
    logSheet.setFrozenRows(1);
    for (let c = 1; c <= headers.length; c++) {
      logSheet.setColumnWidth(c, 160);
    }
    logSheet.setColumnWidth(5, 250);
    logSheet.setColumnWidth(6, 250);
  }
  return logSheet;
}

/**
 * Ghi nhật ký thao tác
 */
function logAction(ss, teamName, maTram, hanhDong, giaTriCu, giaTriMoi, nguoiThucHien) {
  try {
    const logSheet = getOrCreateLogSheet(ss);
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+7", "dd/MM/yyyy HH:mm:ss");
    logSheet.appendRow([
      timestamp,
      teamName || "",
      maTram || "",
      hanhDong || "",
      typeof giaTriCu === "object" ? JSON.stringify(giaTriCu) : (giaTriCu || ""),
      typeof giaTriMoi === "object" ? JSON.stringify(giaTriMoi) : (giaTriMoi || ""),
      nguoiThucHien || "Hệ thống"
    ]);
  } catch (e) {
    Logger.log("Lỗi ghi nhật ký: " + e.message);
  }
}

/**
 * Định dạng ngày về dd/MM/yyyy
 */
function formatDateVN(val) {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return Utilities.formatDate(val, Session.getScriptTimeZone() || "GMT+7", "dd/MM/yyyy");
  }
  const str = String(val).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${d}/${m}/${y}`;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
    const parts = str.split('-');
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${d}/${m}/${y}`;
  }
  return str;
}

/**
 * Chuẩn hóa số nguyên không âm
 */
function parseNonNegativeInt(val) {
  if (val === null || val === undefined || val === "") return 0;
  const num = parseInt(val, 10);
  return isNaN(num) || num < 0 ? 0 : num;
}

/**
 * Lấy toàn bộ dữ liệu từ cả 3 Sheet tương ứng 3 phòng/đội
 */
function getAllData() {
  const ss = getSpreadsheet();
  const teamMapping = getTeamSheetMapping(ss);
  const allStations = [];
  const teamStats = {};
  const duplicateStations = [];
  const duplicateCheck = {};

  TEAM_CONFIG.forEach(t => {
    const sheet = teamMapping[t.key];
    if (!sheet) {
      teamStats[t.key] = {
        key: t.key,
        name: t.name,
        sheetName: "",
        totalStations: 0,
        totalVolume: 0,
        completedVolume: 0,
        deletedVolume: 0,
        remainingVolume: 0,
        progressPercent: 0
      };
      return;
    }

    const sheetName = sheet.getName();
    const map = getColumnMapping(sheet);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    let teamStations = [];
    let totalVolume = 0;
    let completedVolume = 0;
    let deletedVolume = 0;

    if (lastRow > 1) {
      const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rowIndex = i + 2;

        const maTramRaw = map.ma_tram > 0 ? String(row[map.ma_tram - 1] || "").trim() : "";
        if (!maTramRaw) continue;

        // Kiểm tra trùng trong cùng sheet
        const dupeKey = `${sheetName}_${maTramRaw}`;
        if (duplicateCheck[dupeKey]) {
          duplicateStations.push(`[${t.name} - ${maTramRaw}]`);
        } else {
          duplicateCheck[dupeKey] = true;
        }

        const idTramMoi = map.id_tram_moi > 0 ? String(row[map.id_tram_moi - 1] || "").trim() : "";
        const tenTramMoi = map.ten_tram_moi > 0 ? String(row[map.ten_tram_moi - 1] || "").trim() : "";
        const tong = map.tong > 0 ? parseNonNegativeInt(row[map.tong - 1]) : 0;
        const soLuongHoanThanh = map.so_luong_hoan_thanh > 0 ? parseNonNegativeInt(row[map.so_luong_hoan_thanh - 1]) : 0;
        const xoa = map.xoa > 0 ? parseNonNegativeInt(row[map.xoa - 1]) : 0;
        const trangThaiRaw = map.trang_thai > 0 ? String(row[map.trang_thai - 1] || "").trim() : "";
        const trangThai = trangThaiRaw === "Hoàn thành" ? "Hoàn thành" : "Chưa hoàn thành";
        const ngayHoanThanh = map.ngay_hoan_thanh > 0 ? formatDateVN(row[map.ngay_hoan_thanh - 1]) : "";
        const khuVuc = map.khu_vuc > 0 ? String(row[map.khu_vuc - 1] || "").trim() : t.name;

        let isLocked = false;
        if (map.khoa > 0) {
          const lockVal = row[map.khoa - 1];
          isLocked = lockVal === true || String(lockVal).toUpperCase() === "TRUE";
        }

        const soLanSua = map.so_lan_sua > 0 ? parseNonNegativeInt(row[map.so_lan_sua - 1]) : 0;
        const nguoiNhap = map.nguoi_nhap > 0 ? String(row[map.nguoi_nhap - 1] || "").trim() : "";
        const thoiGianNhap = map.thoi_gian_nhap > 0 ? formatDateVN(row[map.thoi_gian_nhap - 1]) : "";
        const conLai = tong - soLuongHoanThanh - xoa;

        totalVolume += tong;
        completedVolume += soLuongHoanThanh;
        deletedVolume += xoa;

        const stObj = {
          teamKey: t.key,
          teamName: t.name,
          sheetName: sheetName,
          rowIndex: rowIndex,
          stt: map.stt > 0 ? row[map.stt - 1] : (i + 1),
          ma_tram: maTramRaw,
          id_tram_moi: idTramMoi,
          ten_tram_moi: tenTramMoi,
          tong: tong,
          so_luong_hoan_thanh: soLuongHoanThanh,
          xoa: xoa,
          con_lai: conLai,
          trang_thai: trangThai,
          ngay_hoan_thanh: ngayHoanThanh,
          khu_vuc: khuVuc,
          is_locked: isLocked,
          so_lan_sua: soLanSua,
          nguoi_nhap: nguoiNhap,
          thoi_gian_nhap: thoiGianNhap
        };

        allStations.push(stObj);
        teamStations.push(stObj);
      }
    }

    const remainingVolume = totalVolume - completedVolume - deletedVolume;
    teamStats[t.key] = {
      key: t.key,
      name: t.name,
      sheetName: sheetName,
      totalStations: teamStations.length,
      totalVolume: totalVolume,
      completedVolume: completedVolume,
      deletedVolume: deletedVolume,
      remainingVolume: remainingVolume,
      progressPercent: totalVolume > 0 ? Math.round((completedVolume / totalVolume) * 1000) / 10 : 0
    };
  });

  return {
    success: true,
    stations: allStations,
    teamStats: teamStats,
    duplicates: duplicateStations,
    lastUpdated: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+7", "dd/MM/yyyy HH:mm:ss")
  };
}

/**
 * Tìm dòng theo MA_TRAM trong một sheet cụ thể
 */
function findRowByMaTram(sheet, map, maTram) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { found: false, count: 0, rows: [] };

  const values = sheet.getRange(2, map.ma_tram, lastRow - 1, 1).getValues();
  const target = String(maTram).trim();
  const matchedRows = [];

  for (let i = 0; i < values.length; i++) {
    const val = String(values[i][0]).trim();
    if (val === target) {
      matchedRows.push(i + 2);
    }
  }

  return {
    found: matchedRows.length > 0,
    count: matchedRows.length,
    rows: matchedRows,
    rowIndex: matchedRows.length === 1 ? matchedRows[0] : -1
  };
}

/**
 * Tìm Sheet và Dòng chính xác của trạm
 */
function findTargetSheetAndRow(ss, maTram, targetSheetName, targetTeamKey) {
  let targetSheet = null;
  if (targetSheetName) {
    targetSheet = ss.getSheetByName(targetSheetName);
  }
  if (!targetSheet && targetTeamKey) {
    const teamMapping = getTeamSheetMapping(ss);
    targetSheet = teamMapping[targetTeamKey];
  }

  if (targetSheet) {
    const map = getColumnMapping(targetSheet);
    const searchRes = findRowByMaTram(targetSheet, map, maTram);
    if (searchRes.found) {
      return { sheet: targetSheet, map: map, searchResult: searchRes };
    }
  }

  // Nếu chưa thấy, tìm lần lượt trên cả 3 sheet của 3 đội
  const teamMapping = getTeamSheetMapping(ss);
  for (let key in teamMapping) {
    const s = teamMapping[key];
    if (!s) continue;
    const map = getColumnMapping(s);
    const searchRes = findRowByMaTram(s, map, maTram);
    if (searchRes.found) {
      return { sheet: s, map: map, searchResult: searchRes };
    }
  }

  return { sheet: null, map: null, searchResult: { found: false, count: 0, rows: [] } };
}

/**
 * Xử lý lưu số liệu trạm vào đúng Sheet của phòng/đội đó
 */
function handleSaveStation(payload) {
  const lock = LockService.getScriptLock();
  try {
    const hasLock = lock.tryLock(30000);
    if (!hasLock) {
      return { success: false, message: "Hệ thống đang bận. Vui lòng thử lại sau vài giây!" };
    }

    const maTram = String(payload.ma_tram || "").trim();
    if (!maTram) {
      return { success: false, message: "Mã trạm không hợp lệ hoặc để trống!" };
    }

    const ss = getSpreadsheet();
    const { sheet, map, searchResult } = findTargetSheetAndRow(ss, maTram, payload.sheet_name, payload.team_key);

    if (!sheet || !searchResult.found) {
      return { success: false, message: `Không tìm thấy trạm [${maTram}] trong Sheet dữ liệu của đội!` };
    }

    if (searchResult.count > 1) {
      return {
        success: false,
        message: `Cảnh báo: Mã trạm [${maTram}] bị trùng lặp ${searchResult.count} dòng trong Sheet [${sheet.getName()}]. Hệ thống đã chặn ghi để tránh sai lệch dữ liệu!`
      };
    }

    const rowIndex = searchResult.rowIndex;

    // Kiểm tra khóa
    // Kiểm tra khóa & giới hạn số lần sửa
    let currentLocked = false;
    if (map.khoa > 0) {
      const lockVal = sheet.getRange(rowIndex, map.khoa).getValue();
      currentLocked = lockVal === true || String(lockVal).toUpperCase() === "TRUE";
    }

    let currentSoLanSua = map.so_lan_sua > 0 ? parseNonNegativeInt(sheet.getRange(rowIndex, map.so_lan_sua).getValue()) : 0;
    const isEditAction = currentLocked || payload.is_unlock_verified;

    if (isEditAction && currentSoLanSua >= 3) {
      return {
        success: false,
        message: `Trạm [${maTram}] đã sửa đủ 3 lần (tối đa 3 lần)! Hệ thống KHÔNG CHO PHÉP sửa thêm.`
      };
    }

    if (currentLocked && !payload.is_unlock_verified) {
      return {
        success: false,
        isLocked: true,
        message: `Trạm [${maTram}] hiện ĐANG BỊ KHÓA. Bạn cần bấm nút "Yêu cầu sửa" và nhập mã PIN để mở khóa trước khi sửa!`
      };
    }

    // Đọc dữ liệu cũ
    const oldSlHoanThanh = map.so_luong_hoan_thanh > 0 ? parseNonNegativeInt(sheet.getRange(rowIndex, map.so_luong_hoan_thanh).getValue()) : 0;
    const oldXoa = map.xoa > 0 ? parseNonNegativeInt(sheet.getRange(rowIndex, map.xoa).getValue()) : 0;
    const oldTrangThai = map.trang_thai > 0 ? String(sheet.getRange(rowIndex, map.trang_thai).getValue() || "").trim() : "";
    const oldNgayHT = map.ngay_hoan_thanh > 0 ? formatDateVN(sheet.getRange(rowIndex, map.ngay_hoan_thanh).getValue()) : "";

    const oldValues = {
      so_luong_hoan_thanh: oldSlHoanThanh,
      xoa: oldXoa,
      trang_thai: oldTrangThai,
      ngay_hoan_thanh: oldNgayHT
    };

    const newSlHoanThanh = parseNonNegativeInt(payload.so_luong_hoan_thanh);
    const newXoa = parseNonNegativeInt(payload.xoa);
    const newTrangThai = payload.trang_thai === "Hoàn thành" ? "Hoàn thành" : "Chưa hoàn thành";
    let newNgayHT = formatDateVN(payload.ngay_hoan_thanh);

    if (newTrangThai === "Hoàn thành" && !newNgayHT) {
      return { success: false, message: "Khi chọn trạng thái 'Hoàn thành', bắt buộc phải nhập Ngày hoàn thành!" };
    }

    const nguoiNhap = String(payload.nguoi_nhap || "").trim();
    if (!nguoiNhap) {
      return { success: false, message: `Vui lòng nhập tên 'Người nhập' trên dòng trạm [${maTram}] trước khi lưu!` };
    }
    const thoiGianNhap = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+7", "dd/MM/yyyy HH:mm:ss");

    // Cập nhật số lần sửa nếu là thao tác sửa
    if (isEditAction) {
      currentSoLanSua += 1;
      if (map.so_lan_sua > 0) sheet.getRange(rowIndex, map.so_lan_sua).setValue(currentSoLanSua);
    }

    // Cập nhật vào Sheet
    if (map.so_luong_hoan_thanh > 0) sheet.getRange(rowIndex, map.so_luong_hoan_thanh).setValue(newSlHoanThanh);
    if (map.xoa > 0) sheet.getRange(rowIndex, map.xoa).setValue(newXoa);
    if (map.trang_thai > 0) sheet.getRange(rowIndex, map.trang_thai).setValue(newTrangThai);
    if (map.ngay_hoan_thanh > 0) sheet.getRange(rowIndex, map.ngay_hoan_thanh).setNumberFormat("@").setValue(newNgayHT);
    
    // Tự động khóa dòng lại sau khi lưu
    if (map.khoa > 0) sheet.getRange(rowIndex, map.khoa).setValue(true);
    if (map.nguoi_nhap > 0) sheet.getRange(rowIndex, map.nguoi_nhap).setValue(nguoiNhap);
    if (map.thoi_gian_nhap > 0) sheet.getRange(rowIndex, map.thoi_gian_nhap).setValue(thoiGianNhap);

    const newValues = {
      so_luong_hoan_thanh: newSlHoanThanh,
      xoa: newXoa,
      trang_thai: newTrangThai,
      ngay_hoan_thanh: newNgayHT
    };

    const actionName = isEditAction ? `Sửa (Lần ${currentSoLanSua}/3)` : "Lưu";
    logAction(ss, sheet.getName(), maTram, actionName, oldValues, newValues, nguoiNhap);

    const tong = map.tong > 0 ? parseNonNegativeInt(sheet.getRange(rowIndex, map.tong).getValue()) : 0;
    const conLai = tong - newSlHoanThanh - newXoa;

    return {
      success: true,
      message: isEditAction
        ? `Đã lưu chỉnh sửa trạm [${maTram}] (Lần sửa ${currentSoLanSua}/3) vào Sheet [${sheet.getName()}]! Dòng này hiện đã được KHÓA tự động.`
        : `Đã lưu thành công số liệu trạm [${maTram}] vào Sheet [${sheet.getName()}]! Dòng này hiện đã được KHÓA tự động.`,
      updatedStation: {
        sheetName: sheet.getName(),
        rowIndex: rowIndex,
        ma_tram: maTram,
        tong: tong,
        so_luong_hoan_thanh: newSlHoanThanh,
        xoa: newXoa,
        con_lai: conLai,
        trang_thai: newTrangThai,
        ngay_hoan_thanh: newNgayHT,
        is_locked: true,
        so_lan_sua: currentSoLanSua,
        nguoi_nhap: nguoiNhap,
        thoi_gian_nhap: thoiGianNhap
      }
    };
  } catch (error) {
    Logger.log("Lỗi trong handleSaveStation: " + error.message);
    return { success: false, message: "Lỗi hệ thống khi lưu: " + error.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Xử lý mở khóa trạm (Yêu cầu mã PIN 1111, tối đa không quá 3 lần sửa)
 */
function handleUnlockStation(payload) {
  const lock = LockService.getScriptLock();
  try {
    const hasLock = lock.tryLock(30000);
    if (!hasLock) {
      return { success: false, message: "Hệ thống đang bận. Vui lòng thử lại sau vài giây!" };
    }

    const maTram = String(payload.ma_tram || "").trim();
    const inputPin = String(payload.pin || "").trim();
    const clientData = payload.current_client_data || {};
    const nguoiNhap = String(payload.nguoi_nhap || "").trim() || "Cán bộ hiện trường";

    const systemPin = getSystemPin();
    if (inputPin !== systemPin) {
      return {
        success: false,
        message: "Mã PIN xác nhận không đúng! Vui lòng nhập mã PIN chính xác (Mặc định: 1111)."
      };
    }

    const ss = getSpreadsheet();
    const { sheet, map, searchResult } = findTargetSheetAndRow(ss, maTram, payload.sheet_name, payload.team_key);

    if (!sheet || !searchResult.found) {
      return { success: false, message: `Không tìm thấy trạm [${maTram}] trong Sheet!` };
    }

    if (searchResult.count > 1) {
      return {
        success: false,
        message: `Mã trạm [${maTram}] bị trùng lặp ${searchResult.count} dòng trong Sheet [${sheet.getName()}]! Không thể mở khóa.`
      };
    }

    const rowIndex = searchResult.rowIndex;

    // KIỂM TRA GIỚI HẠN TỐI ĐA 3 LẦN SỬA
    const currentSoLanSua = map.so_lan_sua > 0 ? parseNonNegativeInt(sheet.getRange(rowIndex, map.so_lan_sua).getValue()) : 0;
    if (currentSoLanSua >= 3) {
      return {
        success: false,
        message: `Trạm [${maTram}] đã sửa đủ 3 lần (giới hạn tối đa 3 lần)! Hệ thống KHÔNG CHO PHÉP sửa thêm.`
      };
    }

    const sheetSlHoanThanh = map.so_luong_hoan_thanh > 0 ? parseNonNegativeInt(sheet.getRange(rowIndex, map.so_luong_hoan_thanh).getValue()) : 0;
    const sheetXoa = map.xoa > 0 ? parseNonNegativeInt(sheet.getRange(rowIndex, map.xoa).getValue()) : 0;
    const sheetTrangThai = map.trang_thai > 0 ? String(sheet.getRange(rowIndex, map.trang_thai).getValue() || "").trim() : "";
    const sheetNgayHT = map.ngay_hoan_thanh > 0 ? formatDateVN(sheet.getRange(rowIndex, map.ngay_hoan_thanh).getValue()) : "";

    const clientSlHoanThanh = parseNonNegativeInt(clientData.so_luong_hoan_thanh);
    const clientXoa = parseNonNegativeInt(clientData.xoa);
    const clientTrangThai = String(clientData.trang_thai || "").trim();
    const clientNgayHT = formatDateVN(clientData.ngay_hoan_thanh);

    const isMatch = (sheetSlHoanThanh === clientSlHoanThanh) &&
                    (sheetXoa === clientXoa) &&
                    (sheetTrangThai === clientTrangThai) &&
                    (sheetNgayHT === clientNgayHT);

    if (!isMatch) {
      return {
        success: false,
        needReload: true,
        message: "Số liệu đang hiển thị trên máy của bạn KHÁC với số liệu thực tế trong Google Sheet (có thể ai đó vừa cập nhật). Vui lòng bấm 'Tải lại dữ liệu' trước khi yêu cầu sửa!",
        serverData: {
          so_luong_hoan_thanh: sheetSlHoanThanh,
          xoa: sheetXoa,
          trang_thai: sheetTrangThai,
          ngay_hoan_thanh: sheetNgayHT
        }
      };
    }

    // Mở khóa trên Sheet
    if (map.khoa > 0) {
      sheet.getRange(rowIndex, map.khoa).setValue(false);
    }

    logAction(
      ss,
      sheet.getName(),
      maTram,
      `Yêu cầu sửa / Mở khóa PIN (Lần ${currentSoLanSua + 1}/3)`,
      {
        so_luong_hoan_thanh: sheetSlHoanThanh,
        xoa: sheetXoa,
        trang_thai: sheetTrangThai,
        ngay_hoan_thanh: sheetNgayHT
      },
      `Đã xác thực PIN thành công, mở khóa cho phép sửa lần ${currentSoLanSua + 1}/3`,
      nguoiNhap
    );

    return {
      success: true,
      message: `Xác nhận PIN thành công! Đã mở khóa trạm [${maTram}] cho phép sửa (Lần ${currentSoLanSua + 1}/3). Sau khi bấm LƯU, dòng sẽ tự động khóa lại.`,
      is_unlocked: true,
      ma_tram: maTram,
      so_lan_sua: currentSoLanSua,
      sheet_name: sheet.getName()
    };
  } catch (error) {
    Logger.log("Lỗi trong handleUnlockStation: " + error.message);
    return { success: false, message: "Lỗi hệ thống khi mở khóa: " + error.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Xử lý HTTP GET
 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "getData";
  let responseData;

  try {
    if (action === "getData") {
      responseData = getAllData();
    } else if (action === "ping") {
      responseData = { success: true, message: "Apps Script API đang hoạt động tốt!", timestamp: new Date().toISOString() };
    } else {
      responseData = { success: false, message: "Hành động (action) không được hỗ trợ!" };
    }
  } catch (err) {
    responseData = { success: false, message: "Lỗi xử lý GET: " + err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(responseData))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Xử lý HTTP POST
 */
function doPost(e) {
  let responseData;
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (jsonErr) {
        payload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action;

    if (action === "getData") {
      responseData = getAllData();
    } else if (action === "saveStation") {
      responseData = handleSaveStation(payload);
    } else if (action === "unlockStation") {
      responseData = handleUnlockStation(payload);
    } else {
      responseData = { success: false, message: `Hành động không xác định: [${action}]` };
    }
  } catch (err) {
    responseData = { success: false, message: "Lỗi xử lý POST: " + err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(responseData))
    .setMimeType(ContentService.MimeType.JSON);
}
