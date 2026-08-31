// Capa de datos: IndexedDB, 100% local, sin servidor. Port funcional de
// AppDatabase/Daos/TrainRepository.kt. Todo async vía Promises.

const DB_NAME = "trainmetrics";
const DB_VERSION = 2;

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
      // ---- Módulo de dieta ----
      if (!db.objectStoreNames.contains("dietProfile")) {
        // Fila única (id fijo = 1): datos personales + objetivos diarios.
        db.createObjectStore("dietProfile", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("foods")) {
        // Base de alimentos reusable: cada uno con su porción base y macros de esa porción.
        db.createObjectStore("foods", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("dietMeals")) {
        // Comidas del plan (ej: "Desayuno", "Comida 2"), en orden.
        db.createObjectStore("dietMeals", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("dietMealItems")) {
        // Alimentos dentro de cada comida, con cantidad = múltiplo de la porción base.
        const s = db.createObjectStore("dietMealItems", { keyPath: "id", autoIncrement: true });
        s.createIndex("mealId", "mealId");
      }
      if (!db.objectStoreNames.contains("bodyWeightLogs")) {
        // Registro de peso corporal, una entrada por fecha.
        const s = db.createObjectStore("bodyWeightLogs", { keyPath: "id", autoIncrement: true });
        s.createIndex("date", "date");
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
  /** Devuelve los routineExercises de una rutina, ORDENADOS, garantizando que todos
   *  tengan orderIndex. Los registros viejos (creados antes de que existiera el campo
   *  orderIndex) no lo tienen, y comparar undefined-undefined da NaN, lo que deja el
   *  orden "como caiga" en IndexedDB — por eso acá migramos esos casos una sola vez,
   *  asignando el orden según el id (orden de creación original) y persistiéndolo. */
  async _orderedRoutineExercises(routineId) {
    const exs = await getAllByIndex("routineExercises", "routineId", routineId);
    const missing = exs.some((e) => typeof e.orderIndex !== "number");
    if (!missing) return exs.sort((a, b) => a.orderIndex - b.orderIndex);
    const sorted = exs.slice().sort((a, b) => a.id - b.id);
    for (let i = 0; i < sorted.length; i++) {
      sorted[i].orderIndex = i;
      await putRecord("routineExercises", sorted[i]);
    }
    return sorted;
  },
  async getRoutineDetail(routineId) {
    const routine = await getOne("routines", routineId);
    if (!routine) return null;
    const exs = await Repo._orderedRoutineExercises(routineId);
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
    const exs = await Repo._orderedRoutineExercises(routineId);
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
    const exs = await Repo._orderedRoutineExercises(routineId);
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
  // Dieta
  // ---------------------------------------------------------------------

  // ---- Perfil + objetivos diarios ----
  async getDietProfile() {
    return getOne("dietProfile", 1);
  },
  async upsertDietProfile(profile) {
    return putRecord("dietProfile", { ...profile, id: 1 });
  },

  // ---- Alimentos ----
  async getFoods() {
    const all = await getAll("foods");
    return all.sort((a, b) => a.name.localeCompare(b.name));
  },
  async getFood(id) {
    return getOne("foods", id);
  },
  async addFood(food) {
    return addRecord("foods", food);
  },
  async updateFood(food) {
    return putRecord("foods", food);
  },
  /** Borra un alimento y también los ítems de comida que lo usaban (para no dejar
   *  referencias colgantes que después revienten al calcular macros). */
  async deleteFood(foodId) {
    const allItems = await getAll("dietMealItems");
    for (const it of allItems.filter((i) => i.foodId === foodId)) {
      await deleteRecord("dietMealItems", it.id);
    }
    await deleteRecord("foods", foodId);
  },

  // ---- Comidas del plan ----
  async getMeals() {
    const all = await getAll("dietMeals");
    return all.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  },
  async addMeal(name, scheduleLabel = "") {
    const existing = await getAll("dietMeals");
    return addRecord("dietMeals", { name, scheduleLabel, orderIndex: existing.length });
  },
  async updateMeal(meal) {
    return putRecord("dietMeals", meal);
  },
  async removeMeal(mealId) {
    const items = await getAllByIndex("dietMealItems", "mealId", mealId);
    for (const it of items) await deleteRecord("dietMealItems", it.id);
    await deleteRecord("dietMeals", mealId);
  },
  async moveMeal(mealId, direction) {
    const meals = await Repo.getMeals();
    const idx = meals.findIndex((m) => m.id === mealId);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= meals.length) return;
    const a = meals[idx];
    const b = meals[swapIdx];
    const tmp = a.orderIndex ?? idx;
    a.orderIndex = b.orderIndex ?? swapIdx;
    b.orderIndex = tmp;
    await putRecord("dietMeals", a);
    await putRecord("dietMeals", b);
  },

  // ---- Ítems (alimento + cantidad) dentro de una comida ----
  async getMealItems(mealId) {
    const items = await getAllByIndex("dietMealItems", "mealId", mealId);
    return items.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  },
  async addMealItem(mealId, foodId, quantity = 1) {
    const existing = await getAllByIndex("dietMealItems", "mealId", mealId);
    return addRecord("dietMealItems", { mealId, foodId, quantity, orderIndex: existing.length });
  },
  async updateMealItemQuantity(itemId, quantity) {
    const item = await getOne("dietMealItems", itemId);
    if (!item) return;
    item.quantity = quantity;
    await putRecord("dietMealItems", item);
  },
  async removeMealItem(itemId) {
    return deleteRecord("dietMealItems", itemId);
  },

  /** Plan completo: cada comida con sus ítems ya resueltos (alimento + cantidad) y los
   *  totales de macros de esa comida, más el total del día. Puro join + suma, la fórmula
   *  de suma en sí vive en Metrics (metrics.js) para mantener el cálculo testeable aparte. */
  async getDietPlan() {
    const meals = await Repo.getMeals();
    const foods = await Repo.getFoods();
    const foodById = {};
    foods.forEach((f) => (foodById[f.id] = f));
    const mealsOut = [];
    let dayTotals = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    for (const meal of meals) {
      const items = await Repo.getMealItems(meal.id);
      const resolved = items
        .map((it) => ({ ...it, food: foodById[it.foodId] }))
        .filter((it) => it.food);
      const totals = Metrics.mealTotals(resolved);
      dayTotals = {
        kcal: dayTotals.kcal + totals.kcal,
        proteinG: dayTotals.proteinG + totals.proteinG,
        carbsG: dayTotals.carbsG + totals.carbsG,
        fatG: dayTotals.fatG + totals.fatG,
      };
      mealsOut.push({ meal, items: resolved, totals });
    }
    return { meals: mealsOut, dayTotals };
  },

  // ---- Registro de peso corporal ----
  async getBodyWeightLogs() {
    const all = await getAll("bodyWeightLogs");
    return all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  },
  /** Get-or-create por fecha: si ya cargaste el peso de hoy, lo actualiza en vez de duplicar. */
  async logBodyWeight(dateStr, weightKg) {
    const byDate = await getAllByIndex("bodyWeightLogs", "date", dateStr);
    const existing = byDate[0];
    if (existing) {
      existing.weightKg = weightKg;
      await putRecord("bodyWeightLogs", existing);
      return existing.id;
    }
    return addRecord("bodyWeightLogs", { date: dateStr, weightKg });
  },
  async deleteBodyWeightLog(id) {
    return deleteRecord("bodyWeightLogs", id);
  },

  // ---------------------------------------------------------------------
  // Seed del plan nutricional por defecto (Definición Estética, 2 comidas/día),
  // cargado por el usuario en PDF. Mismo criterio que seedFase1IfEmpty: se siembra
  // 1 sola vez por dispositivo, apenas detecta que no hay perfil de dieta todavía,
  // y no pisa nada si el usuario ya tiene datos cargados.
  // ---------------------------------------------------------------------
  async seedDietPlanIfEmpty() {
    const existingProfile = await Repo.getDietProfile();
    if (existingProfile) return;

    await Repo.upsertDietProfile({
      name: "Jose Ignacio Alvarez",
      age: 22,
      heightCm: 165,
      weightKg: 70,
      gender: "M",
      activityFactor: 1.6,
      kcalAdjustment: -500,
      proteinPerKg: 2.41,
      targetKcal: 2151,
      targetProteinG: 169,
      targetCarbsG: 175,
      targetFatG: 81,
      notes:
        "Objetivo: pérdida de grasa con preservación muscular. 2 comidas diarias, déficit ~500 kcal/día (~0.5% del peso corporal por semana). " +
        "Día de descanso (2/sem): reducir arroz de 100g a 60g crudo y avena de 80g a 60g crudo (~-220 kcal). " +
        "Ajuste por falta de progreso: sin pérdida de peso en 2 semanas → 1) sumar 2000 pasos diarios, 2) reducir arroz a 70g y avena a 60g. Nunca reducir proteína ni proteína en polvo. " +
        "Proteína, omega-3 (vía caballa), carbohidratos y grasas ya están cubiertos según el análisis del plan — no hace falta agregar más fuentes. Vitamina D levemente baja: compensar con sol o D3 1000 UI si hace falta.",
    });

    const foodDefs = [
      { key: "avena", name: "Avena (cruda)", portionLabel: "80 g", kcal: 304, proteinG: 11, carbsG: 50, fatG: 6, note: "Cocinar en leche. Ajustada a 80 g para el TDEE actual." },
      { key: "leche", name: "Leche entera o semi", portionLabel: "400 ml", kcal: 240, proteinG: 13, carbsG: 19, fatG: 10, note: "Base de la avena. Calcio + caseína de digestión lenta." },
      { key: "proteina", name: "Proteína en polvo", portionLabel: "1 scoop", kcal: 127, proteinG: 25, carbsG: 3, fatG: 2, note: "Mezclar directamente en la avena con leche. Macros aproximados — verificar con tu producto." },
      { key: "huevos", name: "Huevos enteros", portionLabel: "4 unidades", kcal: 280, proteinG: 24, carbsG: 2, fatG: 20, note: "Perfil aminoacídico completo. Yema: vitaminas A, D, E, colina." },
      { key: "aceite", name: "Aceite de oliva", portionLabel: "10 ml", kcal: 90, proteinG: 0, carbsG: 0, fatG: 10, note: "Ácido oleico, antiinflamatorio. Usar en crudo o a fuego bajo." },
      { key: "verdurasCrudas", name: "Verduras crudas (espinaca, tomate, morrón)", portionLabel: "150 g", kcal: 50, proteinG: 3, carbsG: 9, fatG: 0, note: "Vitamina C, hierro, potasio. Elegir variedad de colores." },
      { key: "pollo", name: "Pechuga de pollo hervida", portionLabel: "300 g cruda (~225 g hervida)", kcal: 330, proteinG: 69, carbsG: 0, fatG: 4, note: "Pesar siempre en crudo. Hervir toda la semana y porcionar (dura hasta 4 días en heladera)." },
      { key: "caballa", name: "Caballa al natural (lata)", portionLabel: "65 g escurrida", kcal: 120, proteinG: 13, carbsG: 0, fatG: 8, note: "EPA+DHA ~1.0 g. Cubre el mínimo diario de omega-3. Al natural, no en aceite." },
      { key: "arroz", name: "Arroz blanco (crudo)", portionLabel: "100 g", kcal: 360, proteinG: 7, carbsG: 79, fatG: 1, note: "Alternativa equivalente: 90 g de fideo seco." },
      { key: "verdurasCocidas", name: "Verduras cocidas (brócoli, zapallo, chaucha)", portionLabel: "200 g", kcal: 70, proteinG: 4, carbsG: 13, fatG: 0, note: "Cocidas al vapor. Fibra insoluble, hierro, folatos. Variar semanalmente." },
    ];
    const foodIdByKey = {};
    for (const f of foodDefs) {
      const { key, ...rest } = f;
      foodIdByKey[key] = await Repo.addFood(rest);
    }

    const desayunoId = await Repo.addMeal("Desayuno", "8:00–10:00 hs");
    for (const [key, qty] of [["avena", 1], ["leche", 1], ["proteina", 1], ["huevos", 1], ["aceite", 1], ["verdurasCrudas", 1]]) {
      await Repo.addMealItem(desayunoId, foodIdByKey[key], qty);
    }

    const comida2Id = await Repo.addMeal("Comida 2 — Tarde/Noche", "15:00–19:00 hs");
    for (const [key, qty] of [["pollo", 1], ["caballa", 1], ["arroz", 1], ["aceite", 2], ["verdurasCocidas", 1]]) {
      await Repo.addMealItem(comida2Id, foodIdByKey[key], qty);
    }
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
