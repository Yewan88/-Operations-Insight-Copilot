/* ============================================================
 * charts.js — 轻量 SVG 图表库（零依赖，离线可用）
 * 提供：
 *   Charts.lineChart(el, cfg)  折线/面积图，支持多序列 + 悬浮提示
 *   Charts.barChart(el, cfg)   分组柱状图（用于成本 / 利润对比）
 * cfg: { labels: [...], series: [{ name, values, color }], yFormat }
 * ============================================================ */

(function (global) {
  "use strict";

  var W = 720, H = 260;
  var PAD = { top: 16, right: 16, bottom: 30, left: 56 };

  function niceTicks(min, max, count) {
    if (min === max) { max = min + 1; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = span / count / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var ticks = [];
    var start = Math.floor(min / step) * step;
    for (var v = start; v <= max + step * 0.5; v += step) ticks.push(v);
    return ticks;
  }

  function defaultFormat(v) {
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1) + "亿";
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1) + "万";
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + "k";
    return (Math.round(v * 100) / 100).toString();
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // 计算坐标映射
  function scales(labels, allValues) {
    var min = Math.min.apply(null, allValues);
    var max = Math.max.apply(null, allValues);
    if (min > 0 && min / max > 0.5) min = min * 0.92;   // 留出下方空间
    if (min > 0 && max / min < 1.15) { /* 区间太窄时已处理 */ }
    if (min === max) { min -= 1; max += 1; }
    var ticks = niceTicks(min, max, 4);
    min = ticks[0]; max = ticks[ticks.length - 1];

    var iw = W - PAD.left - PAD.right;
    var ih = H - PAD.top - PAD.bottom;
    return {
      ticks: ticks,
      x: function (i) {
        return PAD.left + (labels.length === 1 ? iw / 2 : i / (labels.length - 1) * iw);
      },
      y: function (v) { return PAD.top + ih - (v - min) / (max - min) * ih; },
      iw: iw, ih: ih
    };
  }

  function gridAndAxes(sc, labels, yFormat) {
    var s = "";
    sc.ticks.forEach(function (t) {
      var y = sc.y(t);
      s += '<line x1="' + PAD.left + '" y1="' + y + '" x2="' + (W - PAD.right) + '" y2="' + y +
           '" stroke="#EFF0F4" stroke-width="1"/>';
      s += '<text x="' + (PAD.left - 8) + '" y="' + (y + 4) + '" text-anchor="end" ' +
           'font-size="11" fill="#86909C">' + esc(yFormat(t)) + "</text>";
    });
    // X 轴标签：最多显示 ~8 个
    var step = Math.max(1, Math.ceil(labels.length / 8));
    labels.forEach(function (lab, i) {
      if (i % step !== 0 && i !== labels.length - 1) return;
      s += '<text x="' + sc.x(i) + '" y="' + (H - 8) + '" text-anchor="middle" ' +
           'font-size="11" fill="#86909C">' + esc(lab.slice(5)) + "</text>"; // 去掉年份
    });
    return s;
  }

  // 序列折线 + 渐变面积
  function linePaths(series, sc, gid) {
    var defs = "", body = "";
    series.forEach(function (ser, si) {
      var pts = ser.values.map(function (v, i) { return [sc.x(i), sc.y(v)]; });
      var line = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
      if (si === 0) { // 仅第一条序列画面积，避免遮挡
        var gradId = gid + "-g" + si;
        defs += '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
                '<stop offset="0%" stop-color="' + ser.color + '" stop-opacity="0.18"/>' +
                '<stop offset="100%" stop-color="' + ser.color + '" stop-opacity="0"/></linearGradient>';
        var area = line + " L" + pts[pts.length - 1][0].toFixed(1) + " " + (H - PAD.bottom) +
                   " L" + pts[0][0].toFixed(1) + " " + (H - PAD.bottom) + " Z";
        body += '<path d="' + area + '" fill="url(#' + gradId + ')"/>';
      }
      body += '<path d="' + line + '" fill="none" stroke="' + ser.color +
              '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
    });
    return { defs: defs, body: body };
  }

  // 悬浮提示交互（折线 & 柱状共用）
  function bindHover(el, labels, series, sc, yFormat) {
    var box = el.querySelector(".chart-box");
    var svg = box.querySelector("svg");
    var tip = document.createElement("div");
    tip.className = "chart-tooltip";
    box.appendChild(tip);

    var guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
    guide.setAttribute("stroke", "#FFB173");
    guide.setAttribute("stroke-dasharray", "4 3");
    guide.setAttribute("y1", PAD.top);
    guide.setAttribute("y2", H - PAD.bottom);
    guide.style.display = "none";
    svg.appendChild(guide);

    svg.addEventListener("mousemove", function (e) {
      var rect = svg.getBoundingClientRect();
      var fx = (e.clientX - rect.left) / rect.width * W;
      var iw = W - PAD.left - PAD.right;
      var idx = Math.round((fx - PAD.left) / iw * (labels.length - 1));
      idx = Math.max(0, Math.min(labels.length - 1, idx));

      var gx = sc.x(idx);
      guide.setAttribute("x1", gx); guide.setAttribute("x2", gx);
      guide.style.display = "block";

      var html = "<b>" + esc(labels[idx]) + "</b>";
      series.forEach(function (ser) {
        html += '<div class="tt-row"><span class="dot" style="background:' + ser.color + '"></span>' +
                esc(ser.name) + "：" + esc(yFormat(ser.values[idx])) + "</div>";
      });
      tip.innerHTML = html;
      tip.style.display = "block";
      var px = gx / W * rect.width;
      tip.style.left = Math.max(70, Math.min(rect.width - 70, px)) + "px";
      tip.style.top = (PAD.top / H * rect.height + 10) + "px";
    });
    svg.addEventListener("mouseleave", function () {
      tip.style.display = "none";
      guide.style.display = "none";
    });
  }

  function legendHTML(series) {
    return '<div class="legend">' + series.map(function (s) {
      return "<span><i style=\"background:" + s.color + "\"></i>" + esc(s.name) + "</span>";
    }).join("") + "</div>";
  }

  var uid = 0;

  function lineChart(el, cfg) {
    var yFormat = cfg.yFormat || defaultFormat;
    var all = [];
    cfg.series.forEach(function (s) { all = all.concat(s.values); });
    var sc = scales(cfg.labels, all);
    var gid = "lc" + (++uid);
    var paths = linePaths(cfg.series, sc, gid);

    el.innerHTML =
      (cfg.series.length > 1 ? legendHTML(cfg.series) : "") +
      '<div class="chart-box"><svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">' +
      "<defs>" + paths.defs + "</defs>" +
      gridAndAxes(sc, cfg.labels, yFormat) +
      paths.body +
      "</svg></div>";

    bindHover(el, cfg.labels, cfg.series, sc, yFormat);
  }

  function barChart(el, cfg) {
    var yFormat = cfg.yFormat || defaultFormat;
    var all = [0];
    cfg.series.forEach(function (s) { all = all.concat(s.values); });
    var sc = scales(cfg.labels, all);
    var n = cfg.labels.length, m = cfg.series.length;
    var slot = sc.iw / n;
    var barW = Math.min(16, (slot * 0.6) / m);
    var zeroY = sc.y(Math.max(sc.ticks[0], 0));

    var bars = "";
    cfg.series.forEach(function (ser, si) {
      ser.values.forEach(function (v, i) {
        var cx = PAD.left + slot * i + slot / 2;
        var x = cx - (m * barW) / 2 + si * barW;
        var y = sc.y(v);
        var hgt = Math.abs(y - zeroY);
        bars += '<rect x="' + x.toFixed(1) + '" y="' + Math.min(y, zeroY).toFixed(1) +
                '" width="' + (barW - 2).toFixed(1) + '" height="' + Math.max(hgt, 1).toFixed(1) +
                '" rx="2" fill="' + ser.color + '" opacity="0.9"/>';
      });
    });

    // 柱状图的 x 映射改为槽位中心
    var scBar = Object.create(sc);
    scBar.x = function (i) { return PAD.left + slot * i + slot / 2; };

    el.innerHTML =
      legendHTML(cfg.series) +
      '<div class="chart-box"><svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">' +
      gridAndAxes(scBar, cfg.labels, yFormat) +
      bars +
      "</svg></div>";

    bindHover(el, cfg.labels, cfg.series, scBar, yFormat);
  }

  global.Charts = { lineChart: lineChart, barChart: barChart, defaultFormat: defaultFormat };

})(window);
