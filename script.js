(() => {
  "use strict";

  // Exercise types used for grouping and validation.
  const EXERCISE_TYPES = ["Legs", "Arms", "Torso", "Other"];

  // IndexedDB setup with localStorage fallback.
  const DB_NAME = "gymTrackerDB";
  const DB_VERSION = 1;
  const STORE_NAME = "state";
  const STATE_ID = "main";
  const FALLBACK_KEY = "gymTrackerState";
  const THEME_PREF_KEY = "gymTrackerTheme";
  const EXPORT_FILENAME = "workout-tracker-backup.json";
  const THEME_COLOR_LIGHT = "#eaf1ff";
  const THEME_COLOR_DARK = "#111214";

  const DEFAULT_STATE = {
    cycleLength: 7,
    cycleStart: "",
    exercises: [],
    logs: []
  };

  const ui = {};
  let appState = { ...DEFAULT_STATE };
  let currentView = "home";
  let selectedExerciseId = null;
  let selectedLogVariant = "regular";
  let exerciseEditorState = null;
  let pendingDeleteExerciseId = null;
  let pendingDeleteMode = "exercise";
  let pendingImportState = null;
  let historyWeekStart = null;
  let selectedHistoryDate = "";

  const storage = {
    db: null,
    mode: "indexeddb",

    async init() {
      try {
        this.db = await openDatabase();
      } catch (error) {
        this.mode = "localStorage";
        console.warn("IndexedDB not available. Falling back to localStorage.", error);
      }
    },

    async load() {
      if (this.mode === "indexeddb" && this.db) {
        try {
          const record = await idbGet(this.db, STORE_NAME, STATE_ID);
          if (record && record.value) {
            return record.value;
          }
        } catch (error) {
          this.mode = "localStorage";
          console.warn("Failed to load from IndexedDB. Falling back.", error);
        }
      }

      const raw = localStorage.getItem(FALLBACK_KEY);
      if (!raw) {
        return { ...DEFAULT_STATE };
      }

      try {
        return JSON.parse(raw);
      } catch (error) {
        console.warn("Stored fallback state was invalid JSON.", error);
        return { ...DEFAULT_STATE };
      }
    },

    async save(state) {
      if (this.mode === "indexeddb" && this.db) {
        try {
          await idbPut(this.db, STORE_NAME, { id: STATE_ID, value: state });
          return;
        } catch (error) {
          this.mode = "localStorage";
          console.warn("Failed to save to IndexedDB. Falling back.", error);
        }
      }

      localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
    }
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    initTheme();
    attachEvents();

    await storage.init();
    appState = await storage.load();
    sanitizeState();

    if (!appState.cycleStart) {
      appState.cycleStart = todayYMD();
    }

    await ensureCurrentCycle();
    await storage.save(appState);

    selectedHistoryDate = todayYMD();
    historyWeekStart = startOfWeekMonday(parseYMD(selectedHistoryDate));
    updateLogDateLabel();

    renderAll();
    await showView("home");
    registerServiceWorker();
  }

  function cacheElements() {
    ui.pageTitle = document.getElementById("pageTitle");
    ui.homeSubtitle = document.getElementById("homeSubtitle");
    ui.themeToggleBtn = document.getElementById("themeToggleBtn");
    ui.exportDataBtn = document.getElementById("exportDataBtn");
    ui.importDataBtn = document.getElementById("importDataBtn");
    ui.importFileInput = document.getElementById("importFileInput");

    ui.views = {
      home: document.getElementById("view-home"),
      list: document.getElementById("view-list"),
      history: document.getElementById("view-history"),
      log: document.getElementById("view-log")
    };

    ui.listSections = document.getElementById("listSections");
    ui.logSections = document.getElementById("logSections");
    ui.historyEntries = document.getElementById("historyEntries");
    ui.weekGrid = document.getElementById("weekGrid");
    ui.historyMonth = document.getElementById("historyMonth");

    ui.statusMessage = document.getElementById("statusMessage");
    ui.logDateLabel = document.getElementById("logDateLabel");

    ui.addExerciseBtn = document.getElementById("addExerciseBtn");
    ui.setCycleBtn = document.getElementById("setCycleBtn");
    ui.prevWeekBtn = document.getElementById("prevWeekBtn");
    ui.nextWeekBtn = document.getElementById("nextWeekBtn");

    ui.logForm = document.getElementById("logForm");
    ui.logOverlay = document.getElementById("logOverlay");
    ui.closeLogOverlayBtn = document.getElementById("closeLogOverlayBtn");
    ui.logVariantControls = document.getElementById("logVariantControls");
    ui.logRegularVariantBtn = document.getElementById("logRegularVariantBtn");
    ui.logAlternativeVariantBtn = document.getElementById("logAlternativeVariantBtn");
    ui.selectedExerciseName = document.getElementById("selectedExerciseName");
    ui.selectedExerciseMeta = document.getElementById("selectedExerciseMeta");
    ui.logRepsInput = document.getElementById("logRepsInput");
    ui.logWeightInput = document.getElementById("logWeightInput");

    ui.exerciseModal = document.getElementById("exerciseModal");
    ui.exerciseModalTitle = document.getElementById("exerciseModalTitle");
    ui.exerciseVariantSwitchBtn = document.getElementById("exerciseVariantSwitchBtn");
    ui.exerciseVariantLabel = document.getElementById("exerciseVariantLabel");
    ui.exerciseSharedHint = document.getElementById("exerciseSharedHint");
    ui.exerciseSharedFields = document.getElementById("exerciseSharedFields");
    ui.exercisePerCycleField = document.getElementById("exercisePerCycleField");
    ui.exerciseForm = document.getElementById("exerciseForm");
    ui.exerciseSaveBtn = document.getElementById("exerciseSaveBtn");
    ui.exerciseIdInput = document.getElementById("exerciseIdInput");
    ui.exerciseNameInput = document.getElementById("exerciseNameInput");
    ui.exerciseTypeInput = document.getElementById("exerciseTypeInput");
    ui.exerciseSetsInput = document.getElementById("exerciseSetsInput");
    ui.exerciseRepsInput = document.getElementById("exerciseRepsInput");
    ui.exerciseWeightInput = document.getElementById("exerciseWeightInput");
    ui.exercisePerCycleInput = document.getElementById("exercisePerCycleInput");
    ui.cancelExerciseBtn = document.getElementById("cancelExerciseBtn");

    ui.cycleModal = document.getElementById("cycleModal");
    ui.cycleForm = document.getElementById("cycleForm");
    ui.cycleLengthInput = document.getElementById("cycleLengthInput");
    ui.cancelCycleBtn = document.getElementById("cancelCycleBtn");

    ui.deleteConfirmModal = document.getElementById("deleteConfirmModal");
    ui.deleteConfirmText = document.getElementById("deleteConfirmText");
    ui.cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
    ui.confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

    ui.importConfirmModal = document.getElementById("importConfirmModal");
    ui.cancelImportBtn = document.getElementById("cancelImportBtn");
    ui.confirmImportBtn = document.getElementById("confirmImportBtn");
  }

  function attachEvents() {
    document.querySelectorAll("[data-nav]").forEach((button) => {
      button.addEventListener("click", () => showView(button.dataset.nav));
    });
    ui.themeToggleBtn.addEventListener("click", toggleTheme);
    ui.exportDataBtn.addEventListener("click", exportData);
    ui.importDataBtn.addEventListener("click", () => {
      ui.importFileInput.click();
    });
    ui.importFileInput.addEventListener("change", handleImportFileSelected);

    ui.addExerciseBtn.addEventListener("click", openAddExerciseModal);
    ui.cancelExerciseBtn.addEventListener("click", () => closeModal(ui.exerciseModal));
    ui.exerciseVariantSwitchBtn.addEventListener("click", toggleExerciseEditorVariant);
    ui.exerciseForm.addEventListener("submit", handleExerciseSubmit);

    ui.setCycleBtn.addEventListener("click", openCycleModal);
    ui.cancelCycleBtn.addEventListener("click", () => closeModal(ui.cycleModal));
    ui.cycleForm.addEventListener("submit", handleCycleSubmit);

    ui.prevWeekBtn.addEventListener("click", () => shiftWeek(-1));
    ui.nextWeekBtn.addEventListener("click", () => shiftWeek(1));

    ui.weekGrid.addEventListener("click", (event) => {
      const dayBtn = event.target.closest("button[data-date]");
      if (!dayBtn) {
        return;
      }

      selectedHistoryDate = dayBtn.dataset.date;
      renderHistoryPage();
    });

    ui.listSections.addEventListener("click", (event) => {
      const editButton = event.target.closest("button[data-edit-id]");
      if (editButton) {
        const exercise = getExerciseById(editButton.dataset.editId);
        if (exercise) {
          openEditExerciseModal(exercise);
        }
        return;
      }

      const deleteAltButton = event.target.closest("button[data-delete-alt-id]");
      if (deleteAltButton) {
        openDeleteConfirmModal(deleteAltButton.dataset.deleteAltId, "alternative");
        return;
      }

      const deleteButton = event.target.closest("button[data-delete-id]");
      if (deleteButton) {
        openDeleteConfirmModal(deleteButton.dataset.deleteId, "exercise");
      }
    });

    ui.logSections.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-log-id]");
      if (!button || button.disabled) {
        return;
      }

      const exercise = getExerciseById(button.dataset.logId);
      if (!exercise) {
        return;
      }

      selectedExerciseId = exercise.id;
      selectedLogVariant = "regular";
      updateLogOverlayForVariant();
      ui.logForm.classList.remove("hidden");
      ui.logOverlay.classList.remove("hidden");
      ui.logOverlay.setAttribute("aria-hidden", "false");
      renderLogPage();
    });

    ui.logForm.addEventListener("submit", handleLogSubmit);
    ui.closeLogOverlayBtn.addEventListener("click", () => closeLogOverlay(true));
    ui.logRegularVariantBtn.addEventListener("click", () => {
      selectedLogVariant = "regular";
      updateLogOverlayForVariant();
    });
    ui.logAlternativeVariantBtn.addEventListener("click", () => {
      selectedLogVariant = "alternative";
      updateLogOverlayForVariant();
    });
    ui.logOverlay.addEventListener("click", (event) => {
      if (event.target === ui.logOverlay) {
        closeLogOverlay(true);
      }
    });

    ui.cancelDeleteBtn.addEventListener("click", () => closeModal(ui.deleteConfirmModal));
    ui.confirmDeleteBtn.addEventListener("click", handleConfirmDeleteExercise);
    ui.cancelImportBtn.addEventListener("click", () => closeModal(ui.importConfirmModal));
    ui.confirmImportBtn.addEventListener("click", handleConfirmImport);

    [ui.exerciseModal, ui.cycleModal, ui.deleteConfirmModal, ui.importConfirmModal].forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          closeModal(modal);
        }
      });
    });
  }

  // Normalize data loaded from storage so old or malformed data cannot break rendering.
  function sanitizeState() {
    appState.cycleLength = clampInt(appState.cycleLength, 7, 1, 365);
    appState.cycleStart = isValidYMD(appState.cycleStart) ? appState.cycleStart : "";

    appState.exercises = Array.isArray(appState.exercises) ? appState.exercises : [];
    appState.exercises = appState.exercises
      .map((exercise) => {
        const alternativeRaw = exercise.alternative && typeof exercise.alternative === "object" ? exercise.alternative : null;
        const alternative = alternativeRaw
          ? {
              name: String(alternativeRaw.name || "").trim(),
              sets: clampInt(alternativeRaw.sets, 3, 1, 50),
              reps: normalizeRepsPattern(alternativeRaw.reps, "8"),
              weight: clampNumber(alternativeRaw.weight, 0, 0, 5000)
            }
          : null;

        return {
          id: String(exercise.id || createId()),
            name: String(exercise.name || "Exercise").trim() || "Exercise",
            type: normalizeType(exercise.type),
            sets: clampInt(exercise.sets, 3, 1, 50),
            reps: normalizeRepsPattern(exercise.reps, "8"),
            weight: clampNumber(exercise.weight, 0, 0, 5000),
            perCycle: clampInt(exercise.perCycle, 3, 1, 999),
            alternative: alternative && alternative.name ? alternative : null
        };
      })
      .sort(sortByTypeThenName);

    const exerciseNameById = new Map(appState.exercises.map((exercise) => [exercise.id, exercise.name]));
    appState.logs = Array.isArray(appState.logs) ? appState.logs : [];
    appState.logs = appState.logs
      .map((log) => {
        const exerciseId = String(log.exerciseId || "");
        const snapshotName = String(log.exerciseNameSnapshot || "").trim() || String(exerciseNameById.get(exerciseId) || "").trim();
        return {
            id: String(log.id || createId()),
            exerciseId,
            date: isValidDate(log.date) ? log.date : new Date().toISOString(),
            reps: normalizeRepsPattern(log.reps, "1"),
            weight: clampNumber(log.weight, 0, 0, 5000),
            sets: clampInt(log.sets, 0, 0, 50),
            isAlternativeSnapshot: Boolean(log.isAlternativeSnapshot),
          exerciseNameSnapshot: snapshotName
        };
      })
      .filter((log) => log.exerciseId);
  }

  // Move cycle forward if enough days passed so per-cycle limits reset automatically.
  async function ensureCurrentCycle() {
    const start = parseYMD(appState.cycleStart || todayYMD());
    const today = parseYMD(todayYMD());
    const diff = daysBetween(start, today);

    if (diff >= appState.cycleLength) {
      const cyclesPassed = Math.floor(diff / appState.cycleLength);
      appState.cycleStart = toYMD(addDays(start, cyclesPassed * appState.cycleLength));
      setStatus("New cycle started.");
      await storage.save(appState);
    }
  }

  async function showView(viewName) {
    if (!ui.views[viewName]) {
      return;
    }

    if (viewName !== "log") {
      ui.logOverlay.classList.add("hidden");
      ui.logOverlay.setAttribute("aria-hidden", "true");
      ui.logForm.classList.add("hidden");
      ui.logVariantControls.classList.add("hidden");
      ui.selectedExerciseName.classList.remove("alt-name");
      selectedExerciseId = null;
      selectedLogVariant = "regular";
    }

    Object.values(ui.views).forEach((view) => view.classList.remove("active"));
    ui.views[viewName].classList.add("active");
    currentView = viewName;

    ui.pageTitle.textContent =
      viewName === "home"
        ? "Workout Tracker"
        : viewName === "list"
          ? "Exercise List"
          : viewName === "history"
            ? "History"
            : "Log Workout";
    ui.homeSubtitle.classList.toggle("hidden", viewName !== "home");

    await ensureCurrentCycle();

    if (viewName === "list") {
      renderListPage();
    }

    if (viewName === "history") {
      // Requirement: select current day whenever history opens.
      selectedHistoryDate = todayYMD();
      historyWeekStart = startOfWeekMonday(parseYMD(selectedHistoryDate));
      renderHistoryPage();
    }

    if (viewName === "log") {
      updateLogDateLabel();
      renderLogPage();
    }
  }

  function renderAll() {
    renderListPage();
    renderLogPage();
    renderHistoryPage();
  }

  function renderListPage() {
    const counts = getCurrentCycleCounts();
    ui.setCycleBtn.textContent = `Cycle: ${appState.cycleLength}d`;

    if (!appState.exercises.length) {
      ui.listSections.innerHTML = '<p class="empty-note">No exercises yet. Tap + to add your first one.</p>';
      return;
    }

    const grouped = groupExercisesByType(appState.exercises);

    ui.listSections.innerHTML = EXERCISE_TYPES
      .map((type) => {
        const items = grouped[type];
        const content = items.length
          ? `<div class="card-list">${items
              .map((exercise) => renderExerciseCard(exercise, counts[exercise.id] || 0))
              .join("")}</div>`
          : '<p class="empty-note">No exercises in this section yet.</p>';

        return `
          <section class="type-section">
            <h3 class="type-title">${type}</h3>
            ${content}
          </section>
        `;
      })
      .join("");
  }

  function renderExerciseCard(exercise, count) {
    const reached = count >= exercise.perCycle;
    const hasAlternative = Boolean(exercise.alternative && exercise.alternative.name);

    return `
      <article class="exercise-card ${reached ? "reached" : ""}">
        <div class="card-top">
          <h4 class="exercise-name">${escapeHtml(exercise.name)}</h4>
          <span class="badge ${reached ? "limit" : "ok"}">${reached ? "Limit reached" : `${count}/${exercise.perCycle}`}</span>
        </div>

        <div class="exercise-meta">
          <span>Type: ${exercise.type}</span>
          <span>Sets: ${exercise.sets}</span>
          <span>Reps: ${exercise.reps}</span>
          <span>Weight: ${exercise.weight}</span>
          <span>Per cycle: ${exercise.perCycle}</span>
          ${hasAlternative ? "<span>Alternative: Yes</span>" : ""}
        </div>

        <div class="card-actions">
          <button class="secondary-btn" type="button" data-edit-id="${exercise.id}">Edit</button>
          ${hasAlternative ? `<button class="secondary-btn alt-only-btn" type="button" data-delete-alt-id="${exercise.id}" aria-label="Delete alternative for ${escapeHtml(exercise.name)}">🔁</button>` : ""}
          <button class="secondary-btn danger-btn" type="button" data-delete-id="${exercise.id}" aria-label="Delete ${escapeHtml(exercise.name)}">&#128465;</button>
        </div>
      </article>
    `;
  }

  function renderLogPage() {
    const counts = getCurrentCycleCounts();

    if (!appState.exercises.length) {
      ui.logSections.innerHTML = '<p class="empty-note">No exercises yet. Add one on the List page.</p>';
      ui.logForm.classList.add("hidden");
      ui.logOverlay.classList.add("hidden");
      ui.logOverlay.setAttribute("aria-hidden", "true");
      ui.logVariantControls.classList.add("hidden");
      ui.selectedExerciseName.classList.remove("alt-name");
      return;
    }

    const grouped = groupExercisesByType(appState.exercises);

    ui.logSections.innerHTML = EXERCISE_TYPES
      .map((type) => {
        const ordered = grouped[type].slice().sort((a, b) => {
          const aReached = (counts[a.id] || 0) >= a.perCycle;
          const bReached = (counts[b.id] || 0) >= b.perCycle;
          if (aReached !== bReached) {
            return aReached ? 1 : -1;
          }
          return a.name.localeCompare(b.name);
        });
        const sectionUsed = ordered.reduce((sum, exercise) => sum + (counts[exercise.id] || 0), 0);
        const sectionLimit = ordered.reduce((sum, exercise) => sum + exercise.perCycle, 0);

        const content = ordered.length
          ? `<div class="card-list">${ordered
              .map((exercise) => renderLogCard(exercise, counts[exercise.id] || 0))
              .join("")}</div>`
          : '<p class="empty-note">No exercises in this section yet.</p>';

        return `
          <section class="type-section">
            <div class="type-title-row">
              <h3 class="type-title">${type}</h3>
              <span class="type-progress">${sectionUsed}/${sectionLimit}</span>
            </div>
            ${content}
          </section>
        `;
      })
      .join("");

    const selected = getExerciseById(selectedExerciseId);
    if (!selected || (counts[selected.id] || 0) >= selected.perCycle) {
      selectedExerciseId = null;
      ui.logForm.classList.add("hidden");
      ui.logOverlay.classList.add("hidden");
      ui.logOverlay.setAttribute("aria-hidden", "true");
      ui.logVariantControls.classList.add("hidden");
      ui.selectedExerciseName.classList.remove("alt-name");
    }
  }

  function renderLogCard(exercise, count) {
    const reached = count >= exercise.perCycle;
    const selected = selectedExerciseId === exercise.id;
    const hasAlternative = Boolean(exercise.alternative && exercise.alternative.name);
    const switchHint = hasAlternative ? '<span class="switch-indicator">🔁 (switch)</span>' : "";

    return `
      <button
        type="button"
        class="log-card ${reached ? "reached" : ""} ${selected ? "selected" : ""}"
        data-log-id="${exercise.id}"
        ${reached ? "disabled" : ""}
      >
        <div class="card-top">
          <strong>${escapeHtml(exercise.name)} ${switchHint}</strong>
          <span class="badge ${reached ? "limit" : "ok"}">${reached ? "Limit reached" : `${count}/${exercise.perCycle}`}</span>
        </div>
        <span class="log-meta">Sets ${exercise.sets} • Last reps ${exercise.reps} • Last weight ${exercise.weight}</span>
      </button>
    `;
  }

  function renderHistoryPage() {
    historyWeekStart = historyWeekStart || startOfWeekMonday(parseYMD(todayYMD()));
    selectedHistoryDate = selectedHistoryDate || todayYMD();

    const selectedDate = parseYMD(selectedHistoryDate);
    ui.historyMonth.textContent = selectedDate.toLocaleDateString(undefined, { month: "long" });

    const today = todayYMD();
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    ui.weekGrid.innerHTML = labels
      .map((label, index) => {
        const date = addDays(historyWeekStart, index);
        const ymd = toYMD(date);

        const selectedClass = ymd === selectedHistoryDate ? "selected" : "";
        const todayClass = ymd === today ? "today" : "";

        return `
          <button type="button" class="day-btn ${selectedClass} ${todayClass}" data-date="${ymd}">
            <span class="label">${label}</span>
            <span class="date">${date.getDate()}</span>
          </button>
        `;
      })
      .join("");

    renderHistoryEntries();
  }

  function renderHistoryEntries() {
    // Requirement: oldest log at top, newest at bottom.
    const entries = appState.logs
      .filter((log) => toYMD(new Date(log.date)) === selectedHistoryDate)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (!entries.length) {
      ui.historyEntries.innerHTML = '<p class="empty-note">No workouts logged for this day.</p>';
      return;
    }

    ui.historyEntries.innerHTML = entries
      .map((entry) => {
        const exercise = getExerciseById(entry.exerciseId);
        const fallbackName = exercise ? exercise.name : "Deleted Exercise";
        const name = entry.exerciseNameSnapshot || fallbackName;
        const nameClass = entry.isAlternativeSnapshot ? "alt-name" : "";
        const time = new Date(entry.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

        return `
          <article class="history-card">
            <h4 class="${nameClass}">${escapeHtml(name)}</h4>
            <p class="history-row">Sets ${entry.sets} • Reps ${entry.reps} • Weight ${entry.weight}</p>
            <p class="history-row">Logged at ${time}</p>
          </article>
        `;
      })
      .join("");
  }

  function openAddExerciseModal() {
    ui.exerciseModalTitle.textContent = "Add Exercise";
    ui.exerciseSaveBtn.textContent = "Save";
    exerciseEditorState = {
      id: "",
      mode: "add",
      currentVariant: "regular",
      regular: {
        name: "",
        type: "Legs",
        sets: 3,
        reps: "8",
        weight: 0,
        perCycle: 3
      },
      alternative: {
        name: "",
        sets: 3,
        reps: "8",
        weight: 0
      }
    };
    loadExerciseEditorIntoForm();
    openModal(ui.exerciseModal);
    ui.exerciseNameInput.focus();
  }

  function openEditExerciseModal(exercise) {
    ui.exerciseModalTitle.textContent = "Edit Exercise";
    ui.exerciseSaveBtn.textContent = "Update";
    exerciseEditorState = {
      id: exercise.id,
      mode: "edit",
      currentVariant: "regular",
      regular: {
        name: exercise.name,
        type: normalizeType(exercise.type),
        sets: exercise.sets,
        reps: String(exercise.reps),
        weight: exercise.weight,
        perCycle: exercise.perCycle
      },
      alternative: {
        name: exercise.alternative ? exercise.alternative.name : "",
        sets: exercise.alternative ? exercise.alternative.sets : exercise.sets,
        reps: exercise.alternative ? String(exercise.alternative.reps) : String(exercise.reps),
        weight: exercise.alternative ? exercise.alternative.weight : exercise.weight
      }
    };
    loadExerciseEditorIntoForm();

    openModal(ui.exerciseModal);
    ui.exerciseNameInput.focus();
  }

  async function handleExerciseSubmit(event) {
    event.preventDefault();

    syncExerciseEditorFromForm();
    const id = exerciseEditorState.id;
    const regular = exerciseEditorState.regular;
    const alternative = exerciseEditorState.alternative;
    const regularRepsParsed = parseRepsPattern(regular.reps);

    if (!regular.name || regular.sets < 1 || regular.perCycle < 1 || !regularRepsParsed.valid) {
      setStatus("Regular exercise must have valid values (reps like 8 or 8>5).", true);
      return;
    }

    const normalizedAlternative =
      alternative.name.trim().length > 0
          ? {
              name: alternative.name.trim(),
              sets: clampInt(alternative.sets, 3, 1, 50),
              reps: normalizeRepsPattern(alternative.reps, ""),
              weight: clampNumber(alternative.weight, 0, 0, 5000)
            }
          : null;

    if (normalizedAlternative && !normalizedAlternative.reps) {
      setStatus("Alternative reps must be valid (e.g. 8 or 8>5).", true);
      return;
    }

    if (!id) {
      appState.exercises.push({
        id: createId(),
        name: regular.name.trim(),
        type: normalizeType(regular.type),
        sets: clampInt(regular.sets, 3, 1, 50),
        reps: regularRepsParsed.pattern,
        weight: clampNumber(regular.weight, 0, 0, 5000),
        perCycle: clampInt(regular.perCycle, 3, 1, 999),
        alternative: normalizedAlternative
          ? {
              ...normalizedAlternative,
              reps: normalizedAlternative.reps
            }
          : null
      });
      setStatus(`Added ${regular.name.trim()}.`);
    } else {
      const exercise = getExerciseById(id);
      if (!exercise) {
        setStatus("Exercise not found.", true);
        return;
      }

      // Editing fields does not create logs and does not affect per-cycle counts.
      exercise.name = regular.name.trim();
      exercise.type = normalizeType(regular.type);
      exercise.sets = clampInt(regular.sets, 3, 1, 50);
      exercise.reps = regularRepsParsed.pattern;
      exercise.weight = clampNumber(regular.weight, 0, 0, 5000);
      exercise.perCycle = clampInt(regular.perCycle, 3, 1, 999);
      exercise.alternative = normalizedAlternative
        ? {
            ...normalizedAlternative,
            reps: normalizedAlternative.reps
          }
        : null;

      setStatus(`Updated ${regular.name.trim()}.`);
    }

    appState.exercises.sort(sortByTypeThenName);
    await storage.save(appState);

    closeModal(ui.exerciseModal);
    renderListPage();
    renderLogPage();

    if (currentView === "history") {
      renderHistoryPage();
    }
  }

  function toggleExerciseEditorVariant() {
    if (!exerciseEditorState) {
      return;
    }

    syncExerciseEditorFromForm();
    exerciseEditorState.currentVariant = exerciseEditorState.currentVariant === "regular" ? "alternative" : "regular";
    loadExerciseEditorIntoForm();
  }

  function loadExerciseEditorIntoForm() {
    if (!exerciseEditorState) {
      return;
    }

    const isRegular = exerciseEditorState.currentVariant === "regular";
    const source = isRegular ? exerciseEditorState.regular : exerciseEditorState.alternative;

    ui.exerciseIdInput.value = exerciseEditorState.id || "";
    ui.exerciseNameInput.value = String(source.name || "");
    ui.exerciseSetsInput.value = String(source.sets ?? 3);
    ui.exerciseRepsInput.value = String(source.reps ?? 8);
    ui.exerciseWeightInput.value = String(source.weight ?? 0);

    ui.exerciseTypeInput.value = normalizeType(exerciseEditorState.regular.type);
    ui.exercisePerCycleInput.value = String(exerciseEditorState.regular.perCycle ?? 3);

    ui.exerciseVariantLabel.textContent = `Editing: ${isRegular ? "Regular" : "Alternative"}`;
    ui.exerciseVariantSwitchBtn.textContent = isRegular ? "Edit Alternative" : "Edit Regular";
    ui.exerciseSharedFields.classList.toggle("hidden", !isRegular);
    ui.exercisePerCycleField.classList.toggle("hidden", !isRegular);
    ui.exerciseSharedHint.classList.toggle("hidden", isRegular);
  }

  function syncExerciseEditorFromForm() {
    if (!exerciseEditorState) {
      return;
    }

    const isRegular = exerciseEditorState.currentVariant === "regular";
    const target = isRegular ? exerciseEditorState.regular : exerciseEditorState.alternative;

    target.name = ui.exerciseNameInput.value.trim();
    target.sets = clampInt(ui.exerciseSetsInput.value, 3, 1, 50);
    target.reps = ui.exerciseRepsInput.value.trim();
    target.weight = clampNumber(ui.exerciseWeightInput.value, 0, 0, 5000);

    if (isRegular) {
      exerciseEditorState.regular.type = normalizeType(ui.exerciseTypeInput.value);
      exerciseEditorState.regular.perCycle = clampInt(ui.exercisePerCycleInput.value, 3, 1, 999);
    }
  }

  function openCycleModal() {
    ui.cycleLengthInput.value = String(appState.cycleLength);
    openModal(ui.cycleModal);
    ui.cycleLengthInput.focus();
  }

  function openDeleteConfirmModal(exerciseId, mode = "exercise") {
    const exercise = getExerciseById(exerciseId);
    if (!exercise) {
      return;
    }

    pendingDeleteMode = mode;
    pendingDeleteExerciseId = exerciseId;
    ui.deleteConfirmText.textContent =
      mode === "alternative"
        ? "Are you sure you want to delete the alternative version of this exercise?"
        : `Delete "${exercise.name}"? Existing history logs will stay.`;
    openModal(ui.deleteConfirmModal);
  }

  async function handleConfirmDeleteExercise() {
    if (!pendingDeleteExerciseId) {
      closeModal(ui.deleteConfirmModal);
      return;
    }

    const exercise = getExerciseById(pendingDeleteExerciseId);
    if (!exercise) {
      pendingDeleteExerciseId = null;
      closeModal(ui.deleteConfirmModal);
      return;
    }

    if (pendingDeleteMode === "alternative") {
      exercise.alternative = null;
      if (selectedExerciseId === exercise.id && selectedLogVariant === "alternative") {
        selectedLogVariant = "regular";
      }
      setStatus(`Deleted alternative for ${exercise.name}.`);
    } else {
      appState.exercises = appState.exercises.filter((item) => item.id !== pendingDeleteExerciseId);
      if (selectedExerciseId === exercise.id) {
        closeLogOverlay(true);
      }
      setStatus(`Deleted ${exercise.name}.`);
    }

    pendingDeleteExerciseId = null;
    closeModal(ui.deleteConfirmModal);

    await storage.save(appState);
    renderListPage();
    renderLogPage();
    renderHistoryPage();
  }

  function exportData() {
    try {
      const backup = buildBackupState();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = EXPORT_FILENAME;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setStatus(`Exported ${EXPORT_FILENAME}.`);
    } catch (error) {
      console.warn("Export failed.", error);
      setStatus("Export failed. Please try again.", true);
    }
  }

  async function handleImportFileSelected(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    let parsed;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch (error) {
      setStatus("Invalid file. Please choose a valid JSON backup.", true);
      return;
    }

    const validated = validateImportedState(parsed);
    if (!validated.valid) {
      setStatus(validated.error, true);
      return;
    }

    pendingImportState = validated.state;
    openModal(ui.importConfirmModal);
  }

  async function handleConfirmImport() {
    if (!pendingImportState) {
      closeModal(ui.importConfirmModal);
      return;
    }

    appState = deepClone(pendingImportState);
    sanitizeState();
    if (!appState.cycleStart) {
      appState.cycleStart = todayYMD();
    }

    selectedExerciseId = null;
    selectedLogVariant = "regular";
    exerciseEditorState = null;

    await ensureCurrentCycle();
    await storage.save(appState);

    closeLogOverlay(true);
    closeModal(ui.importConfirmModal);
    renderAll();
    setStatus("Imported backup data.");
  }

  function buildBackupState() {
    return {
      cycleLength: clampInt(appState.cycleLength, 7, 1, 365),
      cycleStart: isValidYMD(appState.cycleStart) ? appState.cycleStart : todayYMD(),
      exercises: deepClone(appState.exercises),
      logs: deepClone(appState.logs)
    };
  }

  function validateImportedState(payload) {
    if (!isPlainObject(payload)) {
      return { valid: false, error: "Invalid backup format. Expected a JSON object." };
    }

    if (!Array.isArray(payload.exercises) || !Array.isArray(payload.logs)) {
      return { valid: false, error: "Invalid backup format. Exercises and logs must be arrays." };
    }

    const parsedCycleLength = Number.parseInt(payload.cycleLength, 10);
    if (!Number.isFinite(parsedCycleLength) || parsedCycleLength < 1 || parsedCycleLength > 365) {
      return { valid: false, error: "Invalid backup format. Cycle length must be between 1 and 365." };
    }
    if (typeof payload.cycleStart !== "string" || !isValidYMD(payload.cycleStart)) {
      return { valid: false, error: "Invalid backup format. Cycle start date is invalid." };
    }

    const imported = {
      cycleLength: parsedCycleLength,
      cycleStart: payload.cycleStart,
      exercises: [],
      logs: []
    };
    const seenExerciseIds = new Set();

    for (const exercise of payload.exercises) {
      const normalized = normalizeImportedExercise(exercise);
      if (!normalized.valid) {
        return { valid: false, error: normalized.error };
      }
      if (seenExerciseIds.has(normalized.exercise.id)) {
        return { valid: false, error: `Invalid backup format. Duplicate exercise id "${normalized.exercise.id}".` };
      }
      seenExerciseIds.add(normalized.exercise.id);
      imported.exercises.push(normalized.exercise);
    }

    for (const log of payload.logs) {
      const normalized = normalizeImportedLog(log);
      if (!normalized.valid) {
        return { valid: false, error: normalized.error };
      }
      imported.logs.push(normalized.log);
    }

    imported.exercises.sort(sortByTypeThenName);
    return { valid: true, state: imported };
  }

  function normalizeImportedExercise(exercise) {
    if (!isPlainObject(exercise)) {
      return { valid: false, error: "Invalid backup format. Every exercise must be an object." };
    }

    const id = String(exercise.id || "").trim();
    const name = String(exercise.name || "").trim();
    const type = String(exercise.type || "").trim();
    const sets = Number.parseInt(exercise.sets, 10);
    const perCycle = Number.parseInt(exercise.perCycle, 10);
    const weight = Number.parseFloat(exercise.weight);
    const repsParsed = parseRepsPattern(exercise.reps);

    if (!id || !name) {
      return { valid: false, error: "Invalid backup format. Exercise id and name are required." };
    }
    if (!EXERCISE_TYPES.includes(type)) {
      return { valid: false, error: `Invalid type for "${name}".` };
    }
    if (!Number.isFinite(sets) || sets < 1 || sets > 50) {
      return { valid: false, error: `Invalid sets value for "${name}".` };
    }
    if (!Number.isFinite(perCycle) || perCycle < 1 || perCycle > 999) {
      return { valid: false, error: `Invalid per-cycle limit for "${name}".` };
    }
    if (!Number.isFinite(weight) || weight < 0 || weight > 5000) {
      return { valid: false, error: `Invalid weight value for "${name}".` };
    }
    if (!repsParsed.valid) {
      return { valid: false, error: `Invalid reps pattern for "${name}".` };
    }

    let alternative = null;
    if (exercise.alternative !== undefined && exercise.alternative !== null) {
      if (!isPlainObject(exercise.alternative)) {
        return { valid: false, error: `Invalid alternative data for "${name}".` };
      }

      const altName = String(exercise.alternative.name || "").trim();
      const altSets = Number.parseInt(exercise.alternative.sets, 10);
      const altWeight = Number.parseFloat(exercise.alternative.weight);
      const altReps = parseRepsPattern(exercise.alternative.reps);

      if (!altName) {
        return { valid: false, error: `Alternative name is required for "${name}".` };
      }
      if (!Number.isFinite(altSets) || altSets < 1 || altSets > 50) {
        return { valid: false, error: `Invalid alternative sets for "${name}".` };
      }
      if (!Number.isFinite(altWeight) || altWeight < 0 || altWeight > 5000) {
        return { valid: false, error: `Invalid alternative weight for "${name}".` };
      }
      if (!altReps.valid) {
        return { valid: false, error: `Invalid alternative reps for "${name}".` };
      }

      alternative = {
        name: altName,
        sets: altSets,
        reps: altReps.pattern,
        weight: altWeight
      };
    }

    return {
      valid: true,
      exercise: {
        id,
        name,
        type,
        sets,
        reps: repsParsed.pattern,
        weight,
        perCycle,
        alternative
      }
    };
  }

  function normalizeImportedLog(log) {
    if (!isPlainObject(log)) {
      return { valid: false, error: "Invalid backup format. Every log must be an object." };
    }

    const id = String(log.id || "").trim();
    const exerciseId = String(log.exerciseId || "").trim();
    const date = String(log.date || "");
    const repsParsed = parseRepsPattern(log.reps);
    const weight = Number.parseFloat(log.weight);
    const sets = Number.parseInt(log.sets, 10);
    const snapshotName = String(log.exerciseNameSnapshot || "").trim();

    if (!id || !exerciseId) {
      return { valid: false, error: "Invalid backup format. Log id and exerciseId are required." };
    }
    if (!isValidDate(date)) {
      return { valid: false, error: "Invalid backup format. One or more log dates are invalid." };
    }
    if (!repsParsed.valid) {
      return { valid: false, error: "Invalid backup format. One or more log reps values are invalid." };
    }
    if (!Number.isFinite(weight) || weight < 0 || weight > 5000) {
      return { valid: false, error: "Invalid backup format. One or more log weights are invalid." };
    }
    if (!Number.isFinite(sets) || sets < 0 || sets > 50) {
      return { valid: false, error: "Invalid backup format. One or more log sets values are invalid." };
    }

    return {
      valid: true,
      log: {
        id,
        exerciseId,
        date: new Date(date).toISOString(),
        reps: repsParsed.pattern,
        weight,
        sets,
        isAlternativeSnapshot: Boolean(log.isAlternativeSnapshot),
        exerciseNameSnapshot: snapshotName
      }
    };
  }

  async function handleCycleSubmit(event) {
    event.preventDefault();

    const days = clampInt(ui.cycleLengthInput.value, 0, 1, 365);
    if (days < 1) {
      setStatus("Enter a valid cycle length.", true);
      return;
    }

    appState.cycleLength = days;
    appState.cycleStart = todayYMD();
    selectedExerciseId = null;

    await storage.save(appState);
    closeModal(ui.cycleModal);
    setStatus(`Cycle set to ${days} day${days === 1 ? "" : "s"}.`);

    renderListPage();
    renderLogPage();
  }

  async function handleLogSubmit(event) {
    event.preventDefault();

    await ensureCurrentCycle();

    const exercise = getExerciseById(selectedExerciseId);
    if (!exercise) {
      setStatus("Select an exercise to log.", true);
      closeLogOverlay(true);
      return;
    }

    const counts = getCurrentCycleCounts();
    const used = counts[exercise.id] || 0;
    if (used >= exercise.perCycle) {
      setStatus(`${exercise.name} reached its per-cycle limit.`, true);
      renderLogPage();
      return;
    }

    const repsParsed = parseRepsPattern(ui.logRepsInput.value);
    const weight = clampNumber(ui.logWeightInput.value, 0, 0, 5000);

    if (!repsParsed.valid) {
      setStatus("Reps must be valid (e.g. 8 or 8>5).", true);
      return;
    }

    const variantData = getExerciseVariant(exercise, selectedLogVariant);
    const usedVariant = variantData ? selectedLogVariant : "regular";
    const usedName = variantData ? variantData.name : exercise.name;
    const usedSets = variantData ? variantData.sets : exercise.sets;
    const reps = repsParsed.pattern;
    const loggedRepTotal = repsParsed.total;
    const storedRepTotal = getRepsTotal(variantData ? variantData.reps : exercise.reps);
    const storedWeight = clampNumber(variantData ? variantData.weight : exercise.weight, 0, 0, 5000);

    appState.logs.push({
      id: createId(),
      exerciseId: exercise.id,
      date: new Date().toISOString(),
      reps,
      weight,
      sets: usedSets,
      isAlternativeSnapshot: usedVariant === "alternative",
      exerciseNameSnapshot: usedName
    });

    // Only update stored exercise values when the new log is not worse.
    const isWorse =
      weight < storedWeight ||
      (weight === storedWeight && loggedRepTotal < storedRepTotal);

    if (!isWorse) {
      if (usedVariant === "alternative" && exercise.alternative) {
        exercise.alternative.reps = reps;
        exercise.alternative.weight = weight;
      } else {
        exercise.reps = reps;
        exercise.weight = weight;
      }
    }

    await storage.save(appState);
    setStatus(`Logged ${usedName}.`);
    closeLogOverlay(true);

    renderListPage();

    if (currentView === "history" || selectedHistoryDate === todayYMD()) {
      renderHistoryPage();
    }
  }

  function shiftWeek(direction) {
    const current = historyWeekStart || startOfWeekMonday(parseYMD(todayYMD()));
    const selected = parseYMD(selectedHistoryDate || todayYMD());
    const offset = Math.min(Math.max(daysBetween(current, selected), 0), 6);

    historyWeekStart = addDays(current, direction * 7);
    selectedHistoryDate = toYMD(addDays(historyWeekStart, offset));
    renderHistoryPage();
  }

  function updateLogDateLabel() {
    ui.logDateLabel.textContent = new Date().toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function openModal(modal) {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal(modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");

    if (modal === ui.deleteConfirmModal) {
      pendingDeleteExerciseId = null;
      pendingDeleteMode = "exercise";
    }

    if (modal === ui.exerciseModal) {
      exerciseEditorState = null;
    }

    if (modal === ui.importConfirmModal) {
      pendingImportState = null;
    }
  }

  function closeLogOverlay(clearSelection = true) {
    ui.logOverlay.classList.add("hidden");
    ui.logOverlay.setAttribute("aria-hidden", "true");
    ui.logForm.classList.add("hidden");
    ui.logVariantControls.classList.add("hidden");
    ui.selectedExerciseName.classList.remove("alt-name");
    selectedLogVariant = "regular";

    if (clearSelection) {
      selectedExerciseId = null;
      renderLogPage();
    }
  }

  function setStatus(message, isError = false) {
    ui.statusMessage.textContent = message ? `Last Action: ${message}` : "";
    ui.statusMessage.classList.toggle("error", isError);
  }

  function initTheme() {
    const storedTheme = localStorage.getItem(THEME_PREF_KEY);
    const systemPrefersDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme =
      storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : (systemPrefersDark ? "dark" : "light");

    applyTheme(initialTheme, false);
  }

  function toggleTheme() {
    const isDark = document.body.classList.contains("theme-dark");
    applyTheme(isDark ? "light" : "dark", true);
  }

  function applyTheme(theme, persist = true) {
    const isDark = theme === "dark";
    document.documentElement.classList.toggle("theme-dark", isDark);
    document.body.classList.toggle("theme-dark", isDark);
    ui.themeToggleBtn.innerHTML = `<span class="toggle-glyph">${isDark ? "☀" : "☾"}</span>`;
    ui.themeToggleBtn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    updateThemeMeta(isDark);

    if (persist) {
      localStorage.setItem(THEME_PREF_KEY, isDark ? "dark" : "light");
    }
  }

  function updateThemeMeta(isDark) {
    const color = isDark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", color);
    });
  }

  function getExerciseById(id) {
    return appState.exercises.find((exercise) => exercise.id === id) || null;
  }

  function getCurrentCycleCounts() {
    const start = parseYMD(appState.cycleStart || todayYMD());
    const end = addDays(start, appState.cycleLength);
    const counts = {};

    for (const log of appState.logs) {
      const date = new Date(log.date);
      if (date >= start && date < end) {
        counts[log.exerciseId] = (counts[log.exerciseId] || 0) + 1;
      }
    }

    return counts;
  }

  function getLastValues(exerciseId, variant = "regular") {
    let latest = null;
    const wantsAlternative = variant === "alternative";

    for (const log of appState.logs) {
      if (log.exerciseId !== exerciseId) {
        continue;
      }
      if (Boolean(log.isAlternativeSnapshot) !== wantsAlternative) {
        continue;
      }
      if (!latest || new Date(log.date) > new Date(latest.date)) {
        latest = log;
      }
    }

    const exercise = getExerciseById(exerciseId);
    if (!exercise) {
      return { reps: 0, weight: 0 };
    }

    const variantData = getExerciseVariant(exercise, variant);
    const fallback = variantData
      ? { reps: variantData.reps, weight: variantData.weight }
      : { reps: exercise.reps, weight: exercise.weight };

    return latest
      ? { reps: latest.reps, weight: latest.weight }
      : fallback;
  }

  function getExerciseVariant(exercise, variant) {
    if (!exercise) {
      return null;
    }

    if (variant === "alternative" && exercise.alternative && exercise.alternative.name) {
      return exercise.alternative;
    }

    if (variant === "regular") {
      return {
        name: exercise.name,
        sets: exercise.sets,
        reps: exercise.reps,
        weight: exercise.weight
      };
    }

    return null;
  }

  function updateLogOverlayForVariant() {
    const exercise = getExerciseById(selectedExerciseId);
    if (!exercise) {
      return;
    }

    const hasAlternative = Boolean(exercise.alternative && exercise.alternative.name);
    if (selectedLogVariant === "alternative" && !hasAlternative) {
      selectedLogVariant = "regular";
    }

    const variantData = getExerciseVariant(exercise, selectedLogVariant);
    const lastValues = getLastValues(exercise.id, selectedLogVariant);
    const isAlternative = selectedLogVariant === "alternative" && hasAlternative;

    ui.logVariantControls.classList.toggle("hidden", !hasAlternative);
    ui.logRegularVariantBtn.classList.toggle("active", !isAlternative);
    ui.logAlternativeVariantBtn.classList.toggle("active", isAlternative);
    ui.selectedExerciseName.classList.toggle("alt-name", isAlternative);

    ui.selectedExerciseName.textContent = variantData ? variantData.name : exercise.name;
    ui.selectedExerciseMeta.textContent = `${exercise.type} • Sets: ${variantData ? variantData.sets : exercise.sets} • Per cycle: ${exercise.perCycle}`;
    ui.logRepsInput.value = String(lastValues.reps);
    ui.logWeightInput.value = String(lastValues.weight);
  }

  function groupExercisesByType(exercises) {
    const grouped = {
      Legs: [],
      Arms: [],
      Torso: [],
      Other: []
    };

    for (const exercise of exercises) {
      const type = normalizeType(exercise.type);
      grouped[type].push(exercise);
    }

    for (const type of EXERCISE_TYPES) {
      grouped[type].sort((a, b) => a.name.localeCompare(b.name));
    }

    return grouped;
  }

  function normalizeType(type) {
    return EXERCISE_TYPES.includes(type) ? type : "Other";
  }

  function sortByTypeThenName(a, b) {
    const typeDiff = EXERCISE_TYPES.indexOf(normalizeType(a.type)) - EXERCISE_TYPES.indexOf(normalizeType(b.type));
    if (typeDiff !== 0) {
      return typeDiff;
    }
    return a.name.localeCompare(b.name);
  }

  function todayYMD() {
    return toYMD(new Date());
  }

  function parseYMD(ymd) {
    const safe = isValidYMD(ymd) ? ymd : todayYMD();
    const [year, month, day] = safe.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function toYMD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function startOfWeekMonday(date) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = copy.getDay();
    const shift = day === 0 ? -6 : 1 - day;
    copy.setDate(copy.getDate() + shift);
    return copy;
  }

  function addDays(date, amount) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    copy.setDate(copy.getDate() + amount);
    return copy;
  }

  function daysBetween(a, b) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const aMs = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    const bMs = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    return Math.floor((bMs - aMs) / msPerDay);
  }

  function clampInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return Math.min(Math.max(parsed, min), max);
  }

  function clampNumber(value, fallback, min, max) {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return Math.min(Math.max(parsed, min), max);
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function parseRepsPattern(value) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return { valid: false, pattern: "", total: 0 };
    }

    const parts = raw.split(">").map((part) => part.trim());
    if (!parts.length || parts.some((part) => part.length === 0)) {
      return { valid: false, pattern: "", total: 0 };
    }

    let total = 0;
    for (const part of parts) {
      if (!/^\d+$/.test(part)) {
        return { valid: false, pattern: "", total: 0 };
      }
      const amount = Number.parseInt(part, 10);
      if (amount < 1) {
        return { valid: false, pattern: "", total: 0 };
      }
      total += amount;
    }

    return { valid: true, pattern: parts.join(">"), total };
  }

  function normalizeRepsPattern(value, fallback = "8") {
    const parsed = parseRepsPattern(value);
    if (parsed.valid) {
      return parsed.pattern;
    }
    return fallback;
  }

  function getRepsTotal(value) {
    const parsed = parseRepsPattern(value);
    return parsed.valid ? parsed.total : 0;
  }

  function isValidDate(value) {
    if (typeof value !== "string") {
      return false;
    }
    return !Number.isNaN(new Date(value).getTime());
  }

  function isValidYMD(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function createId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const secureContext =
      location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1";

    // file:// still works for app logic, but SW registration needs secure context.
    if (!secureContext) {
      return;
    }

    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed.", error);
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function idbGet(db, storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function idbPut(db, storeName, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.put(value);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
})();
