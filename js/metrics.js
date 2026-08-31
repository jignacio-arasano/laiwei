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

  // -----------------------------------------------------------------------
  // Estancamiento — cruza entrenamiento (volumen/fatiga) con dieta (peso,
  // déficit, proteína) para sugerir la causa más probable, siguiendo el
  // marco de Chris Beardsley: un plateau real puede venir de fatiga
  // acumulada (exceso de volumen), de un déficit calórico demasiado
  // agresivo/sostenido, de proteína insuficiente (~1.6 g/kg es el piso
  // razonable para retener masa magra en déficit), o de un estímulo de
  // entrenamiento que ya no supera el umbral necesario para seguir
  // progresando ("inadequate stimulus").
  // -----------------------------------------------------------------------

  /** Media móvil centrada de windowSize puntos (no depende de que los días sean regulares). */
  _movingAveragePoints(points, windowSize = 3) {
    const half = Math.floor(windowSize / 2);
    return points.map((p, i) => {
      const start = Math.max(0, i - half);
      const end = Math.min(points.length, i + half + 1);
      const slice = points.slice(start, end);
      const avgY = slice.reduce((a, q) => a + q.y, 0) / slice.length;
      return { x: p.x, y: avgY };
    });
  },

  /**
   * Tendencia de peso corporal en kg/semana a partir de bodyWeightLogs
   * (se acepta en cualquier orden). Negativo = está bajando de peso.
   * Regresión lineal simple sobre día vs. peso; devuelve null si hay
   * menos de 2 registros o si todavía no cubren minSpanDays.
   *
   * Si el registro es denso (poca separación promedio entre pesadas — típico
   * de pesarse casi todos los días), se aplica antes una media móvil de 3
   * puntos para amortiguar la variabilidad hídrica día a día (agua, sodio,
   * digestión) sin comprometer la sensibilidad de la regresión a la
   * tendencia real. Con registros espaciados (ej. 1 vez por semana) no hay
   * ruido de corto plazo que suavizar, así que se usan los puntos crudos.
   */
  weightTrendKgPerWeek(logs, minSpanDays = 10) {
    if (!logs || logs.length < 2) return null;
    const sorted = logs.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const t0 = new Date(sorted[0].date).getTime();
    const rawPoints = sorted.map((l) => ({
      x: (new Date(l.date).getTime() - t0) / 86400000,
      y: l.weightKg,
    }));
    const spanDays = rawPoints[rawPoints.length - 1].x;
    if (spanDays < minSpanDays) return null;

    const n = rawPoints.length;
    const avgGapDays = spanDays / (n - 1);
    const points =
      avgGapDays <= 2.5 && n >= 5 ? Metrics._movingAveragePoints(rawPoints, 3) : rawPoints;

    const sumX = points.reduce((a, p) => a + p.x, 0);
    const sumY = points.reduce((a, p) => a + p.y, 0);
    const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
    const sumXX = points.reduce((a, p) => a + p.x * p.x, 0);
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return null;
    const slopePerDay = (n * sumXY - sumX * sumY) / denom;
    return slopePerDay * 7;
  },

  /**
   * Diagnóstico de estancamiento. Recibe:
   * - volumeRows: [{ muscleGroup, setCount, target, zone, fatiguedExerciseCount }]
   *   (mismo shape que arma la pantalla Volumen)
   * - weightTrendKgPerWeek: número o null (ver función de arriba)
   * - bodyWeightKg: peso actual de referencia, o null
   * - profile: dietProfile (kcalAdjustment, proteinPerKg, ...) o null
   * - weightLogsCount: cantidad de registros de peso cargados
   * - fatigueSignals: { totalFatigued, totalEligible, ratio, crossFatigueByGroup } o null
   *   (ver Repo.systemicFatigueSignals en db.js) — fatiga transversal/global y fatiga
   *   atribuida a músculos SECUNDARIOS de ejercicios fatigados (ej. peso muerto fatigado
   *   también carga la zona lumbar/isquios como secundario).
   * Devuelve { causes: [...], verdict, deficitPctPerWeek, hasTrainingData, hasWeightData }
   * ordenado por severidad (alta > media > baja). No toca DB ni UI.
   */
  plateauDiagnosis({ volumeRows, weightTrendKgPerWeek, bodyWeightKg, profile, weightLogsCount, fatigueSignals }) {
    const rows = volumeRows || [];
    const hasTrainingData = rows.length > 0;
    const causes = [];

    const overMrvFatigued = rows.filter((r) => r.zone === "SOBRE_MRV" && r.fatiguedExerciseCount > 0);
    if (overMrvFatigued.length > 0) {
      causes.push({
        type: "EXCESO_VOLUMEN",
        severity: "alta",
        title: "Volumen excesivo",
        detail: `${overMrvFatigued.map((r) => r.muscleGroup).join(", ")} está(n) por encima del MRV y con ejercicios en fatiga. El volumen extra puede estar generando más fatiga/inflamación de la que recuperás entre sesiones, tapando el progreso real. Probá un deload esta semana en esos grupos.`,
      });
    }

    const totalFatigued = rows.reduce((a, r) => a + r.fatiguedExerciseCount, 0);
    const anyOverMrv = rows.some((r) => r.zone === "SOBRE_MRV");
    if (totalFatigued > 0 && !anyOverMrv) {
      causes.push({
        type: "FATIGA_SIN_EXCESO_VOLUMEN",
        severity: "media",
        title: "Fatiga sin exceso de volumen",
        detail: "Hay ejercicios rindiendo por debajo de su piso reciente, pero el volumen semanal no está pasado de rosca. Apunta más a un problema de recuperación externo al entrenamiento en sí — revisá sueño y estrés, y sobre todo las señales de dieta de abajo.",
      });
    }

    // Fatiga sistémica global: proporción de ejercicios con historial suficiente que
    // vienen rindiendo por debajo de su piso, sin importar el grupo muscular. Cuando es
    // alta, la causa raíz suele ser transversal (sueño, estrés, déficit) más que un grupo
    // puntual pasado de volumen.
    if (fatigueSignals && fatigueSignals.totalEligible >= 3 && fatigueSignals.ratio != null && fatigueSignals.ratio >= 0.3) {
      const pct = Math.round(fatigueSignals.ratio * 100);
      causes.push({
        type: "FATIGA_SISTEMICA_GLOBAL",
        severity: fatigueSignals.ratio >= 0.5 ? "alta" : "media",
        title: "Fatiga sistémica transversal",
        detail: `${pct}% de tus ejercicios con historial suficiente (${fatigueSignals.totalFatigued}/${fatigueSignals.totalEligible}) vienen rindiendo por debajo de su piso reciente, repartido entre varios grupos musculares. Esto apunta a fatiga acumulada a nivel general (sistema nervioso, sueño, estrés, déficit) más que a un solo grupo con exceso de volumen — considerá un deload global de toda la semana, no solo puntual.`,
      });
    }

    // Fatiga cruzada por músculos secundarios: ejercicios en fatiga cuyo movimiento
    // también carga, de forma secundaria, a otro grupo muscular — ese grupo puede estar
    // rindiendo mal por una razón que no aparece mirándolo de forma aislada.
    if (fatigueSignals && fatigueSignals.crossFatigueByGroup) {
      const crossGroups = Object.entries(fatigueSignals.crossFatigueByGroup).filter(([, count]) => count >= 2);
      if (crossGroups.length > 0) {
        causes.push({
          type: "FATIGA_CRUZADA_SECUNDARIA",
          severity: "media",
          title: "Fatiga cruzada vía músculos secundarios",
          detail: `${crossGroups.map(([g, c]) => `${g} (${c})`).join(", ")} está(n) recibiendo fatiga indirecta de ejercicios fatigados que los trabajan como músculo secundario (ej. peso muerto fatigado → lumbares/isquios). Si ese grupo también viene estancado, puede no ser un problema propio sino un arrastre de la fatiga de otro ejercicio.`,
        });
      }
    }

    let deficitPctPerWeek = null;
    if (weightTrendKgPerWeek != null && bodyWeightKg) {
      deficitPctPerWeek = (-weightTrendKgPerWeek / bodyWeightKg) * 100;
    }

    if (deficitPctPerWeek != null && deficitPctPerWeek >= 1.0) {
      causes.push({
        type: "DEFICIT_AGRESIVO",
        severity: deficitPctPerWeek >= 1.5 ? "alta" : "media",
        title: "Ritmo de pérdida de peso alto",
        detail: `Venís bajando ~${deficitPctPerWeek.toFixed(2)}%/semana de tu peso corporal (el objetivo del plan es ~0.5%/semana). Un déficit sostenido más agresivo que eso golpea la capacidad de adaptación al entrenamiento — considerá subir un poco las calorías o meter una semana de mantenimiento.`,
      });
    }

    // Ajuste dinámico de TDEE: compara el cambio de peso TEÓRICO que implica el
    // kcalAdjustment del perfil (vía la conversión ~7700 kcal ≈ 1kg de grasa) contra el
    // cambio REAL medido en la tendencia de peso. Cuando hay una brecha sostenida, el TDEE
    // real es distinto al calculado (BMR/Harris-Benedict + factor de actividad son
    // estimaciones) — se sugiere un ajuste concreto en kcal/día en vez de solo señalar
    // "meseta".
    if (
      profile &&
      (profile.kcalAdjustment || 0) !== 0 &&
      weightTrendKgPerWeek != null &&
      (weightLogsCount || 0) >= 4
    ) {
      const expectedWeeklyChangeKg = (profile.kcalAdjustment * 7) / 7700;
      const gapKgPerWeek = expectedWeeklyChangeKg - weightTrendKgPerWeek;
      if (Math.abs(gapKgPerWeek) >= 0.1) {
        const kcalPerDayAdjust = Math.round((gapKgPerWeek * 7700) / 7);
        const suggestedKcalAdjustment = Math.round(profile.kcalAdjustment - kcalPerDayAdjust);
        const detail =
          gapKgPerWeek > 0
            ? `Tu plan actual (${Math.round(profile.kcalAdjustment)} kcal/día de ajuste) implica bajar ~${Math.abs(expectedWeeklyChangeKg).toFixed(2)}kg/semana, pero tus registros muestran ~${Math.abs(weightTrendKgPerWeek).toFixed(2)}kg/semana real — estás perdiendo más despacio de lo esperado. Tu gasto real (TDEE) parece ser más alto que el calculado. Para alinear el ritmo, bajá el ajuste calórico a ~${suggestedKcalAdjustment} kcal/día (unas ${Math.abs(kcalPerDayAdjust)} kcal menos por día).`
            : `Tu plan actual (${Math.round(profile.kcalAdjustment)} kcal/día de ajuste) implica un cambio de ~${expectedWeeklyChangeKg.toFixed(2)}kg/semana, pero tus registros muestran ~${weightTrendKgPerWeek.toFixed(2)}kg/semana real — te estás moviendo más rápido de lo planeado. Tu gasto real (TDEE) parece ser distinto al calculado. Para alinear el ritmo, subí el ajuste calórico a ~${suggestedKcalAdjustment} kcal/día (unas ${Math.abs(kcalPerDayAdjust)} kcal más por día).`;
        causes.push({
          type: "AJUSTE_TDEE",
          severity: Math.abs(gapKgPerWeek) >= 0.25 ? "alta" : "media",
          title: "El ritmo real no coincide con el calculado — ajustar TDEE",
          detail,
        });
      }
    }

    if (profile && profile.proteinPerKg != null && profile.proteinPerKg < 1.6) {
      causes.push({
        type: "PROTEINA_BAJA",
        severity: "alta",
        title: "Proteína por debajo del umbral",
        detail: `Tu objetivo actual es ${profile.proteinPerKg} g/kg. Por debajo de ~1.6 g/kg, en déficit, la retención de masa muscular se resiente y el estancamiento se vuelve más probable. Subí la proteína objetivo en "Perfil".`,
      });
    }

    const noneAtOrAboveMav =
      hasTrainingData && rows.every((r) => r.zone === "BAJO_MEV" || r.zone === "EN_MEV_MAV" || r.zone == null);
    if (causes.length === 0 && hasTrainingData && noneAtOrAboveMav) {
      causes.push({
        type: "ESTIMULO_INSUFICIENTE",
        severity: "media",
        title: "Estímulo de entrenamiento posiblemente insuficiente",
        detail: "No hay señales de fatiga ni de exceso de volumen, y varios grupos están corriendo cerca o por debajo del MEV. Si venís estancado en fuerza, el volumen/esfuerzo actual puede ya no superar el umbral necesario para seguir progresando — probá acercarte más al MAV en esos grupos.",
      });
    }

    let verdict;
    if (!hasTrainingData) {
      verdict = "Todavía no hay suficientes series cargadas esta semana para un diagnóstico.";
    } else if (causes.length === 0) {
      verdict = "No se detectan señales claras de estancamiento en los datos actuales — volumen, fatiga y dieta están dentro de rango.";
    } else if (causes.length === 1) {
      verdict = "Se detectó una causa probable de estancamiento:";
    } else {
      verdict = "Se detectaron varias causas probables de estancamiento (ordenadas por relevancia):";
    }

    const order = { alta: 0, media: 1, baja: 2 };
    causes.sort((a, b) => order[a.severity] - order[b.severity]);

    return {
      causes,
      verdict,
      deficitPctPerWeek,
      hasTrainingData,
      hasWeightData: (weightLogsCount || 0) >= 2,
    };
  },
};
