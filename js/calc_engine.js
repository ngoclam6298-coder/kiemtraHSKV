/**
 * calc_engine.js - Bộ máy tính toán kỹ thuật điện & mô phỏng sang tải
 * CÔNG TY ĐIỆN LỰC VŨNG TÀU - EVNHCMC
 */

window.CalcEngine = (function () {
  'use strict';

  // Chuẩn hóa chuỗi số Việt Nam: 1.234,56 hoặc -39.692,75 hoặc #DIV/0!
  function parseVnNumber(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    
    let str = String(val).trim();
    if (!str || str === '#DIV/0!' || str === '#N/A' || str === '-' || str === 'NaN') {
      return null;
    }
    // Bỏ ký tự %
    str = str.replace('%', '').trim();
    
    try {
      if (str.includes('.') && str.includes(',')) {
        str = str.replace(/\./g, '').replace(',', '.');
      } else if (str.includes(',')) {
        str = str.replace(',', '.');
      }
      const num = parseFloat(str);
      return isNaN(num) ? null : num;
    } catch (e) {
      return null;
    }
  }

  // Định dạng số hiển thị kiểu Việt Nam: 1.234,56
  function formatVnNumber(num, decimals = 2) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    const parts = Number(num).toFixed(decimals).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return parts.join(',');
  }

  // Định dạng tỷ lệ phần trăm
  function formatPercent(val) {
    if (val === null || val === undefined) return '#DIV/0!';
    const num = typeof val === 'number' ? val : parseVnNumber(val);
    if (num === null) return '#DIV/0!';
    return `${formatVnNumber(num, 2)}%`;
  }

  // Phân loại tổn thất theo quy chuẩn kỹ thuật Điện lực Vũng Tàu (Sheet Chú thích)
  function categorizeLoss(lossVal, lossStr = '') {
    if (lossStr === '#DIV/0!' || (lossVal === null && lossStr.includes('#'))) {
      return {
        cat: 'error',
        label: 'Mất đầu nguồn (#DIV/0!)',
        badgeClass: 'badge-status error',
        color: '#7c3aed',
        description: 'Mất tín hiệu đo đếm công tơ tổng hoặc đầu nguồn = 0'
      };
    }
    if (lossVal === null) {
      return {
        cat: 'unknown',
        label: 'Chưa có số liệu',
        badgeClass: 'badge-status',
        color: '#64748b',
        description: 'Chưa cập nhật số liệu tổn thất'
      };
    }
    if (lossVal < 0) {
      return {
        cat: 'negative',
        label: 'Tổn thất âm (< 0%) - Báo động đỏ',
        badgeClass: 'badge-status negative',
        color: '#dc2626',
        description: 'Thương phẩm > Đầu nguồn: Nghi ngờ đảo dây, nhầm trạm hoặc NLMT phát ngược'
      };
    }
    if (lossVal > 2.35) {
      return {
        cat: 'high',
        label: 'Tổn thất cao (> 2.35%)',
        badgeClass: 'badge-status high',
        color: '#d97706',
        description: 'Vượt quy chuẩn tổn thất kỹ thuật EVNHCMC (ngưỡng 2.35%)'
      };
    }
    return {
      cat: 'good',
      label: 'Tốt (0 - 2.35%)',
      badgeClass: 'badge-status good',
      color: '#059669',
      description: 'Tổn thất đạt chuẩn kỹ thuật'
    };
  }

  /**
   * Tính toán tỷ lệ tổn thất điện năng (TTĐN):
   * Tỷ lệ % = ((Đầu nguồn - Thương phẩm) / Đầu nguồn) * 100%
   */
  function calculateLossRate(dauNguon, thuongPham, solar = 0) {
    dauNguon = Number(dauNguon) || 0;
    thuongPham = Number(thuongPham) || 0;
    solar = Number(solar) || 0;

    // Nếu có điện mặt trời nhận từ khách hàng sau trạm: Tổng nguồn cấp = Đầu nguồn + NLMT
    const tongNguon = dauNguon + solar;
    if (tongNguon <= 0) {
      return null; // #DIV/0!
    }
    const deltaA = tongNguon - thuongPham;
    return (deltaA / tongNguon) * 100;
  }

  /**
   * Suy diễn điện năng đầu nguồn từ Thương Phẩm và Tỉ lệ TTĐN cũ:
   * Nếu TTĐN% = (ĐN - TP) / ĐN * 100 => 1 - (TTĐN%/100) = TP / ĐN
   * => ĐN = TP / (1 - TTĐN%/100)
   */
  function inferDauNguon(thuongPham, lossRate, solar = 0) {
    thuongPham = Number(thuongPham) || 0;
    solar = Number(solar) || 0;
    if (lossRate === null || isNaN(lossRate)) {
      // Giả định tổn thất 3% nếu không có số liệu
      return thuongPham * 1.03;
    }
    const ratio = 1 - (lossRate / 100);
    if (ratio === 0) return thuongPham;
    const dauNguon = (thuongPham / ratio) - solar;
    return Math.max(0, dauNguon);
  }

  /**
   * Mô phỏng Sang Tải Khách Hàng (Load Transfer Simulator)
   * @param {Object} sourceStation - Thông tin trạm nguồn (A)
   * @param {Object} targetStation - Thông tin trạm đích (B)
   * @param {Array} movedCustomers - Danh sách các khách hàng chuyển tải
   */
  function simulateLoadTransfer(sourceStation, targetStation, movedCustomers = []) {
    // 1. Tổng sản lượng khách hàng chuyển (kWh)
    const transferKwh = movedCustomers.reduce((sum, kh) => {
      const sl = parseVnNumber(kh.sl_t08) || 0;
      return sum + sl;
    }, 0);

    const movedCount = movedCustomers.length;

    // 2. Thông số trạm nguồn cũ từ dữ liệu thực
    const srcId = sourceStation.station_id || sourceStation.ma_tram;
    const customersMap = window.APP_DATA?.customers_by_station || {};
    const srcKhList = customersMap[srcId] || [];
    const srcKhSum = srcKhList.reduce((acc, c) => acc + (parseVnNumber(c.sl_t08) || 0), 0);
    const srcTPOld = Number(sourceStation.commercial_kwh) || srcKhSum || 0;
    const srcLossOld = parseVnNumber(sourceStation.loss_val) ?? parseVnNumber(sourceStation.loss_str);
    const srcSolar = Number(sourceStation.solar_kwh) || 0;
    const srcDauNguon = inferDauNguon(srcTPOld, srcLossOld, srcSolar);

    // 3. Thông số trạm đích cũ từ dữ liệu thực
    const tgtId = targetStation.station_id || targetStation.ma_tram;
    const tgtKhList = customersMap[tgtId] || [];
    const tgtKhSum = tgtKhList.reduce((acc, c) => acc + (parseVnNumber(c.sl_t08) || 0), 0);
    const tgtTPOld = Number(targetStation.commercial_kwh) || tgtKhSum || 0;
    const tgtLossOld = parseVnNumber(targetStation.loss_val) ?? parseVnNumber(targetStation.loss_str) ?? 2.1;
    const tgtSolar = Number(targetStation.solar_kwh) || 0;
    const tgtDauNguon = inferDauNguon(tgtTPOld, tgtLossOld, tgtSolar);

    // 4. Tính toán sau khi chuyển tải:
    // Trạm nguồn giảm thương phẩm (hoặc khách hàng sai ranh trạm được tách đi)
    const srcTPNew = Math.max(0, srcTPOld - transferKwh);
    const srcLossNew = calculateLossRate(srcDauNguon, srcTPNew, srcSolar);

    // Trạm đích tăng thương phẩm
    const tgtTPNew = tgtTPOld + transferKwh;
    const tgtLossNew = calculateLossRate(tgtDauNguon, tgtTPNew, tgtSolar);

    // 5. Đánh giá hiệu quả sang tải
    const srcCategoryOld = categorizeLoss(srcLossOld);
    const srcCategoryNew = categorizeLoss(srcLossNew);
    const tgtCategoryOld = categorizeLoss(tgtLossOld);
    const tgtCategoryNew = categorizeLoss(tgtLossNew);

    let isEffective = false;
    let effectSummary = '';

    if (srcLossOld !== null && srcLossOld < 0 && srcLossNew !== null && srcLossNew >= 0) {
      isEffective = true;
      effectSummary = 'Thành công vượt trội: Đã xử lý triệt để tổn thất âm trạm nguồn (chuyển từ âm sang dương an toàn).';
    } else if (srcLossOld !== null && srcLossNew !== null && srcLossNew > srcLossOld && srcLossOld < 0) {
      isEffective = true;
      effectSummary = 'Cải thiện tốt: Giảm mức độ tổn thất âm của trạm nguồn đáng kể.';
    } else {
      effectSummary = 'Phương án đã cân đối phụ tải giữa hai trạm liên kết.';
    }

    return {
      transferKwh,
      movedCount,
      source: {
        id: sourceStation.station_id || sourceStation.ma_tram,
        name: sourceStation.station_name || sourceStation.ten_tram,
        tpOld: srcTPOld,
        tpNew: srcTPNew,
        dauNguon: srcDauNguon,
        lossOld: srcLossOld,
        lossNew: srcLossNew,
        catOld: srcCategoryOld,
        catNew: srcCategoryNew,
        diffLoss: srcLossNew !== null && srcLossOld !== null ? (srcLossNew - srcLossOld) : null
      },
      target: {
        id: targetStation.station_id || targetStation.ma_tram,
        name: targetStation.station_name || targetStation.ten_tram,
        tpOld: tgtTPOld,
        tpNew: tgtTPNew,
        dauNguon: tgtDauNguon,
        lossOld: tgtLossOld,
        lossNew: tgtLossNew,
        catOld: tgtCategoryOld,
        catNew: tgtCategoryNew,
        diffLoss: tgtLossNew !== null && tgtLossOld !== null ? (tgtLossNew - tgtLossOld) : null
      },
      isEffective,
      effectSummary
    };
  }

  return {
    parseVnNumber,
    formatVnNumber,
    formatPercent,
    categorizeLoss,
    calculateLossRate,
    inferDauNguon,
    simulateLoadTransfer
  };
})();
