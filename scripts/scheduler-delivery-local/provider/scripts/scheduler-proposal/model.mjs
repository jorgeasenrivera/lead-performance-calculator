export const addDays = (day, n) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();
export function nextWeek(today) {
  return addDays(today, 8 - (weekday(today) || 7));
}
export function reading(value) {
  if (value === "NA") return { state: "closed", units: null };
  if (value === null || value === undefined || value === "")
    return { state: "unknown", units: null };
  return Number.isInteger(value) && value >= 0
    ? { state: "known", units: value }
    : { state: "unknown", units: null };
}
export function ruleFor(rules, day) {
  return rules
    .filter((r) => r.effective <= day)
    .sort((a, b) => b.effective.localeCompare(a.effective))[0];
}
export function forecast(history, day) {
  const values = history
    .filter(
      (r) =>
        r.day < day && weekday(r.day) === weekday(day) && r.state === "known",
    )
    .slice(-8)
    .map((r) => r.units);
  if (values.length < 4) return null;
  return {
    low: Math.min(...values),
    high: Math.max(...values),
    reason: `Range of ${values.length} prior known ${["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][weekday(day)]}. Fictional illustration, not a calibrated forecast.`,
  };
}
export function propose(store, start, overrides = {}) {
  const used = Object.fromEntries(store.people.map((p) => [p.id, 0]));
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i),
      rule = ruleFor(store.rules, day),
      estimate = forecast(store.history, day);
    const state = !rule
      ? "unknown"
      : rule.holidays[day] ||
        (rule.closedDays.includes(weekday(day)) ? "closed" : "open");
    if (state !== "open")
      return {
        day,
        state,
        rule,
        estimate: null,
        ids: [],
        issues:
          state === "unknown"
            ? ["Store hours or holiday status unknown. Manager input needed."]
            : [],
        required: null,
      };
    const hours = rule.close - rule.open;
    if (
      !(hours > 0) ||
      !Number.isInteger(rule.minimum) ||
      rule.minimum < 1 ||
      (rule.useCapacity && !(rule.capacity > 0))
    )
      return {
        day,
        state: "unknown",
        rule,
        ids: [],
        issues: ["Enter valid store hours, minimum coverage and capacity."],
        required: null,
      };
    const required = Math.max(
      rule.minimum,
      rule.useCapacity && estimate
        ? Math.ceil(estimate.high / rule.capacity)
        : 0,
    );
    const eligible = store.people
      .filter(
        (p) =>
          !p.off.includes(weekday(day)) &&
          p.start <= rule.open &&
          p.end >= rule.close &&
          used[p.id] + hours <= p.maxHours,
      )
      .sort((a, b) => used[a.id] - used[b.id] || a.id.localeCompare(b.id));
    const ids = overrides[day] ?? eligible.slice(0, required).map((p) => p.id);
    const issues = [];
    for (const id of ids) {
      const p = store.people.find((p) => p.id === id);
      if (!p) {
        issues.push("Unknown person.");
        continue;
      }
      if (p.off.includes(weekday(day))) issues.push(`${p.name}: day off.`);
      if (p.start > rule.open || p.end < rule.close)
        issues.push(`${p.name}: does not cover store hours.`);
      used[id] += hours;
      if (used[id] > p.maxHours)
        issues.push(`${p.name}: weekly hours exceeded.`);
    }
    if (ids.length < required)
      issues.push(
        `${required - ids.length} more needed for entered coverage/capacity.`,
      );
    if (!estimate)
      issues.push(
        "Delivery history unknown or insufficient. Minimum coverage still applies.",
      );
    return {
      day,
      state,
      rule,
      estimate,
      required,
      ids,
      hours,
      issues,
      override: Object.hasOwn(overrides, day),
    };
  });
}
export function fixtures() {
  return ["Cedar", "Harbor", "Meadow", "Orchard", "Summit", "Willow"].map(
    (name, index) => {
      const history = [];
      for (
        let day = "2014-01-01", n = 0;
        day <= "2026-10-13";
        day = addDays(day, 1), n++
      ) {
        const value =
          n % 97 === 0
            ? null
            : weekday(day) === 0
              ? "NA"
              : (n * 7 + index * 3) % 15;
        history.push({ day, ...reading(value) });
      }
      return {
        id: `fictional-${index}`,
        name: `${name} Motors`,
        history,
        people: ["Alex", "Blair", "Casey", "Drew", "Ellis", "Frankie"].map(
          (name, i) => ({
            id: `p${i}`,
            name: `${name} ${index + 1}`,
            off: [0, (i % 5) + 1],
            start: 9,
            end: 17,
            maxHours: 40,
          }),
        ),
        rules: [
          {
            effective: "2026-01-01",
            open: 9,
            close: 17,
            minimum: 2,
            useCapacity: false,
            capacity: 6,
            closedDays: [0],
            holidays: { "2026-10-21": "unknown", "2026-10-23": "closed" },
          },
        ],
      };
    },
  );
}
