// The six supplied GPX files are bundled unchanged; their numbers are the survey days.
export const SURVEY_DAYS = Array.from({ length: 6 }, (_, i) => ({
  number: i + 1,
  file: `data/routes/day_${String(i + 1).padStart(2, '0')}_nav.gpx`,
}));

export async function loadSurveyDay(number) {
  const entry = SURVEY_DAYS.find((day) => day.number === number);
  if (!entry) throw new Error('unknown-day');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(entry.file, { signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}
