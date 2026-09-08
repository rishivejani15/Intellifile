"use strict";

/**
 * Parse the unambiguous month-level date expressions used by IntelliFile
 * search.  Bounds are [from, to): the upper bound is always exclusive.
 *
 * This small, dependency-free parser is deliberately shared with the Electron
 * main process so deterministic metadata requests never become embedding
 * queries merely because the user prefixed them with "all files".
 */
const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
  april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
  august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

function startOfMonth(year, month) {
  return Math.floor(new Date(year, month, 1, 0, 0, 0, 0).getTime() / 1000);
}

function removeDateScaffolding(query) {
  return query
    .replace(/\b(all|files?|modified|created|dated|containing|with|about|on|in|during|of)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDeterministicMonthDateQuery(rawQuery) {
  const query = String(rawQuery || "");
  const monthPattern = Object.keys(MONTHS).join("|");
  const match = query.match(new RegExp(
    `\\b(before|after|during)\\s+(${monthPattern})\\s+(\\d{4})\\b`, "i"
  ));

  if (!match) return null;

  const operator = match[1].toLowerCase();
  const month = MONTHS[match[2].toLowerCase()];
  const year = Number.parseInt(match[3], 10);
  const start = startOfMonth(year, month);
  const next = startOfMonth(year, month + 1);
  const remainder = removeDateScaffolding(query.replace(match[0], " "));

  if (operator === "before") {
    return { cleanQuery: remainder, dateFrom: null, dateTo: start };
  }
  if (operator === "after") {
    return { cleanQuery: remainder, dateFrom: next, dateTo: null };
  }
  return { cleanQuery: remainder, dateFrom: start, dateTo: next };
}

module.exports = { parseDeterministicMonthDateQuery };
