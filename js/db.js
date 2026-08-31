// Capa de datos: IndexedDB, 100% local, sin servidor. Port funcional de
// AppDatabase/Daos/TrainRepository.kt. Todo async vía Promises.

const DB_NAME = "trainmetrics";
const DB_VERSION = 1;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Lunes (fijo, no depende de locale) de la semana que contiene dateStr. */
function mondayOfStr(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=domingo .. 6=sábado
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDaysStr(dateStr, diffToMonday);
}

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("exercises")) {
        const s = db.createObjectStore("exercises", { keyPath: "id", autoIncrement: true });
        s.createIndex("muscleGroup", "muscleGroup");
      }
      if (!db.objectStoreNames.contains("sessions")) {
        const s = db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
        s.createIndex("date", "date");
      }
      if (!db.objectStoreNames.contains("sets")) {
        const s = db.createObjectStore("sets", { keyPath: "id", autoIncrement: true });
        s.createIndex("sessionId", "sessionId");
        s.createIndex("exerciseId", "exerciseId");
      }
      if (!db.objectStoreNames.contains("routines")) {
        db.createObjectStore("routines", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("routineExercises")) {
        const s = db.createObjectStore("routineExercises", { keyPath: "id", autoIncrement: true });
        s.createIndex("routineId", "routineId");
      }
      if (!db.objectStoreNames.contains("plannedSets")) {
        const s = db.createObjectStore("plannedSets", { keyPath: "id", autoIncrement: true });
        s.createIndex("routineExerciseId", "routineExerciseId");
      }
      if (!db.objectStoreNames.contains("muscleGroupTargets")) {
        db.createObjectStore("muscleGroupTargets", { keyPath: "muscleGroup" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode) {
  return openDB().then((db) => db.transaction(storeNames, mode));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(store) {
  const t = await tx([store], "readonly");
  return reqToPromise(t.objectStore(store).getAll());
}

async function getAllByIndex(store, index, value) {
  const t = await tx([store], "readonly");
  return reqToPromise(t.objectStore(store).index(index).getAll(value));
}

async function getOne(store, key) {
  const t = await tx([store], "readonly");
  const result = await reqToPromise(t.objectStore(store).get(key));
  return result || null;
}

async function addRecord(store, obj) {
  const t = await tx([store], "readwrite");
  const id = await reqToPromise(t.objectStore(store).add(obj));
  return id;
}

async function putRecord(store, obj) {
  const t = await tx([store], "readwrite");
  return reqToPromise(t.objectStore(store).put(obj));
}

async function deleteRecord(store, key) {
  const t = await tx([store], "readwrite");
  return reqToPromise(t.objectStore(store).delete(key));
}

// ---------------------------------------------------------------------
// Repo: espejo funcional de TrainRepository.kt
// ---------------------------------------------------------------------

const Repo = {
  todayStr,

  // ---- Exercises ----
  async addExercise(name, muscleGroup, equipment = "") {
    return addRecord("exercises", { name, muscleGroup, equipment, archived: false });
  },
  async getExercise(id) {
    return getOne("exercises", id);
  },
  async getActiveExercises() {
    const all = await getAll("exercises");
    return all.filter((e) => !e.archived).sort((a, b) => a.name.localeCompare(b.name));
  },
  async getMuscleGroups() {
    const all = await Repo.getActiveExercises();
    return [...new Set(all.map((e) => e.muscleGroup))].sort();
  },

  // ---- Sessions ----
  /** Get-or-create: si ya existe una sesión para esa fecha, la reusa (actualiza rutina si cambió). */
  async startSession(dateStr = todayStr(), routineId = null) {
    const bySDate = await getAllByIndex("sessions", "date", dateStr);
    const existing = bySDate[0];
    if (existing) {
      if ((existing.routineId ?? null) !== (routineId ?? null)) {
        existing.routineId = routineId;
        await putRecord("sessions", existing);
      }
      return existing.id;
    }
    return addRecord("sessions", { date: dateStr, routineId, note: "" });
  },
  async getSession(id) {
    return getOne("sessions", id);
  },

  // ---- Sets ----
  async addSet(set) {
    return addRecord("sets", set);
  },
  async deleteSet(id) {
    return deleteRecord("sets", id);
  },
  async getSetsForSession(sessionId) {
    const sets = await getAllByIndex("sets", "sessionId", sessionId);
    return sets.sort((a, b) => a.setNumber - b.setNumber);
  },

  // ---- Muscle group targets ----
  async getMuscleGroupTarget(muscleGroup) {
    return getOne("muscleGroupTargets", muscleGroup);
  },
  async upsertMuscleGroupTarget(target) {
    return putRecord("muscleGroupTargets", target);
  },

  /** Historial de un ejercicio con fecha de sesión resuelta, más reciente primero. */
  async exerciseHistory(exerciseId) {
    const sets = await getAllByIndex("sets", "exerciseId", exerciseId);
    const sessionCache = {};
    const out = [];
    for (const set of sets) {
      if (!(set.sessionId in sessionCache)) {
        const session = await Repo.getSession(set.sessionId);
        sessionCache[set.sessionId] = session ? session.date : null;
      }
      const date = sessionCache[set.sessionId];
      if (date) out.push({ set, date });
    }
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.set.id - a.set.id));
    return out;
  },

  async floorFor(exerciseId, windowSessions = 4, marginPct = 0.08) {
    const history = await Repo.exerciseHistory(exerciseId);
    return Metrics.floor(history, windowSessions, marginPct);
  },

  /** Series de trabajo de la semana actual (lunes a domingo) agrupadas por grupo muscular. */
  async currentWeekVolumeByMuscleGroup() {
    const monday = mondayOfStr(todayStr());
    const sunday = addDaysStr(monday, 6);
    const allSets = await getAll("sets");
    const allSessions = await getAll("sessions");
    const sessionDateById = {};
    allSessions.forEach((s) => (sessionDateById[s.id] = s.date));
    const inRange = allSets.filter((s) => {
      const d = sessionDateById[s.sessionId];
      return d && d >= monday && d <= sunday;
    });
    const exercises = await getAll("exercises");
    const muscleGroupByExerciseId = {};
    exercises.forEach((e) => (muscleGroupByExerciseId[e.id] = e.muscleGroup));
    return Metrics.weeklySetsByMuscleGroup(inRange, muscleGroupByExerciseId);
  },

  // ---- Rutinas ----
  async getRoutines() {
    const all = await getAll("routines");
    return all.sort((a, b) => a.name.localeCompare(b.name));
  },
  async createRoutine(name) {
    return addRecord("routines", { name });
  },
  async deleteRoutine(routineId) {
    const exs = await getAllByIndex("routineExercises", "routineId", routineId);
    for (const re of exs) {
      const planned = await getAllByIndex("plannedSets", "routineExerciseId", re.id);
      for (const p of planned) await deleteRecord("plannedSets", p.id);
      await deleteRecord("routineExercises", re.id);
    }
    await deleteRecord("routines", routineId);
  },
  async getRoutineDetail(routineId) {
    const routine = await getOne("routines", routineId);
    if (!routine) return null;
    const exs = (await getAllByIndex("routineExercises", "routineId", routineId)).sort(
      (a, b) => a.orderIndex - b.orderIndex
    );
    const entries = [];
    for (const re of exs) {
      const exercise = await getOne("exercises", re.exerciseId);
      if (!exercise) continue;
      const plannedSets = (await getAllByIndex("plannedSets", "routineExerciseId", re.id)).sort(
        (a, b) => a.setNumber - b.setNumber
      );
      entries.push({ routineExerciseId: re.id, exercise, plannedSets });
    }
    return { routine, entries };
  },
  /** exercisesIds ya presentes en la rutina, útil para filtrar el picker de "agregar ejercicio". */
  async getRoutineExerciseIds(routineId) {
    const exs = await getAllByIndex("routineExercises", "routineId", routineId);
    return exs.map((e) => e.exerciseId);
  },
  async addExerciseToRoutine(routineId, exerciseId, plannedSets) {
    const existing = await getAllByIndex("routineExercises", "routineId", routineId);
    const orderIndex = existing.length;
    const routineExerciseId = await addRecord("routineExercises", {
      routineId,
      exerciseId,
      orderIndex,
    });
    let i = 0;
    for (const planned of plannedSets) {
      i += 1;
      await addRecord("plannedSets", {
        routineExerciseId,
        setNumber: i,
        targetReps: planned.targetReps,
        targetRir: planned.targetRir ?? null,
        targetRpe: planned.targetRpe ?? null,
      });
    }
    return routineExerciseId;
  },
  async removeExerciseFromRoutine(routineExerciseId) {
    const planned = await getAllByIndex("plannedSets", "routineExerciseId", routineExerciseId);
    for (const p of planned) await deleteRecord("plannedSets", p.id);
    await deleteRecord("routineExercises", routineExerciseId);
  },
  /** Mueve un ejercicio de la rutina un lugar hacia arriba (-1) o abajo (+1), swapeando
   *  orderIndex con el vecino. No hace nada si ya está en la punta correspondiente. */
  async reorderRoutineExercise(routineId, routineExerciseId, direction) {
    const exs = (await getAllByIndex("routineExercises", "routineId", routineId)).sort(
      (a, b) => a.orderIndex - b.orderIndex
    );
    const idx = exs.findIndex((e) => e.id === routineExerciseId);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= exs.length) return;
    const a = exs[idx];
    const b = exs[swapIdx];
    const tmp = a.orderIndex;
    a.orderIndex = b.orderIndex;
    b.orderIndex = tmp;
    await putRecord("routineExercises", a);
    await putRecord("routineExercises", b);
  },
  /** Ejercicios de la rutina de hoy, EN ORDEN — usado por la pantalla de Sesión para no
   *  mostrar ejercicios que no pertenecen a la rutina elegida. */
  async getRoutineExercises(routineId) {
    if (!routineId) return [];
    const exs = (await getAllByIndex("routineExercises", "routineId", routineId)).sort(
      (a, b) => a.orderIndex - b.orderIndex
    );
    const out = [];
    for (const re of exs) {
      const exercise = await getOne("exercises", re.exerciseId);
      if (exercise) out.push(exercise);
    }
    return out;
  },
  async getPlannedSetsForRoutineExercise(routineId, exerciseId) {
    if (!routineId) return [];
    const exs = await getAllByIndex("routineExercises", "routineId", routineId);
    const re = exs.find((e) => e.exerciseId === exerciseId);
    if (!re) return [];
    return (await getAllByIndex("plannedSets", "routineExerciseId", re.id)).sort(
      (a, b) => a.setNumber - b.setNumber
    );
  },

  /** Cantidad de ejercicios en fatiga (Metrics.isInFatigue) agrupados por grupo muscular. */
  async fatiguedExercisesByMuscleGroup() {
    const exercises = await Repo.getActiveExercises();
    const counts = {};
    for (const exercise of exercises) {
      const history = await Repo.exerciseHistory(exercise.id);
      if (Metrics.isInFatigue(history)) {
        counts[exercise.muscleGroup] = (counts[exercise.muscleGroup] || 0) + 1;
      }
    }
    return counts;
  },

  // ---------------------------------------------------------------------
  // Seed: carga inicial del plan "Fase 1: Reacondicionamiento" (3 días,
  // full body) la primera vez que se abre la app en un dispositivo nuevo.
  // Se guarda 1 vez porque IndexedDB es local a cada navegador/dispositivo:
  // no hay forma de "enviar" datos ya cargados a otro celular, así que el
  // plan se siembra automáticamente en cuanto detecta que no hay rutinas.
  // No pisa datos existentes: si ya hay al menos 1 rutina, no hace nada.
  // ---------------------------------------------------------------------
  async seedFase1IfEmpty() {
    const existingRoutines = await Repo.getRoutines();
    if (existingRoutines.length > 0) return;

    const muscleGroupByName = {
      "Press Inclinado Multipower": "Empuje",
      "Remo Hammer Unilateral": "Tracción Horizontal",
      "Jalón al Pecho (Agarre Neutro)": "Tracción Vertical",
      "Laterales en Máquina": "Deltoides Lat.",
      "Tríceps Barra Polea": "Tríceps",
      "Bíceps en Polea": "Bíceps",
      "Sentadilla Péndulo": "Cuádriceps",
      "Curl Femoral Sentado": "Isquiotibiales",
      "Extensión de Cuádriceps": "Cuádriceps",
      "Sentadilla Power Squat": "Cuádriceps",
      "Peck Deck (Aperturas)": "Empuje",
      "Extensiones Tríceps Barra": "Tríceps",
      "Curl Alternado Mancuernas": "Bíceps",
      "Laterales Parado Máquina": "Deltoides Lat.",
      "Remo T (Apoyo en Pecho)": "Tracción Horizontal",
      "Press Hammer Inclinado": "Empuje",
      "Prensa a Una Pierna": "Cuádriceps",
      "Curl Bíceps Bayesian": "Bíceps",
      "Vuelos Laterales Mancuerna": "Deltoides Lat.",
      "Aductores Máquina": "Aductores",
    };

    const days = [
      {
        name: "Día 1 – Empuje",
        exercises: [
          { name: "Press Inclinado Multipower", sets: 3, reps: 6, rir: 2 },
          { name: "Remo Hammer Unilateral", sets: 2, reps: 8, rir: 2 },
          { name: "Jalón al Pecho (Agarre Neutro)", sets: 2, reps: 8, rir: 2 },
          { name: "Laterales en Máquina", sets: 2, reps: 12, rir: 1 },
          { name: "Tríceps Barra Polea", sets: 2, reps: 10, rir: 1 },
          { name: "Bíceps en Polea", sets: 2, reps: 12, rir: 1 },
          { name: "Sentadilla Péndulo", sets: 2, reps: 6, rir: 2 },
          { name: "Curl Femoral Sentado", sets: 2, reps: 10, rir: 1 },
          { name: "Extensión de Cuádriceps", sets: 1, reps: 12, rir: 1 },
        ],
      },
      {
        name: "Día 2 – Pierna",
        exercises: [
          { name: "Sentadilla Power Squat", sets: 3, reps: 8, rir: 2 },
          { name: "Jalón al Pecho (Agarre Neutro)", sets: 3, reps: 8, rir: 2 },
          { name: "Curl Femoral Sentado", sets: 3, reps: 10, rir: 1 },
          { name: "Peck Deck (Aperturas)", sets: 3, reps: 10, rir: 2 },
          { name: "Extensiones Tríceps Barra", sets: 2, reps: 10, rir: 2 },
          { name: "Curl Alternado Mancuernas", sets: 2, reps: 12, rir: 1 },
          { name: "Laterales Parado Máquina", sets: 2, reps: 12, rir: 1 },
        ],
      },
      {
        name: "Día 3 – Espalda",
        exercises: [
          { name: "Remo T (Apoyo en Pecho)", sets: 3, reps: 8, rir: 2 },
          { name: "Press Hammer Inclinado", sets: 2, reps: 10, rir: 1 },
          { name: "Prensa a Una Pierna", sets: 2, reps: 10, rir: 2 },
          { name: "Tríceps Barra Polea", sets: 2, reps: 12, rir: 1 },
          { name: "Curl Bíceps Bayesian", sets: 2, reps: 12, rir: 1 },
          { name: "Vuelos Laterales Mancuerna", sets: 3, reps: 10, rir: 2 },
          { name: "Extensión de Cuádriceps", sets: 1, reps: 12, rir: 1 },
          { name: "Aductores Máquina", sets: 2, reps: 12, rir: 1 },
        ],
      },
    ];

    // Ejercicios ya existentes (por si el usuario cargó alguno manualmente
    // antes de crear su primera rutina) para no duplicar por nombre.
    const existingExercises = await Repo.getActiveExercises();
    const exerciseIdByName = {};
    existingExercises.forEach((e) => (exerciseIdByName[e.name] = e.id));

    async function ensureExercise(name) {
      if (exerciseIdByName[name]) return exerciseIdByName[name];
      const id = await Repo.addExercise(name, muscleGroupByName[name] || "Otro");
      exerciseIdByName[name] = id;
      return id;
    }

    for (const day of days) {
      const routineId = await Repo.createRoutine(day.name);
      for (const ex of day.exercises) {
        const exerciseId = await ensureExercise(ex.name);
        const plannedSets = Array.from({ length: ex.sets }, () => ({
          targetReps: ex.reps,
          targetRir: ex.rir,
        }));
        await Repo.addExerciseToRoutine(routineId, exerciseId, plannedSets);
      }
    }
  },
};
