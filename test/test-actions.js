/*\
title: $:/plugins/rimir/work-focus/test/test-actions.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for actions.js (which tiles appear).

\*/
"use strict";

var actions = require("$:/plugins/rimir/work-focus/actions.js");

describe("work-focus actions", function() {

	var wiki = $tw.wiki, added;

	function put(fields) {
		added.push(fields.title);
		wiki.addTiddler(new $tw.Tiddler(fields));
	}
	function group(name, extra) {
		put($tw.utils.extend({title: "$:/test/wf/g/" + name, tags: actions.GROUP_TAG, "wf.name": name, caption: name}, extra));
	}
	function action(id, extra) {
		put($tw.utils.extend({title: "$:/test/wf/a/" + id, tags: actions.ACTION_TAG, caption: id, "wf.group": "t-g"}, extra));
	}
	// Selection restricted to fixture groups (names starting with "t-")
	function sel(item, area) {
		return actions.select(wiki, item || "Item", area || "Area").groups.filter(function(g) {
			return g.name.indexOf("t-") === 0 || g.name === "more";
		});
	}
	function find(groups, name) {
		return groups.filter(function(g) { return g.name === name; })[0];
	}
	function captions(tiles) {
		return tiles.map(function(t) { return t.caption; });
	}

	beforeEach(function() {
		added = [];
		put({title: "Item", f: "x"});
		put({title: "Area", "wf.date-field": "start"});
		group("t-g");
	});
	afterEach(function() {
		added.forEach(function(t) { wiki.deleteTiddler(t); });
	});

	it("exposes the context variables", function() {
		expect(actions.context(wiki, "Item", "Area")).toEqual({item: "Item", area: "Area", "date-field": "start", currentTiddler: "Item"});
		expect(actions.context(wiki, "Item", "Nope")["date-field"]).toBe("");
	});

	it("all matching actions appear", function() {
		action("one", {"wf.order": "1"});
		action("two", {"wf.order": "2", "wf.filter": "[all[current]field:f[x]]"});
		action("three", {"wf.order": "3", "wf.filter": "[all[current]field:f[nope]]"});
		var g = find(sel(), "t-g");
		expect(captions(g.tiles)).toEqual(["one", "two"]);
		expect(g.tiles[0].action).toBe("$:/test/wf/a/one");
	});

	it("the filter sees area and item", function() {
		action("a", {"wf.filter": "[<area>match[A]]"});
		action("b", {"wf.filter": "[<item>match[Item]]", "wf.order": "2"});
		expect(find(sel("Item", "A"), "t-g").tiles.length).toBe(2);
		expect(find(sel("Item", "B"), "t-g").tiles.map(function(t) { return t.caption; })).toEqual(["b"]);
	});

	it("an area-only negated filter works", function() {
		action("np", {"wf.filter": "[<area>!match[plan]]"});
		expect(find(sel("Item", "other"), "t-g").tiles.length).toBe(1);
		expect(find(sel("Item", "plan"), "t-g")).toBeUndefined();
	});

	it("a malformed wf.filter means no match", function() {
		action("bad", {"wf.filter": "[[x]addprefix[]"});
		action("ok");
		expect(captions(find(sel(), "t-g").tiles)).toEqual(["ok"]);
	});

	it("a malformed wf.tiles gives no tiles", function() {
		action("badtiles", {"wf.tiles": "[[x]addprefix[]"});
		action("ok");
		expect(captions(find(sel(), "t-g").tiles)).toEqual(["ok"]);
	});

	it("a runtime filter error in wf.filter or wf.tiles is no match", function() {
		action("err", {"wf.filter": "[is[nonsense]]"});
		action("errtiles", {"wf.tiles": "[is[nonsense]]", "wf.order": "2"});
		action("ok", {"wf.order": "3"});
		expect(captions(find(sel(), "t-g").tiles)).toEqual(["ok"]);
	});

	it("wf.filter, wf.tiles and hints see global functions", function() {
		put({title: "$:/test/wf/glob", tags: "$:/tags/Global", text: "\\function t.wf-is-item() [<item>match[Item]]\n\\function t.wf-vals() [[g1]] [[g2]]\n"});
		action("g", {"wf.filter": "[t.wf-is-item[]]", "wf.tiles": "[t.wf-vals[]]", "wf.hint": "<$text text={{{ [t.wf-vals[]join[+]] }}}/>"});
		var tiles = find(sel(), "t-g").tiles;
		expect(tiles.map(function(t) { return t.value; })).toEqual(["g1", "g2"]);
		expect(actions.hint(wiki, tiles[0], "Item", "Area")).toBe("g1+g2");
	});

	it("draft actions and groups are ignored", function() {
		action("real", {"wf.group": "t-d"});
		group("t-d", {caption: "Real"});
		put({title: "Draft of '$:/test/wf/a/real'", "draft.of": "$:/test/wf/a/real", "draft.title": "$:/test/wf/a/real",
			tags: actions.ACTION_TAG, caption: "draft", "wf.group": "t-d"});
		put({title: "Draft of '$:/test/wf/g/t-d'", "draft.of": "$:/test/wf/g/t-d", "draft.title": "$:/test/wf/g/t-d",
			tags: actions.GROUP_TAG, "wf.name": "t-d", caption: "Draft"});
		var g = find(sel(), "t-d");
		expect(captions(g.tiles)).toEqual(["real"]);
		expect(g.caption).toBe("Real");
	});

	it("hidden actions are left out", function() {
		action("shown");
		action("hid", {"wf.hidden": "yes"});
		expect(captions(find(sel(), "t-g").tiles)).toEqual(["shown"]);
	});

	it("replaces drops the replaced action only when the replacer matches", function() {
		action("old");
		action("new", {"wf.replaces": "$:/test/wf/a/old", "wf.filter": "[<area>match[A]]", "wf.order": "2"});
		expect(captions(find(sel("Item", "A"), "t-g").tiles)).toEqual(["new"]);
		expect(captions(find(sel("Item", "B"), "t-g").tiles)).toEqual(["old"]);
	});

	it("tiles expand one action into several", function() {
		action("move", {"wf.tiles": "[[today]] [[+1d]]", "wf.tile-label": "Go <<value>>", "wf.tile-sub": "<<area>>"});
		var tiles = find(sel(), "t-g").tiles;
		// one action: tiles keep the filter's value order
		expect(tiles.map(function(t) { return t.value; })).toEqual(["today", "+1d"]);
		expect(tiles.map(function(t) { return t.caption; })).toEqual(["Go today", "Go +1d"]);
		expect(tiles[0].sub).toBe("Area");
	});

	it("a tile without wf.tile-label is captioned by its value", function() {
		action("v", {"wf.tiles": "[[mon]] [[tue]] [[+1w]]"});
		var tiles = find(sel(), "t-g").tiles;
		expect(captions(tiles)).toEqual(["mon", "tue", "+1w"]);
	});

	it("wf.tile-labels overrides the label of single values", function() {
		action("lab", {"wf.order": "1", "wf.tiles": "[[a]] [[b]] [[c]]", "wf.tile-label": "T-<<value>>", "wf.tile-labels": JSON.stringify({b: "Bee", c: "  "})});
		action("lab2", {"wf.order": "2", "wf.tiles": "[[a]] [[b]]", "wf.tile-labels": JSON.stringify({a: "Ay"})});
		action("lab3", {"wf.order": "3", "wf.tiles": "[[x]]", "wf.tile-label": "T-<<value>>", "wf.tile-labels": "{broken"});
		// override if non-blank, else the template, else the value; a broken JSON is ignored
		expect(captions(find(sel(), "t-g").tiles)).toEqual(["T-a", "Bee", "T-c", "Ay", "b", "T-x"]);
	});

	it("a plain action takes caption, empty sub and group icon", function() {
		group("t-i", {"wf.icon": "G"});
		action("x", {"wf.group": "t-i"});
		action("y", {"wf.group": "t-i", "wf.icon": "Y", "wf.order": "0"});
		var tiles = find(sel(), "t-i").tiles;
		expect(tiles[0].icon).toBe("Y");
		expect(tiles[1].icon).toBe("G");
		expect(tiles[1].sub).toBe("");
		expect(tiles[1].value).toBe("");
	});

	it("groups are ordered and nested", function() {
		group("t-b", {"wf.order": "2"});
		group("t-a", {"wf.order": "1"});
		group("t-child", {"wf.parent": "t-a"});
		action("p", {"wf.group": "t-a"});
		action("q", {"wf.group": "t-b"});
		action("c", {"wf.group": "t-child"});
		var groups = sel().filter(function(g) { return g.name !== "t-g"; });
		expect(groups.map(function(g) { return g.name; })).toEqual(["t-a", "t-b"]);
		expect(groups[0].groups.map(function(g) { return g.name; })).toEqual(["t-child"]);
		expect(captions(groups[0].groups[0].tiles)).toEqual(["c"]);
	});

	it("nesting deeper than three attaches to the depth-3 ancestor", function() {
		group("t-1"); group("t-2", {"wf.parent": "t-1"}); group("t-3", {"wf.parent": "t-2"});
		group("t-4", {"wf.parent": "t-3"}); group("t-5", {"wf.parent": "t-4"});
		action("d4", {"wf.group": "t-4"});
		action("d5", {"wf.group": "t-5"});
		var g3 = find(find(find(sel(), "t-1").groups, "t-2").groups, "t-3");
		expect(captions(g3.tiles).sort()).toEqual(["d4", "d5"]);
		expect(g3.groups.length).toBe(0);
	});

	it("a group without a group tiddler is a plain group", function() {
		action("z", {"wf.group": "t-nogroup"});
		var g = find(sel(), "t-nogroup");
		expect(g.caption).toBe("t-nogroup");
		expect(captions(g.tiles)).toEqual(["z"]);
	});

	it("empty groups are dropped", function() {
		group("t-empty");
		action("only");
		expect(find(sel(), "t-empty")).toBeUndefined();
	});

	it("more than six groups go under More", function() {
		for(var i = 1; i <= 7; i++) {
			group("t-m" + i, {"wf.order": String(i)});
			action("m" + i, {"wf.group": "t-m" + i});
		}
		var top = actions.select(wiki, "Item", "Area").groups;
		var more = top[top.length - 1];
		expect(top.length).toBe(6);
		expect(more.name).toBe("more");
		expect(more.caption).toBe("More");
		expect(more.icon).toBe("⋯");
		expect(more.tiles).toEqual([]);
		expect(more.defaultTile).toBe(null);
		expect(more.groups.length).toBeGreaterThan(0);
	});

	it("the default tile is wf.default, else the first", function() {
		group("t-d", {"wf.default": "$:/test/wf/a/second"});
		action("first", {"wf.group": "t-d", "wf.order": "1"});
		action("second", {"wf.group": "t-d", "wf.order": "2"});
		expect(find(sel(), "t-d").defaultTile.caption).toBe("second");
		var gt = find(sel(), "t-d");
		gt.tiles.length; // sanity
		wiki.addTiddler(new $tw.Tiddler(wiki.getTiddler("$:/test/wf/g/t-d"), {"wf.default": ""}));
		expect(find(sel(), "t-d").defaultTile.caption).toBe("first");
	});


	it("select in edit mode keeps empty and hidden groups", function() {
		group("t-empty", {"wf.parent": "t-g"});
		group("t-hid", {"wf.hidden": "yes"});
		action("shown");
		action("gone", {"wf.hidden": "yes"});
		// the shipped groups plus the fixtures exceed six: look inside More too
		var groups = [];
		actions.select(wiki, "Item", "Area", {edit: true}).groups.forEach(function(g) {
			groups = groups.concat(g.name === "more" ? g.groups : [g]);
		});
		groups = groups.filter(function(g) { return g.name.indexOf("t-") === 0; });
		var g = find(groups, "t-g");
		expect(g.title).toBe("$:/test/wf/g/t-g");
		expect(g.hidden).toBe(false);
		expect(captions(g.tiles)).toEqual(["gone", "shown"]);
		expect(g.tiles.map(function(t) { return t.hidden; })).toEqual([true, false]);
		expect(find(g.groups, "t-empty").title).toBe("$:/test/wf/g/t-empty");
		expect(find(groups, "t-hid").hidden).toBe(true);
		expect(find(groups, "t-empty")).toBeUndefined();
	});

	it("hidden groups are skipped outside edit mode", function() {
		group("t-hid", {"wf.hidden": "yes"});
		action("a", {"wf.group": "t-hid"});
		action("b");
		var groups = sel();
		expect(find(groups, "t-hid")).toBeUndefined();
		expect(find(groups, "t-g").title).toBe("$:/test/wf/g/t-g");
		expect(find(groups, "t-g").tiles[0].hidden).toBe(false);
	});
});
