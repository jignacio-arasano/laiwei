// UI + estado de la app. Sin frameworks: render manual de HTML strings + event delegation
// vía onclick="App.xxx.yyy(...)" (mismo patrón que la factory manual de ViewModels en la
// versión Android: simple y directo, sin herramientas extra).

const Icons = {
  session: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="3" height="6" rx="1"/><rect x="19" y="9" width="3" height="6" rx="1"/><line x1="5" y1="12" x2="19" y2="12"/><rect x="7" y="7" width="2" height="10" rx="1"/><rect x="15" y="7" width="2" height="10" rx="1"/></svg>`,
  routines: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="7" y1="2" x2="7" y2="6"/><line x1="17" y1="2" x2="17" y2="6"/></svg>`,
  volume: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="4" y2="12"/><line x1="10" y1="20" x2="10" y2="6"/><line x1="16" y1="20" x2="16" y2="14"/><line x1="21" y1="20" x2="3" y2="20"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  diet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8c0-3-2-5-4-5-1 0-1.5.7-2 .7S11 3 10 3C7 3 5 6 5 10c0 6 4 11 6 11s3-1 3-1"/><path d="M15 3c0 1.5-1 2-1 3.5"/><circle cx="17" cy="16" r="4.5"/><path d="M17 13.2V16l1.6 1.6"/></svg>`,
};

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function fmt1(n) {
  return n == null ? "-" : (Math.round(n * 10) / 10).toString();
}
function orDash(v) {
  return v == null || v === "" ? "-" : v;
}

// ---------------------------------------------------------------------
// Picker genérico: input de búsqueda + lista, reusado en Sesión y Rutinas.
// ---------------------------------------------------------------------
const Picker = {
  registry: {},
  mount(key, items, renderItemFn) {
    Picker.registry[key] = { all: items, render: renderItemFn };
  },
  html(key, placeholder) {
    return `
      <input class="search-input" placeholder="${escapeHtml(placeholder)}"
        oninput="Picker.onInput('${key}', this.value)">
      <div class="exercise-picker-list" id="${key}-list"></div>`;
  },
  renderList(key, query) {
    const p = Picker.registry[key];
    const el = document.getElementById(key + "-list");
    if (!p || !el) return;
    const q = query.trim().toLowerCase();
    const filtered = q ? p.all.filter((it) => it.searchText.toLowerCase().includes(q)) : p.all;
    el.innerHTML = filtered.length
      ? filtered.map(p.render).join("")
      : `<div class="empty-state">Sin resultados</div>`;
  },
  onInput(key, value) {
    Picker.renderList(key, value);
  },
  refresh(key) {
    const el = document.getElementById(key + "-list");
    if (el) Picker.renderList(key, "");
  },
};

function exerciseItemHtml(ex, onSelectExpr) {
  return `<div class="exercise-picker-item" onclick="${onSelectExpr}(${ex.id})">
    <div class="name">${escapeHtml(ex.name)}</div>
    <div class="group">${escapeHtml(ex.muscleGroup)}</div>
  </div>`;
}

// =======================================================================
// App
// =======================================================================
const App = {
  state: { view: "session" },

  async init() {
    await openDB();
    await Repo.seedFase1IfEmpty();
    await Repo.seedDietPlanIfEmpty();
    App.nav.render();
    await App.session.load();
    await App.volume.load();
    await App.routines.load();
    await App.diet.load();
    App.nav.goTo("session");
  },

  nav: {
    views: ["session", "routines", "volume", "diet"],
    render() {
      document.getElementById("bottom-nav").innerHTML = `
        <button class="nav-btn" id="nav-session" onclick="App.nav.goTo('session')">
          ${Icons.session}<span>Sesión</span>
        </button>
        <button class="nav-btn" id="nav-routines" onclick="App.nav.goTo('routines')">
          ${Icons.routines}<span>Rutinas</span>
        </button>
        <button class="nav-btn" id="nav-volume" onclick="App.nav.goTo('volume')">
          ${Icons.volume}<span>Volumen</span>
        </button>
        <button class="nav-btn" id="nav-diet" onclick="App.nav.goTo('diet')">
          ${Icons.diet}<span>Dieta</span>
        </button>`;
    },
    goTo(view) {
      App.state.view = view;
      App.nav.views.forEach((v) => {
        document.getElementById("view-" + v).classList.toggle("hidden", v !== view);
        document.getElementById("nav-" + v).classList.toggle("active", v === view);
      });
      if (view === "volume") App.volume.refresh();
      if (view === "routines") App.routines.render();
      if (view === "session") App.session.refresh();
      if (view === "diet") App.diet.refresh();
    },
  },

  util: { escapeHtml, fmt1, orDash },
};

// =======================================================================
// Sesión
// =======================================================================
App.session = {
  s: {
    exercises: [],
    muscleGroups: [],
    routines: [],
    selectedRoutineId: null,
    routineExercises: [], // ejercicios de la rutina elegida, en orden
    sessionId: null,
    selectedExerciseId: null,
    setsLoggedToday: [],
    lastSessionWorkingSets: [],
    lastSessionDate: null,
    floor: null,
    plannedSets: [],
    calibrationWarnings: [],
    showAdHocPicker: false,
    showCreateExercise: false,
  },

  async load() {
    const s = App.session.s;
    s.exercises = await Repo.getActiveExercises();
    s.muscleGroups = await Repo.getMuscleGroups();
    s.routines = await Repo.getRoutines();
    s.sessionId = await Repo.startSession(Repo.todayStr(), s.selectedRoutineId);
    s.routineExercises = await Repo.getRoutineExercises(s.selectedRoutineId);
  },

  render() {
    const s = App.session.s;
    const today = new Date();
    const dateLabel = today.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

    let html = `
      <div class="topbar">
        <h1>Sesión de hoy</h1>
        <div class="subtitle">${dateLabel}</div>
      </div>
      <div class="view" id="view-session-inner">
        <div class="card">
          <div class="card-title">Rutina de hoy</div>
          <div class="chip-row">
            <button class="chip ${s.selectedRoutineId === null ? "selected" : ""}" onclick="App.session.selectRoutine(null)">Sesión libre</button>
            ${s.routines
              .map(
                (r) =>
                  `<button class="chip ${s.selectedRoutineId === r.id ? "selected" : ""}" onclick="App.session.selectRoutine(${r.id})">${escapeHtml(r.name)}</button>`
              )
              .join("")}
          </div>
          ${
            s.routines.length === 0
              ? `<div class="muted" style="margin-top:8px;">Todavía no creaste rutinas. Podés armar una en la pestaña "Rutinas".</div>`
              : ""
          }
        </div>

        <div class="card">
          <div class="card-title">Ejercicio</div>
          ${App.session.renderExercisePicker()}
        </div>

        <div id="session-exercise-detail"></div>
      </div>`;

    document.getElementById("view-session").innerHTML = html;
    App.session.renderExerciseDetail();
  },

  /** Se llama al volver a la pestaña Sesión — refresca el orden de ejercicios de la
   *  rutina elegida por si se reordenaron desde la pestaña Rutinas mientras tanto. */
  async refresh() {
    const s = App.session.s;
    if (s.selectedRoutineId !== null) {
      s.routineExercises = await Repo.getRoutineExercises(s.selectedRoutineId);
    }
    App.session.render();
  },

  renderExercisePicker() {
    const s = App.session.s;
    const selectedName = s.exercises.find((e) => e.id === s.selectedExerciseId)?.name;

    if (s.selectedRoutineId !== null) {
      // Modo rutina: SOLO los ejercicios que vos cargaste para este día.
      if (s.routineExercises.length === 0) {
        return `<div class="muted">Esta rutina todavía no tiene ejercicios cargados. Andá a "Rutinas" para agregarlos, o elegí "Sesión libre".</div>`;
      }
      let html = `<div class="chip-row">`;
      html += s.routineExercises
        .map(
          (ex) =>
            `<button class="chip ${s.selectedExerciseId === ex.id ? "selected" : ""}" onclick="App.session.selectExercise(${ex.id})">${escapeHtml(ex.name)}</button>`
        )
        .join("");
      html += `<button class="chip ghost" onclick="App.session.toggleAdHoc()">+ otro ejercicio</button>`;
      html += `</div>`;
      if (s.showAdHocPicker) {
        html += App.session.renderAdHocPanel();
      }
      return html;
    }

    // Sesión libre: buscador sobre todos los ejercicios.
    Picker.mount(
      "session-picker",
      s.exercises.map((e) => ({ ...e, searchText: `${e.name} ${e.muscleGroup}` })),
      (ex) => exerciseItemHtml(ex, "App.session.selectExercise")
    );
    let html = `<div class="row" style="margin-bottom:8px;">
        <span class="muted">${selectedName ? "Elegido: " + escapeHtml(selectedName) : "Buscá o elegí un ejercicio"}</span>
        <button class="link-btn" onclick="App.session.toggleCreateExercise()">+ Nuevo ejercicio</button>
      </div>`;
    html += Picker.html("session-picker", "Buscar ejercicio...");
    if (s.showCreateExercise) html += App.session.renderCreateExerciseForm();
    setTimeout(() => Picker.refresh("session-picker"), 0);
    return html;
  },

  renderAdHocPanel() {
    const s = App.session.s;
    Picker.mount(
      "session-adhoc-picker",
      s.exercises.map((e) => ({ ...e, searchText: `${e.name} ${e.muscleGroup}` })),
      (ex) => exerciseItemHtml(ex, "App.session.selectExerciseAdHoc")
    );
    setTimeout(() => Picker.refresh("session-adhoc-picker"), 0);
    return `<div style="margin-top:10px;">
      ${Picker.html("session-adhoc-picker", "Buscar cualquier ejercicio...")}
      <button class="link-btn" style="margin-top:6px;" onclick="App.session.toggleCreateExercise()">+ Nuevo ejercicio</button>
      ${s.showCreateExercise ? App.session.renderCreateExerciseForm() : ""}
    </div>`;
  },

  renderCreateExerciseForm() {
    const s = App.session.s;
    return `<div class="card" style="margin-top:10px; box-shadow:none; border:1px dashed var(--border);">
      <div class="field"><label>Nombre</label><input id="new-ex-name" placeholder="Ej: Press banca"></div>
      <div class="field"><label>Grupo muscular</label><input id="new-ex-group" placeholder="Ej: ${escapeHtml(s.muscleGroups.slice(0, 2).join(", ") || "pecho")}"></div>
      <div class="field"><label>Equipo (opcional)</label><input id="new-ex-equip" placeholder="Ej: barra"></div>
      <button class="btn btn-primary btn-block" onclick="App.session.createExercise()">Crear y elegir</button>
    </div>`;
  },

  toggleAdHoc() {
    App.session.s.showAdHocPicker = !App.session.s.showAdHocPicker;
    App.session.render();
  },
  toggleCreateExercise() {
    App.session.s.showCreateExercise = !App.session.s.showCreateExercise;
    App.session.render();
  },

  async createExercise() {
    const name = document.getElementById("new-ex-name").value.trim();
    const group = document.getElementById("new-ex-group").value.trim();
    const equip = document.getElementById("new-ex-equip").value.trim();
    if (!name || !group) return;
    const id = await Repo.addExercise(name, group, equip);
    App.session.s.showCreateExercise = false;
    App.session.s.exercises = await Repo.getActiveExercises();
    App.session.s.muscleGroups = await Repo.getMuscleGroups();
    await App.session.selectExercise(id);
  },

  async selectRoutine(routineId) {
    const s = App.session.s;
    s.selectedRoutineId = routineId;
    s.selectedExerciseId = null;
    s.showAdHocPicker = false;
    s.sessionId = await Repo.startSession(Repo.todayStr(), routineId);
    s.routineExercises = await Repo.getRoutineExercises(routineId);
    App.session.render();
  },

  async selectExercise(exerciseId) {
    const s = App.session.s;
    s.selectedExerciseId = exerciseId;
    s.calibrationWarnings = [];
    await App.session.refreshExerciseData();
    App.session.render();
  },
  async selectExerciseAdHoc(exerciseId) {
    App.session.s.showAdHocPicker = false;
    await App.session.selectExercise(exerciseId);
  },

  async refreshExerciseData() {
    const s = App.session.s;
    const exerciseId = s.selectedExerciseId;
    if (exerciseId == null) return;

    s.setsLoggedToday = (await Repo.getSetsForSession(s.sessionId)).filter(
      (set) => set.exerciseId === exerciseId
    );

    const history = await Repo.exerciseHistory(exerciseId);
    const today = Repo.todayStr();
    const previous = history.filter((h) => h.date !== today);
    s.lastSessionDate = previous[0]?.date ?? null;
    s.lastSessionWorkingSets = previous
      .filter((h) => h.date === s.lastSessionDate && COUNTS_AS_WORK.has(h.set.setType))
      .map((h) => h.set);
    s.floor = Metrics.floor(history);

    s.plannedSets = await Repo.getPlannedSetsForRoutineExercise(s.selectedRoutineId, exerciseId);
  },

  /** Número de la próxima serie DE TRABAJO (para matchear contra el objetivo de la rutina).
   *  Las series de aproximación/entrada en calor/PAP no cuentan — así "serie 1" del objetivo
   *  sigue siendo la primera serie efectiva, sin importar cuántas series previas de calentamiento
   *  se hayan cargado antes. */
  nextWorkingSetNumber() {
    const s = App.session.s;
    return s.setsLoggedToday.filter((set) => COUNTS_AS_WORK.has(set.setType)).length + 1;
  },

  renderExerciseDetail() {
    const s = App.session.s;
    const el = document.getElementById("session-exercise-detail");
    if (!el) return;
    if (s.selectedExerciseId == null) {
      el.innerHTML = "";
      return;
    }
    const exercise = s.exercises.find((e) => e.id === s.selectedExerciseId);
    const nextPlanned = s.plannedSets.find((p) => p.setNumber === App.session.nextWorkingSetNumber());

    let html = `
      <div class="card">
        <div class="card-title">Referencia para decidir el peso de hoy</div>
        ${
          s.lastSessionDate == null
            ? `<div class="muted">Sin sesiones anteriores todavía.</div>`
            : `<div class="muted">Última vez (${s.lastSessionDate}):</div>
               ${s.lastSessionWorkingSets
                 .map((set) => `<div>· ${set.weightKg}kg × ${set.reps} — RIR ${orDash(set.rir)} / RPE ${orDash(set.rpe)}</div>`)
                 .join("")}`
        }
        <div style="margin-top:8px;">
          ${
            s.floor != null
              ? `<span class="chip small" style="background:var(--primary-light); border-color:var(--primary); color:var(--primary-dark);">Piso (e1RM): ${fmt1(s.floor)}kg</span>`
              : `<span class="muted">Piso: sin datos suficientes todavía</span>`
          }
        </div>
      </div>`;

    if (nextPlanned) {
      html += `
      <div class="card accent">
        <div class="card-title" style="color:var(--primary-dark);">Objetivo de la rutina — serie ${nextPlanned.setNumber}</div>
        <div style="font-size:16px; font-weight:700;">${nextPlanned.targetReps} reps @ RIR ${orDash(nextPlanned.targetRir)} / RPE ${orDash(nextPlanned.targetRpe)}</div>
        <div class="muted" style="margin-top:4px;">Elegí el peso que te permita cumplir este objetivo.</div>
      </div>`;
    }

    html += App.session.renderSetForm();

    if (s.calibrationWarnings.length > 0) {
      html += `<div class="card warn">
        <div class="card-title" style="color:var(--warn);">Avisos de calibración</div>
        ${s.calibrationWarnings.map((w) => `<div style="margin-top:4px;">· ${escapeHtml(w)}</div>`).join("")}
      </div>`;
    }

    html += `<div class="card-title" style="margin: 18px 0 8px;">Series de hoy</div>`;
    html += `<div class="card">`;
    html += s.setsLoggedToday.length
      ? s.setsLoggedToday
          .map(
            (set) => `<div class="set-row">
        <div>
          <span class="set-type-tag">${escapeHtml(setTypeLabel(set.setType))}</span>
          ${set.weightKg}kg × ${set.reps} — RIR ${orDash(set.rir)} / RPE ${orDash(set.rpe)}
          ${set.note ? `<div class="muted">${escapeHtml(set.note)}</div>` : ""}
        </div>
        <button class="icon-btn danger" onclick="App.session.deleteSet(${set.id})">${Icons.trash}</button>
      </div>`
          )
          .join("")
      : `<div class="empty-state">Todavía no cargaste series hoy.</div>`;
    html += `</div>`;

    el.innerHTML = html;
  },

  renderSetForm() {
    return `
      <div class="card">
        <div class="card-title">Cargar serie</div>
        <div class="chip-row" id="set-type-chips">
          ${SET_TYPES.map(
            (t) =>
              `<button class="chip small ${t.value === "NORMAL" ? "selected" : ""}" data-settype="${t.value}" onclick="App.session.pickSetType('${t.value}')">${t.label}</button>`
          ).join("")}
        </div>
        <div class="section-gap"></div>
        <div class="field-row">
          <div class="field"><label>Peso (kg)</label><input id="set-weight" type="number" inputmode="decimal" placeholder="0"></div>
          <div class="field"><label>Reps</label><input id="set-reps" type="number" inputmode="numeric" placeholder="0"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>RIR</label><input id="set-rir" type="number" inputmode="decimal" placeholder="opcional"></div>
          <div class="field"><label>RPE</label><input id="set-rpe" type="number" inputmode="decimal" placeholder="opcional"></div>
        </div>
        <div class="field"><label>Nota (opcional)</label><input id="set-note" placeholder=""></div>
        <button class="btn btn-primary btn-block" onclick="App.session.logSet()">Guardar serie</button>
      </div>`;
  },

  _setType: "NORMAL",
  pickSetType(value) {
    App.session._setType = value;
    document.querySelectorAll("#set-type-chips .chip").forEach((chip) => {
      chip.classList.toggle("selected", chip.dataset.settype === value);
    });
  },

  async logSet() {
    const s = App.session.s;
    if (s.selectedExerciseId == null) return;
    const weight = parseFloat(document.getElementById("set-weight").value);
    const reps = parseInt(document.getElementById("set-reps").value, 10);
    if (isNaN(weight) || isNaN(reps)) return;
    const rirRaw = document.getElementById("set-rir").value;
    const rpeRaw = document.getElementById("set-rpe").value;
    const rir = rirRaw === "" ? null : parseFloat(rirRaw);
    const rpe = rpeRaw === "" ? null : parseFloat(rpeRaw);
    const note = document.getElementById("set-note").value.trim();
    const setType = App.session._setType;
    // setNumber guarda el orden real en que se cargó (incluye aproximación/calentamiento),
    // solo se usa para ordenar la lista "Series de hoy". El objetivo de la rutina, en cambio,
    // se matchea contra el número de serie DE TRABAJO (ver nextWorkingSetNumber).
    const nextSetNumber = s.setsLoggedToday.length + 1;
    const nextWorkingSetNumber = App.session.nextWorkingSetNumber();
    const plannedSet = s.plannedSets.find((p) => p.setNumber === nextWorkingSetNumber);

    await Repo.addSet({
      sessionId: s.sessionId,
      exerciseId: s.selectedExerciseId,
      setNumber: nextSetNumber,
      weightKg: weight,
      reps,
      rir,
      rpe,
      setType,
      note,
    });

    if (
      COUNTS_AS_WORK.has(setType) &&
      plannedSet &&
      Metrics.calibrationMismatch(rir, plannedSet.targetRir, rpe, plannedSet.targetRpe)
    ) {
      s.calibrationWarnings.push(
        `Serie ${nextWorkingSetNumber}: te desviaste del objetivo (objetivo RIR ${orDash(plannedSet.targetRir)} / RPE ${orDash(plannedSet.targetRpe)}, diste RIR ${orDash(rir)} / RPE ${orDash(rpe)})`
      );
    }

    App.session._setType = "NORMAL";
    await App.session.refreshExerciseData();
    App.session.renderExerciseDetail();
  },

  async deleteSet(id) {
    await Repo.deleteSet(id);
    await App.session.refreshExerciseData();
    App.session.renderExerciseDetail();
  },
};

// =======================================================================
// Rutinas
// =======================================================================
App.routines = {
  s: {
    list: [],
    detailId: null,
    detail: null,
    newName: "",
    addingExercise: false,
    plannedRows: [{ reps: "8", rir: "", rpe: "" }],
    pickedExerciseId: null,
  },

  async load() {
    App.routines.s.list = await Repo.getRoutines();
  },

  render() {
    const s = App.routines.s;
    const el = document.getElementById("view-routines");
    if (s.detailId != null) {
      App.routines.renderDetail(el);
      return;
    }
    el.innerHTML = `
      <div class="topbar"><h1>Rutinas</h1><div class="subtitle">Días de entrenamiento con objetivos por serie</div></div>
      <div class="view">
        <div class="card">
          <div class="card-title">Nueva rutina</div>
          <div class="row">
            <input id="new-routine-name" placeholder="Ej: Día A, Push, Full body..." style="flex:1; border:1.5px solid var(--border); border-radius:10px; padding:11px 12px; font-size:15px; font-family:inherit;">
            <button class="btn btn-primary" onclick="App.routines.create()">Crear</button>
          </div>
        </div>
        ${
          s.list.length === 0
            ? `<div class="empty-state">Todavía no creaste ninguna rutina.</div>`
            : s.list
                .map(
                  (r) => `<div class="card row" style="cursor:pointer;" onclick="App.routines.openDetail(${r.id})">
                  <div><strong>${escapeHtml(r.name)}</strong></div>
                  <button class="icon-btn danger" onclick="event.stopPropagation(); App.routines.remove(${r.id})">${Icons.trash}</button>
                </div>`
                )
                .join("")
        }
      </div>`;
  },

  async create() {
    const input = document.getElementById("new-routine-name");
    const name = input.value.trim();
    if (!name) return;
    await Repo.createRoutine(name);
    await App.routines.load();
    App.routines.render();
    // La rutina puede haber cambiado para la sesión de hoy si la tenían seleccionada.
    App.session.s.routines = App.routines.s.list;
  },

  async remove(routineId) {
    await Repo.deleteRoutine(routineId);
    await App.routines.load();
    if (App.session.s.selectedRoutineId === routineId) {
      await App.session.selectRoutine(null);
    }
    App.session.s.routines = App.routines.s.list;
    App.routines.render();
  },

  async openDetail(routineId) {
    const s = App.routines.s;
    s.detailId = routineId;
    s.addingExercise = false;
    s.plannedRows = [{ reps: "8", rir: "", rpe: "" }];
    s.pickedExerciseId = null;
    s.detail = await Repo.getRoutineDetail(routineId);
    App.routines.render();
  },

  backToList() {
    App.routines.s.detailId = null;
    App.routines.render();
  },

  async renderDetail(el) {
    const s = App.routines.s;
    const detail = s.detail;
    if (!detail) {
      el.innerHTML = `<div class="view"><div class="empty-state">Rutina no encontrada.</div></div>`;
      return;
    }
    const allExercises = await Repo.getActiveExercises();
    const already = new Set(detail.entries.map((e) => e.exercise.id));
    const available = allExercises.filter((e) => !already.has(e.id));

    let html = `
      <div class="topbar row">
        <button class="icon-btn" onclick="App.routines.backToList()">${Icons.back}</button>
        <div style="flex:1;"><h1>${escapeHtml(detail.routine.name)}</h1></div>
      </div>
      <div class="view">
        <div class="muted" style="margin-bottom:12px;">Objetivos de reps/RIR/RPE por serie, sin peso — el peso lo elegís vos en la sesión.</div>
        ${
          detail.entries.length === 0
            ? `<div class="empty-state">Todavía no agregaste ejercicios a esta rutina.</div>`
            : detail.entries
                .map(
                  (entry, i) => `<div class="card">
              <div class="row">
                <strong>${i + 1}. ${escapeHtml(entry.exercise.name)}</strong>
                <div class="row" style="gap:2px; flex:0 0 auto;">
                  <button class="icon-btn" ${i === 0 ? "disabled" : ""} onclick="App.routines.moveExercise(${entry.routineExerciseId}, -1)">${Icons.up}</button>
                  <button class="icon-btn" ${i === detail.entries.length - 1 ? "disabled" : ""} onclick="App.routines.moveExercise(${entry.routineExerciseId}, 1)">${Icons.down}</button>
                  <button class="icon-btn danger" onclick="App.routines.removeExercise(${entry.routineExerciseId})">${Icons.trash}</button>
                </div>
              </div>
              ${entry.plannedSets
                .map((p) => `<div class="muted" style="margin-top:4px;">Serie ${p.setNumber}: ${p.targetReps} reps @ RIR ${orDash(p.targetRir)} / RPE ${orDash(p.targetRpe)}</div>`)
                .join("")}
            </div>`
                )
                .join("")
        }
        ${App.routines.renderAddExerciseForm(available)}
      </div>`;
    el.innerHTML = html;
    if (s.addingExercise) {
      Picker.mount(
        "routine-add-picker",
        available.map((e) => ({ ...e, searchText: `${e.name} ${e.muscleGroup}` })),
        (ex) => exerciseItemHtml(ex, "App.routines.pickExercise")
      );
      setTimeout(() => Picker.refresh("routine-add-picker"), 0);
    }
  },

  renderAddExerciseForm(available) {
    const s = App.routines.s;
    if (!s.addingExercise) {
      return `<button class="btn btn-ghost" onclick="App.routines.toggleAddExercise()">+ Agregar ejercicio</button>`;
    }
    const pickedName = available.find((e) => e.id === s.pickedExerciseId)?.name;
    return `<div class="card">
      <div class="card-title">Agregar ejercicio a la rutina</div>
      ${
        s.pickedExerciseId
          ? `<div class="row"><span><strong>${escapeHtml(pickedName || "")}</strong></span><button class="link-btn" onclick="App.routines.clearPicked()">Cambiar</button></div>`
          : available.length
            ? Picker.html("routine-add-picker", "Buscar ejercicio...")
            : `<div class="muted">Ya agregaste todos tus ejercicios a esta rutina.</div>`
      }
      ${s.pickedExerciseId ? App.routines.renderPlannedRows() : ""}
      <div class="row" style="margin-top:10px;">
        <button class="btn btn-ghost" onclick="App.routines.toggleAddExercise()">Cancelar</button>
        ${s.pickedExerciseId ? `<button class="btn btn-primary" onclick="App.routines.saveExercise()">Guardar ejercicio</button>` : ""}
      </div>
    </div>`;
  },

  renderPlannedRows() {
    const s = App.routines.s;
    return `
      <div class="muted" style="margin: 10px 0 6px;">Series planificadas (reps / RIR / RPE objetivo)</div>
      ${s.plannedRows
        .map(
          (row, i) => `<div class="field-row" style="align-items:center; margin-bottom:6px;">
          <input type="number" placeholder="Reps" value="${escapeHtml(row.reps)}" oninput="App.routines.updateRow(${i}, 'reps', this.value)" style="flex:1; border:1.5px solid var(--border); border-radius:8px; padding:9px;">
          <input type="number" placeholder="RIR" value="${escapeHtml(row.rir)}" oninput="App.routines.updateRow(${i}, 'rir', this.value)" style="flex:1; border:1.5px solid var(--border); border-radius:8px; padding:9px;">
          <input type="number" placeholder="RPE" value="${escapeHtml(row.rpe)}" oninput="App.routines.updateRow(${i}, 'rpe', this.value)" style="flex:1; border:1.5px solid var(--border); border-radius:8px; padding:9px;">
          <button class="icon-btn danger" onclick="App.routines.removeRow(${i})">${Icons.trash}</button>
        </div>`
        )
        .join("")}
      <button class="link-btn" onclick="App.routines.addRow()">+ Agregar serie</button>`;
  },

  toggleAddExercise() {
    const s = App.routines.s;
    s.addingExercise = !s.addingExercise;
    s.pickedExerciseId = null;
    s.plannedRows = [{ reps: "8", rir: "", rpe: "" }];
    App.routines.render();
  },
  pickExercise(exerciseId) {
    App.routines.s.pickedExerciseId = exerciseId;
    App.routines.render();
  },
  clearPicked() {
    App.routines.s.pickedExerciseId = null;
    App.routines.render();
  },
  addRow() {
    App.routines.s.plannedRows.push({ reps: "8", rir: "", rpe: "" });
    App.routines.render();
  },
  removeRow(i) {
    const rows = App.routines.s.plannedRows;
    if (rows.length > 1) rows.splice(i, 1);
    App.routines.render();
  },
  updateRow(i, field, value) {
    App.routines.s.plannedRows[i][field] = value;
  },

  async saveExercise() {
    const s = App.routines.s;
    const inputs = s.plannedRows
      .map((row) => {
        const reps = parseInt(row.reps, 10);
        if (isNaN(reps)) return null;
        return {
          targetReps: reps,
          targetRir: row.rir === "" ? null : parseFloat(row.rir),
          targetRpe: row.rpe === "" ? null : parseFloat(row.rpe),
        };
      })
      .filter(Boolean);
    if (inputs.length === 0) return;
    await Repo.addExerciseToRoutine(s.detailId, s.pickedExerciseId, inputs);
    s.detail = await Repo.getRoutineDetail(s.detailId);
    s.addingExercise = false;
    s.pickedExerciseId = null;
    s.plannedRows = [{ reps: "8", rir: "", rpe: "" }];
    App.routines.render();
    App.session.refreshRoutineExercisesIfNeeded(s.detailId);
  },

  async removeExercise(routineExerciseId) {
    const s = App.routines.s;
    await Repo.removeExerciseFromRoutine(routineExerciseId);
    s.detail = await Repo.getRoutineDetail(s.detailId);
    App.routines.render();
    App.session.refreshRoutineExercisesIfNeeded(s.detailId);
  },

  async moveExercise(routineExerciseId, direction) {
    const s = App.routines.s;
    await Repo.reorderRoutineExercise(s.detailId, routineExerciseId, direction);
    s.detail = await Repo.getRoutineDetail(s.detailId);
    App.routines.render();
    App.session.refreshRoutineExercisesIfNeeded(s.detailId);
  },
};

// Si edito la rutina que está activa en la sesión de hoy, refresco esa vista también.
App.session.refreshRoutineExercisesIfNeeded = async function (routineId) {
  const s = App.session.s;
  if (s.selectedRoutineId === routineId) {
    s.routineExercises = await Repo.getRoutineExercises(routineId);
    if (s.selectedExerciseId != null) await App.session.refreshExerciseData();
  }
};

// =======================================================================
// Volumen semanal
// =======================================================================
App.volume = {
  s: { rows: [], editing: {} },

  async load() {
    const volumeByGroup = await Repo.currentWeekVolumeByMuscleGroup();
    const fatiguedByGroup = await Repo.fatiguedExercisesByMuscleGroup();
    const groups = new Set([...Object.keys(volumeByGroup), ...Object.keys(fatiguedByGroup)]);
    const rows = [];
    for (const group of groups) {
      const target = await Repo.getMuscleGroupTarget(group);
      const setCount = volumeByGroup[group] || 0;
      const zone = target ? Metrics.volumeZone(setCount, target.mev, target.mav, target.mrv) : null;
      rows.push({
        muscleGroup: group,
        setCount,
        target,
        zone,
        fatiguedExerciseCount: fatiguedByGroup[group] || 0,
      });
    }
    rows.sort((a, b) => a.muscleGroup.localeCompare(b.muscleGroup));
    App.volume.s.rows = rows;
  },

  async refresh() {
    await App.volume.load();
    App.volume.render();
  },

  render() {
    const s = App.volume.s;
    const el = document.getElementById("view-volume");
    el.innerHTML = `
      <div class="topbar">
        <h1>Volumen semanal</h1>
        <div class="subtitle">Series de trabajo de esta semana (lunes a domingo) contra tus propias bandas</div>
      </div>
      <div class="view">
        ${
          s.rows.length === 0
            ? `<div class="empty-state">Todavía no cargaste series de trabajo esta semana.</div>`
            : s.rows.map((row) => App.volume.rowHtml(row)).join("")
        }
      </div>`;
  },

  rowHtml(row) {
    const editing = App.volume.s.editing[row.muscleGroup] ?? !row.target;
    const zoneMeta = {
      BAJO_MEV: { label: "Bajo el mínimo efectivo (MEV)", cls: "zone-bajo" },
      EN_MEV_MAV: { label: "Entre MEV y MAV", cls: "zone-optimo" },
      EN_MAV_MRV: { label: "Entre MAV y MRV", cls: "zone-alto" },
      SOBRE_MRV: { label: "Por encima del máximo recuperable (MRV)", cls: "zone-sobre" },
    }[row.zone] || null;

    let barPct = 0;
    if (row.target) {
      barPct = Math.min(100, (row.setCount / Math.max(row.target.mrv, 1)) * 100);
    }

    let html = `<div class="card">
      <div class="row"><strong>${escapeHtml(row.muscleGroup)}</strong><span class="muted">${row.setCount} series</span></div>`;

    if (row.target && zoneMeta) {
      html += `
        <div class="volume-bar"><div class="volume-bar-fill ${zoneMeta.cls}" style="width:${barPct}%;"></div></div>
        <div class="row"><span class="zone-label" style="color:var(--text-muted);">MEV ${row.target.mev} · MAV ${row.target.mav} · MRV ${row.target.mrv}</span></div>
        <div class="zone-label" style="margin-top:4px;">${zoneMeta.label}</div>`;
    }

    if (row.fatiguedExerciseCount > 0) {
      html += `<div class="muted" style="margin-top:8px;">${row.fatiguedExerciseCount} ejercicio(s) en fatiga (por debajo de su piso reciente)</div>`;
    }
    if (row.fatiguedExerciseCount >= 2) {
      html += `<div class="card warn" style="margin: 10px 0 0; box-shadow:none;">⚠ Sugerencia: considerá un deload en ${escapeHtml(row.muscleGroup)} — varios ejercicios vienen rindiendo por debajo de su piso.</div>`;
    }

    if (editing) {
      html += `
        <div class="field-row" style="margin-top:12px;">
          <div class="field"><label>MEV</label><input id="mev-${escapeHtml(row.muscleGroup)}" type="number" value="${row.target?.mev ?? 8}"></div>
          <div class="field"><label>MAV</label><input id="mav-${escapeHtml(row.muscleGroup)}" type="number" value="${row.target?.mav ?? 14}"></div>
          <div class="field"><label>MRV</label><input id="mrv-${escapeHtml(row.muscleGroup)}" type="number" value="${row.target?.mrv ?? 20}"></div>
        </div>
        <button class="btn btn-primary" onclick="App.volume.saveTarget('${escapeHtml(row.muscleGroup)}')">Guardar bandas</button>`;
    } else {
      html += `<div style="text-align:right; margin-top:8px;"><button class="btn btn-ghost btn-sm" onclick="App.volume.toggleEdit('${escapeHtml(row.muscleGroup)}')">Ajustar bandas</button></div>`;
    }
    html += `</div>`;
    return html;
  },

  toggleEdit(group) {
    App.volume.s.editing[group] = !(App.volume.s.editing[group] ?? false);
    App.volume.render();
  },

  async saveTarget(group) {
    const mev = parseInt(document.getElementById(`mev-${group}`).value, 10);
    const mav = parseInt(document.getElementById(`mav-${group}`).value, 10);
    const mrv = parseInt(document.getElementById(`mrv-${group}`).value, 10);
    if (isNaN(mev) || isNaN(mav) || isNaN(mrv)) return;
    await Repo.upsertMuscleGroupTarget({ muscleGroup: group, mev, mav, mrv });
    App.volume.s.editing[group] = false;
    await App.volume.refresh();
  },
};

// =======================================================================
// Dieta
// =======================================================================
App.diet = {
  s: {
    subview: "plan",
    profile: null,
    plan: { meals: [], dayTotals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 } },
    foods: [],
    weightLogs: [],
    addingFoodToMeal: null,
    pickedFoodId: null,
    showNewMeal: false,
    showFoodForm: false,
    editingFoodId: null,
  },

  async load() {
    const s = App.diet.s;
    s.profile = await Repo.getDietProfile();
    s.plan = await Repo.getDietPlan();
    s.foods = await Repo.getFoods();
    s.weightLogs = await Repo.getBodyWeightLogs();
  },

  async refresh() {
    await App.diet.load();
    App.diet.render();
  },

  render() {
    const s = App.diet.s;
    const el = document.getElementById("view-diet");
    el.innerHTML = `
      <div class="topbar">
        <h1>Dieta</h1>
        <div class="subtitle">Perfil, plan de comidas y peso corporal</div>
      </div>
      <div class="view">
        <div class="chip-row" style="margin-bottom:12px;">
          <button class="chip ${s.subview === "plan" ? "selected" : ""}" onclick="App.diet.goSub('plan')">Plan</button>
          <button class="chip ${s.subview === "profile" ? "selected" : ""}" onclick="App.diet.goSub('profile')">Perfil</button>
          <button class="chip ${s.subview === "foods" ? "selected" : ""}" onclick="App.diet.goSub('foods')">Alimentos</button>
          <button class="chip ${s.subview === "weight" ? "selected" : ""}" onclick="App.diet.goSub('weight')">Peso</button>
        </div>
        <div id="diet-subview"></div>
      </div>`;
    App.diet.renderSub();
  },

  goSub(sub) {
    App.diet.s.subview = sub;
    App.diet.render();
  },

  renderSub() {
    const s = App.diet.s;
    const el = document.getElementById("diet-subview");
    if (!el) return;
    if (s.subview === "plan") {
      el.innerHTML = App.diet.renderPlan();
      if (s.addingFoodToMeal != null) App.diet.mountFoodPickerForMeal();
    } else if (s.subview === "profile") {
      el.innerHTML = App.diet.renderProfile();
    } else if (s.subview === "foods") {
      el.innerHTML = App.diet.renderFoods();
    } else if (s.subview === "weight") {
      el.innerHTML = App.diet.renderWeight();
    }
  },

  // ---- Plan de comidas ----
  renderPlan() {
    const s = App.diet.s;
    const plan = s.plan;
    const profile = s.profile;
    let html = "";

    if (profile) {
      const t = plan.dayTotals;
      html += `<div class="card accent">
        <div class="card-title" style="color:var(--primary-dark);">Total del plan vs. objetivo</div>
        ${App.diet.macroRowHtml("Calorías", t.kcal, profile.targetKcal, "kcal")}
        ${App.diet.macroRowHtml("Proteína", t.proteinG, profile.targetProteinG, "g")}
        ${App.diet.macroRowHtml("Carbohidratos", t.carbsG, profile.targetCarbsG, "g")}
        ${App.diet.macroRowHtml("Grasas", t.fatG, profile.targetFatG, "g")}
      </div>`;
    } else {
      html += `<div class="muted" style="margin-bottom:10px;">Todavía no cargaste tu perfil — anda a la pestaña "Perfil" para fijar tus objetivos diarios.</div>`;
    }

    html += plan.meals.length
      ? plan.meals.map((m, i) => App.diet.mealCardHtml(m, i, plan.meals.length)).join("")
      : `<div class="empty-state">Todavía no armaste ninguna comida.</div>`;

    if (s.showNewMeal) {
      html += `<div class="card">
        <div class="card-title">Nueva comida</div>
        <div class="field"><label>Nombre</label><input id="new-meal-name" placeholder="Ej: Merienda"></div>
        <div class="field"><label>Horario (opcional)</label><input id="new-meal-schedule" placeholder="Ej: 17:00–18:00 hs"></div>
        <div class="row">
          <button class="btn btn-ghost" onclick="App.diet.toggleNewMeal()">Cancelar</button>
          <button class="btn btn-primary" onclick="App.diet.saveNewMeal()">Crear</button>
        </div>
      </div>`;
    } else {
      html += `<button class="btn btn-ghost btn-block" onclick="App.diet.toggleNewMeal()">+ Agregar comida</button>`;
    }
    return html;
  },

  macroRowHtml(label, actual, target, unit) {
    const t = target || 0;
    const pct = t > 0 ? Math.min(100, (actual / t) * 100) : 0;
    const over = t > 0 && actual > t * 1.05;
    return `<div style="margin-bottom:8px;">
      <div class="row"><span>${label}</span><span class="muted">${Math.round(actual)} / ${Math.round(t)} ${unit}</span></div>
      <div class="volume-bar"><div class="volume-bar-fill ${over ? "zone-sobre" : "zone-optimo"}" style="width:${pct}%;"></div></div>
    </div>`;
  },

  mealCardHtml(m, i, total) {
    const s = App.diet.s;
    const meal = m.meal;
    const totals = m.totals;
    let html = `<div class="card">
      <div class="row">
        <div><strong>${escapeHtml(meal.name)}</strong>${meal.scheduleLabel ? ` <span class="muted">· ${escapeHtml(meal.scheduleLabel)}</span>` : ""}</div>
        <div class="row" style="gap:2px; flex:0 0 auto;">
          <button class="icon-btn" ${i === 0 ? "disabled" : ""} onclick="App.diet.moveMeal(${meal.id}, -1)">${Icons.up}</button>
          <button class="icon-btn" ${i === total - 1 ? "disabled" : ""} onclick="App.diet.moveMeal(${meal.id}, 1)">${Icons.down}</button>
          <button class="icon-btn danger" onclick="App.diet.removeMeal(${meal.id})">${Icons.trash}</button>
        </div>
      </div>`;

    html += m.items.length
      ? m.items
          .map(
            (it) => `<div class="set-row">
        <div>
          <strong>${escapeHtml(it.food.name)}</strong> — ${App.diet.formatQuantity(it.quantity)} × ${escapeHtml(it.food.portionLabel)}
          <div class="muted">${Math.round(it.food.kcal * it.quantity)} kcal · P ${fmt1(it.food.proteinG * it.quantity)}g · C ${fmt1(it.food.carbsG * it.quantity)}g · G ${fmt1(it.food.fatG * it.quantity)}g</div>
        </div>
        <div class="row" style="gap:6px; flex:0 0 auto;">
          <input type="number" step="0.5" value="${it.quantity}" style="width:56px; border:1.5px solid var(--border); border-radius:8px; padding:6px; font-family:inherit;" onchange="App.diet.updateItemQuantity(${it.id}, this.value)">
          <button class="icon-btn danger" onclick="App.diet.removeItem(${it.id})">${Icons.trash}</button>
        </div>
      </div>`
          )
          .join("")
      : `<div class="empty-state">Sin alimentos todavía.</div>`;

    html += `<div class="muted" style="margin-top:8px;">Total: ${Math.round(totals.kcal)} kcal · P ${fmt1(totals.proteinG)}g · C ${fmt1(totals.carbsG)}g · G ${fmt1(totals.fatG)}g</div>`;

    if (s.addingFoodToMeal === meal.id) {
      html += App.diet.renderAddFoodPanel(meal.id);
    } else {
      html += `<button class="link-btn" style="margin-top:8px;" onclick="App.diet.toggleAddFood(${meal.id})">+ Agregar alimento</button>`;
    }
    html += `</div>`;
    return html;
  },

  formatQuantity(q) {
    return (Math.round(q * 100) / 100).toString();
  },

  renderAddFoodPanel(mealId) {
    const s = App.diet.s;
    const pickedName = s.foods.find((f) => f.id === s.pickedFoodId)?.name;
    let html = `<div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border);">`;
    if (s.pickedFoodId) {
      html += `<div class="row"><span><strong>${escapeHtml(pickedName || "")}</strong></span><button class="link-btn" onclick="App.diet.clearPickedFood()">Cambiar</button></div>
        <div class="field-row" style="margin-top:8px; align-items:flex-end;">
          <div class="field"><label>Cantidad (× porción base)</label><input id="add-food-qty" type="number" step="0.5" value="1"></div>
          <button class="btn btn-primary" style="margin-bottom:12px;" onclick="App.diet.confirmAddFoodToMeal(${mealId})">Agregar</button>
        </div>`;
    } else if (s.foods.length === 0) {
      html += `<div class="muted">Todavía no cargaste alimentos — andá a la pestaña "Alimentos".</div>`;
    } else {
      html += Picker.html("diet-food-picker", "Buscar alimento...");
    }
    html += `<button class="link-btn" onclick="App.diet.toggleAddFood(${mealId})">Cancelar</button>`;
    html += `</div>`;
    return html;
  },

  mountFoodPickerForMeal() {
    const s = App.diet.s;
    if (s.pickedFoodId) return;
    Picker.mount(
      "diet-food-picker",
      s.foods.map((f) => ({ ...f, searchText: f.name })),
      (f) => `<div class="exercise-picker-item" onclick="App.diet.pickFoodForMeal(${f.id})">
        <div class="name">${escapeHtml(f.name)}</div>
        <div class="group">${escapeHtml(f.portionLabel)} — ${f.kcal} kcal</div>
      </div>`
    );
    setTimeout(() => Picker.refresh("diet-food-picker"), 0);
  },

  toggleAddFood(mealId) {
    const s = App.diet.s;
    s.addingFoodToMeal = s.addingFoodToMeal === mealId ? null : mealId;
    s.pickedFoodId = null;
    App.diet.renderSub();
  },
  pickFoodForMeal(foodId) {
    App.diet.s.pickedFoodId = foodId;
    App.diet.renderSub();
  },
  clearPickedFood() {
    App.diet.s.pickedFoodId = null;
    App.diet.renderSub();
  },
  async confirmAddFoodToMeal(mealId) {
    const qty = parseFloat(document.getElementById("add-food-qty").value);
    if (isNaN(qty) || qty <= 0) return;
    await Repo.addMealItem(mealId, App.diet.s.pickedFoodId, qty);
    App.diet.s.addingFoodToMeal = null;
    App.diet.s.pickedFoodId = null;
    await App.diet.refresh();
  },
  async updateItemQuantity(itemId, value) {
    const qty = parseFloat(value);
    if (isNaN(qty) || qty < 0) return;
    await Repo.updateMealItemQuantity(itemId, qty);
    await App.diet.refresh();
  },
  async removeItem(itemId) {
    await Repo.removeMealItem(itemId);
    await App.diet.refresh();
  },
  toggleNewMeal() {
    App.diet.s.showNewMeal = !App.diet.s.showNewMeal;
    App.diet.renderSub();
  },
  async saveNewMeal() {
    const name = document.getElementById("new-meal-name").value.trim();
    const schedule = document.getElementById("new-meal-schedule").value.trim();
    if (!name) return;
    await Repo.addMeal(name, schedule);
    App.diet.s.showNewMeal = false;
    await App.diet.refresh();
  },
  async moveMeal(mealId, direction) {
    await Repo.moveMeal(mealId, direction);
    await App.diet.refresh();
  },
  async removeMeal(mealId) {
    await Repo.removeMeal(mealId);
    await App.diet.refresh();
  },

  // ---- Perfil ----
  renderProfile() {
    const p = App.diet.s.profile || {};
    return `
      <div class="card">
        <div class="card-title">Datos personales</div>
        <div class="field-row">
          <div class="field"><label>Nombre</label><input id="diet-name" value="${escapeHtml(p.name || "")}"></div>
          <div class="field"><label>Edad</label><input id="diet-age" type="number" value="${p.age ?? ""}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Altura (cm)</label><input id="diet-height" type="number" value="${p.heightCm ?? ""}"></div>
          <div class="field"><label>Peso (kg)</label><input id="diet-weight" type="number" step="0.1" value="${p.weightKg ?? ""}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Género</label>
            <select id="diet-gender" style="width:100%; border:1.5px solid var(--border); border-radius:8px; padding:11px 12px; font-size:15px; font-family:inherit; background:var(--surface-2);">
              <option value="M" ${p.gender !== "F" ? "selected" : ""}>Masculino</option>
              <option value="F" ${p.gender === "F" ? "selected" : ""}>Femenino</option>
            </select>
          </div>
          <div class="field"><label>Factor de actividad</label><input id="diet-activity" type="number" step="0.05" value="${p.activityFactor ?? 1.5}"></div>
        </div>
        <div class="muted" id="diet-bmr-info">${App.diet.bmrInfoText(p)}</div>
      </div>

      <div class="card">
        <div class="card-title">Objetivos diarios</div>
        <div class="field-row">
          <div class="field"><label>Ajuste calórico (kcal)</label><input id="diet-kcaladj" type="number" value="${p.kcalAdjustment ?? -500}"></div>
          <div class="field"><label>Proteína (g/kg)</label><input id="diet-proteinperkg" type="number" step="0.01" value="${p.proteinPerKg ?? 2}"></div>
        </div>
        <button class="btn btn-ghost" style="margin-bottom:10px;" onclick="App.diet.recalcSuggested()">Recalcular sugerido a partir del perfil</button>
        <div class="field-row">
          <div class="field"><label>Calorías (kcal/día)</label><input id="diet-target-kcal" type="number" value="${p.targetKcal ?? ""}"></div>
          <div class="field"><label>Proteína (g/día)</label><input id="diet-target-protein" type="number" value="${p.targetProteinG ?? ""}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Carbohidratos (g/día)</label><input id="diet-target-carbs" type="number" value="${p.targetCarbsG ?? ""}"></div>
          <div class="field"><label>Grasas (g/día)</label><input id="diet-target-fat" type="number" value="${p.targetFatG ?? ""}"></div>
        </div>
        <div class="field"><label>Notas</label><textarea id="diet-notes" rows="4">${escapeHtml(p.notes || "")}</textarea></div>
        <button class="btn btn-primary btn-block" onclick="App.diet.saveProfile()">Guardar perfil y objetivos</button>
      </div>`;
  },

  bmrInfoText(p) {
    if (!p.weightKg || !p.heightCm || !p.age) return "Completá altura, peso y edad para ver el BMR y el TDEE.";
    const bmr = Metrics.harrisBenedictBmr(p.weightKg, p.heightCm, p.age, p.gender);
    const tdeeVal = Metrics.tdee(bmr, p.activityFactor || 1.5);
    return `BMR (Harris-Benedict): ${Math.round(bmr)} kcal · TDEE (factor ${p.activityFactor || 1.5}): ${Math.round(tdeeVal)} kcal`;
  },

  readProfileForm() {
    return {
      name: document.getElementById("diet-name").value.trim(),
      age: parseInt(document.getElementById("diet-age").value, 10) || 0,
      heightCm: parseFloat(document.getElementById("diet-height").value) || 0,
      weightKg: parseFloat(document.getElementById("diet-weight").value) || 0,
      gender: document.getElementById("diet-gender").value,
      activityFactor: parseFloat(document.getElementById("diet-activity").value) || 1.5,
      kcalAdjustment: parseFloat(document.getElementById("diet-kcaladj").value) || 0,
      proteinPerKg: parseFloat(document.getElementById("diet-proteinperkg").value) || 0,
      targetKcal: parseFloat(document.getElementById("diet-target-kcal").value) || 0,
      targetProteinG: parseFloat(document.getElementById("diet-target-protein").value) || 0,
      targetCarbsG: parseFloat(document.getElementById("diet-target-carbs").value) || 0,
      targetFatG: parseFloat(document.getElementById("diet-target-fat").value) || 0,
      notes: document.getElementById("diet-notes").value,
    };
  },

  recalcSuggested() {
    const draft = App.diet.readProfileForm();
    const sug = Metrics.suggestedMacros(draft);
    document.getElementById("diet-target-kcal").value = sug.targetKcal;
    document.getElementById("diet-target-protein").value = sug.proteinG;
    document.getElementById("diet-target-carbs").value = sug.carbsG;
    document.getElementById("diet-bmr-info").textContent =
      `BMR: ${sug.bmr} kcal · TDEE: ${sug.tdee} kcal · Calorías sugeridas: ${sug.targetKcal} kcal`;
  },

  async saveProfile() {
    const profile = App.diet.readProfileForm();
    await Repo.upsertDietProfile(profile);
    await App.diet.refresh();
  },

  // ---- Alimentos ----
  renderFoods() {
    const s = App.diet.s;
    let html = `<div class="card">
      <div class="card-title">Base de alimentos</div>
      <div class="muted" style="margin-bottom:8px;">Cada alimento tiene una porción base con sus macros. Se puede reusar el mismo alimento en varias comidas con distinta cantidad.</div>
      <button class="btn btn-ghost" onclick="App.diet.toggleFoodForm()">+ Nuevo alimento</button>
      ${s.showFoodForm ? App.diet.renderFoodForm() : ""}
    </div>`;
    html += s.foods.length
      ? s.foods.map((f) => App.diet.foodRowHtml(f)).join("")
      : `<div class="empty-state">Todavía no cargaste alimentos.</div>`;
    return html;
  },

  foodRowHtml(f) {
    if (App.diet.s.editingFoodId === f.id) return App.diet.renderFoodForm(f);
    return `<div class="card">
      <div class="row">
        <strong>${escapeHtml(f.name)}</strong>
        <div class="row" style="gap:2px; flex:0 0 auto;">
          <button class="icon-btn" onclick="App.diet.editFood(${f.id})">${Icons.edit}</button>
          <button class="icon-btn danger" onclick="App.diet.removeFood(${f.id})">${Icons.trash}</button>
        </div>
      </div>
      <div class="muted">Porción: ${escapeHtml(f.portionLabel)} — ${f.kcal} kcal · P ${f.proteinG}g · C ${f.carbsG}g · G ${f.fatG}g</div>
      ${f.note ? `<div class="muted" style="margin-top:4px;">${escapeHtml(f.note)}</div>` : ""}
    </div>`;
  },

  renderFoodForm(existing) {
    const f = existing || { name: "", portionLabel: "", kcal: "", proteinG: "", carbsG: "", fatG: "", note: "" };
    return `<div class="card" style="border:1px dashed var(--border); box-shadow:none;">
      <div class="field"><label>Nombre</label><input id="food-name" value="${escapeHtml(f.name)}"></div>
      <div class="field"><label>Porción base</label><input id="food-portion" placeholder="Ej: 100 g, 1 unidad, 250 ml" value="${escapeHtml(f.portionLabel)}"></div>
      <div class="field-row">
        <div class="field"><label>Kcal</label><input id="food-kcal" type="number" value="${f.kcal}"></div>
        <div class="field"><label>Proteína (g)</label><input id="food-protein" type="number" value="${f.proteinG}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Carbohidratos (g)</label><input id="food-carbs" type="number" value="${f.carbsG}"></div>
        <div class="field"><label>Grasas (g)</label><input id="food-fat" type="number" value="${f.fatG}"></div>
      </div>
      <div class="field"><label>Nota (opcional)</label><input id="food-note" value="${escapeHtml(f.note || "")}"></div>
      <div class="row">
        <button class="btn btn-ghost" onclick="App.diet.cancelFoodForm()">Cancelar</button>
        <button class="btn btn-primary" onclick="App.diet.saveFood(${existing ? existing.id : "null"})">Guardar</button>
      </div>
    </div>`;
  },

  toggleFoodForm() {
    App.diet.s.showFoodForm = !App.diet.s.showFoodForm;
    App.diet.s.editingFoodId = null;
    App.diet.renderSub();
  },
  editFood(id) {
    App.diet.s.editingFoodId = id;
    App.diet.s.showFoodForm = false;
    App.diet.renderSub();
  },
  cancelFoodForm() {
    App.diet.s.showFoodForm = false;
    App.diet.s.editingFoodId = null;
    App.diet.renderSub();
  },
  async saveFood(id) {
    const food = {
      name: document.getElementById("food-name").value.trim(),
      portionLabel: document.getElementById("food-portion").value.trim(),
      kcal: parseFloat(document.getElementById("food-kcal").value) || 0,
      proteinG: parseFloat(document.getElementById("food-protein").value) || 0,
      carbsG: parseFloat(document.getElementById("food-carbs").value) || 0,
      fatG: parseFloat(document.getElementById("food-fat").value) || 0,
      note: document.getElementById("food-note").value.trim(),
    };
    if (!food.name) return;
    if (id) {
      food.id = id;
      await Repo.updateFood(food);
    } else {
      await Repo.addFood(food);
    }
    App.diet.s.showFoodForm = false;
    App.diet.s.editingFoodId = null;
    await App.diet.refresh();
  },
  async removeFood(id) {
    await Repo.deleteFood(id);
    await App.diet.refresh();
  },

  // ---- Peso corporal ----
  renderWeight() {
    const logs = App.diet.s.weightLogs;
    const latest = logs[0];
    const prev = logs[1];
    let trendHtml = "";
    if (latest && prev) {
      const diff = latest.weightKg - prev.weightKg;
      const sign = diff > 0 ? "+" : "";
      trendHtml = `<div class="muted" style="margin-top:6px;">Variación vs. registro anterior: ${sign}${diff.toFixed(1)} kg</div>`;
    }
    return `
      <div class="card">
        <div class="card-title">Registrar peso</div>
        <div class="field-row">
          <div class="field"><label>Fecha</label><input id="weight-date" type="date" value="${Repo.todayStr()}"></div>
          <div class="field"><label>Peso (kg)</label><input id="weight-value" type="number" step="0.1" placeholder="0.0"></div>
        </div>
        <button class="btn btn-primary btn-block" onclick="App.diet.saveWeight()">Guardar</button>
        ${trendHtml}
      </div>
      <div class="card-title" style="margin: 18px 0 8px;">Historial</div>
      <div class="card">
        ${
          logs.length
            ? logs
                .map(
                  (l) => `<div class="set-row">
              <div>${l.date} — <strong>${fmt1(l.weightKg)} kg</strong></div>
              <button class="icon-btn danger" onclick="App.diet.removeWeight(${l.id})">${Icons.trash}</button>
            </div>`
                )
                .join("")
            : `<div class="empty-state">Todavía no registraste tu peso.</div>`
        }
      </div>`;
  },

  async saveWeight() {
    const date = document.getElementById("weight-date").value || Repo.todayStr();
    const weight = parseFloat(document.getElementById("weight-value").value);
    if (isNaN(weight)) return;
    await Repo.logBodyWeight(date, weight);
    await App.diet.refresh();
  },
  async removeWeight(id) {
    await Repo.deleteBodyWeightLog(id);
    await App.diet.refresh();
  },
};

document.addEventListener("DOMContentLoaded", App.init);
