/* Design gallery - no dependencies, no build step.
 *
 * Manifest loading: manifest.js (a plain <script>) is what makes the site work
 * from file://, where fetch() of a local JSON file is blocked. On http(s) the
 * JSON is fetched as a freshness check and used if it parses.
 */
(function () {
  "use strict";

  var DEFAULT_BASE = "https://leaderboard.fn-gaming.net";
  var LOCAL_BASE = "http://127.0.0.1:18101";
  var STORE_BASE = "wnf.gallery.base";

  var refreshers = [];

  /* Render from the embedded manifest straight away (that is the file:// path),
     then - only on http(s) - fetch the JSON and push a fresher copy to whoever
     registered a refresher. A slow fetch must never leave the page blank. */
  function loadManifest(cb) {
    var embedded = window.GALLERY_MANIFEST;
    if (embedded) cb(embedded);
    if (location.protocol === "file:") return;
    fetch("manifest.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (json) { if (embedded) refreshers.forEach(function (fn) { fn(json); }); else cb(json); })
      .catch(function (err) { console.warn("manifest.json fetch failed, using embedded manifest:", err); if (!embedded) cb(null); });
  }

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (kid) { if (kid) node.appendChild(kid); });
    return node;
  }

  function bytes(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(2) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(0) + " kB";
    return n + " B";
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function statusBadge(ref) {
    return el("span", {
      "class": "badge " + (ref.status === "new" ? "new" : "exists"),
      text: ref.status === "new" ? "new" : "exists"
    });
  }

  /* ------------------------------------------------------------------ index */

  function renderIndex(manifest) {
    var grid = document.getElementById("grid");
    var refs = manifest.refs.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var state = { q: "", filter: "all" };

    document.getElementById("counts").innerHTML =
      "<strong>" + refs.length + "</strong> files &middot; " +
      "<strong>" + manifest.counts.unique + "</strong> pages &middot; " +
      "<strong>" + manifest.counts.elements + "</strong> inventoried elements &middot; " +
      "<strong>" + manifest.counts.new_pages + "</strong> new routes";

    function matches(ref) {
      if (state.filter === "exists" && ref.status !== "exists") return false;
      if (state.filter === "new" && ref.status !== "new") return false;
      if (state.filter === "duplicate" && !ref.duplicate_of) return false;
      if (!state.q) return true;
      var hay = (ref.id + " " + ref.title + " " + ref.routes.join(" ") + " " + ref.summary).toLowerCase();
      return hay.indexOf(state.q) !== -1;
    }

    function draw() {
      grid.textContent = "";
      var shown = refs.filter(matches);
      if (!shown.length) {
        grid.appendChild(el("p", { "class": "empty", text: "Nothing matches that filter." }));
        return;
      }
      shown.forEach(function (ref) {
        var img = el("img", { src: ref.thumb, alt: ref.title + " preview", width: "720", height: "405" });
        var badges = el("div", { "class": "row" }, [statusBadge(ref)]);
        if (ref.duplicate_of) badges.appendChild(el("span", { "class": "badge dup", text: "duplicate of " + ref.duplicate_of }));
        var row2 = el("div", { "class": "row" }, [
          el("span", { "class": "name", text: ref.title }),
          el("span", { "class": "route", text: ref.route })
        ]);
        var meta = el("div", { "class": "meta", text:
          ref.width + " \u00d7 " + ref.height + " \u00b7 " + bytes(ref.bytes) +
          " \u00b7 " + ref.element_count + " elements" });
        var link = el("a", {
          "class": "tile",
          href: "viewer.html?ref=" + encodeURIComponent(ref.id),
          title: "Open " + ref.title
        }, [
          el("span", { "class": "shot" }, [img]),
          el("span", { "class": "body" }, [badges, row2, meta])
        ]);
        grid.appendChild(link);
      });
    }

    document.getElementById("search").addEventListener("input", function (e) {
      state.q = e.target.value.trim().toLowerCase();
      draw();
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-filter]"), function (btn) {
      btn.addEventListener("click", function () {
        state.filter = btn.getAttribute("data-filter");
        Array.prototype.forEach.call(document.querySelectorAll("[data-filter]"), function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        draw();
      });
    });
    draw();
    refreshers.push(function (fresh) {
      refs = fresh.refs.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
      document.getElementById("counts").innerHTML =
        "<strong>" + refs.length + "</strong> files &middot; " +
        "<strong>" + fresh.counts.unique + "</strong> pages &middot; " +
        "<strong>" + fresh.counts.elements + "</strong> inventoried elements &middot; " +
        "<strong>" + fresh.counts.new_pages + "</strong> new routes";
      draw();
    });
  }

  /* ----------------------------------------------------------------- viewer */

  function renderViewer(manifest) {
    var refs = manifest.refs.filter(function (r) { return !r.duplicate_of; });
    var byId = {};
    manifest.refs.forEach(function (r) { byId[r.id] = r; });

    var params = new URLSearchParams(location.search);
    var wanted = params.get("ref") || refs[0].id;
    var index = Math.max(0, refs.findIndex(function (r) { return r.id === wanted; }));
    var zoom = "fit";
    var compare = params.get("compare") === "1";
    var overlay = params.get("overlay") === "1";
    var base = params.get("base") || localStorage.getItem(STORE_BASE) || DEFAULT_BASE;

    var titleEl = document.getElementById("v-title");
    var subEl = document.getElementById("v-sub");
    var stage = document.getElementById("stage");
    var barBadges = document.getElementById("v-badges");
    var settings = document.getElementById("compare-settings");
    var baseInput = document.getElementById("base-url");
    var urlOut = document.getElementById("target-url");
    var hint = document.getElementById("hint");
    var single = null;

    function ref() { return refs[index]; }

    function targetUrl(r) {
      var b = base.trim().replace(/\/+$/, "");
      var route = r.route || "/";
      return b + (route.charAt(0) === "/" ? route : "/" + route);
    }

    function remember() {
      var q = new URLSearchParams();
      q.set("ref", ref().id);
      if (compare) q.set("compare", "1");
      if (overlay) q.set("overlay", "1");
      if (base !== DEFAULT_BASE) q.set("base", base);
      history.replaceState(null, "", "viewer.html?" + q.toString());
    }

    function drawChrome() {
      var r = ref();
      document.title = r.title + " \u2014 design gallery";
      titleEl.textContent = r.id + " \u2014 " + r.title;
      subEl.textContent = r.route + " \u00b7 " + r.width + " \u00d7 " + r.height + " \u00b7 " + bytes(r.bytes) +
        (r.duplicate_of ? " \u00b7 duplicate of " + r.duplicate_of : "");
      barBadges.textContent = "";
      barBadges.appendChild(statusBadge(r));
      barBadges.appendChild(el("span", { "class": "badge count", text: r.element_count + " elements" }));
      barBadges.appendChild(el("span", { "class": "badge count", text: r.blockers.length + " blockers" }));
      document.getElementById("prev").disabled = index === 0;
      document.getElementById("next").disabled = index === refs.length - 1;
      document.getElementById("pos").textContent = (index + 1) + " / " + refs.length;
      Array.prototype.forEach.call(document.querySelectorAll("[data-zoom]"), function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-zoom") === zoom));
      });
      document.getElementById("toggle-compare").setAttribute("aria-pressed", String(compare));
      baseInput.value = base;
      urlOut.textContent = targetUrl(r);
      settings.classList.toggle("on", compare);
      hint.className = "hint" + (compare ? " warn" : "");
      hint.innerHTML = compare
        ? "Right pane: the live page in an iframe. If it stays blank the panel sends " +
          "<code>X-Frame-Options</code> / <code>frame-ancestors</code> and cannot be framed \u2014 " +
          "<a href=\"" + targetUrl(r) + "\" target=\"_blank\" rel=\"noopener\">open it in a tab</a>. " +
          "The local build is usually <code>" + LOCAL_BASE + "</code>."
        : "<span class=\"kbd\">\u2190</span> <span class=\"kbd\">\u2192</span> previous / next \u00b7 " +
          "<span class=\"kbd\">c</span> compare \u00b7 <span class=\"kbd\">o</span> overlay \u00b7 " +
          "<span class=\"kbd\">f</span> fit \u00b7 <span class=\"kbd\">1</span> 100% \u00b7 " +
          "<span class=\"kbd\">2</span> 200% \u00b7 drag to pan when zoomed";
    }

    function scaledFrame(r, scale) {
      return el("div", {
        "class": "frame",
        style: "width:" + r.width + "px;height:" + r.height + "px;transform:scale(" + scale + ");"
      });
    }

    function drawStage() {
      stage.textContent = "";
      var r = ref();
      if (!compare) {
        var box = el("div", { "class": "single", id: "single" });
        box.style.setProperty("--natural-w", r.width + "px");
        box.setAttribute("data-zoom", zoom);
        var img = el("img", { src: r.image, alt: r.title + " reference screenshot", width: r.width, height: r.height });
        box.appendChild(img);
        stage.appendChild(box);
        box.addEventListener("mousedown", function (ev) {
          if (zoom === "fit") return;
          var sx = ev.pageX, sy = ev.pageY, l = box.scrollLeft, t = box.scrollTop;
          box.classList.add("dragging");
          function move(e) {
            box.scrollLeft = l - (e.pageX - sx);
            box.scrollTop = t - (e.pageY - sy);
          }
          function up() {
            box.classList.remove("dragging");
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          }
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        });
        return;
      }

      var panes = el("div", { "class": "panes" + (overlay ? " overlay" : "") });
      var refPane = el("div", { "class": "pane ref" });
      var livePane = el("div", { "class": "pane live" });
      refPane.appendChild(el("div", { "class": "pane-head" }, [
        el("span", { text: "reference \u2014 " + r.id + ".png" }),
        el("span", { text: r.width + "\u00d7" + r.height })
      ]));
      livePane.appendChild(el("div", { "class": "pane-head" }, [
        el("span", { text: "live \u2014 " + targetUrl(r) }),
        el("span", { text: "iframe" })
      ]));

      var refWrap = el("div", { "class": "frame-wrap" });
      var liveWrap = el("div", { "class": "frame-wrap" });
      var refFrame = scaledFrame(r, 1);
      refFrame.appendChild(el("img", { src: r.image, alt: "reference" }));
      var liveFrame = scaledFrame(r, 1);
      var iframe = el("iframe", { src: targetUrl(r), title: "live page " + r.route });
      liveFrame.appendChild(iframe);
      refWrap.appendChild(refFrame);
      liveWrap.appendChild(liveFrame);
      refPane.appendChild(refWrap);
      livePane.appendChild(liveWrap);
      panes.appendChild(refPane);
      panes.appendChild(livePane);
      stage.appendChild(panes);

      function fit() {
        var aspect = r.height / r.width;
        var available = stage.clientWidth - (overlay ? 32 : 48);
        var w = overlay ? available : available / 2;
        if (window.innerWidth < 900) w = available;
        var maxH = window.innerHeight - 250;
        var scale = Math.min(w / r.width, maxH / r.height);
        scale = Math.max(0.05, scale);
        [refWrap, liveWrap].forEach(function (wrap) {
          wrap.style.height = Math.round(r.height * scale) + "px";
        });
        [refFrame, liveFrame].forEach(function (f) { f.style.transform = "scale(" + scale + ")"; });
      }
      fit();
      window.addEventListener("resize", fit);
    }

    function draw() {
      remember();
      drawChrome();
      drawStage();
    }

    function go(delta) {
      var next = index + delta;
      if (next < 0 || next >= refs.length) return;
      index = next;
      draw();
    }

    document.getElementById("prev").addEventListener("click", function () { go(-1); });
    document.getElementById("next").addEventListener("click", function () { go(1); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-zoom]"), function (btn) {
      btn.addEventListener("click", function () {
        zoom = btn.getAttribute("data-zoom");
        if (compare) { compare = false; }
        draw();
      });
    });
    document.getElementById("toggle-compare").addEventListener("click", function () {
      compare = !compare;
      if (!compare) overlay = false;
      draw();
    });
    document.getElementById("toggle-overlay").addEventListener("click", function () {
      if (!compare) compare = true;
      overlay = !overlay;
      draw();
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"), function (btn) {
      btn.addEventListener("click", function () {
        base = btn.getAttribute("data-preset");
        localStorage.setItem(STORE_BASE, base);
        draw();
      });
    });
    baseInput.addEventListener("change", function () {
      base = baseInput.value.trim() || DEFAULT_BASE;
      localStorage.setItem(STORE_BASE, base);
      draw();
    });
    document.getElementById("reload-live").addEventListener("click", draw);

    document.addEventListener("keydown", function (e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "ArrowLeft") { go(-1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { go(1); e.preventDefault(); }
      else if (e.key === "c" || e.key === "C") { compare = !compare; if (!compare) overlay = false; draw(); }
      else if (e.key === "o" || e.key === "O") { compare = true; overlay = !overlay; draw(); }
      else if (e.key === "f" || e.key === "F") { zoom = "fit"; compare = false; draw(); }
      else if (e.key === "1") { zoom = "1"; compare = false; draw(); }
      else if (e.key === "2") { zoom = "2"; compare = false; draw(); }
      else if (e.key === "Escape") { compare = false; overlay = false; draw(); }
    });

    draw();
  }

  /* ------------------------------------------------------------------- boot */

  document.addEventListener("DOMContentLoaded", function () {
    var view = document.body.getAttribute("data-view");
    loadManifest(function (manifest) {
      if (!manifest) {
        document.body.appendChild(el("p", { "class": "empty", text:
          "manifest.js did not load, so there is no gallery data. Run tools/design/build_gallery.py." }));
        return;
      }
      if (view === "index") renderIndex(manifest);
      else if (view === "viewer") renderViewer(manifest);
    });
  });
})();
