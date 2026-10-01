const entriesElement = document.getElementById("entries");
const emptyState = document.getElementById("empty-state");
const entryTemplate = document.getElementById("entry-template");
const connection = document.querySelector(".connection");
const connectionText = document.getElementById("connection-text");

let entries = [];
let hasLoadedSnapshot = false;

function displayTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-AE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function fillCell(node, selector, value) {
  node.querySelector(selector).textContent = value || "-";
}

function makeEntryNode(entry, isNew) {
  const node = entryTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = entry.id;
  if (isNew) node.classList.add("is-new");

  fillCell(node, ".time-cell", displayTime(entry.timestamp));
  fillCell(node, ".foreman-cell", entry.foreman);
  fillCell(node, ".employee-cell", entry.employee);
  fillCell(node, ".plate-cell", entry.licensePlate);
  fillCell(node, ".service-cell", entry.service);
  fillCell(node, ".company-cell", entry.company);
  fillCell(node, ".price-cell", entry.price);
  node.querySelector(".price-cell").dataset.free = String(entry.price).toLowerCase() === "free";
  return node;
}

function render(nextEntries, newEntryId = "") {
  const previousPositions = new Map(
    Array.from(entriesElement.children).map((node) => [node.dataset.id, node.getBoundingClientRect()]),
  );

  entries = nextEntries.slice(0, 10);
  document.documentElement.style.setProperty("--row-count", Math.max(entries.length, 1));
  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => fragment.append(makeEntryNode(entry, entry.id === newEntryId)));
  entriesElement.replaceChildren(fragment);
  emptyState.hidden = entries.length > 0;

  requestAnimationFrame(() => {
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

function setConnection(isLive, message) {
  connection.classList.toggle("is-live", isLive);
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
  setConnection(false, "Connecting");

  try {
    const config = window.AL_RAKED_FIREBASE_CONFIG;
    const session = await getFirebaseAnonymousSession(config.apiKey);
    openFirebaseStream(config, session);
  } catch (error) {
    console.error(error);
    setConnection(false, "Connection failed");
  }
}

const FIREBASE_REFRESH_TOKEN_KEY = "al-raked-firebase-refresh-token-v1";
let firebaseSlots = {};
let firebaseStream = null;
let firebaseRefreshTimer = null;

async function getFirebaseAnonymousSession(apiKey) {
  const storedRefreshToken = localStorage.getItem(FIREBASE_REFRESH_TOKEN_KEY);
  if (storedRefreshToken) {
    try {
      return await refreshFirebaseSession(apiKey, storedRefreshToken);
    } catch (error) {
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

async function refreshFirebaseSession(apiKey, refreshToken) {
  const response = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
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
  render(
    nextEntries,
    hasLoadedSnapshot && nextNewestId !== previousNewestId ? nextNewestId : "",
  );
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
  firebaseStream.addEventListener("put", (event) => {
    applyFirebaseStreamChange("put", JSON.parse(event.data));
  });
  firebaseStream.addEventListener("patch", (event) => {
    applyFirebaseStreamChange("patch", JSON.parse(event.data));
  });
  firebaseStream.addEventListener("cancel", (event) => {
    console.error("Firebase stream cancelled.", event.data);
    setConnection(false, "Connection failed");
  });
  firebaseStream.addEventListener("auth_revoked", () => {
    localStorage.removeItem(FIREBASE_REFRESH_TOKEN_KEY);
    setConnection(false, "Reconnecting");
    connectFirebase();
  });
  firebaseStream.onerror = () => setConnection(false, "Reconnecting");

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
    render(payload.entries || []);
    hasLoadedSnapshot = true;
  });
  stream.addEventListener("entry", (event) => {
    const payload = JSON.parse(event.data);
    render(payload.entries || [], hasLoadedSnapshot ? payload.entry?.id : "");
    hasLoadedSnapshot = true;
  });
  stream.addEventListener("error", () => setConnection(false, "Reconnecting"));
}

const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
const sourceOverride = new URLSearchParams(window.location.search).get("source");
const useFirebase =
  sourceOverride === "firebase" ||
  (sourceOverride !== "local" && !localHostnames.has(window.location.hostname));

if (useFirebase) {
  connectFirebase();
} else {
  connectLocal();
}
