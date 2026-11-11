/*\
title: $:/plugins/rimir/work-focus/test/test-check.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for check.js and the <$action-wf-check> widget.

\*/
"use strict";

var check = require("$:/plugins/rimir/work-focus/check.js");

describe("work-focus check", function() {

	var now = new Date(2026, 10, 6, 10, 0); // Friday (2026-11-06)
	var wiki;

	function addArea(title, filter) {
		wiki.addTiddler({title: title, tags: check.AREA_TAG, "wf.filter": filter});
	}
	function item(title, k) {
		wiki.addTiddler({title: title, k: k});
	}
	function snapshot() {
		return JSON.parse(wiki.getTiddlerText(check.SNAPSHOT));
	}

	beforeEach(function() {
		wiki = new $tw.Wiki();
		addArea("A", "[field:k[a]]");
		addArea("B", "[field:k[a]] [field:k[b]]");
		addArea("C", "[field:k[c]]");
		wiki.addTiddler({title: check.AREA_TAG, list: "A B C"});
	});

	it("first match wins within a tab", function() {
		item("X", "a"); item("Y", "b");
		var s = check.compute(wiki, now);
		expect(s.areas.A).toEqual(["X"]);
		expect(s.areas.B).toEqual(["Y"]);
	});

	it("areas of different tabs both list a matching item", function() {
		wiki.addTiddler({title: "T1", tags: check.AREA_TAG, "wf.filter": "[field:k[a]]", "wf.tab": "Tasks"});
		wiki.addTiddler({title: "T2", tags: check.AREA_TAG, "wf.filter": "[field:k[a]]", "wf.tab": "Tasks"});
		wiki.addTiddler({title: "K1", tags: check.AREA_TAG, "wf.filter": "[field:k[a]]", "wf.tab": " Consistency "});
		wiki.addTiddler({title: check.AREA_TAG, list: "A B C T1 T2 K1"});
		item("X", "a");
		var s = check.compute(wiki, now);
		// General tab (A, B, C): first match A; Tasks: first match T1; Consistency: K1
		expect(s.areas.A).toEqual(["X"]);
		expect(s.areas.B).toEqual([]);
		expect(s.areas.T1).toEqual(["X"]);
		expect(s.areas.T2).toEqual([]);
		expect(s.areas.K1).toEqual(["X"]);
	});

	it("tag order sets the winner inside a tab only", function() {
		wiki.addTiddler({title: "T1", tags: check.AREA_TAG, "wf.filter": "[field:k[a]]", "wf.tab": "Tasks"});
		wiki.addTiddler({title: "T2", tags: check.AREA_TAG, "wf.filter": "[field:k[a]]", "wf.tab": "Tasks"});
		wiki.addTiddler({title: check.AREA_TAG, list: "T2 A T1 B C"});
		item("X", "a");
		var s = check.compute(wiki, now);
		expect(s.areas.T2).toEqual(["X"]);
		expect(s.areas.T1).toEqual([]);
		expect(s.areas.A).toEqual(["X"]);
	});

	function tabbed() {
		wiki.addTiddler({title: "T1", tags: check.AREA_TAG, "wf.filter": "[field:k[a]]", "wf.tab": "Tasks"});
		wiki.addTiddler({title: "T2", tags: check.AREA_TAG, "wf.filter": "[field:k[a]]", "wf.tab": "Tasks"});
		wiki.addTiddler({title: "K1", tags: check.AREA_TAG, "wf.filter": "[field:k[a]]", "wf.tab": "Consistency"});
		wiki.addTiddler({title: check.AREA_TAG, list: "A B C T1 T2 K1"});
	}

	it("a mute hides the item only in its tab", function() {
		tabbed();
		item("X", "a");
		wiki.setTiddlerData(check.MUTES, {Tasks: {X: "20991231"}});
		var s = check.compute(wiki, now);
		expect(s.areas.T1).toEqual([]);
		expect(s.areas.T2).toEqual([]);
		expect(s.areas.K1).toEqual(["X"]);
		expect(s.areas.A).toEqual(["X"]);
		expect(s.muted).toEqual({Tasks: ["X"]});
	});

	it("the General tab has its own mutes", function() {
		tabbed();
		item("X", "a");
		wiki.setTiddlerData(check.MUTES, {"$:/rimir/work-focus/no-tab": {X: "20991231"}});
		var s = check.compute(wiki, now);
		expect(s.areas.A).toEqual([]);
		expect(s.areas.T1).toEqual(["X"]);
		expect(s.muted).toEqual({"$:/rimir/work-focus/no-tab": ["X"]});
	});

	it("an older all-tabs mute entry hides the item in every tab", function() {
		tabbed();
		item("X", "a");
		wiki.setTiddlerData(check.MUTES, {X: "20991231"});
		var s = check.compute(wiki, now);
		["A", "B", "C", "T1", "T2", "K1"].forEach(function(area) {
			expect(s.areas[area]).toEqual([]);
		});
		expect(s.muted).toEqual({"$:/rimir/work-focus/no-tab": ["X"], Tasks: ["X"], Consistency: ["X"]});
	});

	it("a tab named like an item is not an all-tabs mute", function() {
		tabbed();
		item("Tasks", "a");
		wiki.setTiddlerData(check.MUTES, {Tasks: {Other: "20991231"}});
		expect(check.compute(wiki, now).areas.T1).toEqual(["Tasks"]);
	});

	it("areas follow the tag order", function() {
		expect(Object.keys(check.compute(wiki, now).areas)).toEqual(["A", "B", "C"]);
		wiki.addTiddler({title: check.AREA_TAG, list: "C A B"});
		expect(Object.keys(check.compute(wiki, now).areas)).toEqual(["C", "A", "B"]);
	});

	it("muted items are left out until their day", function() {
		item("X", "a"); item("Y", "c"); item("Z", "b");
		var G = "$:/rimir/work-focus/no-tab";
		wiki.setTiddlerData(check.MUTES, {X: "20991231", Y: "20261105", Tasks: {Q: "20261101"}, [G]: {Z: "20991231", W: "20261106"}});
		var s = check.write(wiki, now);
		expect(s.areas.A).toEqual([]);
		expect(s.areas.B).toEqual([]);
		expect(s.areas.C).toEqual(["Y"]);
		expect(s.muted).toEqual({[G]: ["X", "Z"]});
		// expired entries and emptied tabs are dropped
		expect(wiki.getTiddlerData(check.MUTES)).toEqual({X: "20991231", [G]: {Z: "20991231"}});
	});

	it("a broken filter does not stop the check", function() {
		addArea("A", "[[unclosed");
		item("Y", "b");
		var s = check.compute(wiki, now);
		expect(s.areas.A).toEqual([]);
		expect(typeof s.errors.A).toBe("string");
		expect(s.errors.A.length).toBeGreaterThan(0);
		expect(s.areas.B).toEqual(["Y"]);
	});

	it("a runtime filter error is an error, not an item", function() {
		addArea("A", "[is[nonsense]]");
		addArea("C", "[field:k[c]] :bogus[[x]]");
		item("Y", "b");
		var s = check.compute(wiki, now);
		expect(s.areas.A).toEqual([]);
		expect(s.errors.A).toMatch(/^filter error:/i);
		expect(s.areas.C).toEqual([]);
		expect(s.errors.C).toMatch(/^filter error:/i);
		expect(s.areas.B).toEqual(["Y"]);
	});

	it("area filters see global functions", function() {
		wiki.addTiddler({title: "$:/core/config/GlobalImportFilter", text: $tw.wiki.getTiddlerText("$:/core/config/GlobalImportFilter")});
		wiki.addTiddler({title: "$:/test/wf/glob", tags: "$:/tags/Global", text: "\\function t.wf-glob() [field:k[c]]\n"});
		addArea("C", "[t.wf-glob[]]");
		item("Y", "c");
		var s = check.compute(wiki, now);
		expect(s.errors).toEqual({});
		expect(s.areas.C).toEqual(["Y"]);
	});

	it("drafts are neither areas nor items", function() {
		item("X", "a");
		wiki.addTiddler({title: "Draft of 'X'", "draft.of": "X", "draft.title": "X", k: "a"});
		wiki.addTiddler({title: "Draft of 'C'", "draft.of": "C", "draft.title": "C", tags: check.AREA_TAG, "wf.filter": "[field:k[a]]"});
		expect(check.areas(wiki)).toEqual(["A", "B", "C"]);
		var s = check.compute(wiki, now);
		expect(Object.keys(s.areas)).toEqual(["A", "B", "C"]);
		expect(s.areas.A).toEqual(["X"]);
		expect(s.areas.B).toEqual([]);
	});

	it("placement keeps odd titles", function() {
		var odd = 'A "quoted" [[odd]] title';
		item(odd, "a"); item("$:/x y", "c");
		check.write(wiki, now);
		var s = snapshot();
		expect(s.areas.A).toEqual([odd]);
		expect(s.areas.C).toEqual(["$:/x y"]);
	});

	it("the snapshot is one JSON tiddler with checked time", function() {
		check.write(wiki, now);
		expect(wiki.getTiddler(check.SNAPSHOT).fields.type).toBe("application/json");
		expect(snapshot().checked).toBe($tw.utils.stringifyDate(now));
	});

	it("acted marks are kept per area, added and cleared", function() {
		check.write(wiki, now, {acted: {item: "I", area: "A", mark: "x"}});
		expect(wiki.getTiddlerData(check.ACTED)).toEqual({A: {I: "x"}});
		check.write(wiki, now);
		expect(wiki.getTiddlerData(check.ACTED).A.I).toBe("x");
		check.write(wiki, now, {acted: {item: "J", area: "B", mark: "y"}});
		check.write(wiki, now, {acted: {item: "I", area: "K", mark: "z"}});
		expect(wiki.getTiddlerData(check.ACTED)).toEqual({A: {I: "x"}, B: {J: "y"}, K: {I: "z"}});
		check.write(wiki, now, {clearActed: true});
		expect(wiki.tiddlerExists(check.ACTED)).toBe(false);
	});

	it("unacted drops an item's marks in every area", function() {
		check.write(wiki, now, {acted: {item: "I", area: "A", mark: "x"}});
		check.write(wiki, now, {acted: {item: "I", area: "K", mark: "z"}});
		check.write(wiki, now, {acted: {item: "J", area: "A", mark: "y"}});
		check.write(wiki, now, {unacted: "I"});
		expect(wiki.getTiddlerData(check.ACTED)).toEqual({A: {J: "y"}});
	});

	it("the action widget runs the check", function() {
		var root = $tw.rootWidget, w = $tw.wiki;
		w.deleteTiddler(check.SNAPSHOT);
		w.deleteTiddler(check.ACTED);
		root.invokeActionString('<$action-wf-check acted-item="I" acted-area="A" acted-mark="✓"/>', root, null, {});
		expect(w.tiddlerExists(check.SNAPSHOT)).toBe(true);
		expect(w.getTiddlerData(check.ACTED)).toEqual({A: {I: "✓"}});
		root.invokeActionString('<$action-wf-check unacted-item="I"/>', root, null, {});
		expect(w.getTiddlerData(check.ACTED)).toEqual({});
		w.deleteTiddler(check.SNAPSHOT);
		w.deleteTiddler(check.ACTED);
	});
});
