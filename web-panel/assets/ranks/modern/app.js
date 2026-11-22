// Showcase interactions: spotlight cards, scroll reveals, rank tabs, seamless ticker. No frameworks, no requests.
(function () {
  // Card spotlight follows the cursor (drives --mx/--my used by CSS ::before).
  document.querySelectorAll(".card").forEach(function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });

  // Scroll reveals (graceful: if IO missing, show everything).
  var els = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add("in"); });
  }

  // Rank tabs scroll to cards.
  var tabs = document.querySelectorAll(".rank-tabs button");
  tabs.forEach(function (b) {
    b.addEventListener("click", function () {
      tabs.forEach(function (x) { x.setAttribute("aria-selected", "false"); });
      b.setAttribute("aria-selected", "true");
      var t = document.querySelector(b.getAttribute("data-target"));
      if (t) t.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  // Duplicate ticker content once for a seamless -50% loop.
  var track = document.getElementById("tickerTrack");
  if (track && track.children.length) track.innerHTML += track.innerHTML;
})();
