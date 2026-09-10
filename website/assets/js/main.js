/**
 * ArDali Browser Official Website - Vanilla JavaScript
 * Minimal, Security-First, Zero Dependencies, Zero Tracking
 */
"use strict";

document.addEventListener("DOMContentLoaded", function () {
  // Mobile Navigation Toggle
  var navToggle = document.querySelector(".mobile-nav-toggle");
  var siteNav = document.querySelector(".site-nav");

  if (navToggle && siteNav) {
    navToggle.addEventListener("click", function () {
      var isExpanded = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!isExpanded));
      siteNav.classList.toggle("open");
    });

    // Close menu when clicking on nav links
    var navLinks = siteNav.querySelectorAll(".nav-links a");
    navLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        if (siteNav.classList.contains("open")) {
          siteNav.classList.remove("open");
          navToggle.setAttribute("aria-expanded", "false");
        }
      });
    });
  }

  // Copy Code Button Handlers
  var copyButtons = document.querySelectorAll(".copy-btn");
  copyButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var targetId = btn.getAttribute("data-target");
      if (!targetId) return;

      var targetEl = document.getElementById(targetId);
      if (!targetEl) return;

      var textToCopy = targetEl.textContent ? targetEl.textContent.trim() : "";
      if (!textToCopy) return;

      var originalText = btn.textContent;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(
          function () {
            btn.textContent = btn.getAttribute("data-copied") || "Copied!";
            btn.classList.add("copied");
            setTimeout(function () {
              btn.textContent = originalText;
              btn.classList.remove("copied");
            }, 2000);
          },
          function () {
            // Fallback: silent failure, no crash
          }
        );
      }
    });
  });

  // Back to Top Button
  var backToTopBtn = document.querySelector(".back-to-top");
  if (backToTopBtn) {
    backToTopBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
});
