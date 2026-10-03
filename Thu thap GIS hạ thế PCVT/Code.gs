/**
 * =========================================================================================
 * GOOGLE APPS SCRIPT - THU THẬP GIS HẠ THẾ PC VŨNG TÀU (PCVT)
 * File: Code.gs
 * Mục đích: API Backend đồng bộ dữ liệu giữa Web App và Google Sheet
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

// ID của Google Sheet chính (nếu dùng Container-bound script gắn với Sheet thì tự nhận, hoặc fallback ID này)
const SPREADSHEET_ID = "1uXozLAoqevpVxiqbHnfaM6BsSHASoSatp3aDwpo9_e4";
const SHEET_DATA_NAME = "Sheet1"; // Tên sheet dữ liệu chính (tự động nhận sheet đầu tiên nếu không tìm thấy)
const SHEET_LOG_NAME = "Nhật ký";   // Sheet ghi nhật ký thao tác
const DEFAULT_PIN = "1111";

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
    else if (norm.includes("nguoinhap") || norm.includes("nguoithuchien")) map.nguoi_nhap = idx + 1;
    else if (norm.includes("thoigiannhap") || norm.includes("thoigiancapnhat")) map.thoi_gian_nhap = idx + 1;
  });

  // Tự động thêm cột phụ vào cuối bảng nếu chưa có
  let currentMaxCol = sheet.getLastColumn();
  const missingCols = [];
  if (map.khoa === -1) missingCols.push({ key: "khoa", title: "Khóa" });
  if (map.nguoi_nhap === -1) missingCols.push({ key: "nguoi_nhap", title: "Người nhập" });
  if (map.thoi_gian_nhap === -1) missingCols.push({ key: "thoi_gian_nhap", title: "Thời gian nhập" });

  if (missingCols.length > 0) {
    missingCols.forEach(col => {
      currentMaxCol++;
      sheet.getRange(1, currentMaxCol).setValue(col.title);
      // Format tiêu đề
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
    logSheet.setColumnWidth(4, 250);
    logSheet.setColumnWidth(5, 250);
  }
  return logSheet;
}

/**
 * Ghi nhật ký thao tác
 */
function logAction(ss, maTram, hanhDong, giaTriCu, giaTriMoi, nguoiThucHien) {
  try {
    const logSheet = getOrCreateLogSheet(ss);
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+7", "dd/MM/yyyy HH:mm:ss");
    logSheet.appendRow([
      timestamp,
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
  // Nếu đã là định dạng dd/mm/yyyy
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${d}/${m}/${y}`;
  }
  // Nếu là yyyy-mm-dd
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
 * Lấy toàn bộ dữ liệu từ Sheet
 */
function getAllData() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_DATA_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0]; // Lấy sheet đầu tiên nếu không thấy tên Sheet1
  }

  const map = getColumnMapping(sheet);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow <= 1) {
    return {
      success: true,
      stations: [],
      teams: [],
      summary: { totalStations: 0, totalVolume: 0, completedVolume: 0, deletedVolume: 0, remainingVolume: 0 },
      lastUpdated: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+7", "dd/MM/yyyy HH:mm:ss")
    };
  }

  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const stations = [];
  const teamSet = {};
  const duplicateCheck = {};
  const duplicateStations = [];

  let totalVolume = 0;
  let completedVolume = 0;
  let deletedVolume = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowIndex = i + 2;

    const maTramRaw = map.ma_tram > 0 ? String(row[map.ma_tram - 1] || "").trim() : "";
    if (!maTramRaw) continue; // Bỏ qua dòng không có Mã trạm

    // Kiểm tra trùng mã trạm
    if (duplicateCheck[maTramRaw]) {
      duplicateCheck[maTramRaw].push(rowIndex);
      duplicateStations.push(maTramRaw);
    } else {
      duplicateCheck[maTramRaw] = [rowIndex];
    }

    const idTramMoi = map.id_tram_moi > 0 ? String(row[map.id_tram_moi - 1] || "").trim() : "";
    const tenTramMoi = map.ten_tram_moi > 0 ? String(row[map.ten_tram_moi - 1] || "").trim() : "";
    const tong = map.tong > 0 ? parseNonNegativeInt(row[map.tong - 1]) : 0;
    const soLuongHoanThanh = map.so_luong_hoan_thanh > 0 ? parseNonNegativeInt(row[map.so_luong_hoan_thanh - 1]) : 0;
    const xoa = map.xoa > 0 ? parseNonNegativeInt(row[map.xoa - 1]) : 0;
    const trangThaiRaw = map.trang_thai > 0 ? String(row[map.trang_thai - 1] || "").trim() : "";
    const trangThai = trangThaiRaw === "Hoàn thành" ? "Hoàn thành" : "Chưa hoàn thành";
    const ngayHoanThanh = map.ngay_hoan_thanh > 0 ? formatDateVN(row[map.ngay_hoan_thanh - 1]) : "";
    const khuVuc = map.khu_vuc > 0 ? String(row[map.khu_vuc - 1] || "").trim() : "";
    
    // Khóa: TRUE/FALSE
    let isLocked = false;
    if (map.khoa > 0) {
      const lockVal = row[map.khoa - 1];
      isLocked = lockVal === true || String(lockVal).toUpperCase() === "TRUE";
    }

    const nguoiNhap = map.nguoi_nhap > 0 ? String(row[map.nguoi_nhap - 1] || "").trim() : "";
    const thoiGianNhap = map.thoi_gian_nhap > 0 ? formatDateVN(row[map.thoi_gian_nhap - 1]) : "";

    // Tính còn lại = Tổng - Hoàn thành - Xóa (cho phép âm)
    const conLai = tong - soLuongHoanThanh - xoa;

    totalVolume += tong;
    completedVolume += soLuongHoanThanh;
    deletedVolume += xoa;

    if (khuVuc) {
      teamSet[khuVuc] = (teamSet[khuVuc] || 0) + 1;
    }

    stations.push({
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
      nguoi_nhap: nguoiNhap,
      thoi_gian_nhap: thoiGianNhap
    });
  }

  const teams = Object.keys(teamSet);
  const remainingVolume = totalVolume - completedVolume - deletedVolume;

  return {
    success: true,
    sheetNames: ss.getSheets().map(s => s.getName()),
    stations: stations,
    teams: teams,
    duplicates: duplicateStations,
    summary: {
      totalStations: stations.length,
      totalVolume: totalVolume,
      completedVolume: completedVolume,
      deletedVolume: deletedVolume,
      remainingVolume: remainingVolume,
      progressPercent: totalVolume > 0 ? Math.round((completedVolume / totalVolume) * 1000) / 10 : 0
    },
    lastUpdated: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+7", "dd/MM/yyyy HH:mm:ss")
  };
}

/**
 * Tìm dòng theo MA_TRAM và kiểm tra trùng lặp
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
      matchedRows.push(i + 2); // Dòng thực tế trên Sheet (bắt đầu từ 2)
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
 * Xử lý lưu số liệu trạm (Chỉ cập nhật dòng, không thêm dòng mới)
 * Sau khi lưu thành công, dòng sẽ TỰ ĐỘNG BỊ KHÓA
 */
function handleSaveStation(payload) {
  const lock = LockService.getScriptLock();
  try {
    // Chờ tối đa 30 giây để tránh xung đột ghi đè
    const hasLock = lock.tryLock(30000);
    if (!hasLock) {
      return {
        success: false,
        message: "Hệ thống đang bận phục vụ yêu cầu khác. Vui lòng thử lại sau vài giây!"
      };
    }

    const maTram = String(payload.ma_tram || "").trim();
    if (!maTram) {
      return { success: false, message: "Mã trạm không hợp lệ hoặc để trống!" };
    }

    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_DATA_NAME);
    if (!sheet) sheet = ss.getSheets()[0];

    const map = getColumnMapping(sheet);

    // 1. Kiểm tra tìm dòng và chống ghi nhầm khi trùng MA_TRAM
    const searchResult = findRowByMaTram(sheet, map, maTram);
    if (!searchResult.found) {
      return { success: false, message: `Không tìm thấy trạm [${maTram}] trong Sheet. App chỉ cập nhật trạm có sẵn, không thêm mới!` };
    }
    if (searchResult.count > 1) {
      return {
        success: false,
        message: `Cảnh báo: Mã trạm [${maTram}] bị trùng lặp ${searchResult.count} dòng trên Sheet (dòng ${searchResult.rows.join(", ")}). Hệ thống đã chặn ghi để tránh sai lệch dữ liệu. Vui lòng liên hệ quản lý xử lý trùng lặp trên Google Sheet!`
      };
    }

    const rowIndex = searchResult.rowIndex;

    // 2. Kiểm tra trạng thái khóa ở phía SERVER
    let currentLocked = false;
    if (map.khoa > 0) {
      const lockVal = sheet.getRange(rowIndex, map.khoa).getValue();
      currentLocked = lockVal === true || String(lockVal).toUpperCase() === "TRUE";
    }

    // Nếu dòng đang bị khóa VÀ yêu cầu không có cờ bỏ qua mở khóa hợp lệ
    // Người dùng bắt buộc phải dùng tính năng "Yêu cầu sửa" (nhập PIN) trước
    if (currentLocked && !payload.is_unlock_verified) {
      return {
        success: false,
        isLocked: true,
        message: `Trạm [${maTram}] hiện ĐANG BỊ KHÓA. Bạn cần bấm nút "Yêu cầu sửa" và nhập đúng mã PIN quản lý để mở khóa trước khi sửa!`
      };
    }

    // 3. Đọc dữ liệu cũ để ghi nhật ký
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

    // 4. Kiểm tra dữ liệu hợp lệ phía server
    const newSlHoanThanh = parseNonNegativeInt(payload.so_luong_hoan_thanh);
    const newXoa = parseNonNegativeInt(payload.xoa);
    const newTrangThai = payload.trang_thai === "Hoàn thành" ? "Hoàn thành" : "Chưa hoàn thành";
    let newNgayHT = formatDateVN(payload.ngay_hoan_thanh);

    if (newTrangThai === "Hoàn thành" && !newNgayHT) {
      return { success: false, message: "Khi chọn trạng thái 'Hoàn thành', bắt buộc phải nhập Ngày hoàn thành!" };
    }

    const nguoiNhap = String(payload.nguoi_nhap || "").trim() || "Cán bộ hiện trường";
    const thoiGianNhap = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+7", "dd/MM/yyyy HH:mm:ss");

    // 5. Cập nhật 4 cột người dùng và 3 cột phụ vào Sheet
    if (map.so_luong_hoan_thanh > 0) sheet.getRange(rowIndex, map.so_luong_hoan_thanh).setValue(newSlHoanThanh);
    if (map.xoa > 0) sheet.getRange(rowIndex, map.xoa).setValue(newXoa);
    if (map.trang_thai > 0) sheet.getRange(rowIndex, map.trang_thai).setValue(newTrangThai);
    if (map.ngay_hoan_thanh > 0) {
      // Đặt giá trị chuỗi dd/mm/yyyy
      sheet.getRange(rowIndex, map.ngay_hoan_thanh).setValue(newNgayHT);
    }
    
    // TỰ ĐỘNG KHÓA DÒNG LẠI SAU KHI LƯU
    if (map.khoa > 0) sheet.getRange(rowIndex, map.khoa).setValue(true);
    if (map.nguoi_nhap > 0) sheet.getRange(rowIndex, map.nguoi_nhap).setValue(nguoiNhap);
    if (map.thoi_gian_nhap > 0) sheet.getRange(rowIndex, map.thoi_gian_nhap).setValue(thoiGianNhap);

    // 6. Ghi nhật ký
    const newValues = {
      so_luong_hoan_thanh: newSlHoanThanh,
      xoa: newXoa,
      trang_thai: newTrangThai,
      ngay_hoan_thanh: newNgayHT
    };

    const actionName = currentLocked || payload.is_unlock_verified ? "Sửa" : "Lưu";
    logAction(ss, maTram, actionName, oldValues, newValues, nguoiNhap);

    // Đọc lại tổng để tính còn lại
    const tong = map.tong > 0 ? parseNonNegativeInt(sheet.getRange(rowIndex, map.tong).getValue()) : 0;
    const conLai = tong - newSlHoanThanh - newXoa;

    return {
      success: true,
      message: `Đã lưu thành công số liệu trạm [${maTram}]! Dòng này hiện đã được KHÓA tự động.`,
      updatedStation: {
        rowIndex: rowIndex,
        ma_tram: maTram,
        tong: tong,
        so_luong_hoan_thanh: newSlHoanThanh,
        xoa: newXoa,
        con_lai: conLai,
        trang_thai: newTrangThai,
        ngay_hoan_thanh: newNgayHT,
        is_locked: true,
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
 * Xử lý yêu cầu mở khóa (Nhập mã PIN + Đối chiếu dữ liệu thực tế)
 * Cho phép mở khóa để sửa MỘT lần
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

    // 1. Kiểm tra mã PIN
    const systemPin = getSystemPin();
    if (inputPin !== systemPin) {
      return {
        success: false,
        message: "Mã PIN xác nhận không đúng! Vui lòng liên hệ người quản lý để được cấp mã PIN chính xác."
      };
    }

    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_DATA_NAME);
    if (!sheet) sheet = ss.getSheets()[0];

    const map = getColumnMapping(sheet);

    // 2. Tìm trạm và kiểm tra trùng lặp
    const searchResult = findRowByMaTram(sheet, map, maTram);
    if (!searchResult.found) {
      return { success: false, message: `Không tìm thấy trạm [${maTram}] trong Sheet!` };
    }
    if (searchResult.count > 1) {
      return {
        success: false,
        message: `Mã trạm [${maTram}] bị trùng lặp ${searchResult.count} dòng trên Sheet! Không thể mở khóa.`
      };
    }

    const rowIndex = searchResult.rowIndex;

    // 3. ĐỐI CHIẾU SỐ LIỆU ĐANG HIỂN THỊ TRÊN WEB VỚI SỐ LIỆU THỰC TẾ TRONG SHEET
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
        message: "Số liệu đang hiển thị trên máy của bạn KHÁC với số liệu thực tế trong Google Sheet (có thể ai đó vừa cập nhật từ thiết bị khác). Để tránh ghi đè số liệu cũ, vui lòng bấm 'Tải lại dữ liệu' trước khi yêu cầu sửa!",
        serverData: {
          so_luong_hoan_thanh: sheetSlHoanThanh,
          xoa: sheetXoa,
          trang_thai: sheetTrangThai,
          ngay_hoan_thanh: sheetNgayHT
        }
      };
    }

    // 4. Số liệu khớp và PIN đúng -> MỞ KHÓA TẠM THỜI TRÊN SHEET
    if (map.khoa > 0) {
      sheet.getRange(rowIndex, map.khoa).setValue(false);
    }

    // 5. Ghi nhật ký: Mở khóa
    logAction(
      ss,
      maTram,
      "Yêu cầu sửa / Mở khóa",
      {
        so_luong_hoan_thanh: sheetSlHoanThanh,
        xoa: sheetXoa,
        trang_thai: sheetTrangThai,
        ngay_hoan_thanh: sheetNgayHT
      },
      "Đã xác thực PIN thành công, mở khóa cho phép sửa 1 lần",
      nguoiNhap
    );

    return {
      success: true,
      message: `Xác nhận PIN thành công! Đã mở khóa trạm [${maTram}] cho phép sửa 01 lần. Sau khi bấm LƯU, dòng sẽ tự động khóa lại.`,
      is_unlocked: true,
      ma_tram: maTram
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
