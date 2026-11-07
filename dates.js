/*\
title: $:/plugins/rimir/work-focus/dates.js
type: application/javascript
module-type: library

Date helpers for work-focus: date expressions, formatting, day differences.
All dates are local calendar days; TW 14/17-digit values are UTC instants.

\*/
"use strict";

var DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
var CONFIG_FORMAT = "$:/config/rimir/work-focus/date-format";
var DEFAULT_FORMAT = "YYYY0MM0DD";
var TW_FORMAT = "[UTC]YYYY0MM0DD0hh0mm0ss0XXX";

function midnight(date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, n) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function pad(n, len) {
	var s = String(n);
	while(s.length < len) { s = "0" + s; }
	return s;
}

// Local calendar day of a value: Date (local midnight) or null.
function dayOf(value) {
	var v = String(value === undefined || value === null ? "" : value).trim(), d;
	if(/^\d{8}$/.test(v)) {
		d = new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8));
		// reject overflowed dates such as 20261340
		if(d.getFullYear() !== +v.slice(0, 4) || d.getMonth() !== +v.slice(4, 6) - 1 || d.getDate() !== +v.slice(6, 8)) {
			return null;
		}
		return d;
	}
	if(/^(\d{14}|\d{17})$/.test(v)) {
		d = $tw.utils.parseDate(v);
		return d && !isNaN(d.getTime()) ? midnight(d) : null;
	}
	return null;
}

// expr: today | +Nd | -Nd | +Nw | mon..sun (next such day, never today) | YYYYMMDD
exports.resolve = function(expr, now) {
	var e = String(expr === undefined || expr === null ? "" : expr).trim().toLowerCase(), m, today = midnight(now), delta;
	if(e === "today") {
		return today;
	}
	m = /^([+-])(\d+)([dw])$/.exec(e);
	if(m) {
		return addDays(today, (m[1] === "-" ? -1 : 1) * (+m[2]) * (m[3] === "w" ? 7 : 1));
	}
	m = DAYS.indexOf(e);
	if(m >= 0) {
		delta = (m - today.getDay() + 7) % 7;
		return addDays(today, delta === 0 ? 7 : delta);
	}
	if(/^\d{8}$/.test(e)) {
		return dayOf(e);
	}
	return null;
};

// Format date in the shape of sample (8 digits: YYYYMMDD; 14/17 digits: TW date; else config format).
exports.format = function(date, sample, wiki) {
	var s = String(sample === undefined || sample === null ? "" : sample).trim(), fmt;
	if(/^\d{8}$/.test(s)) {
		return pad(date.getFullYear(), 4) + pad(date.getMonth() + 1, 2) + pad(date.getDate(), 2);
	}
	if(/^(\d{14}|\d{17})$/.test(s)) {
		return $tw.utils.formatDateString(date, TW_FORMAT);
	}
	fmt = ((wiki || $tw.wiki).getTiddlerText(CONFIG_FORMAT) || "").trim() || DEFAULT_FORMAT;
	return $tw.utils.formatDateString(date, fmt);
};

// Whole days from local today to the value's calendar day; null if unparsable.
exports.daysFrom = function(value, now) {
	var d = dayOf(value), t = midnight(now);
	if(!d) {
		return null;
	}
	return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
};
