/*\
title: $:/plugins/rimir/work-focus/test/test-live.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the debounced live filter (live-filter.js, live-widget.js).

\*/
"use strict";

var live = require("$:/plugins/rimir/work-focus/live-filter.js");
var Widget = require("$:/core/modules/widgets/widget.js").widget;

describe("work-focus live filter", function() {

	var wiki = $tw.wiki, added, widget;

	function put(fields) {
		added.push(fields.title);
		wiki.addTiddler(new $tw.Tiddler(fields));
	}

	beforeEach(function() {
		added = [];
		widget = new Widget({}, {wiki: wiki, parentWidget: $tw.rootWidget, document: $tw.fakeDocument});
		for(var i = 1; i <= 5; i++) {
			put({title: "LT" + i, tags: "LT"});
		}
		put({title: "T1", due: "20260101"});
		put({title: "T2"});
	});

	afterEach(function() {
		added.forEach(function(title) { wiki.deleteTiddler(title); });
	});

	it("counts and lists the first titles", function() {
		var r = live.evaluate(wiki, "[tag[LT]sort[]]", widget, "", 3);
		expect(r.count).toBe(5);
		expect(r.titles).toEqual(["LT1", "LT2", "LT3"]);
		expect(r.error).toBe("");
	});

	it("runs with the source as input", function() {
		expect(live.evaluate(wiki, "[has[due]]", widget, "T1").count).toBe(1);
		expect(live.evaluate(wiki, "[has[due]]", widget, "T2").count).toBe(0);
	});

	it("is empty for a blank filter", function() {
		expect(live.evaluate(wiki, "  ", widget, "T1")).toEqual({count: 0, titles: [], error: ""});
	});

	it("shows the error of a broken filter", function() {
		var r = live.evaluate(wiki, "[tag[unclosed", widget, "", 3);
		expect(r.count).toBe(0);
		expect(r.titles).toEqual([]);
		expect(r.error).toMatch(/Filter error/i);
	});

	describe("widget", function() {
		var host, wrapper, calls, original, now, pendingTimers, savedTimers;

		function render(text) {
			put({title: "LS", text: text});
			wrapper = wiki.makeTranscludeWidget("LS", {document: $tw.fakeDocument, parseAsInline: false});
			host = $tw.fakeDocument.createElement("div");
			wrapper.render(host, null);
		}
		function tick(ms) {
			now += ms;
			var due = pendingTimers.filter(function(t) { return t.at <= now; });
			pendingTimers = pendingTimers.filter(function(t) { return t.at > now; });
			due.forEach(function(t) { t.fn(); });
		}
		function html() { return host.innerHTML; }
		function change(filter) {
			var changed = {};
			put({title: "LF", text: filter});
			changed.LF = {modified: true};
			wrapper.refresh(changed);
		}

		beforeEach(function() {
			// manual clock: module code runs in TW's sandbox, jasmine.clock() can't reach its setTimeout
			now = 0;
			pendingTimers = [];
			savedTimers = live.timers;
			live.timers = {
				set: function(fn, ms) { pendingTimers.push({fn: fn, at: now + ms}); return pendingTimers[pendingTimers.length - 1]; },
				clear: function(t) { pendingTimers = pendingTimers.filter(function(x) { return x !== t; }); }
			};
			calls = 0;
			original = live.evaluate;
			spyOn(live, "evaluate").and.callFake(function() {
				calls++;
				return original.apply(live, arguments);
			});
			put({title: "LF", text: "[tag[LT]]"});
		});
		afterEach(function() {
			if(wrapper) { wrapper.destroy(); }
			live.timers = savedTimers;
		});

		it("waits for a pause", function() {
			render("<$wf-live filter={{LF}} delay=\"300\">n=<<live-count>> p=<<live-pending>></$wf-live>");
			expect(calls).toBe(1);
			expect(html()).toContain("n=5 p=no");
			change("[tag[LT]limit[2]]");
			tick(100);
			change("[tag[LT]limit[3]]");
			tick(100);
			change("[tag[LT]limit[4]]");
			expect(calls).toBe(1);
			expect(html()).toContain("p=yes");
			expect(html()).toContain("n=5");
			tick(300);
			expect(calls).toBe(2);
			expect(html()).toContain("n=4 p=no");
		});

		it("does not re-run on other wiki changes", function() {
			render("<$wf-live filter={{LF}}>n=<<live-count>></$wf-live>");
			expect(calls).toBe(1);
			put({title: "Unrelated", text: "x"});
			wrapper.refresh({Unrelated: {modified: true}});
			tick(1000);
			expect(calls).toBe(1);
		});

		it("sees the variables of the widget and exposes titles and error", function() {
			render("<$let area=\"LT\"><$wf-live filter=\"[tag<area>sort[]]\" limit=\"2\"><<live-titles>></$wf-live></$let>");
			expect(html()).toContain("LT1 LT2");
			wrapper.destroy();
			render("<$wf-live filter=\"[tag[unclosed\">e=<<live-error>></$wf-live>");
			expect(html()).toMatch(/e=Filter error/i);
		});
	});
});
