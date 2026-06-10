/* ============================================================
 * mockdata.js — 模拟运营数据生成
 * 生成 6 个城市 × 28 天的日级经营数据（确定性随机，刷新结果一致）。
 * 数据中预埋了业务剧情，便于演示异常检测 / 指标拆解：
 *   - 杭州：最近一周转化率与活跃用户明显下滑 → GMV / 订单异常
 *   - 成都：最近一周补贴成本大幅上升 → 利润异常
 *   - 深圳：增长良好（正向对照）
 * ============================================================ */

(function (global) {
  "use strict";

  // 简单可复现的伪随机数（mulberry32）
  function seededRandom(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var DAYS = 28;                       // 共 28 天：前 21 天 + 最近 7 天
  var END_DATE = "2026-06-09";         // 数据截止日期

  // 城市基础盘子与剧情参数
  var CITIES = [
    { name: "北京", au: 52000, conv: 3.4, aov: 86, subRate: 0.060, trend: 0.04,
      lastWeek: {} },
    { name: "上海", au: 56000, conv: 3.6, aov: 92, subRate: 0.058, trend: 0.01,
      lastWeek: {} },
    { name: "深圳", au: 43000, conv: 3.8, aov: 78, subRate: 0.062, trend: 0.06,
      lastWeek: { au: 1.03, conv: 1.02 } },                  // 正向：增长标杆
    { name: "杭州", au: 30000, conv: 3.5, aov: 74, subRate: 0.065, trend: 0.02,
      lastWeek: { au: 0.91, conv: 0.82 } },                  // 异常：转化掉、活跃掉
    { name: "成都", au: 27000, conv: 3.2, aov: 62, subRate: 0.060, trend: 0.03,
      lastWeek: { subRate: 1.55, aov: 0.97 } },              // 异常：补贴飙升吃掉利润
    { name: "武汉", au: 18000, conv: 3.0, aov: 58, subRate: 0.055, trend: -0.02,
      lastWeek: { au: 0.97 } }
  ];

  var TAKE_RATE = 0.17;  // 平台货币化率，用于推算利润：利润 = GMV × 货币化率 − 补贴成本

  function fmtDate(d) {
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  // 生成全部模拟数据行
  function generateMockData() {
    var rows = [];
    var end = new Date(END_DATE + "T00:00:00");

    CITIES.forEach(function (city, ci) {
      var rand = seededRandom(20260609 + ci * 97);

      for (var i = DAYS - 1; i >= 0; i--) {
        var d = new Date(end);
        d.setDate(end.getDate() - i);
        var dayIdx = DAYS - 1 - i;          // 0..27
        var isLastWeek = i < 7;             // 最近 7 天应用剧情参数
        var weekday = d.getDay();
        var weekendBoost = (weekday === 0 || weekday === 6) ? 1.12 : 1.0;

        // 整体缓慢趋势 + 周末效应 + 噪声
        var progress = dayIdx / (DAYS - 1);
        var trendFactor = 1 + city.trend * progress;
        var noise = function (amp) { return 1 + (rand() - 0.5) * amp; };

        var lw = isLastWeek ? city.lastWeek : {};
        var au = city.au * trendFactor * weekendBoost * noise(0.08) * (lw.au || 1);
        var conv = city.conv * noise(0.06) * (lw.conv || 1);
        var aov = city.aov * noise(0.05) * (lw.aov || 1);
        var subRate = city.subRate * noise(0.10) * (lw.subRate || 1);

        var activeUsers = Math.round(au);
        var orders = Math.round(activeUsers * conv / 100);
        var gmv = Math.round(orders * aov);
        var newUsers = Math.round(activeUsers * 0.045 * noise(0.20) * (lw.au || 1));
        var subsidy = Math.round(gmv * subRate);
        var profit = Math.round(gmv * TAKE_RATE - subsidy);

        rows.push({
          date: fmtDate(d),
          city: city.name,
          gmv: gmv,
          orders: orders,
          activeUsers: activeUsers,
          newUsers: newUsers,
          convRate: +(orders / activeUsers * 100).toFixed(2), // 百分数，如 3.42
          aov: +(gmv / orders).toFixed(2),
          subsidyCost: subsidy,
          profit: profit
        });
      }
    });

    rows.sort(function (a, b) {
      return a.date === b.date ? a.city.localeCompare(b.city, "zh") : (a.date < b.date ? -1 : 1);
    });
    return rows;
  }

  // 导出为 CSV 文本（含中文表头，可直接再次上传验证解析）
  function rowsToCSV(rows) {
    var header = "日期,城市,GMV,订单量,活跃用户,新增用户,用户转化率,平均客单价,营销补贴成本,利润";
    var lines = rows.map(function (r) {
      return [r.date, r.city, r.gmv, r.orders, r.activeUsers, r.newUsers,
              r.convRate + "%", r.aov, r.subsidyCost, r.profit].join(",");
    });
    return header + "\n" + lines.join("\n");
  }

  var api = { generateMockData: generateMockData, rowsToCSV: rowsToCSV };

  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node（生成示例 CSV 用）
  else global.MockData = api;                                               // 浏览器

})(typeof window !== "undefined" ? window : globalThis);
