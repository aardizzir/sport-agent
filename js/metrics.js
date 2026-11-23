// ANATA · Traductor de métricas para las pantallas (mismos rangos que el agente,
// ver docs/ANATA-PERSONAL.md → "Traductor de métricas").
// "Claridad antes que jerga": nombre simple arriba, nombre Garmin pequeño abajo.

const isNum = v => typeof v === 'number' && Number.isFinite(v);

export function hhmm(min) {
  if (!isNum(min)) return '—';
  return `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`;
}

function band(value, bands) {
  if (!isNum(value)) return null;
  return bands.find(b => value <= b.max) || bands[bands.length - 1];
}

// Diferencia frente a "tu normal", en palabras.
function vsNormal(value, normal, { unit = '', higherIsBetter = true, tolerance = 3, round = true } = {}) {
  if (!isNum(value) || !isNum(normal)) return null;
  const diff = round ? Math.round(value - normal) : value - normal;
  if (Math.abs(diff) <= tolerance) return 'en tu normal';
  const more = diff > 0;
  const n = Math.abs(diff);
  const word = more ? 'sobre' : 'bajo';
  return `${n}${unit} ${word} tu normal`;
}

export const METRICS = [
  {
    key: 'battery', col: 'body_battery_wake', name: 'Tu batería', garmin: 'Body Battery al despertar',
    format: v => (isNum(v) ? String(v) : '—'),
    bands: [{ max: 25, label: 'baja' }, { max: 50, label: 'media' }, { max: 75, label: 'alta' }, { max: 100, label: 'muy alta' }],
    line(v, normal) {
      const b = band(v, this.bands); if (!b) return 'Todavía no llega lo de anoche.';
      const cmp = vsNormal(v, normal, { tolerance: 5 });
      return `Energía ${b.label}${cmp ? ` · ${cmp}` : ''}.`;
    },
    what: 'Tu batería de energía. Se carga durmiendo y se gasta con esfuerzo y estrés.',
    ranges: '0–25 baja · 26–50 media · 51–75 alta · 76–100 muy alta',
    read: 'Mira con cuánto despertaste: es la energía que tienes para el día. Si despiertas bajo 25 varios días, tu cuerpo no está recuperando.',
  },
  {
    key: 'sleep', col: 'sleep_score', name: 'Tu sueño', garmin: 'Puntuación de sueño',
    format: v => (isNum(v) ? String(v) : '—'),
    bands: [{ max: 59, label: 'malo' }, { max: 79, label: 'regular' }, { max: 89, label: 'bueno' }, { max: 100, label: 'excelente' }],
    line(v, normal, row) {
      const b = band(v, this.bands); if (!b) return 'Todavía no llega lo de anoche.';
      const cmp = vsNormal(v, normal, { tolerance: 4 });
      return `Sueño ${b.label}, ${hhmm(row?.sleep_minutes)}${cmp ? ` · ${cmp}` : ''}.`;
    },
    what: 'Qué tan bien y cuánto dormiste anoche.',
    ranges: '90–100 excelente · 80–89 bueno · 60–79 regular · menos de 60 malo',
    read: 'El promedio de los usuarios de Garmin es 72 (regular) y solo el 7% promedia excelente. Una noche regular es normal, no una alarma.',
  },
  {
    key: 'stress', col: 'stress_avg', name: 'Tu estrés de ayer', garmin: 'Estrés promedio', useYesterday: true,
    format: v => (isNum(v) ? String(v) : '—'),
    bands: [{ max: 25, label: 'en reposo' }, { max: 50, label: 'bajo' }, { max: 75, label: 'medio' }, { max: 100, label: 'alto' }],
    line(v, normal) {
      const b = band(v, this.bands); if (!b) return 'Sin datos de ayer.';
      const cmp = vsNormal(v, normal, { tolerance: 4 });
      return `Cuerpo ${b.label === 'en reposo' ? 'en reposo' : `con estrés ${b.label}`}${cmp ? ` · ${cmp}` : ''}.`;
    },
    what: 'Qué tan acelerado está tu cuerpo cuando no te mueves.',
    ranges: '0–25 reposo · 26–50 bajo · 51–75 medio · 76–100 alto',
    read: 'Se mira el día completo, por eso te muestro el de ayer. Un día de estrés alto gasta batería aunque no entrenes.',
  },
  {
    key: 'rhr', col: 'resting_hr', name: 'Tu pulso en reposo', garmin: 'Frecuencia cardíaca en reposo',
    format: v => (isNum(v) ? String(v) : '—'), unit: 'lpm',
    line(v, normal) {
      if (!isNum(v)) return 'Sin datos de hoy.';
      if (!isNum(normal)) return 'Latidos por minuto, descansando.';
      const d = Math.round(v - normal);
      if (Math.abs(d) <= 2) return 'En tu normal: buena señal.';
      return d > 0 ? `${d} latidos sobre tu normal.` : `${-d} latidos bajo tu normal: buena señal.`;
    },
    what: 'Cuántas veces late tu corazón descansando. Si sube varios días seguidos, suele indicar cansancio.',
    ranges: 'Garmin no da rangos. ANATA lo compara con tu promedio de 7 días.',
    read: 'Si está 5 latidos o más sobre tu normal dos días seguidos, es señal de cansancio acumulado.',
  },
  {
    key: 'hrv', col: 'hrv_last_night_ms', name: 'Tu recuperación de fondo', garmin: 'Estado de VFC', calibKey: 'hrv_status',
    format: v => (isNum(v) ? String(v) : '—'), unit: 'ms',
    line(v, normal, row) {
      if (row?.hrv_status && row.hrv_status !== 'none') {
        const map = { balanced: 'Equilibrado: en tu rango normal.', unbalanced: 'Desequilibrado: fuera de tu rango.', low: 'Bajo: tu cuerpo se está recuperando menos.', poor: 'Pobre: prioriza recuperar.' };
        return map[row.hrv_status] || row.hrv_status;
      }
      return 'Todavía estoy aprendiendo tu normal.';
    },
    what: 'Si tu sistema nervioso se está recuperando bien. Garmin compara tu promedio de 7 días con tu propio rango normal. El número es la variabilidad de tu pulso durante la noche (VFC), en milisegundos.',
    ranges: 'Equilibrado · Desequilibrado · Bajo · Pobre. Necesita 3 semanas de noches con la banda.',
    read: 'Más que el número de una noche, importa la tendencia. Usa la banda todas las noches para que aparezca.',
  },
  {
    key: 'load', col: 'acute_load', name: 'Tu carga de la semana', garmin: 'Carga aguda · ratio de carga', calibKey: 'load_ratio',
    format: v => (isNum(v) ? String(v) : '—'),
    line(v, normal, row) {
      if (isNum(row?.load_ratio)) {
        const r = row.load_ratio;
        const txt = r < 0.8 ? 'Entrenaste menos de lo que tu cuerpo está acostumbrado.' : r <= 1.4 ? 'Carga en el rango óptimo.' : 'Subiste la carga más rápido de lo acostumbrado. Cuidado con la acumulación.';
        return `${txt} (ratio ${String(r).replace('.', ',')})`;
      }
      return isNum(v) ? 'Suma de tus entrenamientos de los últimos 7 días.' : 'Sin entrenamientos esta semana.';
    },
    what: 'Si esta semana entrenaste mucho más o mucho menos de lo que tu cuerpo está acostumbrado. ANATA lo calcula con la carga de cada entrenamiento que registra tu banda.',
    ranges: 'Ratio: menos de 0,8 bajo · 0,8–1,4 óptimo · 1,5–1,9 alto. Aparece tras 2 semanas.',
    read: 'Subir la carga de a poco es lo que te deja volver al rugby sin lesionarte.',
  },
];

// Métricas que la API no entrega (o todavía no existen): se muestran apagadas.
export const MUTED = [
  { name: 'Tu disposición para entrenar', garmin: 'Training Readiness', note: 'Garmin no la comparte por la API. Pronto podrás subirla con una captura.' },
  { name: 'Tu motor aeróbico', garmin: 'VO2 máx', note: 'Garmin todavía no lo calcula. Cambia en semanas: te lo mostraré como tendencia mensual.' },
];

// Insignia "calibrando": "Aprendiendo tu normal · día 3/21"
export function calibrationBadge(calibration, key) {
  const d = calibration?.details?.[key];
  if (!d) return null;
  if (key === 'hrv_status') return `Aprendiendo tu normal · noche ${d.day}/${d.of}`;
  if (key === 'load_ratio') return `Aprendiendo tu carga · día ${d.day}/${d.of}`;
  return `Aprendiendo tu normal · día ${d.day}/${d.of}`;
}

export const STATUS = {
  go: { label: 'Entrena', cls: 'st-go' },
  caution: { label: 'Ajusta', cls: 'st-caution' },
  stop: { label: 'Descansa', cls: 'st-stop' },
};
