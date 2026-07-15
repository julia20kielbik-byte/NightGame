const views = [...document.querySelectorAll(".view")];

const state = {
  roomCode: localStorage.getItem("roomCode"),
  participantToken: localStorage.getItem("participantToken"),
  adminToken: localStorage.getItem("adminToken"),
  isAdmin: Boolean(localStorage.getItem("adminToken")),
  currentRoom: null,
  proposals: [],
  refreshTimer: null
};

function showView(viewId) {
  views.forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("error", type === "error");
  toast.classList.add("visible");

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("visible");
  }, 3200);
}

async function request(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (state.adminToken) {
    headers["x-admin-token"] = state.adminToken;
  }

  if (state.participantToken) {
    headers["x-participant-token"] = state.participantToken;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Wystąpił nieoczekiwany błąd.");
  }

  return data;
}

function saveRoomSession({ code, adminToken = null, participantToken = null }) {
  state.roomCode = code.toUpperCase();
  state.adminToken = adminToken;
  state.participantToken = participantToken;
  state.isAdmin = Boolean(adminToken);

  localStorage.setItem("roomCode", state.roomCode);

  if (adminToken) {
    localStorage.setItem("adminToken", adminToken);
    localStorage.removeItem("participantToken");
  } else {
    localStorage.removeItem("adminToken");
  }

  if (participantToken) {
    localStorage.setItem("participantToken", participantToken);
    localStorage.removeItem("adminToken");
  } else {
    localStorage.removeItem("participantToken");
  }
}

function clearRoomSession() {
  state.roomCode = null;
  state.adminToken = null;
  state.participantToken = null;
  state.isAdmin = false;
  state.currentRoom = null;
  state.proposals = [];

  localStorage.removeItem("roomCode");
  localStorage.removeItem("adminToken");
  localStorage.removeItem("participantToken");

  window.clearInterval(state.refreshTimer);
}

function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function statusText(status) {
  return {
    open: "Zapisy otwarte",
    locked: "Zapisy zamknięte",
    drawn: "Grupy wylosowane"
  }[status] || status;
}

function renderRoom(data) {
  state.currentRoom = data;

  document.getElementById("roomName").textContent = data.room.name;
  document.getElementById("roomCode").textContent = data.room.code;
  document.getElementById("participantCount").textContent =
    data.room.participantCount;
  document.getElementById("roomStatusLabel").textContent =
    statusText(data.room.status);

  const participantsList = document.getElementById("participantsList");

  if (data.participants.length === 0) {
    participantsList.innerHTML = `
      <p class="muted">Nikt jeszcze nie dołączył.</p>
    `;
  } else {
    participantsList.innerHTML = data.participants
      .map(
        (participant) => `
          <div class="participant-item">
            <div class="participant-main">
              <span class="participant-avatar">${getInitials(participant.name)}</span>
              <strong>${escapeHtml(participant.name)}</strong>
            </div>

            ${
              participant.colorHex
                ? `<span
                    class="participant-group-dot"
                    title="${escapeHtml(participant.groupName)}"
                    style="background:${participant.colorHex}"
                  ></span>`
                : ""
            }

            ${
              state.isAdmin && data.room.status === "open"
                ? `<button
                    class="remove-participant"
                    type="button"
                    data-remove-participant="${participant.id}"
                  >
                    Usuń
                  </button>`
                : ""
            }
          </div>
        `
      )
      .join("");
  }

  document.querySelectorAll("[data-remove-participant]").forEach((button) => {
    button.addEventListener("click", () => {
      removeParticipant(button.dataset.removeParticipant);
    });
  });

  renderAdminPanel(data);
  renderGroups(data.groups);
  renderParticipantResult(data.currentParticipant);
}

function renderAdminPanel(data) {
  const adminPanel = document.getElementById("adminPanel");
  const openActions = document.getElementById("adminOpenActions");
  const lockedActions = document.getElementById("adminLockedActions");
  const drawnActions = document.getElementById("adminDrawnActions");

  adminPanel.classList.toggle("hidden", !state.isAdmin);
  openActions.classList.toggle("hidden", data.room.status !== "open");
  lockedActions.classList.toggle("hidden", data.room.status !== "locked");
  drawnActions.classList.toggle("hidden", data.room.status !== "drawn");

  if (state.isAdmin && data.room.status === "locked") {
    loadProposals();
  }
}

function renderProposals() {
  const proposalsList = document.getElementById("proposalsList");

  if (state.proposals.length === 0) {
    proposalsList.innerHTML = `
      <p class="muted">Brak dostępnych wariantów podziału.</p>
    `;
    return;
  }

  proposalsList.innerHTML = state.proposals
    .map(
      (proposal, index) => `
        <button
          class="proposal-button"
          type="button"
          data-group-count="${proposal.groupCount}"
        >
          <strong>
            ${index === 0 ? "Polecany: " : ""}
            ${escapeHtml(proposal.description)}
          </strong>
          <span>
            ${proposal.perfectlyEqual ? "Idealnie równe grupy" : "Różnica maksymalnie 1 osoby"}
          </span>
        </button>
      `
    )
    .join("");

  document.querySelectorAll("[data-group-count]").forEach((button) => {
    button.addEventListener("click", () => {
      drawGroups(Number(button.dataset.groupCount));
    });
  });
}

function renderGroups(groups) {
  const section = document.getElementById("groupsSection");
  const grid = document.getElementById("groupsGrid");

  section.classList.toggle("hidden", groups.length === 0);

  grid.innerHTML = groups
    .map(
      (group) => `
        <article class="group-card">
          <div class="group-color-bar" style="background:${group.color_hex}"></div>
          <div class="group-card-content">
            <h3>${escapeHtml(group.name)}</h3>
            <ul class="group-members">
              ${group.participants
                .map((participant) => `<li>${escapeHtml(participant.name)}</li>`)
                .join("")}
            </ul>
          </div>
        </article>
      `
    )
    .join("");
}

function renderParticipantResult(participant) {
  const panel = document.getElementById("participantResult");

  if (!participant || !participant.group_id) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  panel.style.setProperty("--result-color", participant.color_hex);
  panel.innerHTML = `
    <span class="eyebrow">Twój wynik</span>
    <h2>Jesteś w: ${escapeHtml(participant.group_name)}</h2>
    <p>Kolor grupy: ${escapeHtml(participant.color_name)}</p>
  `;
  panel.classList.remove("hidden");
}

async function loadRoom({ silent = false } = {}) {
  if (!state.roomCode) {
    return;
  }

  try {
    const data = await request(`/api/rooms/${state.roomCode}`);
    renderRoom(data);
    showView("roomView");
  } catch (error) {
    if (!silent) {
      showToast(error.message, "error");
    }

    if (error.message.includes("uprawnień")) {
      clearRoomSession();
      showView("adminLoginView");
    }
  }
}

async function loadProposals() {
  if (!state.isAdmin || !state.roomCode) {
    return;
  }

  try {
    const data = await request(`/api/rooms/${state.roomCode}/proposals`);
    state.proposals = data.proposals;
    renderProposals();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function closeRoom() {
  try {
    const data = await request(`/api/rooms/${state.roomCode}/close`, {
      method: "POST"
    });

    state.proposals = data.proposals;
    renderProposals();
    showToast("Zapisy zostały zamknięte.");
    await loadRoom();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function reopenRoom() {
  try {
    await request(`/api/rooms/${state.roomCode}/reopen`, {
      method: "POST"
    });
    state.proposals = [];
    showToast("Zapisy zostały ponownie otwarte.");
    await loadRoom();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function drawGroups(groupCount) {
  try {
    await request(`/api/rooms/${state.roomCode}/draw`, {
      method: "POST",
      body: JSON.stringify({ groupCount })
    });
    showToast("Grupy zostały wylosowane.");
    await loadRoom();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function redrawGroups() {
  try {
    const proposals = await request(
      `/api/rooms/${state.roomCode}/proposals`
    );

    const currentGroupCount = state.currentRoom?.groups?.length;
    const selected =
      proposals.proposals.find(
        (proposal) => proposal.groupCount === currentGroupCount
      ) || proposals.proposals[0];

    if (!selected) {
      throw new Error("Brak dostępnego podziału.");
    }

    await drawGroups(selected.groupCount);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function removeParticipant(participantId) {
  try {
    await request(
      `/api/rooms/${state.roomCode}/participants/${participantId}`,
      { method: "DELETE" }
    );
    showToast("Uczestnik został usunięty.");
    await loadRoom();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function startAutoRefresh() {
  window.clearInterval(state.refreshTimer);
  state.refreshTimer = window.setInterval(() => {
    loadRoom({ silent: true });
  }, 2500);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document
  .getElementById("showCreateButton")
  .addEventListener("click", () => showView("createView"));

document
  .getElementById("showJoinButton")
  .addEventListener("click", () => showView("joinView"));

document
  .getElementById("showAdminLoginButton")
  .addEventListener("click", () => showView("adminLoginView"));

document.getElementById("homeButton").addEventListener("click", () => {
  if (state.roomCode) {
    loadRoom();
  } else {
    showView("homeView");
  }
});

document.getElementById("createRoomForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);

  try {
    const data = await request("/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        adminName: form.get("adminName"),
        password: form.get("password")
      })
    });

    saveRoomSession({
      code: data.code,
      adminToken: data.adminToken
    });

    showToast(`Pokój utworzony. Kod: ${data.code}`);
    await loadRoom();
    startAutoRefresh();
  } catch (error) {
    showToast(error.message, "error");
  }
});

document.getElementById("joinRoomForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const code = String(form.get("code")).trim().toUpperCase();

  try {
    const data = await request(`/api/rooms/${code}/join`, {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name")
      })
    });

    saveRoomSession({
      code,
      participantToken: data.sessionToken
    });

    showToast("Dołączono do pokoju.");
    await loadRoom();
    startAutoRefresh();
  } catch (error) {
    showToast(error.message, "error");
  }
});

document.getElementById("adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const code = String(form.get("code")).trim().toUpperCase();

  try {
    const data = await request(`/api/rooms/${code}/admin-login`, {
      method: "POST",
      body: JSON.stringify({
        password: form.get("password")
      })
    });

    saveRoomSession({
      code,
      adminToken: data.adminToken
    });

    showToast("Zalogowano jako administrator.");
    await loadRoom();
    startAutoRefresh();
  } catch (error) {
    showToast(error.message, "error");
  }
});

document
  .getElementById("closeRoomButton")
  .addEventListener("click", closeRoom);

document
  .getElementById("reopenRoomButton")
  .addEventListener("click", reopenRoom);

document
  .getElementById("resetRoomButton")
  .addEventListener("click", reopenRoom);

document
  .getElementById("redrawButton")
  .addEventListener("click", redrawGroups);

document
  .getElementById("copyRoomCodeButton")
  .addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.roomCode);
      showToast("Kod pokoju został skopiowany.");
    } catch {
      showToast(`Kod pokoju: ${state.roomCode}`);
    }
  });

const codeFromUrl = new URLSearchParams(window.location.search).get("room");

if (codeFromUrl && !state.roomCode) {
  document.querySelector('#joinRoomForm input[name="code"]').value =
    codeFromUrl.toUpperCase();
  showView("joinView");
} else if (state.roomCode) {
  loadRoom();
  startAutoRefresh();
}
