const entriesElement = document.getElementById("entries");
const emptyState = document.getElementById("empty-state");
const entryTemplate = document.getElementById("entry-template");
const connection = document.querySelector(".connection");
const connectionText = document.getElementById("connection-text");
const clockDate = document.getElementById("clock-date");
const clockHijriDate = document.getElementById("clock-hijri-date");
const clockHours = document.getElementById("clock-hours");
const clockMinutes = document.getElementById("clock-minutes");
const promoPlayer = document.getElementById("promo-player");
const promoVideo = document.getElementById("promo-video");
const readyChime = document.getElementById("ready-chime");
const soundPrompt = document.getElementById("sound-prompt");
const soundEnable = document.getElementById("sound-enable");
const readyAlert = document.getElementById("ready-alert");
const readyAlertPlate = document.getElementById("ready-alert-plate");

const PROMO_INITIAL_DELAY_MS = 20_000;
const PROMO_INTERVAL_MS = 90_000;
const PROMO_RESUME_DELAY_MS = 20_000;
const PROMO_FADE_MS = 900;
const PROMO_STALL_TIMEOUT_MS = 7_000;
const PROMO_RETRY_DELAY_MS = 350;
const READY_ALERT_DURATION_MS = 6_500;
const READY_EVENT_MAX_AGE_MS = 10 * 60 * 1000;
const READY_EVENT_STORAGE_KEY = "al-raked-seen-ready-events-v1";
// Set this to false to remove the chime and its TV activation prompt.
const READY_CHIME_ENABLED = true;
const DEFAULT_PROMO_GROUPS = [
  {
    videos: ["/media/promo-1.mp4", "/media/promo-2.mp4", "/media/promo-3.mp4"],
    finalFrameHoldMs: 0,
  },
  { videos: ["/media/oil.mp4"], finalFrameHoldMs: 3_500 },
];

const promoState = {
  groups: DEFAULT_PROMO_GROUPS,
  groupIndex: 0,
  videoIndex: 0,
  intervalTimer: null,
  holdTimer: null,
  cleanupTimer: null,
  stallTimer: null,
  retryTimer: null,
  retryCount: 0,
  playToken: 0,
  resumePending: false,
  resumeTime: 0,
  handlingFailure: false,
  running: false,
};

const readyAlertState = {
  active: false,
  queue: [],
  timer: null,
};

const seenReadyEvents = loadSeenReadyEvents();

let entries = [];
let hasLoadedSnapshot = false;
let overflowRefreshFrame = 0;

function displayTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-AE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Dubai",
  }).format(date);
}

function plateParts(value) {
  const plate = String(value || "-").trim().toUpperCase();
  const letters = (plate.match(/[A-Z]/g) || []).join("");
  const digits = (plate.match(/\d/g) || []).join("");

  if (letters) {
    return {
      style: "dubai",
      code: letters,
      number: digits || "-",
    };
  }

  const separated = plate.match(/^([A-Z0-9]{1,2})\s*[\\/]\s*(.+)$/);

  if (separated) {
    return {
      style: "abu-dhabi",
      code: separated[1],
      number: separated[2].trim() || "-",
    };
  }

  return { style: "abu-dhabi", code: "AD", number: plate || "-" };
}

function updateClock() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-AE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Dubai",
  }).formatToParts(now);
  clockDate.textContent = new Intl.DateTimeFormat("en-AE", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Dubai",
  }).format(now).toUpperCase();
  clockHijriDate.textContent = new Intl.DateTimeFormat(
    "ar-AE-u-ca-islamic-umalqura-nu-arab",
    {
      day: "numeric",
      month: "long",
      timeZone: "Asia/Dubai",
    },
  ).format(now);
  clockHours.textContent = parts.find((part) => part.type === "hour")?.value || "00";
  clockMinutes.textContent = parts.find((part) => part.type === "minute")?.value || "00";
}

let readyAudioContext = null;
let readyChimeBuffer = null;
let readyChimeUnlockPromise = null;

function setSoundPromptVisible(visible) {
  soundPrompt.classList.toggle("is-hidden", !visible);
  soundPrompt.setAttribute("aria-hidden", String(!visible));
}

async function enableReadyChime() {
  if (!READY_CHIME_ENABLED || readyChimeBuffer) return;
  if (readyChimeUnlockPromise) return readyChimeUnlockPromise;

  readyChimeUnlockPromise = (async () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is unavailable");

    readyAudioContext ||= new AudioContextClass();
    await readyAudioContext.resume();
    const response = await fetch(readyChime.currentSrc || readyChime.src, {
      cache: "force-cache",
    });
    if (!response.ok) throw new Error(`Chime request returned HTTP ${response.status}`);
    readyChimeBuffer = await readyAudioContext.decodeAudioData(
      await response.arrayBuffer(),
    );
    setSoundPromptVisible(false);
  })();

  try {
    await readyChimeUnlockPromise;
  } catch (error) {
    console.warn("Completion sound could not be enabled.", error);
    setSoundPromptVisible(true);
  } finally {
    readyChimeUnlockPromise = null;
  }
}

function playReadyChime() {
  if (!READY_CHIME_ENABLED) return;

  if (readyAudioContext && readyChimeBuffer) {
    readyAudioContext.resume()
      .then(() => {
        const source = readyAudioContext.createBufferSource();
        source.buffer = readyChimeBuffer;
        source.connect(readyAudioContext.destination);
        source.start(0);
      })
      .catch((error) => {
        console.warn("Ready chime could not play.", error);
        setSoundPromptVisible(true);
      });
    return;
  }

  readyChime.volume = 1;
  readyChime.currentTime = 0;
  readyChime.play().catch((error) => {
    console.warn("Ready chime needs TV permission.", error);
    setSoundPromptVisible(true);
  });
}

if (READY_CHIME_ENABLED) {
  setSoundPromptVisible(true);
  soundEnable.addEventListener("click", enableReadyChime);
  window.setTimeout(() => soundEnable.focus(), 250);
} else {
  setSoundPromptVisible(false);
}

function schedulePromo(delay = PROMO_INTERVAL_MS) {
  window.clearTimeout(promoState.intervalTimer);
  promoState.intervalTimer = window.setTimeout(startPromo, delay);
}

function postponePromoForLiveUpdate() {
  if (!promoState.running) return;

  window.clearTimeout(promoState.holdTimer);
  window.clearTimeout(promoState.cleanupTimer);
  window.clearTimeout(promoState.retryTimer);
  clearPromoStallTimer();
  promoState.playToken += 1;
  promoState.resumeTime = Number.isFinite(promoVideo.currentTime)
    ? promoVideo.currentTime
    : 0;
  promoState.resumePending = true;
  promoState.handlingFailure = false;
  promoState.running = false;
  promoVideo.pause();
  promoVideo.classList.remove("is-active");
  promoPlayer.classList.remove("is-visible");
  schedulePromo(PROMO_RESUME_DELAY_MS);
}

function normalizePromoGroups(value) {
  if (!Array.isArray(value?.groups)) return [];

  return value.groups
    .map((group) => {
      const videos = Array.isArray(group?.videos)
        ? group.videos
          .map((source) => String(source || "").trim())
          .filter(Boolean)
        : [];
      const requestedHold = Number(group?.finalFrameHoldMs || 0);
      return {
        videos,
        finalFrameHoldMs: Number.isFinite(requestedHold)
          ? Math.max(0, Math.min(requestedHold, 10_000))
          : 0,
      };
    })
    .filter((group) => group.videos.length > 0);
}

async function loadPromoGroups() {
  try {
    const response = await fetch("/promos.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Promo playlist returned HTTP ${response.status}`);
    const groups = normalizePromoGroups(await response.json());
    if (!groups.length) throw new Error("Promo playlist has no playable groups.");
    return groups;
  } catch (error) {
    console.warn("Using the built-in promo playlist.", error);
    return DEFAULT_PROMO_GROUPS;
  }
}

function currentPromoGroup() {
  return promoState.groups[promoState.groupIndex] || promoState.groups[0];
}

function currentPromoSource() {
  return currentPromoGroup()?.videos[promoState.videoIndex] || "";
}

function clearPromoStallTimer() {
  window.clearTimeout(promoState.stallTimer);
  promoState.stallTimer = null;
}

function armPromoStallTimer() {
  if (!promoState.running) return;
  clearPromoStallTimer();
  promoState.stallTimer = window.setTimeout(() => {
    promoState.stallTimer = null;
    if (!promoState.running) return;
    handlePromoFailure();
  }, PROMO_STALL_TIMEOUT_MS);
}

function playVideoWhenReady(video) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let frameRequested = false;
    let frameFallbackTimer = null;

    const cleanup = () => {
      window.clearTimeout(timeoutTimer);
      window.clearTimeout(frameFallbackTimer);
      video.removeEventListener("playing", confirmFrame);
      video.removeEventListener("error", fail);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Video could not begin playback."));
    };

    const confirmFrame = () => {
      if (frameRequested || settled) return;
      frameRequested = true;

      if (typeof video.requestVideoFrameCallback === "function") {
        frameFallbackTimer = window.setTimeout(finish, 700);
        video.requestVideoFrameCallback(finish);
      } else {
        window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
      }
    };

    const timeoutTimer = window.setTimeout(fail, 5_000);
    video.addEventListener("playing", confirmFrame, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.play().catch(fail);

    if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      confirmFrame();
    }
  });
}

function startPromo() {
  if (promoState.running) return;
  if (document.visibilityState === "hidden") {
    schedulePromo();
    return;
  }

  promoState.running = true;
  playCurrentPromo();
}

function playCurrentPromo() {
  if (!promoState.running) return;
  const source = currentPromoSource();
  if (!source) {
    finishPromo();
    return;
  }

  const token = ++promoState.playToken;
  const sourceChanged = promoVideo.getAttribute("src") !== source;
  promoState.handlingFailure = false;
  clearPromoStallTimer();
  promoVideo.classList.remove("is-active");

  if (sourceChanged) {
    promoVideo.src = source;
    promoVideo.load();
  } else if (promoState.resumePending && Number.isFinite(promoVideo.duration)) {
    const finalPlayableTime = Math.max(0, promoVideo.duration - 0.25);
    promoVideo.currentTime = Math.min(promoState.resumeTime, finalPlayableTime);
  }

  playVideoWhenReady(promoVideo)
    .then(() => {
      if (!promoState.running || promoState.playToken !== token) return;
      promoState.resumePending = false;
      promoState.resumeTime = 0;
      promoState.handlingFailure = false;
      promoVideo.classList.add("is-active");
      window.requestAnimationFrame(() => promoPlayer.classList.add("is-visible"));
    })
    .catch(handlePromoFailure);
}

function handlePromoFailure() {
  if (!promoState.running || promoState.handlingFailure) return;
  promoState.handlingFailure = true;
  clearPromoStallTimer();
  promoState.playToken += 1;

  if (promoState.retryCount < 1) {
    promoState.retryCount += 1;
    promoState.resumePending = false;
    promoState.resumeTime = 0;
    promoVideo.pause();
    promoVideo.currentTime = 0;
    promoVideo.load();
    promoState.retryTimer = window.setTimeout(() => {
      promoState.handlingFailure = false;
      playCurrentPromo();
    }, PROMO_RETRY_DELAY_MS);
    return;
  }

  promoState.handlingFailure = false;
  advancePromo();
}

function handlePromoEnded() {
  if (!promoState.running) return;
  clearPromoStallTimer();

  const group = currentPromoGroup();
  const isLastVideo = promoState.videoIndex === group.videos.length - 1;
  if (isLastVideo && group.finalFrameHoldMs > 0) {
    promoState.holdTimer = window.setTimeout(finishPromo, group.finalFrameHoldMs);
    return;
  }

  advancePromo();
}

function advancePromo() {
  if (!promoState.running) return;
  clearPromoStallTimer();
  window.clearTimeout(promoState.retryTimer);
  const group = currentPromoGroup();
  const nextIndex = promoState.videoIndex + 1;
  if (nextIndex < group.videos.length) {
    promoState.videoIndex = nextIndex;
    promoState.retryCount = 0;
    promoState.resumePending = false;
    promoState.resumeTime = 0;
    playCurrentPromo();
  } else {
    finishPromo();
  }
}

function finishPromo() {
  window.clearTimeout(promoState.holdTimer);
  window.clearTimeout(promoState.cleanupTimer);
  window.clearTimeout(promoState.retryTimer);
  clearPromoStallTimer();
  promoState.playToken += 1;
  promoState.running = false;
  promoState.handlingFailure = false;
  promoState.resumePending = false;
  promoState.resumeTime = 0;
  promoState.retryCount = 0;
  promoState.videoIndex = 0;
  promoState.groupIndex = (promoState.groupIndex + 1) % promoState.groups.length;
  promoPlayer.classList.remove("is-visible");

  promoState.cleanupTimer = window.setTimeout(() => {
    promoVideo.pause();
    promoVideo.classList.remove("is-active");
    promoVideo.currentTime = 0;
    schedulePromo();
  }, PROMO_FADE_MS);
}

async function initPromoPlayer() {
  promoVideo.defaultMuted = true;
  promoVideo.addEventListener("ended", handlePromoEnded);
  promoVideo.addEventListener("error", handlePromoFailure);
  promoVideo.addEventListener("playing", clearPromoStallTimer);
  promoVideo.addEventListener("canplay", clearPromoStallTimer);
  promoVideo.addEventListener("waiting", armPromoStallTimer);
  promoVideo.addEventListener("stalled", armPromoStallTimer);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && promoState.running) {
      promoVideo.play().catch(handlePromoFailure);
    }
  });

  promoState.groups = await loadPromoGroups();
  schedulePromo(PROMO_INITIAL_DELAY_MS);
}

function entryIsReady(entry) {
  return entry?.ready === true || String(entry?.ready || "").toLowerCase() === "true";
}

function loadSeenReadyEvents() {
  try {
    const stored = JSON.parse(localStorage.getItem(READY_EVENT_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(stored) ? stored.slice(-100) : []);
  } catch {
    return new Set();
  }
}

function readyEventKey(entry) {
  if (!entry?.id || !entryIsReady(entry)) return "";
  return String(entry.readyEventId || `${entry.id}:${entry.readyAt || "ready"}`);
}

function markReadyEventSeen(eventKey) {
  if (!eventKey) return;
  seenReadyEvents.add(eventKey);
  const retained = Array.from(seenReadyEvents).slice(-100);
  localStorage.setItem(READY_EVENT_STORAGE_KEY, JSON.stringify(retained));
}

function queueFreshUnseenReadyAlerts(nextEntries) {
  const now = Date.now();
  nextEntries
    .filter((entry) => {
      if (!entryIsReady(entry) || !entry.readyAt) return false;
      const readyTime = new Date(entry.readyAt).getTime();
      const age = now - readyTime;
      const eventKey = readyEventKey(entry);
      return (
        Number.isFinite(readyTime) &&
        age >= -2 * 60 * 1000 &&
        age <= READY_EVENT_MAX_AGE_MS &&
        eventKey &&
        !seenReadyEvents.has(eventKey)
      );
    })
    .sort((first, second) => {
      return new Date(first.readyAt).getTime() - new Date(second.readyAt).getTime();
    })
    .forEach(queueReadyAlert);
}

function queueReadyAlert(entry) {
  if (!entry || !entry.id || !entryIsReady(entry)) return;

  const alertKey = readyEventKey(entry);
  if (!alertKey || seenReadyEvents.has(alertKey)) return;
  const alreadyQueued = readyAlertState.queue.some(
    (queuedEntry) => queuedEntry.alertKey === alertKey,
  );
  if (alreadyQueued) return;

  markReadyEventSeen(alertKey);
  readyAlertState.queue.push({ ...entry, alertKey });
  showNextReadyAlert();
}

function showNextReadyAlert() {
  if (readyAlertState.active || readyAlertState.queue.length === 0) return;

  const entry = readyAlertState.queue.shift();
  readyAlertState.active = true;
  postponePromoForLiveUpdate();

  readyAlertPlate.textContent = String(entry.licensePlate || "Vehicle").trim();
  readyAlert.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => readyAlert.classList.add("is-visible"));
  playReadyChime();

  readyAlertState.timer = window.setTimeout(() => {
    readyAlert.classList.remove("is-visible");
    window.setTimeout(() => {
      readyAlert.setAttribute("aria-hidden", "true");
      readyAlertState.active = false;
      showNextReadyAlert();
    }, 450);
  }, READY_ALERT_DURATION_MS);
}

function fillCell(node, selector, value) {
  node.querySelector(selector).textContent = value || "-";
}

function fillScrollingCell(node, selector, value) {
  const cell = node.querySelector(selector);
  const text = String(value || "-");
  const scrollWindow = document.createElement("span");
  const track = document.createElement("span");
  const copy = document.createElement("span");

  scrollWindow.className = "cell-scroll-window";
  track.className = "cell-scroll-track";
  copy.className = "cell-scroll-copy";
  copy.textContent = text;
  track.append(copy);
  scrollWindow.append(track);
  cell.replaceChildren(scrollWindow);
  cell.setAttribute("aria-label", text);
}

function fillFittingCell(node, selector, value) {
  const cell = node.querySelector(selector);
  const text = String(value || "-");
  const content = document.createElement("span");

  content.className = "cell-fit-text";
  content.textContent = text;
  cell.replaceChildren(content);
  cell.setAttribute("aria-label", text);
}

function refreshForemanFits() {
  entriesElement.querySelectorAll(".foreman-cell").forEach((cell) => {
    const content = cell.querySelector(".cell-fit-text");
    if (!content) return;

    cell.classList.remove("is-condensed", "is-extra-condensed");
    if (content.scrollWidth <= content.clientWidth + 1) return;

    cell.classList.add("is-condensed");
    if (content.scrollWidth <= content.clientWidth + 1) return;

    cell.classList.add("is-extra-condensed");
  });
}

function refreshOverflowScrolls() {
  const cells = entriesElement.querySelectorAll(".scrollable-cell");

  cells.forEach((cell) => {
    const scrollWindow = cell.querySelector(".cell-scroll-window");
    const track = cell.querySelector(".cell-scroll-track");
    const copy = cell.querySelector(".cell-scroll-copy");
    if (!scrollWindow || !track || !copy) return;

    cell.classList.remove("is-scrolling");
    track.querySelectorAll("[data-scroll-clone]").forEach((clone) => clone.remove());
    track.style.removeProperty("--scroll-distance");
    track.style.removeProperty("--scroll-duration");
    track.style.removeProperty("--scroll-gap");

    if (copy.scrollWidth <= scrollWindow.clientWidth + 1) return;

    const gap = Math.max(40, Math.round(scrollWindow.clientWidth * 0.16));
    const clone = copy.cloneNode(true);
    const distance = copy.getBoundingClientRect().width + gap;
    const duration = Math.max(8, distance / 46);

    clone.dataset.scrollClone = "";
    clone.setAttribute("aria-hidden", "true");
    track.append(clone);
    track.style.setProperty("--scroll-gap", `${gap}px`);
    track.style.setProperty("--scroll-distance", `${distance}px`);
    track.style.setProperty("--scroll-duration", `${duration}s`);
    cell.classList.add("is-scrolling");
  });
}

function scheduleOverflowRefresh() {
  cancelAnimationFrame(overflowRefreshFrame);
  overflowRefreshFrame = requestAnimationFrame(() => {
    refreshOverflowScrolls();
    refreshForemanFits();
  });
}

function makeEntryNode(entry, isNew) {
  const node = entryTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = entry.id;
  if (isNew) node.classList.add("is-new");

  fillCell(node, ".entry-time", displayTime(entry.timestamp));
  fillScrollingCell(node, ".employee-cell", entry.employee);
  fillScrollingCell(node, ".service-cell", entry.service);
  fillCell(node, ".price-value", entry.price);

  const ready = entryIsReady(entry);
  const statusCell = node.querySelector(".status-cell");
  statusCell.dataset.ready = String(ready);
  fillCell(node, ".status-value", ready ? "Ready" : "In Progress");

  const plate = plateParts(entry.licensePlate);
  const plateElement = node.querySelector(".vehicle-plate");
  plateElement.classList.toggle("is-dubai", plate.style === "dubai");
  plateElement.classList.toggle("is-abu-dhabi", plate.style !== "dubai");
  fillCell(node, ".plate-code", plate.code);
  fillCell(node, ".plate-letters", plate.code);
  fillScrollingCell(node, ".plate-number", plate.number);
  plateElement.setAttribute(
    "aria-label",
    `${plate.style === "dubai" ? "Dubai" : "Abu Dhabi"} plate ${plate.code} ${plate.number}`,
  );

  node.querySelector(".price-cell").dataset.free = String(entry.price).toLowerCase() === "free";
  return node;
}

function makePlaceholderNode(index) {
  const node = makeEntryNode({
    id: `placeholder-${index}`,
    timestamp: "",
    employee: "-",
    licensePlate: "-",
    service: "-",
    price: "-",
    ready: false,
  }, false);

  node.classList.add("is-placeholder");
  node.setAttribute("aria-hidden", "true");
  return node;
}

function render(nextEntries, newEntryId = "") {
  const previousPositions = new Map(
    Array.from(entriesElement.children).map((node) => [node.dataset.id, node.getBoundingClientRect()]),
  );

  entries = nextEntries.slice(0, 10);
  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => fragment.append(makeEntryNode(entry, entry.id === newEntryId)));
  for (let index = entries.length; index < 10; index += 1) {
    fragment.append(makePlaceholderNode(index));
  }
  entriesElement.replaceChildren(fragment);
  emptyState.hidden = true;

  requestAnimationFrame(() => {
    refreshOverflowScrolls();
    refreshForemanFits();
    for (const node of entriesElement.children) {
      const previous = previousPositions.get(node.dataset.id);
      if (!previous) continue;
      const current = node.getBoundingClientRect();
      const offset = previous.top - current.top;
      if (!offset) continue;
      node.animate(
        [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
        { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
  });
}

window.addEventListener("resize", scheduleOverflowRefresh);
document.fonts?.ready.then(scheduleOverflowRefresh);

function setConnection(isLive, message) {
  connection.dataset.live = String(isLive);
  connectionText.textContent = message;
}

function sortedFirebaseEntries(value) {
  return Object.values(value || {})
    .filter((entry) => entry && typeof entry === "object")
    .sort((first, second) => {
      return new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime();
    })
    .slice(0, 10);
}

async function connectFirebase() {
  firebaseConnectController?.abort();
  firebaseConnectController = new AbortController();
  const controller = firebaseConnectController;

  firebaseStream?.close();
  firebaseStream = null;
  clearTimeout(firebaseRefreshTimer);
  scheduleFirebaseEmptyRetry();
  setConnection(false, "Connecting");

  try {
    const config = window.AL_RAKED_FIREBASE_CONFIG;
    const session = await getFirebaseAnonymousSession(config.apiKey, controller.signal);
    if (controller.signal.aborted) return;
    openFirebaseStream(config, session);
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error(error);
    setConnection(false, "Connection failed");
    scheduleFirebaseEmptyRetry();
  } finally {
    if (firebaseConnectController === controller) {
      firebaseConnectController = null;
    }
  }
}

const FIREBASE_REFRESH_TOKEN_KEY = "al-raked-firebase-refresh-token-v1";
const FIREBASE_EMPTY_RETRY_MS = 60_000;
let firebaseSlots = {};
let firebaseStream = null;
let firebaseRefreshTimer = null;
let firebaseEmptyRetryTimer = null;
let firebaseConnectController = null;

function clearFirebaseEmptyRetry() {
  clearTimeout(firebaseEmptyRetryTimer);
  firebaseEmptyRetryTimer = null;
}

function scheduleFirebaseEmptyRetry() {
  if (sortedFirebaseEntries(firebaseSlots).length > 0) {
    clearFirebaseEmptyRetry();
    return;
  }
  if (firebaseEmptyRetryTimer !== null) return;

  firebaseEmptyRetryTimer = window.setTimeout(() => {
    firebaseEmptyRetryTimer = null;
    if (sortedFirebaseEntries(firebaseSlots).length > 0) return;

    setConnection(false, "Reconnecting");
    connectFirebase();
  }, FIREBASE_EMPTY_RETRY_MS);
}

async function getFirebaseAnonymousSession(apiKey, signal) {
  const storedRefreshToken = localStorage.getItem(FIREBASE_REFRESH_TOKEN_KEY);
  if (storedRefreshToken) {
    try {
      return await refreshFirebaseSession(apiKey, storedRefreshToken, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      localStorage.removeItem(FIREBASE_REFRESH_TOKEN_KEY);
      console.warn("Saved Firebase session could not be refreshed.", error);
    }
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
      signal,
    },
  );
  const result = await response.json();
  if (!response.ok || !result.idToken || !result.refreshToken) {
    throw new Error(`Firebase anonymous sign-in failed with HTTP ${response.status}`);
  }

  localStorage.setItem(FIREBASE_REFRESH_TOKEN_KEY, result.refreshToken);
  return {
    idToken: result.idToken,
    refreshToken: result.refreshToken,
    expiresIn: Number(result.expiresIn || 3600),
  };
}

async function refreshFirebaseSession(apiKey, refreshToken, signal) {
  const response = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      signal,
    },
  );
  const result = await response.json();
  if (!response.ok || !result.id_token || !result.refresh_token) {
    throw new Error(`Firebase session refresh failed with HTTP ${response.status}`);
  }

  localStorage.setItem(FIREBASE_REFRESH_TOKEN_KEY, result.refresh_token);
  return {
    idToken: result.id_token,
    refreshToken: result.refresh_token,
    expiresIn: Number(result.expires_in || 3600),
  };
}

function applyFirebaseStreamChange(eventType, payload) {
  const previousEntries = sortedFirebaseEntries(firebaseSlots);
  const path = payload?.path || "/";
  if (path === "/") {
    firebaseSlots = eventType === "patch"
      ? { ...firebaseSlots, ...(payload.data || {}) }
      : payload.data || {};
  } else {
    const slot = path.replace(/^\//, "").split("/")[0];
    if (!slot) return;

    if (payload.data === null) {
      delete firebaseSlots[slot];
    } else {
      firebaseSlots[slot] = eventType === "patch"
        ? { ...(firebaseSlots[slot] || {}), ...payload.data }
        : payload.data;
    }
  }

  const nextEntries = sortedFirebaseEntries(firebaseSlots);
  const previousNewestId = entries[0]?.id || "";
  const nextNewestId = nextEntries[0]?.id || "";
  const previousById = new Map(
    previousEntries.map((entry) => [entry.id, entry]),
  );
  const hasLiveChange =
    nextNewestId !== previousNewestId ||
    nextEntries.some((entry) => {
      const previousEntry = previousById.get(entry.id);
      return (
        previousEntry &&
        entryIsReady(previousEntry) !== entryIsReady(entry)
      );
    });

  if (hasLoadedSnapshot && hasLiveChange) postponePromoForLiveUpdate();
  render(
    nextEntries,
    hasLoadedSnapshot && nextNewestId !== previousNewestId ? nextNewestId : "",
  );
  if (hasLoadedSnapshot) {
    nextEntries.forEach((entry) => {
      const previousEntry = previousById.get(entry.id);
      if (
        previousEntry &&
        !entryIsReady(previousEntry) &&
        entryIsReady(entry)
      ) {
        queueReadyAlert(entry);
      }
    });
  } else {
    queueFreshUnseenReadyAlerts(nextEntries);
  }
  if (nextEntries.length > 0) {
    clearFirebaseEmptyRetry();
  } else {
    scheduleFirebaseEmptyRetry();
  }
  hasLoadedSnapshot = true;
  setConnection(true, "Live");
}

function openFirebaseStream(config, session) {
  firebaseStream?.close();
  clearTimeout(firebaseRefreshTimer);

  const databaseUrl = config.databaseURL.replace(/\/$/, "");
  firebaseStream = new EventSource(
    `${databaseUrl}/liveDisplay.json?auth=${encodeURIComponent(session.idToken)}`,
  );
  scheduleFirebaseEmptyRetry();
  firebaseStream.addEventListener("put", (event) => {
    applyFirebaseStreamChange("put", JSON.parse(event.data));
  });
  firebaseStream.addEventListener("patch", (event) => {
    applyFirebaseStreamChange("patch", JSON.parse(event.data));
  });
  firebaseStream.addEventListener("cancel", (event) => {
    console.error("Firebase stream cancelled.", event.data);
    setConnection(false, "Connection failed");
    scheduleFirebaseEmptyRetry();
  });
  firebaseStream.addEventListener("auth_revoked", () => {
    localStorage.removeItem(FIREBASE_REFRESH_TOKEN_KEY);
    setConnection(false, "Reconnecting");
    connectFirebase();
  });
  firebaseStream.onerror = () => {
    setConnection(false, "Reconnecting");
    scheduleFirebaseEmptyRetry();
  };

  const refreshAfterSeconds = Math.max(60, session.expiresIn - 300);
  firebaseRefreshTimer = window.setTimeout(async () => {
    try {
      const refreshed = await refreshFirebaseSession(
        config.apiKey,
        session.refreshToken,
      );
      openFirebaseStream(config, refreshed);
    } catch (error) {
      console.error(error);
      localStorage.removeItem(FIREBASE_REFRESH_TOKEN_KEY);
      connectFirebase();
    }
  }, refreshAfterSeconds * 1000);
}

function connectLocal() {
  const stream = new EventSource("/api/stream");

  stream.addEventListener("open", () => setConnection(true, "Live"));
  stream.addEventListener("snapshot", (event) => {
    const payload = JSON.parse(event.data);
    const nextEntries = payload.entries || [];
    render(nextEntries);
    queueFreshUnseenReadyAlerts(nextEntries);
    hasLoadedSnapshot = true;
  });
  stream.addEventListener("entry", (event) => {
    const payload = JSON.parse(event.data);
    if (hasLoadedSnapshot) postponePromoForLiveUpdate();
    render(payload.entries || [], hasLoadedSnapshot ? payload.entry?.id : "");
    hasLoadedSnapshot = true;
  });
  stream.addEventListener("status", (event) => {
    const payload = JSON.parse(event.data);
    const previousEntry = entries.find((entry) => entry.id === payload.entry?.id);
    if (hasLoadedSnapshot) postponePromoForLiveUpdate();
    render(payload.entries || []);
    if (
      hasLoadedSnapshot &&
      previousEntry &&
      !entryIsReady(previousEntry) &&
      entryIsReady(payload.entry)
    ) {
      queueReadyAlert(payload.entry);
    }
    hasLoadedSnapshot = true;
  });
  stream.addEventListener("error", () => setConnection(false, "Reconnecting"));
}

const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
const sourceOverride = new URLSearchParams(window.location.search).get("source");
const useFirebase =
  sourceOverride === "firebase" ||
  (sourceOverride !== "local" && !localHostnames.has(window.location.hostname));

render([]);

if (useFirebase) {
  connectFirebase();
} else {
  connectLocal();
}

updateClock();
window.setInterval(updateClock, 1000);
initPromoPlayer();
