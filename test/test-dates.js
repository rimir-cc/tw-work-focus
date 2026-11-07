/*\
title: $:/plugins/rimir/work-focus/test/test-dates.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for dates.js and the wf-date / wf-days filter operators.

\*/
"use strict";

var dates = require("$:/plugins/rimir/work-focus/dates.js");

describe("work-focus dates", function() {

	var now = new Date(2026, 10, 6, 10, 0); // Friday (2026-11-06)

	function ymd(d) {
		return d ? d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() : null;
	}

	describe("resolve", function() {
		it("resolves expressions to local midnight", function() {
			expect(ymd(dates.resolve("today", now))).toBe("2026-11-6");
			expect(ymd(dates.resolve("+2d", now))).toBe("2026-11-8");
			expect(ymd(dates.resolve("-1d", now))).toBe("2026-11-5");
			expect(ymd(dates.resolve("+1w", now))).toBe("2026-11-13");
			expect(ymd(dates.resolve("20261224", now))).toBe("2026-12-24");
			expect(dates.resolve("today", now).getHours()).toBe(0);
		});
		it("weekday names mean the next such day, never today", function() {
			expect(ymd(dates.resolve("fri", now))).toBe("2026-11-13");
			expect(ymd(dates.resolve("thu", now))).toBe("2026-11-12");
			expect(ymd(dates.resolve("mon", now))).toBe("2026-11-9");
		});
		it("returns null for anything else", function() {
			expect(dates.resolve("soon", now)).toBeNull();
			expect(dates.resolve("", now)).toBeNull();
		});
	});

	describe("format", function() {
		var d = new Date(2026, 10, 9);
		it("follows the sample", function() {
			expect(dates.format(d, "20260801", $tw.wiki)).toBe("20261109");
			expect(dates.format(d, "", $tw.wiki)).toBe("20261109");
			var s = dates.format(d, "20260801120000000", $tw.wiki);
			expect(s).toMatch(/^\d{17}$/);
			expect(ymd($tw.utils.parseDate(s))).toBe("2026-11-9");
			expect($tw.utils.parseDate(s).getHours()).toBe(0);
		});
	});

	describe("daysFrom", function() {
		it("counts whole days from local today", function() {
			expect(dates.daysFrom("20261105", now)).toBe(-1);
			expect(dates.daysFrom("20261106", now)).toBe(0);
			expect(dates.daysFrom("20261115", now)).toBe(9);
		});
		it("reads TW dates as UTC instants", function() {
			expect(dates.daysFrom(dates.format(new Date(2026, 10, 9), "20260801000000000", $tw.wiki), now)).toBe(3);
		});
		it("returns null for unparsable values", function() {
			expect(dates.daysFrom("x", now)).toBeNull();
			expect(dates.daysFrom("", now)).toBeNull();
		});
	});

	describe("operators", function() {
		it("wf-days drops unparsable input", function() {
			var now2 = new Date(),
				y = dates.format(dates.resolve("-1d", now2), "20260101", $tw.wiki);
			expect($tw.wiki.filterTiddlers("[[" + y + "]] [[x]] +[wf-days[]]")).toEqual(["-1"]);
		});
		it("wf-date gives today's date", function() {
			expect($tw.wiki.filterTiddlers("[wf-date[+0d]]")).toEqual([dates.format(new Date(), "20260101", $tw.wiki)]);
		});
		it("wf-date is empty for unknown expressions", function() {
			expect($tw.wiki.filterTiddlers("[wf-date[soon]]")).toEqual([]);
		});
		it("wf-date follows the sample", function() {
			expect($tw.wiki.filterTiddlers("[wf-date[+0d],[20260101120000000]]")[0]).toMatch(/^\d{17}$/);
		});
	});
});
