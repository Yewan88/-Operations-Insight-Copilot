/* ============================================================
 * app.js — 页面交互与视图渲染
 * 模块导航 / 数据上传 / Dashboard / 指标拆解 / 异常诊断 / AI 报告
 * ============================================================ */

(function () {
  "use strict";

  var A = window.Analysis;
  var C = window.Charts;

  // 全局状态
  var state = {
    rows: [],
    source: "演示数据",
    tablePage: 1,
    tableCity: "all",
    dashCity: "all",
    decompCity: "all",
    pageSize: 10
  };

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  /* ---------------- 导航 ---------------- */

  var VIEW_TITLES = {
    upload: "运营数据上传与管理",
    dashboard: "核心经营指标 Dashboard",
    decompose: "业务指标拆解分析",
    anomaly: "异常数据监控与诊断",
    report: "AI 运营复盘报告",
    workflow: "AI Workflow · 提效场景"
  };

  function switchView(name) {
    $all(".nav-item").forEach(function (el) {
      el.classList.toggle("active", el.dataset.view === name);
    });
    $all(".view").forEach(function (el) {
      el.classList.toggle("active", el.id === "view-" + name);
    });
    $("#topbar-title").textContent = VIEW_TITLES[name] || "";
  }

  /* ---------------- 工具 ---------------- */

  function deltaBadge(v, opts) {
    opts = opts || {};
    if (v === null || v === undefined || isNaN(v)) return '<span class="delta flat">--</span>';
    var cls = Math.abs(v) < 0.05 ? "flat" : (v > 0 ? "up" : "down");
    if (opts.invert && cls !== "flat") cls = (cls === "up" ? "down" : "up"); // 成本类指标：涨=坏
    var arrow = v > 0 ? "▲" : (v < 0 ? "▼" : "");
    return '<span class="delta ' + cls + '">' + arrow + " " + Math.abs(v).toFixed(1) + "%</span>";
  }

  function cityOptions(rows, withAll) {
    var cities = A.uniqueCities(rows);
    var html = withAll ? '<option value="all">全部城市</option>' : "";
    cities.forEach(function (c) { html += '<option value="' + c + '">' + c + "</option>"; });
    return html;
  }

  function periodText(cmp) {
    if (!cmp) return "";
    var t = "本期 " + cmp.currRange[0] + " ~ " + cmp.currRange[1];
    if (cmp.prevRange) t += " ｜ 环比上期 " + cmp.prevRange[0] + " ~ " + cmp.prevRange[1];
    return t;
  }

  /* ---------------- 模块一：上传与数据表 ---------------- */

  function initUpload() {
    var zone = $("#upload-zone");
    var input = $("#file-input");

    zone.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      if (input.files.length) handleFile(input.files[0]);
      input.value = "";
    });
    ["dragover", "dragleave", "drop"].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.toggle("dragover", evt === "dragover");
        if (evt === "drop" && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
      });
    });

    $("#btn-load-demo").addEventListener("click", function () {
      loadData(window.MockData.generateMockData(), "演示数据");
      showUploadStatus("ok", "已加载内置演示数据（6 个城市 × 28 天，共 " + state.rows.length + " 行）");
    });

    $("#btn-download-sample").addEventListener("click", function () {
      var csv = window.MockData.rowsToCSV(window.MockData.generateMockData());
      var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "运营数据示例_sample_data.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $("#table-city-filter").addEventListener("change", function (e) {
      state.tableCity = e.target.value;
      state.tablePage = 1;
      renderTable();
    });
    $("#pager-prev").addEventListener("click", function () { state.tablePage--; renderTable(); });
    $("#pager-next").addEventListener("click", function () { state.tablePage++; renderTable(); });
  }

  function handleFile(file) {
    if (!/\.(csv|txt)$/i.test(file.name)) {
      showUploadStatus("err", "仅支持 CSV 文件，请重新选择");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var result = A.parseCSV(reader.result);
        loadData(result.rows, file.name);
        var msg = "解析成功：" + file.name + " ｜ 共 " + result.rows.length + " 行有效数据，覆盖 " +
          A.uniqueCities(result.rows).length + " 个城市、" + A.uniqueDates(result.rows).length + " 天";
        if (result.skipped) msg += "（跳过 " + result.skipped + " 行无效数据）";
        showUploadStatus("ok", msg);
      } catch (err) {
        showUploadStatus("err", "解析失败：" + err.message);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function showUploadStatus(type, msg) {
    var el = $("#upload-status");
    el.className = "upload-status " + type;
    el.textContent = (type === "ok" ? "✓ " : "✕ ") + msg;
  }

  function renderTable() {
    var rows = state.rows.filter(function (r) {
      return state.tableCity === "all" || r.city === state.tableCity;
    });
    // 表格按日期倒序展示，最新数据在前
    rows = rows.slice().sort(function (a, b) {
      return a.date === b.date ? a.city.localeCompare(b.city, "zh") : (a.date < b.date ? 1 : -1);
    });

    var totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    state.tablePage = Math.max(1, Math.min(state.tablePage, totalPages));
    var start = (state.tablePage - 1) * state.pageSize;
    var pageRows = rows.slice(start, start + state.pageSize);

    var body = pageRows.map(function (r) {
      return "<tr>" +
        "<td>" + r.date + "</td>" +
        "<td>" + r.city + "</td>" +
        '<td class="num">¥' + A.fmtNum(r.gmv) + "</td>" +
        '<td class="num">' + A.fmtNum(r.orders) + "</td>" +
        '<td class="num">' + A.fmtNum(r.activeUsers) + "</td>" +
        '<td class="num">' + A.fmtNum(r.newUsers) + "</td>" +
        '<td class="num">' + r.convRate.toFixed(2) + "%</td>" +
        '<td class="num">¥' + r.aov.toFixed(1) + "</td>" +
        '<td class="num">¥' + A.fmtNum(r.subsidyCost) + "</td>" +
        '<td class="num">¥' + A.fmtNum(r.profit) + "</td>" +
        "</tr>";
    }).join("");
    $("#data-table-body").innerHTML = body || '<tr><td colspan="10" class="empty-tip">暂无数据</td></tr>';

    $("#pager-info").textContent = "共 " + rows.length + " 行 ｜ 第 " + state.tablePage + " / " + totalPages + " 页";
    $("#pager-prev").disabled = state.tablePage <= 1;
    $("#pager-next").disabled = state.tablePage >= totalPages;
  }

  /* ---------------- 模块二：Dashboard ---------------- */

  function renderDashboard() {
    var cmp = A.periodCompare(state.rows, state.dashCity);
    if (!cmp) return;
    var c = cmp.curr, w = cmp.wow;

    $("#dash-period").textContent = periodText(cmp);

    var kpis = [
      { label: "GMV", value: A.fmtMoney(c.gmv), unit: "元", wow: w.gmv },
      { label: "订单量", value: A.fmtNum(c.orders), unit: "单", wow: w.orders },
      { label: "日均活跃用户", value: A.fmtNum(c.avgActiveUsers), unit: "人", wow: w.activeUsers },
      { label: "转化率", value: c.convRate.toFixed(2), unit: "%", wow: w.convRate },
      { label: "平均客单价", value: c.aov.toFixed(1), unit: "元", wow: w.aov },
      { label: "补贴成本", value: A.fmtMoney(c.subsidyCost), unit: "元", wow: w.subsidyCost, invert: true },
      { label: "利润", value: A.fmtMoney(c.profit), unit: "元", wow: w.profit },
      { label: "新增用户", value: A.fmtNum(c.newUsers), unit: "人", wow: w.newUsers }
    ];
    $("#kpi-grid").innerHTML = kpis.map(function (k) {
      return '<div class="kpi-card">' +
        '<div class="kpi-label"><span>' + k.label + "</span></div>" +
        '<div class="kpi-value">' + k.value + '<span class="kpi-unit">' + k.unit + "</span></div>" +
        '<div class="kpi-foot">' + deltaBadge(k.wow, { invert: k.invert }) + "<span>环比上期</span></div>" +
        "</div>";
    }).join("");

    // 趋势图（取全部天数）
    var days = cmp.days;
    var labels = days.map(function (d) { return d.date; });

    C.lineChart($("#chart-gmv"), {
      labels: labels,
      series: [{ name: "GMV", values: days.map(function (d) { return d.gmv; }), color: "#FF6A00" }],
      yFormat: function (v) { return C.defaultFormat(v); }
    });
    C.lineChart($("#chart-orders"), {
      labels: labels,
      series: [{ name: "订单量", values: days.map(function (d) { return d.orders; }), color: "#4C7CF5" }]
    });
    C.lineChart($("#chart-users"), {
      labels: labels,
      series: [
        { name: "活跃用户", values: days.map(function (d) { return d.activeUsers; }), color: "#00BBB4" },
        { name: "新增用户", values: days.map(function (d) { return d.newUsers; }), color: "#8D5CF6" }
      ]
    });
    C.lineChart($("#chart-conv"), {
      labels: labels,
      series: [{ name: "转化率", values: days.map(function (d) { return d.convRate; }), color: "#FF9D4D" }],
      yFormat: function (v) { return v.toFixed(1) + "%"; }
    });
    C.barChart($("#chart-profit"), {
      labels: labels,
      series: [
        { name: "补贴成本", values: days.map(function (d) { return d.subsidyCost; }), color: "#FFC069" },
        { name: "利润", values: days.map(function (d) { return d.profit; }), color: "#00B578" }
      ]
    });
  }

  /* ---------------- 模块三：指标拆解 ---------------- */

  function renderDecompose() {
    var cmp = A.periodCompare(state.rows, state.decompCity);
    var box = $("#decomp-result");
    if (!cmp || !cmp.prevRange) {
      box.innerHTML = '<div class="empty-tip">数据周期不足两个对比周期，无法拆解</div>';
      return;
    }
    var d = A.decomposeGMV(cmp.curr, cmp.prev);
    if (!d) {
      box.innerHTML = '<div class="empty-tip">GMV 数据缺失，无法拆解</div>';
      return;
    }

    $("#decomp-period").textContent = periodText(cmp);

    var scope = state.decompCity === "all" ? "大盘" : state.decompCity;
    var colors = { activeUsers: "#00BBB4", convRate: "#FF6A00", aov: "#8D5CF6" };
    var maxAbs = Math.max.apply(null, d.items.map(function (it) { return Math.abs(it.contribPct); })) || 1;

    var cards = d.items.map(function (it) {
      var width = Math.max(6, Math.abs(it.contribPct) / maxAbs * 100);
      var color = it.contribAbs >= 0 ? "#00B578" : "#F5483B";
      return '<div class="contrib-card">' +
        "<h4>" + it.name + "</h4>" +
        '<div class="contrib-vals">' +
        '<span class="pct" style="color:' + (it.change >= 0 ? "var(--up)" : "var(--down)") + '">' + A.fmtPct(it.change) + "</span>" +
        '<span class="share">对 GMV 贡献 ' + A.fmtPct(it.contribPct) + "</span></div>" +
        '<div class="contrib-bar"><i style="width:' + width + "%;background:" + color + '"></i></div>' +
        "</div>";
    }).join("");

    var verb = d.gmvPct >= 0 ? "增长" : "下降";
    var mainVerb = d.main.contribAbs >= 0 ? "提升" : "降低";
    var conclusion = scope + " GMV 本周期" + verb + " <b>" + Math.abs(d.gmvPct).toFixed(1) + "%</b>（" +
      A.fmtMoney(Math.abs(d.gmvDelta)) + " 元），主要由 <b>" + d.main.name + "</b> " + mainVerb +
      "导致（该因子自身环比 " + A.fmtPct(d.main.change) + "，对 GMV 贡献 " + A.fmtPct(d.main.contribPct) + "）。";

    box.innerHTML =
      '<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">' +
      '<div class="kpi-card"><div class="kpi-label"><span>' + scope + ' GMV（本期）</span></div>' +
      '<div class="kpi-value">' + A.fmtMoney(cmp.curr.gmv) + '<span class="kpi-unit">元</span></div>' +
      '<div class="kpi-foot">' + deltaBadge(d.gmvPct) + "<span>环比上期 " + A.fmtMoney(cmp.prev.gmv) + " 元</span></div></div>" +
      "</div>" +
      '<div class="contrib-grid">' + cards + "</div>" +
      '<div class="conclusion-box">📌 <b>系统结论：</b>' + conclusion + "</div>";

    renderDecompTable();
  }

  // 分城市拆解明细表
  function renderDecompTable() {
    var cities = A.uniqueCities(state.rows);
    var rowsHtml = cities.map(function (city) {
      var cmp = A.periodCompare(state.rows, city);
      if (!cmp || !cmp.prevRange) return "";
      var d = A.decomposeGMV(cmp.curr, cmp.prev);
      if (!d) return "";
      var get = function (key) { return d.items.filter(function (it) { return it.key === key; })[0]; };
      return "<tr>" +
        "<td>" + city + "</td>" +
        '<td class="num">' + A.fmtMoney(cmp.curr.gmv) + "</td>" +
        '<td class="num">' + deltaBadge(d.gmvPct) + "</td>" +
        '<td class="num">' + A.fmtPct(get("activeUsers").contribPct) + "</td>" +
        '<td class="num">' + A.fmtPct(get("convRate").contribPct) + "</td>" +
        '<td class="num">' + A.fmtPct(get("aov").contribPct) + "</td>" +
        "<td>" + d.main.name.replace(/（.*）/, "") + (d.main.contribAbs >= 0 ? "提升" : "下滑") + "</td>" +
        "</tr>";
    }).join("");
    $("#decomp-table-body").innerHTML = rowsHtml || '<tr><td colspan="7" class="empty-tip">暂无数据</td></tr>';
  }

  /* ---------------- 模块四：异常诊断 ---------------- */

  function renderAnomaly() {
    var anomalies = A.detectAnomalies(state.rows);
    var cmpAll = A.periodCompare(state.rows, "all");
    var cities = A.uniqueCities(state.rows);

    $("#anomaly-period").textContent = periodText(cmpAll) +
      " ｜ 检测规则：核心指标环比下降超过 " + Math.abs(A.ANOMALY_THRESHOLD) + "% 标记为异常";

    var danger = anomalies.filter(function (a) { return a.severity === "danger"; }).length;
    var warn = anomalies.length - danger;
    var abnormalCities = {};
    anomalies.forEach(function (a) { abnormalCities[a.city] = 1; });
    var okCities = cities.length - Object.keys(abnormalCities).length;

    $("#anomaly-summary").innerHTML =
      '<div class="anomaly-stat danger"><div class="n">' + danger + '</div><div class="l">严重异常（降幅 ≥ 20%）</div></div>' +
      '<div class="anomaly-stat warn"><div class="n">' + warn + '</div><div class="l">中度异常（降幅 10% ~ 20%）</div></div>' +
      '<div class="anomaly-stat"><div class="n">' + Object.keys(abnormalCities).length + '</div><div class="l">涉及城市数</div></div>' +
      '<div class="anomaly-stat okay"><div class="n">' + okCities + '</div><div class="l">健康城市数</div></div>';

    if (!anomalies.length) {
      $("#anomaly-list").innerHTML =
        '<div class="card empty-tip" style="grid-column:1/-1">🎉 本周期未检测到异常指标，各城市经营表现健康</div>';
      return;
    }

    var totalGmv = cmpAll ? cmpAll.curr.gmv : 0;

    $("#anomaly-list").innerHTML = anomalies.map(function (a) {
      var cityCmp = A.periodCompare(state.rows, a.city);
      var gmvShare = totalGmv && cityCmp ? (cityCmp.curr.gmv / totalGmv * 100).toFixed(1) : "-";
      var fmtVal = function (v) {
        if (a.metricKey === "convRate") return v.toFixed(2) + "%";
        if (a.metricKey === "activeUsers") return A.fmtNum(v / (cityCmp ? cityCmp.span : 1)) + "/日";
        return A.fmtMoney(v) + (a.metricKey === "orders" ? " 单" : " 元");
      };
      return '<div class="anomaly-card ' + a.severity + '">' +
        '<div class="a-head"><span class="a-title">⚠ ' + a.city + " · " + a.metricName + "下降 " +
          Math.abs(a.change).toFixed(1) + "%</span>" +
        '<span class="badge ' + a.severity + '">' + (a.severity === "danger" ? "严重" : "中度") + "</span></div>" +
        '<div class="a-section"><div class="a-label">影响范围</div>' +
        "<p>" + a.city + "市场 ｜ " + a.metricName + "由上期 " + fmtVal(a.prev) + " 降至本期 " + fmtVal(a.curr) +
        " ｜ 该城市 GMV 占大盘 " + gmvShare + "%</p></div>" +
        '<div class="a-section"><div class="a-label">可能原因分析</div><ol>' +
        a.reasons.map(function (r) { return "<li>" + r + "</li>"; }).join("") + "</ol></div>" +
        '<div class="a-section"><div class="a-label">优化方向建议</div><ol>' +
        a.actions.map(function (r) { return "<li>" + r + "</li>"; }).join("") + "</ol></div>" +
        "</div>";
    }).join("");
  }

  /* ---------------- 模块五：AI 报告 ---------------- */

  var typingTimer = null;

  // 将报告纯文本转换为带样式的 HTML
  function reportToHTML(text) {
    return text.split("\n").map(function (line) {
      if (line.indexOf("# ") === 0) return '<h3 class="rpt-title">' + line.slice(2) + "</h3>";
      if (line.indexOf("@ ") === 0) return '<div class="rpt-meta">' + line.slice(2) + "</div>";
      if (line.indexOf("## ") === 0) return "<h3>" + line.slice(3) + "</h3>";
      if (line.indexOf("- ") === 0) return '<li style="margin-left:20px">' + highlight(line.slice(2)) + "</li>";
      return "<p>" + highlight(line) + "</p>";
    }).join("");
  }

  // 高亮涨跌幅文本
  function highlight(s) {
    return s
      .replace(/(环比\s*)([+]\d+(\.\d+)?%)/g, '$1<span class="hl-up">$2</span>')
      .replace(/(环比\s*)(-\d+(\.\d+)?%)/g, '$1<span class="hl-down">$2</span>')
      .replace(/(下降\s*)(\d+(\.\d+)?%)/g, '$1<span class="hl-down">$2</span>')
      .replace(/(上涨|增长)(\s*)(\d+(\.\d+)?%)/g, '$1$2<span class="hl-up">$3</span>');
  }

  function initReport() {
    $("#btn-gen-report").addEventListener("click", function () {
      var btn = this;
      btn.disabled = true;
      $("#ai-thinking").classList.add("show");
      $("#report-area").classList.remove("show");
      $("#btn-copy-report").style.display = "none";
      if (typingTimer) clearInterval(typingTimer);

      var text = A.generateReport(state.rows);
      state.reportText = text;

      // 模拟 AI 思考延时后逐段打字输出
      setTimeout(function () {
        $("#ai-thinking").classList.remove("show");
        var area = $("#report-area");
        area.classList.add("show");
        area.innerHTML = "";

        var lines = text.split("\n");
        var i = 0;
        typingTimer = setInterval(function () {
          if (i >= lines.length) {
            clearInterval(typingTimer);
            typingTimer = null;
            area.innerHTML = reportToHTML(text); // 完成后整体重渲染，保证结构完整
            $("#btn-copy-report").style.display = "inline-flex";
            btn.disabled = false;
            btn.textContent = "🔄 重新生成报告";
            return;
          }
          area.innerHTML = reportToHTML(lines.slice(0, i + 1).join("\n")) + '<span class="typing-cursor"></span>';
          area.scrollTop = area.scrollHeight;
          i++;
        }, 120);
      }, 900);
    });

    $("#btn-copy-report").addEventListener("click", function () {
      var btn = this;
      var done = function () {
        btn.textContent = "✓ 已复制";
        setTimeout(function () { btn.textContent = "📋 复制报告"; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(state.reportText || "").then(done);
      } else {
        var ta = document.createElement("textarea");
        ta.value = state.reportText || "";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      }
    });
  }

  /* ---------------- 数据装载与全局刷新 ---------------- */

  function loadData(rows, source) {
    state.rows = rows;
    state.source = source;
    state.tablePage = 1;
    state.tableCity = "all";
    state.dashCity = "all";
    state.decompCity = "all";

    // 同步城市筛选器
    $("#table-city-filter").innerHTML = cityOptions(rows, true);
    $("#dash-city-filter").innerHTML = cityOptions(rows, true);
    $("#decomp-city-filter").innerHTML = cityOptions(rows, true);

    // 顶栏信息
    var dates = A.uniqueDates(rows);
    $("#topbar-source").textContent = state.source;
    $("#topbar-range").textContent = dates[0] + " ~ " + dates[dates.length - 1] +
      " ｜ " + A.uniqueCities(rows).length + " 城市 ｜ " + rows.length + " 行";

    renderAll();
  }

  function renderAll() {
    renderTable();
    renderDashboard();
    renderDecompose();
    renderAnomaly();
    // 报告区重置
    $("#report-area").classList.remove("show");
    $("#btn-copy-report").style.display = "none";
    var genBtn = $("#btn-gen-report");
    genBtn.disabled = false;
    genBtn.textContent = "✨ 生成运营分析报告";
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    // 导航
    $all(".nav-item").forEach(function (el) {
      el.addEventListener("click", function () { switchView(el.dataset.view); });
    });

    initUpload();
    initReport();

    $("#dash-city-filter").addEventListener("change", function (e) {
      state.dashCity = e.target.value;
      renderDashboard();
    });
    $("#decomp-city-filter").addEventListener("change", function (e) {
      state.decompCity = e.target.value;
      renderDecompose();
    });

    // 默认加载演示数据，保证打开即有完整效果
    loadData(window.MockData.generateMockData(), "演示数据");
    switchView("dashboard");
  }

  document.addEventListener("DOMContentLoaded", init);

})();
