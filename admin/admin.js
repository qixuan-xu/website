(function () {
  "use strict";

  var API_ROOT = "/v1/admin";
  var RECOVERY_KEY = "qx-admin-recovery-v1";
  var DEMO_ENABLED = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && new URLSearchParams(window.location.search).get("demo") === "1";
  var STATUS_VALUES = ["planned", "prototype", "active", "in_progress", "completed", "archived"];
  var VISUAL_VALUES = ["vision", "drone", "embedded", "game"];
  var state = {
    session: null,
    content: null,
    revision: 0,
    etag: null,
    updatedAt: null,
    updatedBy: null,
    publishedRevision: null,
    versions: [],
    versionsNextCursor: null,
    dirty: false,
    busy: false,
    online: true,
    activeView: "dashboard",
    savedSnapshot: "",
    localRecovery: null,
    draggedProjectId: null,
    staleRecovery: false,
    recoveryBaseRevision: null,
    allowNavigation: false,
    confirmResolver: null,
    recoveryTimer: null
  };

  var demoStore = DEMO_ENABLED ? createDemoStore() : null;

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function makeElement(tagName, className, textValue) {
    var element = document.createElement(tagName);
    if (className) element.className = className;
    if (textValue !== undefined && textValue !== null) element.textContent = String(textValue);
    return element;
  }

  function appendChildren(parent) {
    for (var index = 1; index < arguments.length; index += 1) {
      var child = arguments[index];
      if (child === null || child === undefined) continue;
      parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return parent;
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function stableSnapshot(value) {
    return JSON.stringify(value);
  }

  function getPath(object, path) {
    return path.split(".").reduce(function (current, key) {
      return current === null || current === undefined ? undefined : current[key];
    }, object);
  }

  function setPath(object, path, value) {
    var keys = path.split(".");
    var current = object;
    keys.forEach(function (key, index) {
      if (index === keys.length - 1) {
        current[key] = value;
        return;
      }
      if (!isRecord(current[key]) && !Array.isArray(current[key])) {
        current[key] = /^\d+$/.test(keys[index + 1]) ? [] : {};
      }
      current = current[key];
    });
  }

  function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function isHttpsUrl(value) {
    if (!nonEmpty(value)) return false;
    try {
      return new URL(value).protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function isEmail(value) {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function slugify(value) {
    var result = String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    return result || "untitled-project";
  }

  function uniqueId(prefix) {
    var random = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    return slugify((prefix || "project") + "-" + random);
  }

  function formatDate(value, includeTime) {
    if (!value) return "Not yet";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, includeTime ? {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    } : {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(date);
  }

  function relativeTime(value) {
    if (!value) return "Not yet";
    var milliseconds = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(milliseconds)) return formatDate(value, false);
    var minutes = Math.round(milliseconds / 60000);
    if (Math.abs(minutes) < 1) return "Just now";
    if (Math.abs(minutes) < 60) return Math.abs(minutes) + "m ago";
    var hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return Math.abs(hours) + "h ago";
    var days = Math.round(hours / 24);
    if (Math.abs(days) < 14) return Math.abs(days) + "d ago";
    return formatDate(value, false);
  }

  function createBaseContent() {
    return {
      "$schema": "./site.schema.json",
      schemaVersion: 1,
      site: {
        name: "Qixuan Xu",
        shortMark: "QX",
        canonicalUrl: "https://qixuan.net/",
        title: "Qixuan Xu — Systems that see, decide, and move",
        description: "Qixuan Xu is a student engineer building across computer vision, embedded systems, and FPV.",
        email: "hi@qixuan.net",
        githubUrl: "https://github.com/qixuan-xu",
        footerText: "Built with curiosity"
      },
      navigation: {
        workLabel: "Work",
        aboutLabel: "About",
        githubLabel: "GitHub ↗",
        emailLabel: "Email"
      },
      hero: {
        availabilityEnabled: true,
        availabilityLabel: "Student engineer / Open to internships & collaboration",
        headline: {
          line1: "I build systems",
          line2Prefix: "that",
          primaryAccent: "see",
          line2Suffix: ", decide,",
          line3Prefix: "and",
          secondaryAccent: "move",
          line3Suffix: "."
        },
        intro: {
          lead: "I'm",
          emphasis: "Qixuan Xu",
          tail: ", a student building across computer vision, embedded systems, and FPV — from sensor input and camera frames to firmware and real-world motion."
        },
        primaryCtaLabel: "Explore selected builds",
        secondaryCtaLabel: "GitHub",
        scrollLabel: "Scroll / 01—04"
      },
      systemMap: {
        label: "System map / QX-01",
        state: "Loop active",
        nodes: [
          { name: "Sense", description: "Camera / sensor input", signal: "S" },
          { name: "Decide", description: "Model / control logic", signal: "D" },
          { name: "Move", description: "Motor / real-world output", signal: "M" }
        ],
        focusLabel: "Focus",
        focusValue: "physical systems",
        modeLabel: "Mode",
        modeValue: "learn by building"
      },
      domains: ["Computer vision", "Embedded systems", "FPV / aviation", "Game development"],
      work: {
        sectionLabel: "01 / Selected builds",
        titleLead: "Projects built to",
        titleAccent: "leave the screen."
      },
      projects: [],
      now: {
        label: "Now / Next 05",
        title: "Study Organizer App",
        summary: "A Swift homework and schedule manager for a less chaotic school week.",
        status: "planned",
        statusLabel: "Planned",
        url: null
      },
      method: {
        sectionLabel: "02 / Process",
        title: "One loop, three ways of thinking.",
        items: [
          { label: "INPUT / 01", title: "Sense", description: "Start with the messy world: camera frames, sensors, radio links, and the signal underneath the noise." },
          { label: "LOGIC / 02", title: "Decide", description: "Turn inputs into useful choices with models, firmware, control logic, and repeated testing." },
          { label: "OUTPUT / 03", title: "Act", description: "Close the loop in the physical world — on a motor, in a flight controller, or inside an interaction." }
        ]
      },
      about: {
        headingLead: "I build to understand",
        headingAccent: "how things really work.",
        sectionLabel: "03 / About",
        paragraphs: [
          "I'm most interested in the moment software meets physics: when a control loop steadies a drone, a sensor becomes useful data, or a vision model finds structure in a frame.",
          "This site is my field log for the things I'm learning, breaking, rebuilding, and eventually getting to work."
        ],
        skills: ["Python / OpenCV", "Embedded C", "Betaflight / FPV", "Godot / GDScript"]
      },
      contact: {
        kicker: "04 / Contact — Channel open",
        heading: "Have a problem that crosses hardware and software?",
        buttonLabel: "Let's talk"
      }
    };
  }

  function makeProject(title, category, status, visual, featured, order) {
    var id = slugify(title);
    return {
      id: id,
      slug: id,
      title: title,
      category: category,
      summary: title + " is documented here as a practical build, including the decisions, tests, and next steps.",
      status: status,
      statusLabel: status === "in_progress" ? "In progress" : status.charAt(0).toUpperCase() + status.slice(1),
      tags: [],
      link: null,
      note: "Add project details before publishing",
      featured: Boolean(featured),
      published: true,
      order: order,
      visual: { type: "preset", key: visual }
    };
  }

  function createDemoContent() {
    var content = createBaseContent();
    content.projects = [
      makeProject("YOLO Vision System", "Vision", "prototype", "vision", true, 10),
      makeProject("FPV Drone Build", "Flight", "in_progress", "drone", false, 20),
      makeProject("STM32 Projects", "Embedded", "active", "embedded", false, 30),
      makeProject("Godot Game", "Game dev", "in_progress", "game", false, 40)
    ];
    content.projects[0].summary = "A prototype pipeline that turns road footage into structured detections with Python, OpenCV, and YOLO.";
    content.projects[0].tags = ["Python", "OpenCV", "YOLO"];
    content.projects[0].link = { label: "View repository", url: "https://github.com/qixuan-xu/yolo-vision-system" };
    content.projects[0].note = null;
    content.projects[1].tags = ["FPV", "Betaflight", "Electronics"];
    content.projects[2].tags = ["STM32", "Embedded C", "Sensors"];
    content.projects[3].tags = ["Godot", "GDScript", "Game feel"];
    return content;
  }

  function createDemoStore() {
    var now = new Date().toISOString();
    var content = createDemoContent();
    return {
      content: content,
      revision: 7,
      publishedRevision: "demo-published-7",
      updatedAt: now,
      versions: [
        { id: "demo-published-7", revision: 7, action: "publish", createdAt: now, createdBy: "demo@localhost", isPublished: true },
        { id: "demo-draft-6", revision: 6, action: "draft", createdAt: new Date(Date.now() - 3600000).toISOString(), createdBy: "demo@localhost", isPublished: false },
        { id: "demo-published-5", revision: 5, action: "publish", createdAt: new Date(Date.now() - 86400000).toISOString(), createdBy: "demo@localhost", isPublished: false }
      ],
      snapshots: {
        "demo-published-7": deepClone(content),
        "demo-draft-6": deepClone(content),
        "demo-published-5": deepClone(content)
      }
    };
  }

  function normalizeContent(input) {
    var base = createBaseContent();
    if (!isRecord(input)) return base;
    var content = deepClone(input);
    content["$schema"] = typeof content["$schema"] === "string" ? content["$schema"] : base["$schema"];
    content.schemaVersion = 1;
    ["site", "navigation", "hero", "systemMap", "work", "now", "method", "about", "contact"].forEach(function (key) {
      content[key] = isRecord(content[key]) ? content[key] : deepClone(base[key]);
    });
    content.site = Object.assign({}, base.site, content.site);
    content.navigation = Object.assign({}, base.navigation, content.navigation);
    content.hero = Object.assign({}, base.hero, content.hero);
    content.hero.headline = Object.assign({}, base.hero.headline, isRecord(content.hero.headline) ? content.hero.headline : {});
    content.hero.intro = Object.assign({}, base.hero.intro, isRecord(content.hero.intro) ? content.hero.intro : {});
    content.systemMap = Object.assign({}, base.systemMap, content.systemMap);
    content.systemMap.nodes = Array.isArray(content.systemMap.nodes) && content.systemMap.nodes.length === 3 ? content.systemMap.nodes : deepClone(base.systemMap.nodes);
    content.domains = Array.isArray(content.domains) && content.domains.length === 4 ? content.domains.map(String) : deepClone(base.domains);
    content.work = Object.assign({}, base.work, content.work);
    content.projects = Array.isArray(content.projects) ? content.projects.map(normalizeProject) : [];
    content.now = Object.assign({}, base.now, content.now);
    content.method = Object.assign({}, base.method, content.method);
    content.method.items = Array.isArray(content.method.items) && content.method.items.length === 3 ? content.method.items.map(function (item, index) {
      return Object.assign({}, base.method.items[index], isRecord(item) ? item : {});
    }) : deepClone(base.method.items);
    content.about = Object.assign({}, base.about, content.about);
    content.about.paragraphs = Array.isArray(content.about.paragraphs) && content.about.paragraphs.length ? content.about.paragraphs.map(String).slice(0, 4) : deepClone(base.about.paragraphs);
    content.about.skills = Array.isArray(content.about.skills) && content.about.skills.length ? content.about.skills.map(String).slice(0, 8) : deepClone(base.about.skills);
    content.contact = Object.assign({}, base.contact, content.contact);
    return content;
  }

  function normalizeProject(project, index) {
    var source = isRecord(project) ? deepClone(project) : {};
    var title = nonEmpty(source.title) ? source.title : "Untitled project";
    var id = /^[a-z0-9][a-z0-9-]{0,63}$/.test(source.id || "") ? source.id : slugify(title);
    var visualKey = isRecord(source.visual) && VISUAL_VALUES.indexOf(source.visual.key) >= 0 ? source.visual.key : VISUAL_VALUES[index % VISUAL_VALUES.length];
    var status = STATUS_VALUES.indexOf(source.status) >= 0 ? source.status : "planned";
    return {
      id: id,
      slug: /^[a-z0-9][a-z0-9-]{0,63}$/.test(source.slug || "") ? source.slug : id,
      title: title,
      category: nonEmpty(source.category) ? source.category : "New build",
      summary: nonEmpty(source.summary) ? source.summary : "Add a short project summary before publishing.",
      status: status,
      statusLabel: nonEmpty(source.statusLabel) ? source.statusLabel : status.replace("_", " "),
      tags: Array.isArray(source.tags) ? source.tags.map(String).filter(nonEmpty).slice(0, 8) : [],
      link: isRecord(source.link) && isHttpsUrl(source.link.url) ? { label: nonEmpty(source.link.label) ? source.link.label : "View project", url: source.link.url } : null,
      note: nonEmpty(source.note) ? source.note : null,
      featured: Boolean(source.featured),
      published: source.published !== false,
      order: Number.isInteger(source.order) ? source.order : (index + 1) * 10,
      visual: { type: "preset", key: visualKey }
    };
  }

  function ApiError(status, code, message, requestId, details) {
    this.name = "ApiError";
    this.status = status;
    this.code = code || "request_failed";
    this.message = message || "The request could not be completed.";
    this.requestId = requestId || "";
    this.details = details;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function demoRequest(path, options) {
    var method = (options.method || "GET").toUpperCase();
    var data;
    if (path === "/session" && method === "GET") {
      data = {
        authenticated: true,
        user: { sub: "local-demo", email: "demo@localhost", name: "Demo operator" },
        email: "demo@localhost",
        name: "Demo operator",
        csrfToken: "local-demo-csrf",
        logoutUrl: null
      };
    } else if (path === "/content" && method === "GET") {
      data = {
        content: deepClone(demoStore.content),
        revision: demoStore.revision,
        updatedAt: demoStore.updatedAt,
        updatedBy: "demo@localhost",
        publishedRevision: demoStore.publishedRevision
      };
    } else if ((path === "/content" || path === "/draft") && method === "PUT") {
      if (options.body.expectedRevision !== demoStore.revision) throw new ApiError(409, "revision_conflict", "Demo revision changed.");
      demoStore.revision += 1;
      demoStore.content = deepClone(options.body.content);
      demoStore.updatedAt = new Date().toISOString();
      data = {
        content: deepClone(demoStore.content),
        revision: demoStore.revision,
        updatedAt: demoStore.updatedAt,
        updatedBy: "demo@localhost",
        publishedRevision: demoStore.publishedRevision
      };
    } else if (path === "/publish" && method === "POST") {
      if (options.body.expectedRevision !== demoStore.revision) throw new ApiError(409, "revision_conflict", "Demo revision changed.");
      demoStore.revision += 1;
      var versionId = "demo-published-" + demoStore.revision;
      demoStore.publishedRevision = versionId;
      demoStore.updatedAt = new Date().toISOString();
      demoStore.versions.forEach(function (version) { version.isPublished = false; });
      demoStore.versions.unshift({ id: versionId, revision: demoStore.revision, action: "publish", createdAt: demoStore.updatedAt, createdBy: "demo@localhost", isPublished: true });
      demoStore.snapshots[versionId] = deepClone(demoStore.content);
      data = {
        content: deepClone(demoStore.content),
        revision: demoStore.revision,
        updatedAt: demoStore.updatedAt,
        updatedBy: "demo@localhost",
        publishedRevision: demoStore.publishedRevision
      };
    } else if (path.indexOf("/versions") === 0 && method === "GET") {
      data = { items: deepClone(demoStore.versions), nextCursor: null };
    } else if (path === "/rollback" && method === "POST") {
      if (options.body.expectedRevision !== demoStore.revision) throw new ApiError(409, "revision_conflict", "Demo revision changed.");
      var snapshot = demoStore.snapshots[options.body.versionId];
      if (!snapshot) throw new ApiError(404, "version_not_found", "Demo version was not found.");
      demoStore.revision += 1;
      demoStore.content = deepClone(snapshot);
      demoStore.updatedAt = new Date().toISOString();
      data = {
        content: deepClone(demoStore.content),
        revision: demoStore.revision,
        updatedAt: demoStore.updatedAt,
        updatedBy: "demo@localhost",
        publishedRevision: demoStore.publishedRevision
      };
    } else if (path === "/logout" && method === "POST") {
      data = { logoutUrl: null };
    } else {
      throw new ApiError(404, "not_found", "Demo API route not found.");
    }
    return Promise.resolve({ data: data, etag: "\"draft-" + demoStore.revision + "\"" });
  }

  async function apiRequest(path, options) {
    var config = options || {};
    if (DEMO_ENABLED) return demoRequest(path, config);
    var headers = new Headers({ Accept: "application/json" });
    if (config.body !== undefined) headers.set("Content-Type", "application/json");
    if (config.mutation && state.session && state.session.csrfToken) headers.set("X-CSRF-Token", state.session.csrfToken);
    if (config.etag) headers.set("If-Match", config.etag);
    var response;
    try {
      response = await fetch(API_ROOT + path, {
        method: config.method || "GET",
        headers: headers,
        body: config.body === undefined ? undefined : JSON.stringify(config.body),
        credentials: "include",
        cache: "no-store",
        redirect: "follow"
      });
    } catch (error) {
      throw new ApiError(0, "network_error", "Could not reach site control. Check your connection and try again.");
    }
    var contentType = response.headers.get("content-type") || "";
    var payload = null;
    if (contentType.indexOf("application/json") >= 0) {
      try {
        payload = await response.json();
      } catch (error) {
        throw new ApiError(response.status, "invalid_response", "Site control returned an unreadable response.");
      }
    }
    if (!response.ok || (payload && payload.ok === false)) {
      var details = payload && payload.error ? payload.error : {};
      throw new ApiError(response.status, details.code, details.message || (response.status === 401 ? "Your Access session has expired." : "The request failed."), details.requestId || (payload && payload.requestId), details.details);
    }
    if (!payload) throw new ApiError(response.status, "invalid_response", "Site control returned an unexpected response.");
    return {
      data: payload.ok === true ? payload.data : payload,
      etag: response.headers.get("etag"),
      requestId: payload.requestId || ""
    };
  }

  async function init() {
    bindStaticEvents();
    configureDemoMode();
    try {
      var sessionResult = await apiRequest("/session");
      if (!sessionResult.data || sessionResult.data.authenticated === false) {
        showSessionGate("signed-out");
        return;
      }
      state.session = sessionResult.data;
      await loadWorkspace();
      showApplication();
    } catch (error) {
      if (error.status === 401 || error.status === 403) showSessionGate("signed-out", error.message);
      else showSessionGate("error", error.message);
    }
  }

  function configureDemoMode() {
    if (!DEMO_ENABLED) return;
    document.body.classList.add("is-demo");
    $(".brand small").textContent = "Local demo / no network";
    $("#publish-button").textContent = "Simulate publish ↗";
    $("#save-button").textContent = "Save demo draft";
    $("#mobile-save-button").textContent = "Save demo draft";
  }

  async function loadWorkspace() {
    var results = await Promise.all([apiRequest("/content"), apiRequest("/versions?limit=50")]);
    applyContentPayload(results[0]);
    state.versions = Array.isArray(results[1].data.items) ? results[1].data.items : [];
    state.versionsNextCursor = results[1].data.nextCursor === null || Number.isInteger(results[1].data.nextCursor) ? results[1].data.nextCursor : null;
    state.savedSnapshot = stableSnapshot(state.content);
    state.dirty = false;
    readLocalRecovery();
  }

  function applyContentPayload(result) {
    var payload = result.data || {};
    state.content = normalizeContent(payload.content || payload);
    state.revision = Number.isInteger(payload.revision) ? payload.revision : state.revision;
    state.etag = result.etag || "\"draft-" + state.revision + "\"";
    state.updatedAt = payload.updatedAt || new Date().toISOString();
    state.updatedBy = payload.updatedBy || "";
    state.publishedRevision = payload.publishedRevision || null;
  }

  function showSessionGate(mode, message) {
    $("#session-gate").hidden = false;
    $("#admin-app").hidden = true;
    $("#gate-actions").hidden = mode === "checking";
    $("#gate-signal").hidden = mode !== "checking";
    if (mode === "signed-out") {
      $("#gate-kicker").textContent = "Access required / 401";
      $("#gate-title").textContent = "Your session needs a refresh.";
      $("#gate-copy").textContent = message || "Continue through Cloudflare Access to reopen site control.";
      $("#sign-in-button").hidden = false;
      $("#retry-session-button").hidden = true;
    } else if (mode === "error") {
      $("#gate-kicker").textContent = "Connection interrupted / 503";
      $("#gate-title").textContent = "Site control did not answer.";
      $("#gate-copy").textContent = message || "The admin service may be temporarily unavailable. Your public site is not affected.";
      $("#sign-in-button").hidden = true;
      $("#retry-session-button").hidden = false;
    }
  }

  function showApplication() {
    $("#session-gate").hidden = true;
    $("#admin-app").hidden = false;
    var user = state.session.user || {};
    var name = state.session.name || user.name || "Qixuan";
    var email = state.session.email || user.email || "Access session";
    $("#account-name").textContent = name;
    $("#account-email").textContent = email;
    $("#account-avatar").textContent = name.trim().charAt(0).toUpperCase() || "Q";
    hydrateHomepageForm();
    renderAll();
    var hashView = window.location.hash.replace(/^#/, "");
    switchView(["dashboard", "homepage", "projects", "history"].indexOf(hashView) >= 0 ? hashView : "dashboard", false);
    if (DEMO_ENABLED) toast("Demo mode", "All saves, publishes, and rollbacks are simulated locally.");
  }

  function bindStaticEvents() {
    $("#sign-in-button").addEventListener("click", function () {
      if (DEMO_ENABLED) {
        window.location.reload();
        return;
      }
      var loginUrl = new URL("/cdn-cgi/access/login", window.location.origin);
      loginUrl.searchParams.set("redirect_url", window.location.href);
      window.location.assign(loginUrl.toString());
    });
    $("#retry-session-button").addEventListener("click", function () { window.location.reload(); });
    $all("[data-view]").forEach(function (button) {
      button.addEventListener("click", function () { switchView(button.dataset.view, true); });
    });
    $all("[data-go]").forEach(function (button) {
      button.addEventListener("click", function () { switchView(button.dataset.go, true); });
    });
    window.addEventListener("hashchange", function () {
      var view = window.location.hash.replace(/^#/, "");
      if (["dashboard", "homepage", "projects", "history"].indexOf(view) >= 0) switchView(view, false);
    });
    $("#homepage-form").addEventListener("input", handleStaticFormInput);
    $("#homepage-form").addEventListener("change", handleStaticFormInput);
    $("#homepage-form").addEventListener("submit", function (event) {
      event.preventDefault();
      saveDraft();
    });
    $("#add-stack-button").addEventListener("click", addSkill);
    $("#add-about-paragraph-button").addEventListener("click", addAboutParagraph);
    ["#add-project-button", "#empty-add-project-button", "#dashboard-add-project"].forEach(function (selector) {
      $(selector).addEventListener("click", addProject);
    });
    $("#project-search").addEventListener("input", renderProjects);
    $("#clear-project-search-button").addEventListener("click", function () {
      $("#project-search").value = "";
      renderProjects();
      $("#project-search").focus();
    });
    $("#preview-button").addEventListener("click", openPreview);
    $("#close-preview-button").addEventListener("click", function () { $("#preview-dialog").close(); });
    $all("[data-preview-size]").forEach(function (button) {
      button.addEventListener("click", function () { setPreviewSize(button.dataset.previewSize); });
    });
    $("#save-button").addEventListener("click", function () { saveDraft(); });
    $("#mobile-save-button").addEventListener("click", function () { saveDraft(); });
    $("#publish-button").addEventListener("click", publishDraft);
    $("#refresh-history-button").addEventListener("click", loadVersions);
    $("#load-more-versions-button").addEventListener("click", function () { loadVersions(false, true); });
    $("#account-button").addEventListener("click", toggleAccountMenu);
    $("#logout-button").addEventListener("click", logout);
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".account-block")) closeAccountMenu();
    });
    $("#dismiss-error-button").addEventListener("click", function () { $("#error-banner").hidden = true; });
    $("#download-conflict-button").addEventListener("click", function () { downloadContent(state.content, "qixuan-site-local-conflict.json"); });
    $("#reload-conflict-button").addEventListener("click", reloadRemoteDraft);
    $("#restore-recovery-button").addEventListener("click", restoreLocalRecovery);
    $("#discard-recovery-button").addEventListener("click", discardLocalRecovery);
    $("#confirm-cancel-button").addEventListener("click", function () { resolveConfirmation(false); });
    $("#confirm-accept-button").addEventListener("click", function () { resolveConfirmation(true); });
    $("#confirm-dialog").addEventListener("cancel", function (event) { event.preventDefault(); resolveConfirmation(false); });
    window.addEventListener("beforeunload", function (event) {
      if (!state.dirty || state.allowNavigation) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function handleStaticFormInput(event) {
    var target = event.target;
    if (!target.name || !state.content) return;
    var value = target.type === "checkbox" ? target.checked : target.value;
    if (target.name === "now.url" && !nonEmpty(value)) value = null;
    setPath(state.content, target.name, value);
    updateCharacterCount(target);
    markDirty();
    renderDashboard();
  }

  function hydrateHomepageForm() {
    $all("#homepage-form [name]").forEach(function (control) {
      var value = getPath(state.content, control.name);
      if (control.type === "checkbox") control.checked = Boolean(value);
      else control.value = value === null || value === undefined ? "" : String(value);
      updateCharacterCount(control);
    });
    renderDomainInputs();
    renderAboutParagraphInputs();
    renderSkillInputs();
    renderProcessInputs();
  }

  function updateCharacterCount(control) {
    var counter = $("[data-count-for=\"" + control.id + "\"]");
    if (counter) counter.textContent = String(control.value.length);
  }

  function renderDomainInputs() {
    var container = $("#focus-list");
    container.replaceChildren();
    state.content.domains.forEach(function (value, index) {
      var row = makeElement("label", "repeat-item");
      var number = makeElement("span", "repeat-index", String(index + 1).padStart(2, "0"));
      var input = makeElement("input");
      input.type = "text";
      input.maxLength = 120;
      input.value = value;
      input.setAttribute("aria-label", "Focus area " + (index + 1));
      var fixed = makeElement("span", "repeat-index", "LOCK");
      input.addEventListener("input", function () {
        state.content.domains[index] = input.value;
        markDirty();
        renderDashboard();
      });
      appendChildren(row, number, input, fixed);
      container.appendChild(row);
    });
  }

  function renderSkillInputs() {
    var container = $("#stack-list");
    container.replaceChildren();
    state.content.about.skills.forEach(function (value, index) {
      var row = makeElement("label", "repeat-item");
      var number = makeElement("span", "repeat-index", String(index + 1).padStart(2, "0"));
      var input = makeElement("input");
      input.type = "text";
      input.maxLength = 64;
      input.value = value;
      input.setAttribute("aria-label", "Tool stack item " + (index + 1));
      var remove = makeElement("button", "icon-button", "×");
      remove.type = "button";
      remove.disabled = state.content.about.skills.length <= 1;
      remove.setAttribute("aria-label", "Remove " + (value || "tool"));
      input.addEventListener("input", function () {
        state.content.about.skills[index] = input.value;
        markDirty();
      });
      remove.addEventListener("click", function () {
        if (state.content.about.skills.length <= 1) return;
        state.content.about.skills.splice(index, 1);
        renderSkillInputs();
        markDirty();
      });
      appendChildren(row, number, input, remove);
      container.appendChild(row);
    });
    $("#add-stack-button").disabled = state.content.about.skills.length >= 8;
  }

  function renderAboutParagraphInputs() {
    var container = $("#about-paragraph-list");
    container.replaceChildren();
    state.content.about.paragraphs.forEach(function (value, index) {
      var row = makeElement("label", "paragraph-item");
      var number = makeElement("span", "repeat-index", String(index + 1).padStart(2, "0"));
      var input = makeElement("textarea");
      input.rows = 4;
      input.maxLength = 800;
      input.value = value;
      input.setAttribute("aria-label", "About paragraph " + (index + 1));
      var remove = makeElement("button", "icon-button", "×");
      remove.type = "button";
      remove.disabled = state.content.about.paragraphs.length <= 1;
      remove.setAttribute("aria-label", "Remove about paragraph " + (index + 1));
      input.addEventListener("input", function () {
        state.content.about.paragraphs[index] = input.value;
        markDirty();
      });
      remove.addEventListener("click", function () {
        if (state.content.about.paragraphs.length <= 1) return;
        state.content.about.paragraphs.splice(index, 1);
        renderAboutParagraphInputs();
        markDirty();
      });
      appendChildren(row, number, input, remove);
      container.appendChild(row);
    });
    $("#add-about-paragraph-button").disabled = state.content.about.paragraphs.length >= 4;
  }

  function addAboutParagraph() {
    if (state.content.about.paragraphs.length >= 4) return;
    state.content.about.paragraphs.push("New paragraph");
    renderAboutParagraphInputs();
    markDirty();
    var inputs = $all("#about-paragraph-list textarea");
    if (inputs.length) {
      inputs[inputs.length - 1].focus();
      inputs[inputs.length - 1].select();
    }
  }

  function addSkill() {
    if (state.content.about.skills.length >= 8) return;
    state.content.about.skills.push("New tool");
    renderSkillInputs();
    markDirty();
    var inputs = $all("#stack-list input");
    if (inputs.length) {
      inputs[inputs.length - 1].focus();
      inputs[inputs.length - 1].select();
    }
  }

  function renderProcessInputs() {
    var container = $("#process-list");
    container.replaceChildren();
    state.content.method.items.forEach(function (item, index) {
      var card = makeElement("section", "process-card");
      var number = makeElement("span", "process-number", "PROCESS / " + String(index + 1).padStart(2, "0"));
      appendChildren(card, number);
      [
        { field: "label", label: "Signal label", tag: "input", max: 120 },
        { field: "title", label: "Title", tag: "input", max: 120 },
        { field: "description", label: "Description", tag: "textarea", max: 800 }
      ].forEach(function (definition) {
        var label = makeElement("label");
        var labelText = makeElement("span", "", definition.label);
        var control = makeElement(definition.tag);
        control.value = item[definition.field] || "";
        control.maxLength = definition.max;
        if (definition.tag === "textarea") control.rows = 4;
        control.addEventListener("input", function () {
          state.content.method.items[index][definition.field] = control.value;
          markDirty();
        });
        appendChildren(label, labelText, control);
        card.appendChild(label);
      });
      container.appendChild(card);
    });
  }

  function switchView(view, updateHash) {
    if (!state.content) return;
    state.activeView = view;
    $all("[data-view-panel]").forEach(function (panel) {
      var active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    $all("[data-view]").forEach(function (button) {
      var active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (updateHash) window.history.pushState(null, "", "#" + view);
    if (view === "projects") renderProjects();
    if (view === "history") renderHistory();
    if (view === "dashboard") renderDashboard();
    $("#admin-main").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function renderAll() {
    renderStatus();
    renderDashboard();
    renderProjects();
    renderHistory();
  }

  function renderStatus() {
    $("#revision-label").textContent = "Draft r" + state.revision;
    $("#sidebar-local-state").textContent = state.dirty ? "Unsaved" : "Clean";
    var publicRevision = publishedRevisionNumber();
    $("#sidebar-published-revision").textContent = state.publishedRevision ? (publicRevision === null ? "Live" : "r" + publicRevision) : "Not yet";
    $("#sidebar-last-sync").textContent = relativeTime(state.updatedAt);
    $("#mobile-dirty-bar").hidden = !state.dirty;
    $("#save-button").disabled = state.busy || !state.dirty;
    $("#mobile-save-button").disabled = state.busy || !state.dirty;
    $("#publish-button").disabled = state.busy;
    var light = $("#connection-light");
    light.classList.toggle("is-offline", !state.online);
    light.classList.toggle("is-working", state.busy);
    $("#connection-label").textContent = DEMO_ENABLED ? "Local demo" : state.busy ? "Working" : state.online ? "Connected" : "Offline";
  }

  function publishedRevisionNumber() {
    var current = state.versions.find(function (version) { return version.id === state.publishedRevision || version.isPublished; });
    return current && Number.isInteger(current.revision) ? current.revision : null;
  }

  function readinessChecks() {
    var published = state.content.projects.filter(function (project) { return project.published; });
    var featured = published.filter(function (project) { return project.featured; });
    var ids = state.content.projects.map(function (project) { return project.id; });
    return [
      { label: "Hero message is complete", hint: "Headline + intro", complete: nonEmpty(state.content.hero.headline.line1) && nonEmpty(state.content.hero.headline.primaryAccent) && nonEmpty(state.content.hero.intro.tail) },
      { label: "Contact channel is valid", hint: "Email", complete: isEmail(state.content.site.email) },
      { label: "At least one project is visible", hint: "Published", complete: published.length > 0 },
      { label: "One visible project is featured", hint: "Homepage lead", complete: featured.length === 1 },
      { label: "Project identifiers are unique", hint: "Routing", complete: ids.length === new Set(ids).size && ids.every(function (id) { return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id); }) }
    ];
  }

  function renderDashboard() {
    if (!state.content) return;
    var projects = state.content.projects;
    var published = projects.filter(function (project) { return project.published; });
    var featured = projects.find(function (project) { return project.featured && project.published; });
    var checks = readinessChecks();
    var readyCount = checks.filter(function (check) { return check.complete; }).length;
    $("#metric-revision").textContent = "r" + state.revision;
    $("#metric-draft-state").textContent = state.dirty ? "Unsaved edits" : "Synced to server";
    $("#metric-projects").textContent = String(projects.length).padStart(2, "0");
    $("#metric-published-projects").textContent = published.length + " published";
    $("#metric-featured").textContent = featured ? featured.title : "Not set";
    var publicRevision = publishedRevisionNumber();
    $("#metric-published").textContent = state.publishedRevision ? (publicRevision === null ? "Live" : "r" + publicRevision) : "Not yet";
    $("#metric-published-detail").textContent = state.publishedRevision ? "Current public version" : "Draft only";
    $("#readiness-score").textContent = readyCount + "/" + checks.length;
    $("#dashboard-health").textContent = readyCount === checks.length ? "Ready" : "Review";
    $("#dashboard-health-light").classList.toggle("is-warning", readyCount !== checks.length);
    var checklist = $("#readiness-list");
    checklist.replaceChildren();
    checks.forEach(function (check) {
      var item = makeElement("li", check.complete ? "is-complete" : "");
      var mark = makeElement("span", "check-mark", check.complete ? "✓" : "");
      appendChildren(item, mark, makeElement("span", "", check.label), makeElement("small", "", check.hint));
      checklist.appendChild(item);
    });
    renderDashboardActivity();
    renderProjectLine();
    renderStatus();
  }

  function renderDashboardActivity() {
    var list = $("#dashboard-activity");
    list.replaceChildren();
    var items = state.versions.slice(0, 4);
    $("#dashboard-activity-empty").hidden = items.length > 0;
    items.forEach(function (version, index) {
      var item = makeElement("li", "activity-item");
      var number = makeElement("span", "activity-index", String(index + 1).padStart(2, "0"));
      var copy = makeElement("span", "activity-copy");
      appendChildren(copy, makeElement("b", "", actionLabel(version.action) + " r" + version.revision), makeElement("small", "", version.createdBy || "Unknown operator"));
      appendChildren(item, number, copy, makeElement("time", "activity-time", relativeTime(version.createdAt)));
      list.appendChild(item);
    });
  }

  function renderProjectLine() {
    var line = $("#dashboard-project-line");
    line.replaceChildren();
    var projects = sortedProjects();
    if (!projects.length) {
      line.appendChild(makeElement("p", "fieldset-copy", "No projects are registered in this draft."));
      return;
    }
    projects.forEach(function (project, index) {
      var item = makeElement("div", "project-line-item");
      appendChildren(item,
        makeElement("span", "", String(index + 1).padStart(2, "0") + " / " + project.category),
        makeElement("b", "", project.title),
        makeElement("small", "", project.published ? (project.featured ? "Published / Featured" : "Published") : "Hidden")
      );
      line.appendChild(item);
    });
  }

  function sortedProjects() {
    return state.content.projects.slice().sort(function (a, b) { return a.order - b.order; });
  }

  function addProject() {
    if (state.content.projects.length >= 24) {
      toast("Project limit reached", "The content schema allows up to 24 projects.", true);
      return;
    }
    var title = "Untitled project";
    var id = uniqueId("untitled-project");
    var project = {
      id: id,
      slug: id,
      title: title,
      category: "New build",
      summary: "Add a short project summary before publishing.",
      status: "planned",
      statusLabel: "Planned",
      tags: [],
      link: null,
      note: "Draft project",
      featured: false,
      published: false,
      order: (state.content.projects.length + 1) * 10,
      visual: { type: "preset", key: VISUAL_VALUES[state.content.projects.length % VISUAL_VALUES.length] }
    };
    state.content.projects.push(project);
    markDirty();
    switchView("projects", true);
    renderProjects(project.id);
    window.setTimeout(function () {
      var input = $("[data-project-id=\"" + project.id + "\"] [data-project-field=\"title\"]");
      if (input) { input.focus(); input.select(); }
    }, 0);
  }

  function renderProjects(openId) {
    if (!state.content) return;
    var list = $("#project-editor-list");
    var search = $("#project-search").value.trim().toLowerCase();
    var currentlyOpen = openId || (($(".project-editor.is-open") || {}).dataset || {}).projectId;
    var projects = sortedProjects();
    var filtered = projects.filter(function (project) {
      return !search || [project.title, project.category, project.statusLabel].concat(project.tags).join(" ").toLowerCase().indexOf(search) >= 0;
    });
    list.replaceChildren();
    $("#project-empty").hidden = state.content.projects.length > 0;
    $("#project-filter-empty").hidden = state.content.projects.length === 0 || filtered.length > 0;
    $("#project-count").textContent = filtered.length + (filtered.length === 1 ? " project" : " projects");
    filtered.forEach(function (project, visibleIndex) {
      list.appendChild(createProjectEditor(project, projects.indexOf(project), project.id === currentlyOpen, visibleIndex));
    });
  }

  function createProjectEditor(project, projectIndex, open, visibleIndex) {
    var article = makeElement("article", "project-editor" + (open ? " is-open" : ""));
    article.dataset.projectId = project.id;
    article.draggable = true;
    var header = makeElement("header", "project-summary");
    var handle = makeElement("span", "drag-handle", ":::");
    handle.title = "Drag to reorder";
    var titleButton = makeElement("button", "project-title-block project-title-button");
    titleButton.type = "button";
    titleButton.setAttribute("aria-expanded", open ? "true" : "false");
    appendChildren(titleButton, makeElement("b", "", project.title), makeElement("small", "", String(projectIndex + 1).padStart(2, "0") + " / " + project.category + " / " + project.statusLabel));
    var badges = makeElement("span", "project-badges");
    if (project.featured) badges.appendChild(makeElement("span", "badge badge-featured", "Featured"));
    badges.appendChild(makeElement("span", project.published ? "badge badge-published" : "badge", project.published ? "Published" : "Hidden"));
    var sortButtons = makeElement("span", "project-sort-buttons");
    var up = makeElement("button", "", "↑");
    var down = makeElement("button", "", "↓");
    up.type = down.type = "button";
    up.disabled = projectIndex === 0;
    down.disabled = projectIndex === state.content.projects.length - 1;
    up.setAttribute("aria-label", "Move " + project.title + " up");
    down.setAttribute("aria-label", "Move " + project.title + " down");
    up.addEventListener("click", function () { moveProject(project.id, -1); });
    down.addEventListener("click", function () { moveProject(project.id, 1); });
    appendChildren(sortButtons, up, down);
    var toggle = makeElement("button", "project-chevron", "›");
    toggle.type = "button";
    toggle.setAttribute("aria-label", (open ? "Collapse " : "Expand ") + project.title);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    var bodyId = "project-body-" + project.id;
    toggle.setAttribute("aria-controls", bodyId);
    titleButton.setAttribute("aria-controls", bodyId);
    appendChildren(header, handle, titleButton, badges, sortButtons, toggle);
    var body = createProjectBody(project, projectIndex);
    body.id = bodyId;
    body.hidden = !open;
    function toggleOpen() {
      var nextOpen = body.hidden;
      body.hidden = !nextOpen;
      article.classList.toggle("is-open", nextOpen);
      titleButton.setAttribute("aria-expanded", String(nextOpen));
      toggle.setAttribute("aria-expanded", String(nextOpen));
      toggle.setAttribute("aria-label", (nextOpen ? "Collapse " : "Expand ") + project.title);
    }
    titleButton.addEventListener("click", toggleOpen);
    toggle.addEventListener("click", toggleOpen);
    article.addEventListener("dragstart", function (event) {
      state.draggedProjectId = project.id;
      article.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", project.id);
      }
    });
    article.addEventListener("dragend", function () {
      state.draggedProjectId = null;
      $all(".project-editor").forEach(function (element) { element.classList.remove("is-dragging", "is-drop-target"); });
    });
    article.addEventListener("dragover", function (event) {
      if (!state.draggedProjectId || state.draggedProjectId === project.id) return;
      event.preventDefault();
      article.classList.add("is-drop-target");
    });
    article.addEventListener("dragleave", function () { article.classList.remove("is-drop-target"); });
    article.addEventListener("drop", function (event) {
      event.preventDefault();
      reorderProjectBefore(state.draggedProjectId, project.id);
    });
    appendChildren(article, header, body);
    return article;
  }

  function createProjectBody(project, projectIndex) {
    var body = makeElement("div", "project-editor-body");
    var controls = makeElement("div", "project-controls");
    var toggles = makeElement("div", "toggle-row");
    toggles.appendChild(createProjectToggle(project, "published", "Published"));
    toggles.appendChild(createProjectToggle(project, "featured", "Featured"));
    var remove = makeElement("button", "delete-project-button", "Delete project");
    remove.type = "button";
    remove.addEventListener("click", function () { deleteProject(project.id); });
    appendChildren(controls, toggles, remove);
    var grid = makeElement("div", "project-form-grid");
    grid.appendChild(createProjectField(project, "title", "Project title", "text", 120));
    grid.appendChild(createSlugField(project));
    grid.appendChild(createProjectField(project, "category", "Category", "text", 120));
    grid.appendChild(createStatusField(project));
    grid.appendChild(createProjectField(project, "statusLabel", "Status label", "text", 120));
    grid.appendChild(createVisualField(project));
    grid.appendChild(createProjectField(project, "summary", "Summary", "textarea", 800, true));
    grid.appendChild(createTagsField(project));
    grid.appendChild(createLinkLabelField(project));
    grid.appendChild(createLinkUrlField(project));
    grid.appendChild(createProjectField(project, "note", "Project note", "text", 160, true, true));
    var footer = makeElement("div", "project-footer-actions");
    var duplicate = makeElement("button", "button button-secondary button-small duplicate-project-button", "Duplicate project");
    duplicate.type = "button";
    duplicate.addEventListener("click", function () { duplicateProject(project.id); });
    footer.appendChild(duplicate);
    appendChildren(body, controls, grid, footer);
    return body;
  }

  function createProjectToggle(project, field, labelText) {
    var label = makeElement("label", "toggle-label");
    var text = makeElement("span", "", labelText);
    var input = makeElement("input");
    input.type = "checkbox";
    input.checked = Boolean(project[field]);
    input.addEventListener("change", function () {
      if (field === "featured" && input.checked) {
        state.content.projects.forEach(function (candidate) { candidate.featured = candidate.id === project.id; });
      } else {
        project[field] = input.checked;
      }
      markDirty();
      renderProjects(project.id);
      renderDashboard();
    });
    appendChildren(label, text, input, makeElement("span", "toggle-ui"));
    return label;
  }

  function createProjectField(project, field, labelText, type, maxLength, wide, nullable) {
    var label = makeElement("label", "project-field" + (wide ? " project-field-wide" : ""));
    var caption = makeElement("span", "", labelText);
    var input = makeElement(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") input.type = type;
    else input.rows = 4;
    input.maxLength = maxLength;
    input.value = project[field] || "";
    input.dataset.projectField = field;
    input.addEventListener("input", function () {
      project[field] = nullable && !nonEmpty(input.value) ? null : input.value;
      markDirty();
      if (field === "title") {
        var title = $("[data-project-id=\"" + project.id + "\"] .project-title-block b");
        if (title) title.textContent = input.value || "Untitled project";
      }
    });
    appendChildren(label, caption, input);
    return label;
  }

  function createSlugField(project) {
    var label = makeElement("label", "project-field");
    var caption = makeElement("span", "", "Slug / ID");
    var input = makeElement("input");
    input.type = "text";
    input.maxLength = 64;
    input.pattern = "[a-z0-9][a-z0-9-]{0,63}";
    input.value = project.id;
    input.addEventListener("change", function () {
      var nextId = slugify(input.value);
      project.id = nextId;
      project.slug = nextId;
      input.value = nextId;
      markDirty();
      renderProjects(nextId);
    });
    appendChildren(label, caption, input, makeElement("small", "", "Lowercase letters, numbers, and hyphens."));
    return label;
  }

  function createStatusField(project) {
    var label = makeElement("label", "project-field");
    var caption = makeElement("span", "", "Status code");
    var select = makeElement("select");
    STATUS_VALUES.forEach(function (status) {
      var option = makeElement("option", "", status.replace("_", " "));
      option.value = status;
      option.selected = project.status === status;
      select.appendChild(option);
    });
    select.addEventListener("change", function () { project.status = select.value; markDirty(); });
    appendChildren(label, caption, select);
    return label;
  }

  function createVisualField(project) {
    var label = makeElement("label", "project-field");
    var caption = makeElement("span", "", "Visual preset");
    var select = makeElement("select");
    VISUAL_VALUES.forEach(function (visual) {
      var option = makeElement("option", "", visual);
      option.value = visual;
      option.selected = project.visual.key === visual;
      select.appendChild(option);
    });
    select.addEventListener("change", function () { project.visual = { type: "preset", key: select.value }; markDirty(); });
    appendChildren(label, caption, select);
    return label;
  }

  function createTagsField(project) {
    var label = makeElement("label", "project-field project-field-wide");
    var caption = makeElement("span", "", "Tags");
    var input = makeElement("input");
    input.type = "text";
    input.maxLength = 270;
    input.value = project.tags.join(", ");
    input.placeholder = "Python, OpenCV, YOLO";
    input.addEventListener("input", function () {
      project.tags = Array.from(new Set(input.value.split(",").map(function (tag) { return tag.trim().slice(0, 32); }).filter(nonEmpty))).slice(0, 8);
      markDirty();
    });
    appendChildren(label, caption, input, makeElement("small", "", "Comma separated, up to eight."));
    return label;
  }

  function createLinkLabelField(project) {
    var label = makeElement("label", "project-field");
    var caption = makeElement("span", "", "Link label");
    var input = makeElement("input");
    input.type = "text";
    input.maxLength = 120;
    input.value = project.link ? project.link.label : "";
    input.dataset.linkPart = "label";
    input.addEventListener("input", function () {
      if (project.link) project.link.label = input.value || "View project";
      markDirty();
    });
    appendChildren(label, caption, input);
    return label;
  }

  function createLinkUrlField(project) {
    var label = makeElement("label", "project-field");
    var caption = makeElement("span", "", "Link URL");
    var input = makeElement("input");
    input.type = "url";
    input.maxLength = 500;
    input.placeholder = "https://github.com/...";
    input.value = project.link ? project.link.url : "";
    input.dataset.linkPart = "url";
    input.addEventListener("input", function () {
      if (!nonEmpty(input.value)) project.link = null;
      else {
        var card = input.closest(".project-editor-body");
        var labelInput = $("[data-link-part=\"label\"]", card);
        project.link = { label: labelInput && nonEmpty(labelInput.value) ? labelInput.value : "View project", url: input.value };
      }
      markDirty();
    });
    appendChildren(label, caption, input);
    return label;
  }

  function moveProject(id, delta) {
    var ordered = sortedProjects();
    var from = ordered.findIndex(function (project) { return project.id === id; });
    var to = from + delta;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    var moved = ordered.splice(from, 1)[0];
    ordered.splice(to, 0, moved);
    applyProjectOrder(ordered);
    markDirty();
    renderProjects(id);
    renderDashboard();
  }

  function reorderProjectBefore(draggedId, targetId) {
    if (!draggedId || draggedId === targetId) return;
    var ordered = sortedProjects();
    var from = ordered.findIndex(function (project) { return project.id === draggedId; });
    var to = ordered.findIndex(function (project) { return project.id === targetId; });
    if (from < 0 || to < 0) return;
    var moved = ordered.splice(from, 1)[0];
    var adjustedTo = from < to ? to - 1 : to;
    ordered.splice(adjustedTo, 0, moved);
    applyProjectOrder(ordered);
    markDirty();
    renderProjects(draggedId);
    renderDashboard();
  }

  function applyProjectOrder(ordered) {
    ordered.forEach(function (project, index) { project.order = (index + 1) * 10; });
    state.content.projects = ordered;
  }

  async function deleteProject(id) {
    var project = state.content.projects.find(function (candidate) { return candidate.id === id; });
    if (!project) return;
    var confirmed = await confirmAction({
      kicker: "Remove project",
      title: "Delete “" + project.title + "”?",
      copy: "It will be removed from this draft. The published site will not change until you publish again.",
      accept: "Delete project"
    });
    if (!confirmed) return;
    state.content.projects = state.content.projects.filter(function (candidate) { return candidate.id !== id; });
    applyProjectOrder(sortedProjects());
    markDirty();
    renderProjects();
    renderDashboard();
    toast("Project removed", project.title + " was removed from the draft.");
  }

  function duplicateProject(id) {
    if (state.content.projects.length >= 24) {
      toast("Project limit reached", "Delete or archive a project before creating another copy.", true);
      return;
    }
    var project = state.content.projects.find(function (candidate) { return candidate.id === id; });
    if (!project) return;
    var copy = deepClone(project);
    copy.id = uniqueId(project.slug + "-copy");
    copy.slug = copy.id;
    copy.title = project.title.slice(0, 115).trimEnd() + " Copy";
    copy.featured = false;
    copy.published = false;
    copy.order = (state.content.projects.length + 1) * 10;
    state.content.projects.push(copy);
    markDirty();
    renderProjects(copy.id);
    renderDashboard();
    toast("Project duplicated", "The copy is hidden until you publish it.");
  }

  function markDirty() {
    state.dirty = stableSnapshot(state.content) !== state.savedSnapshot;
    if (state.dirty && state.recoveryBaseRevision === null) state.recoveryBaseRevision = state.revision;
    if (!state.dirty) {
      state.recoveryBaseRevision = null;
      state.staleRecovery = false;
    }
    renderStatus();
    scheduleLocalRecovery();
  }

  function scheduleLocalRecovery() {
    window.clearTimeout(state.recoveryTimer);
    if (!state.dirty) {
      clearLocalRecovery();
      return;
    }
    state.recoveryTimer = window.setTimeout(writeLocalRecoveryNow, 350);
  }

  function writeLocalRecoveryNow() {
    if (!state.dirty) return;
    try {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        baseRevision: state.recoveryBaseRevision === null ? state.revision : state.recoveryBaseRevision,
        content: state.content
      }));
    } catch (error) {
      // The server draft remains the durable save path when storage is unavailable.
    }
  }

  function readLocalRecovery() {
    try {
      var parsed = JSON.parse(localStorage.getItem(RECOVERY_KEY) || "null");
      if (!isRecord(parsed) || !isRecord(parsed.content)) return;
      if (stableSnapshot(parsed.content) === stableSnapshot(state.content)) {
        clearLocalRecovery();
        return;
      }
      state.localRecovery = parsed;
      $("#recovery-copy").textContent = "Saved " + formatDate(parsed.savedAt, true) + " from draft r" + parsed.baseRevision + ". It has not replaced server draft r" + state.revision + ".";
      $("#recovery-banner").hidden = false;
    } catch (error) {
      clearLocalRecovery();
    }
  }

  function restoreLocalRecovery() {
    if (!state.localRecovery) return;
    state.recoveryBaseRevision = Number.isInteger(Number(state.localRecovery.baseRevision)) ? Number(state.localRecovery.baseRevision) : state.revision;
    state.staleRecovery = state.recoveryBaseRevision !== state.revision;
    state.content = normalizeContent(state.localRecovery.content);
    state.dirty = true;
    $("#recovery-banner").hidden = true;
    hydrateHomepageForm();
    renderAll();
    if (state.staleRecovery) {
      $("#conflict-banner").hidden = false;
      toast("Older recovery restored", "Review carefully: it started from an older server revision.", true);
    } else {
      toast("Local edits restored", "Review them, then save the draft to the server.");
    }
  }

  function discardLocalRecovery() {
    state.localRecovery = null;
    state.staleRecovery = false;
    state.recoveryBaseRevision = null;
    clearLocalRecovery();
    $("#recovery-banner").hidden = true;
    toast("Recovery discarded", "The server draft remains unchanged.");
  }

  function clearLocalRecovery() {
    try { localStorage.removeItem(RECOVERY_KEY); } catch (error) { /* Ignore unavailable storage. */ }
  }

  function validateDraft() {
    var issues = [];
    var content = state.content;
    if (!nonEmpty(content.site.name) || !nonEmpty(content.site.shortMark) || !nonEmpty(content.site.title) || !nonEmpty(content.site.description) || !nonEmpty(content.site.footerText)) issues.push("Complete the site identity and search metadata.");
    if (!isHttpsUrl(content.site.canonicalUrl)) issues.push("Canonical URL must start with https://.");
    if (!isEmail(content.site.email)) issues.push("Enter a valid contact email.");
    if (!isHttpsUrl(content.site.githubUrl)) issues.push("GitHub URL must start with https://.");
    if (Object.keys(content.navigation).some(function (key) { return !nonEmpty(content.navigation[key]); })) issues.push("Navigation labels cannot be empty.");
    if (!nonEmpty(content.hero.headline.line1) || !nonEmpty(content.hero.headline.line2Prefix) || !nonEmpty(content.hero.headline.primaryAccent) || !nonEmpty(content.hero.headline.line3Prefix) || !nonEmpty(content.hero.headline.secondaryAccent)) issues.push("Complete all hero headline parts.");
    if (!nonEmpty(content.hero.intro.lead) || !nonEmpty(content.hero.intro.emphasis) || !nonEmpty(content.hero.intro.tail)) issues.push("Complete the hero introduction.");
    if (!nonEmpty(content.hero.availabilityLabel) || !nonEmpty(content.hero.primaryCtaLabel) || !nonEmpty(content.hero.secondaryCtaLabel) || !nonEmpty(content.hero.scrollLabel)) issues.push("Complete the hero labels and actions.");
    if (!nonEmpty(content.systemMap.label) || !nonEmpty(content.systemMap.state) || !nonEmpty(content.systemMap.focusLabel) || !nonEmpty(content.systemMap.focusValue) || !nonEmpty(content.systemMap.modeLabel) || !nonEmpty(content.systemMap.modeValue)) issues.push("Complete the system-map labels.");
    if (!Array.isArray(content.systemMap.nodes) || content.systemMap.nodes.length !== 3 || content.systemMap.nodes.some(function (node) { return !nonEmpty(node.name) || !nonEmpty(node.description) || !nonEmpty(node.signal); })) issues.push("Complete all three system-map nodes.");
    if (!Array.isArray(content.domains) || content.domains.length !== 4 || content.domains.some(function (item) { return !nonEmpty(item); })) issues.push("Keep exactly four non-empty focus areas.");
    if (!nonEmpty(content.work.sectionLabel) || !nonEmpty(content.work.titleLead) || !nonEmpty(content.work.titleAccent)) issues.push("Complete the projects section heading.");
    if (!nonEmpty(content.now.label) || !nonEmpty(content.now.title) || !nonEmpty(content.now.summary) || !nonEmpty(content.now.statusLabel) || STATUS_VALUES.indexOf(content.now.status) < 0 || (content.now.url !== null && !isHttpsUrl(content.now.url))) issues.push("Complete the Now / next project and use an https:// URL when present.");
    if (!nonEmpty(content.method.sectionLabel) || !nonEmpty(content.method.title)) issues.push("Complete the build-loop heading.");
    if (!Array.isArray(content.method.items) || content.method.items.length !== 3 || content.method.items.some(function (item) { return !nonEmpty(item.label) || !nonEmpty(item.title) || !nonEmpty(item.description); })) issues.push("Complete all three build-loop steps.");
    if (!nonEmpty(content.about.sectionLabel) || !nonEmpty(content.about.headingLead) || !nonEmpty(content.about.headingAccent)) issues.push("Complete the About heading.");
    if (!Array.isArray(content.about.paragraphs) || !content.about.paragraphs.length || content.about.paragraphs.some(function (item) { return !nonEmpty(item); })) issues.push("About paragraphs cannot be empty.");
    if (!Array.isArray(content.about.skills) || !content.about.skills.length || content.about.skills.some(function (item) { return !nonEmpty(item); })) issues.push("Add at least one non-empty tool-stack item.");
    if (Array.isArray(content.about.skills) && new Set(content.about.skills).size !== content.about.skills.length) issues.push("Tool-stack items must be unique.");
    if (!nonEmpty(content.contact.kicker) || !nonEmpty(content.contact.heading) || !nonEmpty(content.contact.buttonLabel)) issues.push("Complete the contact section.");
    var ids = new Set();
    if (content.projects.length > 24) issues.push("Keep the project register at 24 items or fewer.");
    content.projects.forEach(function (project, index) {
      var label = "Project " + (index + 1);
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(project.id) || project.slug !== project.id) issues.push(label + " needs a valid matching slug and ID.");
      if (ids.has(project.id)) issues.push("Project IDs must be unique.");
      ids.add(project.id);
      if (!nonEmpty(project.title) || !nonEmpty(project.category) || !nonEmpty(project.summary) || !nonEmpty(project.statusLabel)) issues.push(label + " has an empty required field.");
      if (STATUS_VALUES.indexOf(project.status) < 0) issues.push(label + " has an invalid status.");
      if (!Number.isInteger(project.order) || project.order < 0 || project.order > 10000) issues.push(label + " has an invalid sort order.");
      if (!isRecord(project.visual) || VISUAL_VALUES.indexOf(project.visual.key) < 0) issues.push(label + " needs a valid visual preset.");
      if (project.link && (!nonEmpty(project.link.label) || !isHttpsUrl(project.link.url))) issues.push(label + " link must use https:// and include a label.");
      if (project.tags.length > 8 || project.tags.some(function (tag) { return !nonEmpty(tag) || tag.length > 32; })) issues.push(label + " has invalid tags.");
    });
    return issues;
  }

  async function saveDraft(options) {
    var config = options || {};
    if (!state.dirty && !config.force) {
      if (!config.quiet) toast("Draft already synced", "There are no local edits to save.");
      return true;
    }
    if (state.staleRecovery) {
      var overwriteConfirmed = await confirmAction({
        kicker: "Older recovery",
        title: "Replace the newer server draft?",
        copy: "This local recovery started from an older revision. Saving it writes the complete recovered document over the current server draft. Export a copy first if you may need both.",
        accept: "Replace server draft"
      });
      if (!overwriteConfirmed) return false;
    }
    var issues = validateDraft();
    if (issues.length) {
      showLocalValidation(issues);
      return false;
    }
    setBusy(true);
    try {
      var body = { content: state.content, expectedRevision: state.revision };
      var result;
      try {
        result = await apiRequest("/content", { method: "PUT", body: body, mutation: true, etag: state.etag || "\"draft-" + state.revision + "\"" });
      } catch (error) {
        if (error.status === 404 || error.status === 405) result = await apiRequest("/draft", { method: "PUT", body: body, mutation: true, etag: state.etag || "\"draft-" + state.revision + "\"" });
        else throw error;
      }
      applyContentPayload(result);
      state.savedSnapshot = stableSnapshot(state.content);
      state.dirty = false;
      state.online = true;
      state.localRecovery = null;
      state.staleRecovery = false;
      state.recoveryBaseRevision = null;
      clearLocalRecovery();
      $("#conflict-banner").hidden = true;
      $("#error-banner").hidden = true;
      renderAll();
      if (!config.quiet) toast(DEMO_ENABLED ? "Demo draft saved" : "Draft saved", DEMO_ENABLED ? "This change exists only in the local demo." : "Server draft r" + state.revision + " is up to date.");
      return true;
    } catch (error) {
      handleApiError(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function publishDraft() {
    var issues = validateDraft();
    if (issues.length) {
      showLocalValidation(issues);
      return;
    }
    var checks = readinessChecks();
    var hasWarnings = checks.some(function (check) { return !check.complete; });
    var confirmed = await confirmAction({
      kicker: DEMO_ENABLED ? "Demo publish / No network" : hasWarnings ? "Preflight warning / Public change" : "Publish / Public change",
      title: DEMO_ENABLED ? "Simulate this publish?" : hasWarnings ? "Publish with checklist warnings?" : "Publish this draft?",
      copy: DEMO_ENABLED
        ? "This simulates the complete publish flow locally. No public content or server data will change."
        : hasWarnings
          ? "This draft has recommended checklist warnings. Continuing will still make its published fields publicly visible through qixuan.net."
          : "This will make the current draft publicly visible through qixuan.net. Version history will keep the prior public state available for rollback.",
      accept: DEMO_ENABLED ? "Simulate publish" : hasWarnings ? "Publish anyway" : "Publish publicly"
    });
    if (!confirmed) return;
    if (state.dirty) {
      var saved = await saveDraft({ quiet: true });
      if (!saved) return;
    }
    setBusy(true);
    try {
      var result = await apiRequest("/publish", {
        method: "POST",
        body: { expectedRevision: state.revision },
        mutation: true,
        etag: state.etag || "\"draft-" + state.revision + "\""
      });
      applyContentPayload(result);
      state.savedSnapshot = stableSnapshot(state.content);
      state.dirty = false;
      state.staleRecovery = false;
      state.recoveryBaseRevision = null;
      state.online = true;
      await loadVersions(true);
      renderAll();
      toast(DEMO_ENABLED ? "Demo publish simulated" : "Site published", DEMO_ENABLED ? "Nothing was sent to the network." : "Published revision r" + state.revision + " is now the public source.");
    } catch (error) {
      handleApiError(error);
    } finally {
      setBusy(false);
    }
  }

  async function loadVersions(quiet, append) {
    var silent = quiet === true;
    var loadOlder = append === true;
    if (loadOlder && state.versionsNextCursor === null) return;
    var loadMoreButton = $("#load-more-versions-button");
    loadMoreButton.disabled = true;
    try {
      var path = "/versions?limit=50";
      if (loadOlder) path += "&cursor=" + encodeURIComponent(String(state.versionsNextCursor));
      var result = await apiRequest(path);
      var incoming = Array.isArray(result.data.items) ? result.data.items : [];
      if (loadOlder) {
        var knownIds = new Set(state.versions.map(function (version) { return version.id; }));
        state.versions = state.versions.concat(incoming.filter(function (version) { return !knownIds.has(version.id); }));
      } else {
        state.versions = incoming;
      }
      state.versionsNextCursor = result.data.nextCursor === null || Number.isInteger(result.data.nextCursor) ? result.data.nextCursor : null;
      state.online = true;
      renderHistory();
      renderDashboard();
      if (!silent) toast(loadOlder ? "Older versions loaded" : "History refreshed", state.versions.length + " versions available.");
    } catch (error) {
      handleApiError(error);
    } finally {
      loadMoreButton.disabled = state.busy;
    }
  }

  function renderHistory() {
    if (!state.content) return;
    var list = $("#history-list");
    list.replaceChildren();
    $("#history-empty").hidden = state.versions.length > 0;
    $(".history-layout").hidden = state.versions.length === 0;
    $("#load-more-versions-button").hidden = state.versionsNextCursor === null;
    $("#load-more-versions-button").disabled = state.busy;
    state.versions.forEach(function (version, index) {
      var card = makeElement("article", "version-card");
      var number = makeElement("span", "version-index", "r" + version.revision);
      var copy = makeElement("div", "version-copy");
      var title = actionLabel(version.action);
      if (version.isPublished || version.id === state.publishedRevision) title += " / Current public";
      appendChildren(copy,
        makeElement("h2", "", title),
        makeElement("p", "", formatDate(version.createdAt, true) + " · " + (version.createdBy || "Unknown operator"))
      );
      var button = makeElement("button", "button button-secondary button-small", "Restore as draft");
      button.type = "button";
      button.disabled = state.busy || version.revision === state.revision;
      button.addEventListener("click", function () { rollbackVersion(version); });
      appendChildren(card, number, copy, button);
      list.appendChild(card);
    });
  }

  function actionLabel(action) {
    if (action === "publish") return "Published";
    if (action === "rollback") return "Rollback draft";
    return "Draft saved";
  }

  async function rollbackVersion(version) {
    var hadUnsavedEdits = state.dirty;
    if (hadUnsavedEdits) writeLocalRecoveryNow();
    var copy = "Version r" + version.revision + " will become a new server draft. It will not go live until you publish it.";
    if (state.dirty) copy += " Your current unsaved edits remain in local recovery, but the workspace will be replaced.";
    var confirmed = await confirmAction({
      kicker: "Rollback protocol",
      title: "Restore version r" + version.revision + "?",
      copy: copy,
      accept: "Restore as draft"
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      var result = await apiRequest("/rollback", {
        method: "POST",
        body: { versionId: version.id, expectedRevision: state.revision },
        mutation: true,
        etag: state.etag || "\"draft-" + state.revision + "\""
      });
      applyContentPayload(result);
      state.savedSnapshot = stableSnapshot(state.content);
      state.dirty = false;
      state.staleRecovery = false;
      state.recoveryBaseRevision = null;
      if (!hadUnsavedEdits) clearLocalRecovery();
      hydrateHomepageForm();
      await loadVersions(true);
      renderAll();
      if (hadUnsavedEdits) readLocalRecovery();
      switchView("homepage", true);
      toast(DEMO_ENABLED ? "Demo version restored" : "Version restored", "Review draft r" + state.revision + ", then publish when ready.");
    } catch (error) {
      handleApiError(error);
    } finally {
      setBusy(false);
    }
  }

  async function reloadRemoteDraft() {
    var confirmed = await confirmAction({
      kicker: "Resolve conflict",
      title: "Load the remote draft?",
      copy: "The workspace will use the latest server copy. Your current local edits remain available through Export local copy until this reload completes.",
      accept: "Load remote draft"
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      var result = await apiRequest("/content");
      applyContentPayload(result);
      state.savedSnapshot = stableSnapshot(state.content);
      state.dirty = false;
      state.staleRecovery = false;
      state.recoveryBaseRevision = null;
      clearLocalRecovery();
      $("#conflict-banner").hidden = true;
      hydrateHomepageForm();
      renderAll();
      toast("Remote draft loaded", "You are now editing revision r" + state.revision + ".");
    } catch (error) {
      handleApiError(error);
    } finally {
      setBusy(false);
    }
  }

  function showLocalValidation(issues) {
    $("#error-title").textContent = "The draft needs attention.";
    $("#error-copy").textContent = issues.slice(0, 3).join(" ");
    $("#error-request-id").textContent = issues.length > 3 ? "+ " + (issues.length - 3) + " more checks" : "";
    $("#error-banner").hidden = false;
    $("#error-banner").scrollIntoView({ behavior: "smooth", block: "center" });
    toast("Draft not saved", issues[0], true);
  }

  function handleApiError(error) {
    state.online = error.status !== 0;
    if (error.status === 401 || error.status === 403) {
      showSessionGate("signed-out", error.message);
      return;
    }
    if (error.status === 409 || error.status === 412 || error.code === "revision_conflict") {
      $("#conflict-banner").hidden = false;
      $("#conflict-banner").scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Revision conflict", "Your local edits are safe. Choose how to resolve the newer server draft.", true);
      renderStatus();
      return;
    }
    var detailMessage = error.message || "The request could not be completed.";
    if (error.details && Array.isArray(error.details.issues) && error.details.issues.length) {
      detailMessage += " " + error.details.issues.slice(0, 2).map(function (issue) { return (issue.path || "Content") + " " + issue.message; }).join("; ");
    }
    $("#error-title").textContent = error.status === 0 ? "Site control is offline." : "The request could not be completed.";
    $("#error-copy").textContent = detailMessage;
    $("#error-request-id").textContent = error.requestId ? "Request / " + error.requestId : "";
    $("#error-banner").hidden = false;
    toast("Request failed", error.message, true);
    renderStatus();
  }

  function setBusy(value) {
    state.busy = value;
    renderStatus();
    renderHistory();
  }

  function toggleAccountMenu() {
    var menu = $("#account-menu");
    var open = menu.hidden;
    menu.hidden = !open;
    $("#account-button").setAttribute("aria-expanded", String(open));
  }

  function closeAccountMenu() {
    $("#account-menu").hidden = true;
    $("#account-button").setAttribute("aria-expanded", "false");
  }

  async function logout() {
    closeAccountMenu();
    if (state.dirty) {
      var confirmed = await confirmAction({
        kicker: "Unsaved edits",
        title: "Sign out without saving?",
        copy: "A local recovery copy will remain on this device, but these edits are not on the server.",
        accept: "Sign out"
      });
      if (!confirmed) return;
      writeLocalRecoveryNow();
    }
    if (DEMO_ENABLED) {
      toast("Demo mode", "There is no real Access session to close.");
      return;
    }
    state.allowNavigation = true;
    setBusy(true);
    try {
      var result = await apiRequest("/logout", { method: "POST", body: {}, mutation: true });
      var logoutUrl = result.data && result.data.logoutUrl;
      if (typeof logoutUrl === "string" && logoutUrl) window.location.assign(logoutUrl);
      else window.location.reload();
    } catch (error) {
      state.allowNavigation = false;
      handleApiError(error);
      setBusy(false);
    }
  }

  function openPreview() {
    renderPreview();
    var dialog = $("#preview-dialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function setPreviewSize(size) {
    $("#preview-canvas").classList.toggle("is-mobile", size === "mobile");
    $all("[data-preview-size]").forEach(function (button) {
      var active = button.dataset.previewSize === size;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function renderPreview() {
    var content = state.content;
    var canvas = $("#preview-canvas");
    canvas.replaceChildren();
    var bar = makeElement("header", "preview-site-bar");
    appendChildren(bar, makeElement("span", "preview-logo", content.site.shortMark + " / " + content.site.name), makeElement("span", "", "Work · About · GitHub ↗"));
    var hero = makeElement("section", "preview-hero");
    var heroCopy = makeElement("div");
    heroCopy.appendChild(makeElement("div", "preview-kicker", content.hero.availabilityEnabled ? content.hero.availabilityLabel : "Student engineer"));
    var heading = makeElement("h1");
    heading.appendChild(makeElement("div", "", content.hero.headline.line1));
    var lineTwo = makeElement("div");
    appendChildren(lineTwo, content.hero.headline.line2Prefix + " ", makeElement("span", "", content.hero.headline.primaryAccent), content.hero.headline.line2Suffix);
    var lineThree = makeElement("div");
    appendChildren(lineThree, content.hero.headline.line3Prefix + " ", makeElement("span", "", content.hero.headline.secondaryAccent), content.hero.headline.line3Suffix);
    appendChildren(heading, lineTwo, lineThree);
    var intro = content.hero.intro.lead + " " + content.hero.intro.emphasis + content.hero.intro.tail;
    appendChildren(heroCopy, heading, makeElement("p", "", intro));
    var heroSide = makeElement("aside", "preview-hero-side");
    appendChildren(heroSide, makeElement("span", "preview-meta", content.systemMap.label), makeElement("strong", "", content.systemMap.state), makeElement("small", "", content.systemMap.focusValue + " / " + content.systemMap.modeValue));
    appendChildren(hero, heroCopy, heroSide);
    var focus = makeElement("div", "preview-focus");
    content.domains.forEach(function (domain) { focus.appendChild(makeElement("span", "", domain)); });
    var work = makeElement("section", "preview-work");
    appendChildren(work, makeElement("div", "preview-kicker", content.work.sectionLabel), makeElement("h2", "", content.work.titleLead + " " + content.work.titleAccent));
    var projectGrid = makeElement("div", "preview-project-grid");
    sortedProjects().filter(function (project) { return project.published; }).forEach(function (project) {
      var card = makeElement("article", "preview-project" + (project.featured ? " is-featured" : ""));
      appendChildren(card, makeElement("span", "preview-project-meta", project.category + " / " + project.statusLabel), makeElement("h3", "", project.title), makeElement("p", "", project.summary));
      var tags = makeElement("div", "preview-tags");
      project.tags.forEach(function (tag) { tags.appendChild(makeElement("span", "", tag)); });
      card.appendChild(tags);
      projectGrid.appendChild(card);
    });
    if (!projectGrid.children.length) projectGrid.appendChild(makeElement("p", "", "No published projects in this draft."));
    work.appendChild(projectGrid);
    var about = makeElement("section", "preview-about");
    appendChildren(about, makeElement("h2", "", content.about.headingLead + " " + content.about.headingAccent));
    var aboutCopy = makeElement("div", "preview-about-copy");
    content.about.paragraphs.forEach(function (paragraph) { if (nonEmpty(paragraph)) aboutCopy.appendChild(makeElement("p", "", paragraph)); });
    about.appendChild(aboutCopy);
    var contact = makeElement("section", "preview-contact");
    appendChildren(contact, makeElement("div", "preview-kicker", content.contact.kicker), makeElement("h2", "", content.contact.heading));
    appendChildren(canvas, bar, hero, focus, work, about, contact);
  }

  function confirmAction(options) {
    if (state.confirmResolver) resolveConfirmation(false);
    $("#confirm-kicker").textContent = options.kicker || "Confirm action";
    $("#confirm-title").textContent = options.title || "Are you sure?";
    $("#confirm-copy").textContent = options.copy || "This action needs confirmation.";
    $("#confirm-accept-button").textContent = options.accept || "Continue";
    var dialog = $("#confirm-dialog");
    return new Promise(function (resolve) {
      state.confirmResolver = resolve;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    });
  }

  function resolveConfirmation(value) {
    var dialog = $("#confirm-dialog");
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    if (state.confirmResolver) {
      var resolver = state.confirmResolver;
      state.confirmResolver = null;
      resolver(Boolean(value));
    }
  }

  function downloadContent(content, filename) {
    var blob = new Blob([JSON.stringify(content, null, 2) + "\n"], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = makeElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function toast(title, message, error) {
    var region = $("#toast-region");
    var item = makeElement("div", "toast" + (error ? " is-error" : ""));
    var signal = makeElement("i");
    var copy = makeElement("div");
    appendChildren(copy, makeElement("b", "", title), makeElement("span", "", message));
    appendChildren(item, signal, copy);
    region.appendChild(item);
    window.setTimeout(function () {
      item.classList.add("is-leaving");
      window.setTimeout(function () { item.remove(); }, 250);
    }, 5200);
  }

  init();
})();
