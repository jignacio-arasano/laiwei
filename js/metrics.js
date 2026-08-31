// Funciones puras de cálculo — port 1:1 de calc/Metrics.kt del proyecto Android.
// Nada de esto toca la base de datos ni la UI.

const COUNTS_AS_WORK = new Set(["NORMAL", "AMRAP", "DROP", "MYOREP", "BACKOFF"]);

const SET_TYPES = [
  { value: "APPROACH", label: "Aproximación" },
  { value: "WARMUP", label: "Entrada en calor" },
  { value: "PAP", label: "PAP" },
  { value: "NORMAL", label: "Normal" },
  { value: "AMRAP", label: "AMRAP" },
  { value: "DROP", label: "Drop set" },
  { value: "MYOREP", label: "Myo-rep" },
  { value: "BACKOFF", label: "Backoff" },
];

function setTypeLabel(value) {
  return (SET_TYPES.find((t) => t.value === value) || {}).label || value;
}

const Metrics = {
  /** 1RM estimado con la fórmula de Epley. Solo tiene sentido para series de trabajo real. */
  estimatedOneRepMax(weightKg, reps) {
    if (reps <= 0) return 0;
    if (reps === 1) return weightKg;
    return weightKg * (1 + reps / 30);
  },

  /** Filtra las series que cuentan como trabajo real (excluye aproximación y warm-up). */
  workingSets(sets) {
    return sets.filter((s) => COUNTS_AS_WORK.has(s.setType));
  },

  /**
   * Piso de un ejercicio: mínimo e1RM entre las series de trabajo de las últimas
   * windowSessions fechas distintas, con un margen de seguridad hacia abajo.
   * setsWithDate: [{ set, date }] donde date es "YYYY-MM-DD".
   * Devuelve null si no hay suficiente historial todavía.
   */
  floor(setsWithDate, windowSessions = 4, marginPct = 0.08) {
    const working = setsWithDate.filter((sd) => COUNTS_AS_WORK.has(sd.set.setType));
    if (working.length === 0) return null;

    const recentDates = [...new Set(working.map((sd) => sd.date))]
      .sort()
      .reverse()
      .slice(0, windowSessions);
    const recentSet = new Set(recentDates);
    const relevant = working.filter((sd) => recentSet.has(sd.date));
    if (relevant.length === 0) return null;

    const minE1rm = Math.min(
      ...relevant.map((sd) => Metrics.estimatedOneRepMax(sd.set.weightKg, sd.set.reps))
    );
    return minE1rm * (1 - marginPct);
  },

  /** SIN_DATOS | POR_ENCIMA_DEL_PISO | BAJO_EL_PISO */
  statusAgainstFloor(todaysWorkingSets, floorValue) {
    if (floorValue == null || todaysWorkingSets.length === 0) return "SIN_DATOS";
    const bestToday = Math.max(
      ...todaysWorkingSets.map((s) => Metrics.estimatedOneRepMax(s.weightKg, s.reps))
    );
    return bestToday >= floorValue ? "POR_ENCIMA_DEL_PISO" : "BAJO_EL_PISO";
  },

  /** Volumen semanal (series de trabajo) por grupo muscular. */
  weeklySetsByMuscleGroup(setsInWeek, muscleGroupByExerciseId) {
    const working = Metrics.workingSets(setsInWeek);
    const out = {};
    for (const s of working) {
      const group = muscleGroupByExerciseId[s.exerciseId] || "Sin clasificar";
      out[group] = (out[group] || 0) + 1;
    }
    return out;
  },

  /** BAJO_MEV | EN_MEV_MAV | EN_MAV_MRV | SOBRE_MRV */
  volumeZone(setCount, mev, mav, mrv) {
    if (setCount < mev) return "BAJO_MEV";
    if (setCount <= mav) return "EN_MEV_MAV";
    if (setCount <= mrv) return "EN_MAV_MRV";
    return "SOBRE_MRV";
  },

  /**
   * Flag de fatiga: true si las últimas lookbackSessions sesiones (más reciente primero)
   * dieron, cada una, un e1RM por debajo del piso calculado SOLO con lo anterior a esa sesión
   * (para no hacer trampa mirando hacia adelante). Si no hay suficiente historial previo,
   * devuelve false en vez de asumir fatiga.
   */
  isInFatigue(setsWithDate, windowSessions = 4, marginPct = 0.08, lookbackSessions = 2) {
    const working = setsWithDate.filter((sd) => COUNTS_AS_WORK.has(sd.set.setType));
    const dates = [...new Set(working.map((sd) => sd.date))].sort().reverse();
    if (dates.length <= lookbackSessions) return false;

    return dates.slice(0, lookbackSessions).every((date) => {
      const before = working.filter((sd) => sd.date < date);
      const floorBefore = Metrics.floor(before, windowSessions, marginPct);
      if (floorBefore == null) return false;
      const thatDay = working.filter((sd) => sd.date === date);
      const bestThatDay = Math.max(
        ...thatDay.map((sd) => Metrics.estimatedOneRepMax(sd.set.weightKg, sd.set.reps))
      );
      return bestThatDay < floorBefore;
    });
  },

  /**
   * Flag de calibración: compara el RIR/RPE que reportaste en una serie de trabajo contra
   * el objetivo planificado en la rutina para esa serie. Si cualquiera de los dos se desvía
   * threshold puntos o más, es señal de mala calibración o de fatiga puntual ese día.
   */
  calibrationMismatch(reportedRir, targetRir, reportedRpe, targetRpe, threshold = 2) {
    const rirOff =
      reportedRir != null && targetRir != null && Math.abs(reportedRir - targetRir) >= threshold;
    const rpeOff =
      reportedRpe != null && targetRpe != null && Math.abs(reportedRpe - targetRpe) >= threshold;
    return rirOff || rpeOff;
  },

  // -----------------------------------------------------------------------
  // Dieta — funciones puras de macros (nada de esto toca la DB ni la UI).
  // -----------------------------------------------------------------------

  /** Suma de kcal/macros de una lista de { food, quantity } donde quantity es un
   *  múltiplo de la porción base del alimento (ej: quantity=2 = el doble de esa porción). */
  mealTotals(items) {
    return items.reduce(
      (acc, it) => {
        const q = Number(it.quantity) || 0;
        return {
          kcal: acc.kcal + it.food.kcal * q,
          proteinG: acc.proteinG + it.food.proteinG * q,
          carbsG: acc.carbsG + it.food.carbsG * q,
          fatG: acc.fatG + it.food.fatG * q,
        };
      },
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
    );
  },

  /** BMR por Harris-Benedict (fórmula original de 1919), la misma que usa el plan en PDF. */
  harrisBenedictBmr(weightKg, heightCm, age, gender) {
    if (gender === "F") {
      return 655.1 + 9.563 * weightKg + 1.85 * heightCm - 4.676 * age;
    }
    return 66.5 + 13.75 * weightKg + 5.003 * heightCm - 6.75 * age;
  },

  /** TDEE = BMR x factor de actividad (ej. 1.6 = entrenamiento de fuerza + deporte de contacto). */
  tdee(bmr, activityFactor) {
    return bmr * activityFactor;
  },

  /**
   * Objetivos diarios sugeridos a partir del perfil: calorías = TDEE + ajuste (negativo en
   * déficit), proteína = g/kg x peso, grasas = valor fijo en gramos (igual que el plan en PDF,
   * que no la expresa como %), carbohidratos = resto calórico repartido en el remanente.
   * Es solo una SUGERENCIA — el usuario puede pisar cualquiera de estos valores a mano.
   */
  suggestedMacros(profile) {
    const bmr = Metrics.harrisBenedictBmr(profile.weightKg, profile.heightCm, profile.age, profile.gender);
    const tdeeVal = Metrics.tdee(bmr, profile.activityFactor);
    const targetKcal = Math.round(tdeeVal + (profile.kcalAdjustment || 0));
    const proteinG = Math.round(profile.proteinPerKg * profile.weightKg);
    const fatG = Math.round(profile.targetFatG || 0);
    const carbsKcal = Math.max(0, targetKcal - proteinG * 4 - fatG * 9);
    const carbsG = Math.round(carbsKcal / 4);
    return { bmr: Math.round(bmr), tdee: Math.round(tdeeVal), targetKcal, proteinG, carbsG, fatG };
  },
};
