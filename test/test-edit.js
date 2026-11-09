/*\
title: $:/plugins/rimir/work-focus/test/test-edit.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the edit engine (edit-engine.tid): slugs, area/tab operations, forms.

\*/
"use strict";

var check = require("$:/plugins/rimir/work-focus/check.js");
var actions = require("$:/plugins/rimir/work-focus/actions.js");
var Widget = require("$:/core/modules/widgets/widget.js").widget;

describe("work-focus edit", function() {

	var wiki = $tw.wiki, widget, touched;
	var S = "$:/plugins/rimir/work-focus/";
	var IMPORT = "\\import " + S + "edit-engine\n\\import " + S + "area-card\n\\import " + S + "edit-panel\n";
	var T = "$:/temp/rimir/work-focus/";
	var AREA_TAG = "$:/tags/rimir/work-focus/area";
	var CONFIG = "$:/config/rimir/work-focus/";
	var TAB = "$:/state/rimir/work-focus/tab";
	var SNAPSHOT = T + "snapshot";

	function watch(title) {
		if(touched.indexOf(title) < 0) {
			touched.push(title);
			touched[title] = wiki.getTiddler(title);
		}
	}
	function put(fields) {
		watch(fields.title);
		wiki.addTiddler(new $tw.Tiddler(fields));
	}
	function run(proc, vars) {
		["edit", "edit-view", "edit-area", "form", "form/buffer", "form/tiles", "form/tile-label", "confirm", "open"].forEach(function(n) { watch(T + n); });
		watch(AREA_TAG);
		watch(TAB);
		watch(SNAPSHOT);
		// variables become attributes, so parameters of a procedure get them (a bare call would blank them)
		var attrs = Object.keys(vars || {}).map(function(k) { return " " + k + "=<<" + k + ">>"; }).join("");
		widget.invokeActionString(IMPORT + "<$transclude $variable=\"" + proc + "\"" + attrs + "/>", widget, null, vars || {});
	}
	function field(title, name) {
		var t = wiki.getTiddler(title);
		return t && t.fields[name];
	}
	function tagList() {
		return wiki.getTiddler(AREA_TAG).fields.list || [];
	}
	function fn(filter, vars) {
		return wiki.filterTiddlers(filter, actions.variablesWidget(wiki, vars || {}, check.importWidget(wiki, IMPORT, widget)));
	}
	function buffer(name, value) {
		wiki.setText(T + "form/buffer", name, null, value);
	}

	beforeEach(function() {
		touched = [];
		widget = new Widget({}, {wiki: wiki, parentWidget: $tw.rootWidget, document: $tw.fakeDocument});
		// keep config titles of earlier specs and the dev wiki out of the way
		wiki.filterTiddlers("[all[tiddlers]prefix[" + CONFIG + "]]").forEach(watch);
	});
	afterEach(function() {
		wiki.filterTiddlers("[all[tiddlers]prefix[" + CONFIG + "]] [all[tiddlers]prefix[" + T + "]] [all[tiddlers]prefix[" + S + "]is[shadow]]").forEach(function(title) {
			if(touched.indexOf(title) < 0) { wiki.deleteTiddler(title); }
		});
		touched.forEach(function(title) {
			if(touched[title]) { wiki.addTiddler(touched[title]); } else { wiki.deleteTiddler(title); }
		});
	});

	it("slug of odd captions", function() {
		expect(fn("[function[wf.slug],<t>]", {t: "A \"quoted\" [[odd]] / name"})).toEqual(["a-quoted-odd-name"]);
		expect(fn("[function[wf.slug],<t>]", {t: "   "})).toEqual(["new"]);
		var prefix = "$:/test/wf/p/";
		expect(fn("[function[wf.config-title],<p>,<t>]", {p: prefix, t: "A \"quoted\" [[odd]] / name"})).toEqual([prefix + "a-quoted-odd-name"]);
		put({title: prefix + "a-quoted-odd-name"});
		expect(fn("[function[wf.config-title],<p>,<t>]", {p: prefix, t: "A \"quoted\" [[odd]] / name"})).toEqual([prefix + "a-quoted-odd-name-2"]);
		put({title: prefix + "a-quoted-odd-name-2"});
		expect(fn("[function[wf.config-title],<p>,<t>]", {p: prefix, t: "A \"quoted\" [[odd]] / name"})).toEqual([prefix + "a-quoted-odd-name-3"]);
	});

	it("toggles and leaves edit mode", function() {
		expect(fn("[function[wf.editing]]")).toEqual([]);
		run("wf-edit-toggle");
		expect(fn("[function[wf.editing]]")).toEqual(["yes"]);
		put({title: T + "edit-area", text: "x"});
		put({title: T + "form", kind: "action"});
		put({title: T + "form/buffer"});
		put({title: T + "confirm"});
		run("wf-edit-toggle");
		expect(fn("[function[wf.editing]]")).toEqual([]);
		["edit-area", "form", "form/buffer", "confirm"].forEach(function(n) { expect(wiki.tiddlerExists(T + n)).toBe(false); });
	});

	it("escape closes the form, then edit mode, then the panel", function() {
		put({title: T + "open", text: "yes"});
		put({title: T + "edit", text: "yes"});
		put({title: T + "form", kind: "action"});
		run("wf-escape");
		expect(wiki.tiddlerExists(T + "form")).toBe(false);
		expect(wiki.tiddlerExists(T + "edit")).toBe(true);
		run("wf-escape");
		expect(wiki.tiddlerExists(T + "edit")).toBe(false);
		expect(wiki.tiddlerExists(T + "open")).toBe(true);
		run("wf-escape");
		expect(wiki.tiddlerExists(T + "open")).toBe(false);
	});

	it("escape closes an open area card before edit mode, and after the form", function() {
		put({title: T + "open", text: "yes"});
		put({title: T + "edit", text: "yes"});
		put({title: "$:/test/wf/a1", tags: AREA_TAG, "wf.tab": "WfEsc"});
		put({title: TAB, text: "WfEsc"});
		put({title: T + "edit-area", text: "$:/test/wf/a1"});
		put({title: T + "form", kind: "action"});
		run("wf-escape");
		expect(wiki.tiddlerExists(T + "form")).toBe(false);
		expect(field(T + "edit-area", "text")).toBe("$:/test/wf/a1");
		run("wf-escape");
		expect(wiki.tiddlerExists(T + "edit-area")).toBe(false);
		expect(wiki.tiddlerExists(T + "edit")).toBe(true);
		run("wf-escape");
		expect(wiki.tiddlerExists(T + "edit")).toBe(false);
		expect(wiki.tiddlerExists(T + "open")).toBe(true);
	});

	it("escape skips an open card that is not shown (other view or tab)", function() {
		put({title: T + "open", text: "yes"});
		put({title: T + "edit", text: "yes"});
		put({title: "$:/test/wf/a1", tags: AREA_TAG, "wf.tab": "WfEsc"});
		put({title: "$:/test/wf/a2", tags: AREA_TAG, "wf.tab": "WfEsc2"});
		put({title: TAB, text: "WfEsc"});
		put({title: T + "edit-area", text: "$:/test/wf/a1"});
		put({title: T + "edit-view", text: "actions"});
		run("wf-escape");
		expect(wiki.tiddlerExists(T + "edit")).toBe(false);
		expect(wiki.tiddlerExists(T + "open")).toBe(true);
		// card of another tab
		put({title: T + "edit", text: "yes"});
		put({title: T + "edit-view", text: "areas"});
		put({title: T + "edit-area", text: "$:/test/wf/a2"});
		run("wf-escape");
		expect(wiki.tiddlerExists(T + "edit")).toBe(false);
	});

	it("new area goes to the end of the tag list in its tab and opens", function() {
		put({title: AREA_TAG, list: ["$:/test/wf/x1"]});
		put({title: "$:/test/wf/x1", tags: AREA_TAG});
		run("wf-area-new", {tab: "Plan"});
		var area = field(T + "edit-area", "text");
		expect(area).toBe(CONFIG + "areas/new-area");
		expect(tagList()).toEqual(["$:/test/wf/x1", area]);
		expect(field(area, "wf.tab")).toBe("Plan");
		expect(field(area, "caption")).toBe("New area");
		expect(field(area, "wf.level")).toBe("hint");
		expect(wiki.getTiddler(area).hasTag(AREA_TAG)).toBe(true);
		run("wf-area-new", {tab: "Plan"});
		expect(field(T + "edit-area", "text")).toBe(CONFIG + "areas/new-area-2");
	});

	it("new area creates the tag list when it is missing", function() {
		watch(AREA_TAG);
		wiki.deleteTiddler(AREA_TAG);
		run("wf-area-new", {tab: ""});
		expect(tagList()).toEqual([CONFIG + "areas/new-area"]);
	});

	it("deleting an area removes it from the tag list", function() {
		put({title: AREA_TAG, list: ["$:/test/wf/a1", "$:/test/wf/a2"]});
		put({title: "$:/test/wf/a1", tags: AREA_TAG});
		put({title: "$:/test/wf/a2", tags: AREA_TAG});
		run("wf-area-delete", {area: "$:/test/wf/a1"});
		expect(wiki.tiddlerExists("$:/test/wf/a1")).toBe(false);
		expect(tagList()).toEqual(["$:/test/wf/a2"]);
	});

	it("moving an area to another tab before a given area", function() {
		var a = "$:/test/wf/m/", list = [a + "1", a + "2", a + "3", a + "4"];
		put({title: AREA_TAG, list: list});
		put({title: a + "1", tags: AREA_TAG, "wf.tab": "One"});
		put({title: a + "2", tags: AREA_TAG, "wf.tab": "One"});
		put({title: a + "3", tags: AREA_TAG, "wf.tab": "Two"});
		put({title: a + "4", tags: AREA_TAG, "wf.tab": "Two"});
		run("wf-area-move", {area: a + "1", before: a + "4", tab: "Two"});
		expect(tagList()).toEqual([a + "2", a + "3", a + "1", a + "4"]);
		expect(field(a + "1", "wf.tab")).toBe("Two");
		// blank before: after the last area of the tab
		run("wf-area-move", {area: a + "2", before: "", tab: "Two"});
		expect(tagList()).toEqual([a + "3", a + "1", a + "4", a + "2"]);
		expect(field(a + "2", "wf.tab")).toBe("Two");
		// into an empty tab: the end of the list
		run("wf-area-move", {area: a + "3", before: "", tab: "Three"});
		expect(tagList()).toEqual([a + "1", a + "4", a + "2", a + "3"]);
		expect(field(a + "3", "wf.tab")).toBe("Three");
	});

	it("renaming an odd tab name", function() {
		var odd = "Tab \"x\" [[y]]", a = "$:/test/wf/r/";
		put({title: AREA_TAG, list: [a + "1", a + "2", a + "3"]});
		put({title: a + "1", tags: AREA_TAG, "wf.tab": odd});
		put({title: a + "2", tags: AREA_TAG, "wf.tab": odd});
		put({title: a + "3", tags: AREA_TAG, "wf.tab": "Other"});
		put({title: TAB, text: odd});
		run("wf-tab-rename", {old: odd, "new": "Renamed [[z]]"});
		expect(field(a + "1", "wf.tab")).toBe("Renamed [[z]]");
		expect(field(a + "2", "wf.tab")).toBe("Renamed [[z]]");
		expect(field(a + "3", "wf.tab")).toBe("Other");
		expect(field(TAB, "text")).toBe("Renamed [[z]]");
	});

	it("a new tab gets a free name", function() {
		put({title: AREA_TAG, list: []});
		run("wf-tab-new");
		expect(field(CONFIG + "areas/new-area", "wf.tab")).toBe("New tab");
		run("wf-tab-new");
		expect(field(CONFIG + "areas/new-area-2", "wf.tab")).toBe("New tab 2");
	});

	it("opening an area opens the panel in edit mode on its tab", function() {
		put({title: "$:/test/wf/o/1", tags: AREA_TAG, "wf.tab": "Plan"});
		put({title: "$:/test/wf/o/2", tags: AREA_TAG});
		run("wf-area-open", {area: "$:/test/wf/o/1"});
		expect(field(T + "open", "text")).toBe("yes");
		expect(field(T + "edit", "text")).toBe("yes");
		expect(field(T + "edit-view", "text")).toBe("areas");
		expect(field(TAB, "text")).toBe("Plan");
		expect(field(T + "edit-area", "text")).toBe("$:/test/wf/o/1");
		run("wf-area-open", {area: "$:/test/wf/o/2"});
		expect(field(TAB, "text")).toBe("$:/rimir/work-focus/no-tab");
	});

	it("form open copies the target, or builds a new buffer from the preset", function() {
		run("wf-form-open", {kind: "action", target: S + "actions/open", item: "I", area: "A"});
		expect(wiki.getTiddler(T + "form").fields).toEqual(jasmine.objectContaining({kind: "action", target: S + "actions/open", item: "I", area: "A", side: "right"}));
		expect(field(T + "form/buffer", "caption")).toBe("Open");
		expect(field(T + "form/buffer", "wf.group")).toBe("open");
		run("wf-form-open", {kind: "group", target: "", preset: "{\"wf.parent\":\"open\"}", side: "left"});
		expect(field(T + "form", "side")).toBe("left");
		expect(field(T + "form", "target")).toBe("");
		expect(field(T + "form/buffer", "wf.parent")).toBe("open");
		expect(wiki.getTiddler(T + "form/buffer").hasTag(actions.GROUP_TAG)).toBe(true);
		run("wf-form-close");
		expect(wiki.tiddlerExists(T + "form")).toBe(false);
		expect(wiki.tiddlerExists(T + "form/buffer")).toBe(false);
	});

	it("form open stores the tile value and the position (blank when not given)", function() {
		run("wf-form-open", {kind: "action", target: S + "actions/day-strip", item: "I", area: "A", value: "+1d", left: "512", top: "140"});
		expect(wiki.getTiddler(T + "form").fields).toEqual(jasmine.objectContaining({value: "+1d", left: "512", top: "140"}));
		run("wf-form-open", {kind: "action", target: S + "actions/open"});
		expect(field(T + "form", "value") || "").toBe("");
		expect(field(T + "form", "left") || "").toBe("");
		expect(field(T + "form", "top") || "").toBe("");
	});

	describe("tiles editor", function() {
		var DAYS = "[function[wf.distinct-days],[today +1d mon tue +1w]]";
		function tiles() {
			return field(T + "form/buffer", "wf.tiles");
		}
		function labels() {
			return field(T + "form/buffer", "wf.tile-labels") || "";
		}
		function open(fields) {
			run("wf-form-open", {kind: "action", target: "", preset: JSON.stringify(fields)});
		}

		it("tells a value list from a filter", function() {
			var mode = function(t) { return fn("[function[wf.tiles-mode],<t>]", {t: t}); };
			var values = function(t) { return fn("[function[wf.tiles-values],<t>]", {t: t}); };
			expect(mode("")).toEqual(["blank"]);
			expect(mode("  ")).toEqual(["blank"]);
			expect(mode(DAYS)).toEqual(["days"]);
			expect(values(DAYS)).toEqual(["today", "+1d", "mon", "tue", "+1w"]);
			expect(mode("[[today]] [[+1d]] fri [[next week]]")).toEqual(["list"]);
			expect(values("[[today]] [[+1d]] fri [[next week]]")).toEqual(["today", "+1d", "fri", "next week"]);
			// operators, prefixes and bare +/- words are filters
			["[enlist[+1d +1w]]", "+1d", "[[a]] -[[b]]", "[[a]] [all[tiddlers]]", "[[a]] :map[[b]]", "[<value>]"].forEach(function(t) {
				expect(mode(t)).toEqual(["filter"]);
				expect(values(t)).toEqual([]);
			});
		});

		it("adds, removes and moves values, keeping the distinct-days wrapper", function() {
			open({"wf.tiles": DAYS, "wf.tile-labels": JSON.stringify({tue: "Tuesday"})});
			run("wf-tile-add", {v: " +2d "});
			expect(tiles()).toBe("[function[wf.distinct-days],[today +1d mon tue +1w +2d]]");
			run("wf-tile-add", {v: "mon"});
			run("wf-tile-add", {v: "a]b"});
			run("wf-tile-add", {v: "  "});
			expect(tiles()).toBe("[function[wf.distinct-days],[today +1d mon tue +1w +2d]]");
			run("wf-tile-remove", {v: "tue"});
			expect(tiles()).toBe("[function[wf.distinct-days],[today +1d mon +1w +2d]]");
			// its label override goes with it
			expect(labels()).toBe("");
			run("wf-tile-move", {v: "+1w", by: "-1"});
			expect(tiles()).toBe("[function[wf.distinct-days],[today +1d +1w mon +2d]]");
			run("wf-tile-move", {v: "today", by: "-1"});
			run("wf-tile-move", {v: "+2d", by: "1"});
			expect(tiles()).toBe("[function[wf.distinct-days],[today +1d +1w mon +2d]]");
			run("wf-tile-move", {v: "today", by: "1"});
			expect(tiles()).toBe("[function[wf.distinct-days],[+1d today +1w mon +2d]]");
			// a value with a space can't go into the wrapper: the list is written plain
			run("wf-tile-add", {v: "next week"});
			expect(tiles()).toBe("[[+1d]] [[today]] [[+1w]] [[mon]] [[+2d]] [[next week]]");
			expect(fn("[function[wf.tiles-mode],<t>]", {t: tiles()})).toEqual(["list"]);
		});

		it("a plain list stays bracketed; removing the last value leaves one tile", function() {
			open({"wf.tiles": "[[today]] fri"});
			run("wf-tile-add", {v: "+10d"});
			expect(tiles()).toBe("[[today]] [[fri]] [[+10d]]");
			["today", "fri", "+10d"].forEach(function(v) { run("wf-tile-remove", {v: v}); });
			expect(tiles()).toBe("");
			// blank: the first value starts a list
			run("wf-tile-add", {v: "+1d"});
			expect(tiles()).toBe("[[+1d]]");
		});

		it("relabels a value; blank goes back to the template", function() {
			open({"wf.tiles": "[[+1d]] [[mon]]"});
			run("wf-tile-relabel", {v: "+1d", label: "Tomorrow"});
			run("wf-tile-relabel", {v: "mon", label: "Monday"});
			expect(JSON.parse(labels())).toEqual({"+1d": "Tomorrow", mon: "Monday"});
			run("wf-tile-relabel", {v: "mon", label: "  "});
			expect(JSON.parse(labels())).toEqual({"+1d": "Tomorrow"});
			run("wf-tile-relabel", {v: "+1d", label: ""});
			expect(labels()).toBe("");
		});

		it("make several tiles starts with +1d for date recipes, else opens the add row", function() {
			open({"wf.recipe": "move-date"});
			run("wf-tiles-start");
			expect(tiles()).toBe("[[+1d]]");
			open({"wf.recipe": "mute"});
			run("wf-tiles-start");
			expect(tiles()).toBe("[[+1d]]");
			// a fixed target is the current single case: it becomes the first tile (and the tiles decide from now on)
			open({"wf.recipe": "move-date", "wf.to": "fri", "wf.field": "due"});
			run("wf-tiles-start");
			expect(tiles()).toBe("[[fri]]");
			expect(field(T + "form/buffer", "wf.to") || "").toBe("");
			expect(field(T + "form/buffer", "wf.field")).toBe("due");
			open({"wf.recipe": "mute", "wf.until": "+1w"});
			run("wf-tiles-start");
			expect(tiles()).toBe("[[+1w]]");
			expect(field(T + "form/buffer", "wf.until") || "").toBe("");
			open({"wf.recipe": "set-field"});
			run("wf-tiles-start");
			expect(tiles() || "").toBe("");
			expect(field(T + "form/tiles", "open")).toBe("yes");
			// closing the form drops the editor state
			run("wf-form-close");
			expect(wiki.tiddlerExists(T + "form/tiles")).toBe(false);
		});
	});

	it("save creates an action under actions/ from the caption", function() {
		run("wf-form-open", {kind: "action", target: "", preset: "{\"wf.group\":\"open\"}"});
		buffer("caption", "My \"odd\" action");
		buffer("text", "<$action-log/>");
		run("wf-form-save");
		var title = CONFIG + "actions/my-odd-action";
		expect(field(title, "caption")).toBe("My \"odd\" action");
		expect(field(title, "wf.group")).toBe("open");
		expect(wiki.getTiddler(title).hasTag(actions.ACTION_TAG)).toBe(true);
		expect(field(title, "text")).toBe("<$action-log/>");
		expect(field(title, "wf.name")).toBeUndefined();
		expect(field(T + "form", "target")).toBe(title);
	});

	it("save creates a group with its name", function() {
		run("wf-form-open", {kind: "group", target: ""});
		buffer("caption", "My Group");
		run("wf-form-save");
		var title = CONFIG + "groups/my-group";
		expect(field(title, "wf.name")).toBe("my-group");
		expect(wiki.getTiddler(title).hasTag(actions.GROUP_TAG)).toBe(true);
	});

	it("save overrides a shadow", function() {
		var title = S + "actions/open";
		expect(wiki.isShadowTiddler(title)).toBe(true);
		var shipped = field(title, "caption");
		run("wf-form-open", {kind: "action", target: title});
		buffer("caption", "Edited");
		run("wf-form-save");
		expect(wiki.tiddlerExists(title)).toBe(true);
		expect(field(title, "caption")).toBe("Edited");
		expect(field(title, "wf.recipe")).toBe("open");
		wiki.deleteTiddler(title);
		expect(field(title, "caption")).toBe(shipped);
	});

	it("delete hides a shipped action", function() {
		var title = S + "actions/open";
		run("wf-form-open", {kind: "action", target: title});
		run("wf-form-delete");
		expect(field(title, "wf.hidden")).toBe("yes");
		expect(field(title, "caption")).toBe("Open");
		expect(wiki.tiddlerExists(T + "form")).toBe(false);
		wiki.deleteTiddler(title);
		expect(field(title, "wf.hidden")).toBeUndefined();
	});

	it("delete hides a shipped action that already has an override", function() {
		var title = S + "actions/open";
		put({title: title, tags: actions.ACTION_TAG, caption: "Mine"});
		run("wf-form-open", {kind: "action", target: title});
		run("wf-form-delete");
		expect(field(title, "wf.hidden")).toBe("yes");
		expect(field(title, "caption")).toBe("Mine");
	});

	it("delete removes a user action", function() {
		var title = CONFIG + "actions/mine";
		put({title: title, tags: actions.ACTION_TAG, caption: "Mine"});
		run("wf-form-open", {kind: "action", target: title});
		run("wf-form-delete");
		expect(wiki.tiddlerExists(title)).toBe(false);
		expect(wiki.tiddlerExists(T + "form")).toBe(false);
	});

	it("default of group", function() {
		put({title: "$:/test/wf/dg", tags: actions.GROUP_TAG, "wf.name": "t-dg", "wf.default": "x", "wf.default-value": "+1d"});
		run("wf-form-open", {kind: "action", target: "", preset: "{\"wf.group\":\"t-dg\",\"wf-form.default\":\"yes\"}"});
		buffer("caption", "Zed");
		run("wf-form-save");
		var title = CONFIG + "actions/zed";
		expect(field("$:/test/wf/dg", "wf.default")).toBe(title);
		expect(field("$:/test/wf/dg", "wf.default-value")).toBeUndefined();
		expect(wiki.getTiddler(title).fields["wf-form.default"]).toBeUndefined();
	});

	it("default of a shipped group writes an override", function() {
		var g = S + "groups/move";
		run("wf-form-open", {kind: "action", target: "", preset: "{\"wf.group\":\"move\",\"wf-form.default\":\"yes\"}"});
		buffer("caption", "Zed");
		run("wf-form-save");
		expect(field(g, "wf.default")).toBe(CONFIG + "actions/zed");
		expect(field(g, "wf.default-value")).toBeUndefined();
		expect(field(g, "wf.name")).toBe("move");
	});

	it("duplicate opens a copy", function() {
		var title = S + "actions/open";
		run("wf-form-open", {kind: "action", target: title});
		run("wf-form-duplicate");
		var copy = CONFIG + "actions/open-copy";
		expect(field(copy, "caption")).toBe("Open (copy)");
		expect(field(copy, "wf.recipe")).toBe("open");
		expect(field(T + "form", "target")).toBe(copy);
		expect(field(T + "form/buffer", "caption")).toBe("Open (copy)");
		expect(field(title, "caption")).toBe("Open");
		expect(wiki.tiddlerExists(title)).toBe(false);
	});

	it("duplicate of a group gives the copy its own wf.name, also after Save", function() {
		var title = S + "groups/move";
		run("wf-form-open", {kind: "group", target: title});
		run("wf-form-duplicate");
		var copy = CONFIG + "groups/move-copy";
		expect(field(copy, "wf.name")).toBe("move-copy");
		expect(field(T + "form/buffer", "wf.name")).toBe("move-copy");
		expect(field(T + "form", "target")).toBe(copy);
		buffer("wf.order", "77");
		run("wf-form-save");
		expect(field(copy, "wf.name")).toBe("move-copy");
		expect(field(copy, "wf.order")).toBe("77");
		expect(field(title, "wf.name")).toBe("move");
		expect(wiki.tiddlerExists(title)).toBe(false);
	});

	it("a new group from an implicit group keeps its name", function() {
		run("wf-form-open", {kind: "group", target: "", preset: "{\"wf.name\":\"Waiting\",\"caption\":\"Waiting\"}"});
		buffer("caption", "Waiting for reply");
		run("wf-form-save");
		var title = CONFIG + "groups/waiting-for-reply";
		expect(wiki.tiddlerExists(title)).toBe(true);
		expect(field(title, "wf.name")).toBe("Waiting");
		// a group without a preset name still gets the slug
		run("wf-form-open", {kind: "group", target: ""});
		buffer("caption", "Follow up");
		run("wf-form-save");
		expect(field(CONFIG + "groups/follow-up", "wf.name")).toBe("follow-up");
	});

	it("the form buffer is never one of the tagged actions or groups", function() {
		run("wf-form-open", {kind: "group", target: S + "groups/move"});
		expect(wiki.getTiddler(T + "form/buffer").hasTag(actions.GROUP_TAG)).toBe(true);
		var groups = fn("[function[wf.groups-all]]");
		expect(groups).toContain(S + "groups/move");
		expect(groups).not.toContain(T + "form/buffer");
		expect(fn("[function[wf.group-title],[move]]")).toEqual([S + "groups/move"]);
		// the group form's parent options: the group tree without the group itself
		expect(fn("[function[wf.groups-top]] -[<t>]", {t: S + "groups/move"})).not.toContain(T + "form/buffer");
		run("wf-form-open", {kind: "action", target: S + "actions/open"});
		expect(fn("[function[wf.actions-all]]")).not.toContain(T + "form/buffer");
		expect(fn("[function[wf.group-actions],[open]]")).toEqual([S + "actions/open"]);
	});

	it("select ignores a tagged buffer (no extra tile, no replaces, no duplicate group)", function() {
		put({title: T + "form/buffer", tags: actions.ACTION_TAG, caption: "Buffer", "wf.group": "open", "wf.replaces": S + "actions/open"});
		var open = actions.select(wiki, "Item", "Area").groups.filter(function(g) { return g.name === "open"; })[0];
		expect(open.tiles.map(function(t) { return t.action; })).toEqual([S + "actions/open"]);
		put({title: T + "form/buffer", tags: actions.GROUP_TAG, "wf.name": "open", caption: "Buffer group", "wf.order": "1"});
		var top = actions.select(wiki, "Item", "Area", {edit: true}).groups;
		var names = top.map(function(g) { return g.name; });
		expect(names.filter(function(n) { return n === "open"; }).length).toBe(1);
		expect(top.filter(function(g) { return g.name === "open"; })[0].caption).toBe("Open");
		expect(top.filter(function(g) { return g.name === "open"; })[0].title).toBe(S + "groups/open");
	});

	it("a group save never sets another group's default", function() {
		put({title: "$:/test/wf/dg2", tags: actions.GROUP_TAG, "wf.name": "t-dg2"});
		run("wf-form-open", {kind: "group", target: "", preset: "{\"wf.group\":\"t-dg2\",\"wf-form.default\":\"yes\"}"});
		buffer("caption", "Sub");
		run("wf-form-save");
		expect(field("$:/test/wf/dg2", "wf.default")).toBeUndefined();
		expect(field(CONFIG + "groups/sub", "wf.name")).toBe("sub");
	});

	it("save keeps the creation date of the target", function() {
		var title = CONFIG + "actions/dated", created = new Date(2020, 1, 3, 4, 5, 6);
		put({title: title, tags: actions.ACTION_TAG, caption: "Old", created: created});
		run("wf-form-open", {kind: "action", target: title});
		buffer("caption", "New");
		run("wf-form-save");
		expect(field(title, "caption")).toBe("New");
		expect(field(title, "created").getTime()).toBe(created.getTime());
	});

	it("area order follows the displayed order, also with unlisted areas", function() {
		var a = "$:/test/wf/u/";
		watch(AREA_TAG);
		put({title: AREA_TAG, list: [a + "1"]});
		put({title: a + "1", tags: AREA_TAG, "wf.tab": "One"});
		put({title: a + "2", tags: AREA_TAG, "wf.tab": "One"});
		put({title: a + "3", tags: AREA_TAG, "wf.tab": "One"});
		var before = wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + AREA_TAG + "]!is[draft]]");
		// move 1 before the unlisted 3: nothing is lost, the order is kept
		run("wf-area-move", {area: a + "1", before: a + "3", tab: "One"});
		var after = wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + AREA_TAG + "]!is[draft]]");
		expect(after.slice().sort()).toEqual(before.slice().sort());
		expect(after.indexOf(a + "1")).toBe(after.indexOf(a + "3") - 1);
		expect(tagList().length).toBe(after.length);
	});

	it("a new area goes last when other areas exist but no list tiddler", function() {
		var a = "$:/test/wf/n/";
		watch(AREA_TAG);
		wiki.deleteTiddler(AREA_TAG);
		put({title: a + "1", tags: AREA_TAG});
		put({title: a + "2", tags: AREA_TAG});
		run("wf-area-new", {tab: ""});
		var list = tagList();
		expect(list[list.length - 1]).toBe(CONFIG + "areas/new-area");
		expect(list).toContain(a + "1");
		expect(list).toContain(a + "2");
	});

	it("a new area in the no-tab tab gets a blank wf.tab", function() {
		run("wf-area-new", {tab: "$:/rimir/work-focus/no-tab"});
		expect(field(CONFIG + "areas/new-area", "wf.tab")).toBe("");
	});

	describe("refresh on save", function() {
		var NEWAREA = CONFIG + "areas/new-area";
		function snap() {
			return wiki.getTiddlerData(SNAPSHOT, {});
		}
		function hits(area) {
			return (snap().areas || {})[area] || [];
		}
		function stale() {
			// an old snapshot: whatever runs the check next leaves a newer `checked` time
			wiki.addTiddler(new $tw.Tiddler({title: SNAPSHOT, type: "application/json", text: JSON.stringify({checked: "20000101000000000", areas: {}, muted: [], errors: {}})}));
		}

		it("a new area with a filter shows its hits once the card is closed", function() {
			put({title: "$:/test/wf/r/item", tags: "WfRefreshHit"});
			stale();
			run("wf-area-new", {tab: ""});
			expect(hits(NEWAREA)).toEqual([]);
			// the card edits the area directly (no Save): typing writes the field
			wiki.setText(NEWAREA, "wf.filter", null, "[tag[WfRefreshHit]]");
			expect(hits(NEWAREA)).toEqual([]);
			run("wf-card-toggle", {area: NEWAREA});
			expect(wiki.tiddlerExists(T + "edit-area")).toBe(false);
			expect(hits(NEWAREA)).toEqual(["$:/test/wf/r/item"]);
		});

		it("Done and Esc on a card refresh; opening a card without another open does not", function() {
			put({title: "$:/test/wf/r/item", tags: "WfRefreshHit"});
			put({title: "$:/test/wf/r/a", tags: AREA_TAG, "wf.tab": "WfRef", "wf.filter": "[tag[WfRefreshHit]]"});
			put({title: TAB, text: "WfRef"});
			stale();
			run("wf-card-toggle", {area: "$:/test/wf/r/a"});
			expect(field(T + "edit-area", "text")).toBe("$:/test/wf/r/a");
			expect(snap().checked).toBe("20000101000000000");
			run("wf-card-close", {area: "$:/test/wf/r/a"});
			expect(hits("$:/test/wf/r/a")).toEqual(["$:/test/wf/r/item"]);
			stale();
			put({title: T + "edit", text: "yes"});
			put({title: T + "edit-area", text: "$:/test/wf/r/a"});
			run("wf-escape");
			expect(hits("$:/test/wf/r/a")).toEqual(["$:/test/wf/r/item"]);
		});

		it("saving an action runs the check (newer time)", function() {
			stale();
			run("wf-form-open", {kind: "action", target: "", preset: "{}"});
			buffer("caption", "Refresh action");
			run("wf-form-save");
			expect(wiki.tiddlerExists(CONFIG + "actions/refresh-action")).toBe(true);
			expect(snap().checked > "20000101000000000").toBe(true);
			stale();
			run("wf-form-duplicate");
			expect(snap().checked > "20000101000000000").toBe(true);
			stale();
			run("wf-form-delete");
			expect(snap().checked > "20000101000000000").toBe(true);
		});

		it("leaving edit mode shows an edited filter, also with an open card", function() {
			put({title: "$:/test/wf/r/item", tags: "WfRefreshHit"});
			put({title: "$:/test/wf/r/a", tags: AREA_TAG, "wf.tab": "WfRef", "wf.filter": ""});
			put({title: TAB, text: "WfRef"});
			put({title: T + "edit", text: "yes"});
			put({title: T + "edit-area", text: "$:/test/wf/r/a"});
			stale();
			wiki.setText("$:/test/wf/r/a", "wf.filter", null, "[tag[WfRefreshHit]]");
			run("wf-edit-leave");
			expect(hits("$:/test/wf/r/a")).toEqual(["$:/test/wf/r/item"]);
			expect(wiki.tiddlerExists(T + "edit-area")).toBe(false);
		});

		it("delete, move and tab rename run the check", function() {
			put({title: "$:/test/wf/r/item", tags: "WfRefreshHit"});
			put({title: "$:/test/wf/r/a", tags: AREA_TAG, "wf.tab": "WfRef", "wf.filter": "[tag[WfRefreshHit]]"});
			stale();
			run("wf-area-move", {area: "$:/test/wf/r/a", before: "", tab: "WfRef"});
			expect(hits("$:/test/wf/r/a")).toEqual(["$:/test/wf/r/item"]);
			stale();
			run("wf-tab-rename", {old: "WfRef", "new": "WfRef2"});
			expect(hits("$:/test/wf/r/a")).toEqual(["$:/test/wf/r/item"]);
			// the snapshot still holds the area; the check after the delete drops it
			expect(Object.keys(snap().areas)).toContain("$:/test/wf/r/a");
			run("wf-area-delete", {area: "$:/test/wf/r/a"});
			expect(Object.keys(snap().areas)).not.toContain("$:/test/wf/r/a");
			stale();
			run("wf-tab-new");
			expect(snap().checked > "20000101000000000").toBe(true);
		});
	});
});
