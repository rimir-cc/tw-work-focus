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

	it("first match wins", function() {
		item("X", "a"); item("Y", "b");
		var s = check.compute(wiki, now);
		expect(s.areas.A).toEqual(["X"]);
		expect(s.areas.B).toEqual(["Y"]);
	});

	it("areas follow the tag order", function() {
		expect(Object.keys(check.compute(wiki, now).areas)).toEqual(["A", "B", "C"]);
		wiki.addTiddler({title: check.AREA_TAG, list: "C A B"});
		expect(Object.keys(check.compute(wiki, now).areas)).toEqual(["C", "A", "B"]);
	});

	it("muted items are left out until their day", function() {
		item("X", "a"); item("Y", "c"); item("Z", "b");
		wiki.setTiddlerData(check.MUTES, {X: "20991231", Y: "20261105"});
		var s = check.write(wiki, now);
		expect(s.areas.A).toEqual([]);
		expect(s.areas.C).toEqual(["Y"]);
		expect(s.muted).toEqual(["X"]);
		expect(wiki.getTiddlerData(check.MUTES)).toEqual({X: "20991231"});
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

	it("acted marks are kept, added and cleared", function() {
		check.write(wiki, now, {acted: {item: "I", area: "A", mark: "x"}});
		expect(wiki.getTiddlerData(check.ACTED)).toEqual({I: {area: "A", mark: "x"}});
		check.write(wiki, now);
		expect(wiki.getTiddlerData(check.ACTED).I.mark).toBe("x");
		check.write(wiki, now, {acted: {item: "J", area: "B", mark: "y"}});
		expect(Object.keys(wiki.getTiddlerData(check.ACTED))).toEqual(["I", "J"]);
		check.write(wiki, now, {clearActed: true});
		expect(wiki.tiddlerExists(check.ACTED)).toBe(false);
	});

	it("the action widget runs the check", function() {
		var root = $tw.rootWidget, w = $tw.wiki;
		w.deleteTiddler(check.SNAPSHOT);
		w.deleteTiddler(check.ACTED);
		root.invokeActionString('<$action-wf-check acted-item="I" acted-area="A" acted-mark="✓"/>', root, null, {});
		expect(w.tiddlerExists(check.SNAPSHOT)).toBe(true);
		expect(w.getTiddlerData(check.ACTED)).toEqual({I: {area: "A", mark: "✓"}});
		w.deleteTiddler(check.SNAPSHOT);
		w.deleteTiddler(check.ACTED);
	});
});
