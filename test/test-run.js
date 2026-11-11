/*\
title: $:/plugins/rimir/work-focus/test/test-run.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for running actions (actions.js run/hint, recipes, wf-finished).

\*/
"use strict";

var actions = require("$:/plugins/rimir/work-focus/actions.js");
var check = require("$:/plugins/rimir/work-focus/check.js");
var Widget = require("$:/core/modules/widgets/widget.js").widget;

describe("work-focus run", function() {

	var wiki = $tw.wiki, added, widget, savedClasses;
	var S = "$:/plugins/rimir/work-focus/";

	function put(fields) {
		added.push(fields.title);
		wiki.addTiddler(new $tw.Tiddler(fields));
	}
	function shipped(name) {
		return S + "actions/" + name;
	}
	// A tile for a shipped or test action
	function tile(action, value, caption) {
		return {action: action, caption: caption || "", sub: "", icon: "", value: value || "", order: null};
	}
	function pad(n) { return (n < 10 ? "0" : "") + n; }
	function day8(offset) {
		var d = new Date();
		d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
		return "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
	}
	function field(title, name) {
		return wiki.getTiddler(title).fields[name];
	}
	function acted() {
		return wiki.getTiddlerData(check.ACTED, {});
	}
	function snapshot() {
		return wiki.getTiddlerData(check.SNAPSHOT, {});
	}

	beforeEach(function() {
		added = [];
		widget = new Widget({}, {wiki: wiki, parentWidget: $tw.rootWidget, document: $tw.fakeDocument});
		put({title: "R/Area", "wf.date-field": "due", "wf.filter": "[all[tiddlers]field:rtest[yes]]", tags: check.AREA_TAG});
		wiki.deleteTiddler(check.ACTED);
		wiki.deleteTiddler(check.SNAPSHOT);
		wiki.deleteTiddler(check.MUTES);
		// stub action widget that throws
		savedClasses = Widget.prototype.widgetClasses;
		if(!savedClasses) { widget.makeChildWidget({type: "text", text: ""}); }
		Widget.prototype.widgetClasses["action-wf-throw"] = function(parseTreeNode, options) {
			this.initialise(parseTreeNode, options);
		};
		Widget.prototype.widgetClasses["action-wf-throw"].prototype = Object.create(Widget.prototype);
		Widget.prototype.widgetClasses["action-wf-throw"].prototype.render = function() { this.execute(); };
		Widget.prototype.widgetClasses["action-wf-throw"].prototype.execute = function() {};
		Widget.prototype.widgetClasses["action-wf-throw"].prototype.invokeAction = function() { throw new Error("boom"); };
	});
	afterEach(function() {
		delete Widget.prototype.widgetClasses["action-wf-throw"];
		added.forEach(function(t) { wiki.deleteTiddler(t); });
		wiki.deleteTiddler(check.ACTED);
		wiki.deleteTiddler(check.SNAPSHOT);
		wiki.deleteTiddler(check.MUTES);
	});

	it("move-date sets the area's date field in its own format", function() {
		put({title: "I1", due: "20261101", rtest: "yes"});
		var r = actions.run(widget, tile(shipped("day-strip"), "+1d"), "I1", "R/Area");
		expect(r.ok).toBe(true);
		expect(field("I1", "due")).toBe(day8(1));
		put({title: "I2", due: "20261101000000000", rtest: "yes"});
		actions.run(widget, tile(shipped("day-strip"), "+1d"), "I2", "R/Area");
		expect(field("I2", "due")).toMatch(/^\d{17}$/);
		expect($tw.utils.formatDateString($tw.utils.parseDate(field("I2", "due")), "YYYY0MM0DD")).toBe(day8(1));
		put({title: "I3", due: "", rtest: "yes"});
		actions.run(widget, tile(shipped("day-strip"), "+1d"), "I3", "R/Area");
		expect(field("I3", "due")).toBe(day8(1));
	});

	it("mute writes the mutes tiddler and the next check hides the item", function() {
		put({title: "I1", rtest: "yes"});
		var r = actions.run(widget, tile(shipped("mute"), "+2d"), "I1", "R/Area");
		expect(r.ok).toBe(true);
		expect(wiki.getTiddlerData(check.MUTES, {})).toEqual({"$:/rimir/work-focus/no-tab": {I1: day8(2)}});
		var s = snapshot();
		expect(s.muted["$:/rimir/work-focus/no-tab"]).toContain("I1");
		expect(s.areas["R/Area"]).not.toContain("I1");
	});

	it("mute is tab-local; unmute lifts it and the mark in that tab only", function() {
		put({title: "R/Area", "wf.date-field": "due", "wf.filter": "[all[tiddlers]field:rtest[yes]]", "wf.tab": "Tasks", tags: check.AREA_TAG});
		put({title: "R/Other", "wf.filter": "[all[tiddlers]field:rtest[yes]]", "wf.tab": "Consistency", tags: check.AREA_TAG});
		var odd = 'I "1" [[x]]';
		put({title: odd, rtest: "yes"});
		put({title: "I2", rtest: "yes"});
		actions.run(widget, tile(shipped("mute"), "+2d"), odd, "R/Area");
		actions.run(widget, tile(shipped("mute"), "+2d"), "I2", "R/Area");
		actions.run(widget, tile(shipped("mute"), "+2d"), odd, "R/Other");
		expect(wiki.getTiddlerData(check.MUTES, {})).toEqual({Tasks: {[odd]: day8(2), I2: day8(2)}, Consistency: {[odd]: day8(2)}});
		var s = snapshot();
		expect(s.muted).toEqual({Tasks: [odd, "I2"], Consistency: [odd]});
		expect(s.areas["R/Other"]).toEqual(["I2"]);
		var engine = check.importWidget(wiki, "\\import $:/plugins/rimir/work-focus/engine\n");
		expect(wiki.filterTiddlers("[function[wf.muted],[Tasks]]", engine)).toEqual([odd, "I2"]);
		expect(wiki.filterTiddlers("[function[wf.mute-until],[I2],[Tasks]]", engine)).toEqual([day8(2)]);
		// unmute in Tasks: still muted in Consistency, Tasks marks gone, Consistency mark kept
		var w = new Widget({}, {wiki: wiki, parentWidget: $tw.rootWidget, document: $tw.fakeDocument});
		w.setVariable("item", odd);
		w.setVariable("tab", "Tasks");
		w.invokeActionString("\\import $:/plugins/rimir/work-focus/engine\n<<wf-unmute>>", w, null, {});
		expect(wiki.getTiddlerData(check.MUTES, {})).toEqual({Tasks: {I2: day8(2)}, Consistency: {[odd]: day8(2)}});
		s = snapshot();
		expect(s.areas["R/Area"]).toEqual([odd]);
		expect(s.areas["R/Other"]).toEqual(["I2"]);
		expect(Object.keys(acted()["R/Area"])).toEqual(["I2"]);
		expect(Object.keys(acted()["R/Other"])).toEqual([odd]);
	});

	it("unmute removes an older all-tabs mute entry", function() {
		put({title: "I1", rtest: "yes"});
		wiki.setTiddlerData(check.MUTES, {I1: "20991231"});
		var w = new Widget({}, {wiki: wiki, parentWidget: $tw.rootWidget, document: $tw.fakeDocument});
		w.setVariable("item", "I1");
		w.setVariable("tab", "$:/rimir/work-focus/no-tab");
		w.invokeActionString("\\import $:/plugins/rimir/work-focus/engine\n<<wf-unmute>>", w, null, {});
		expect(wiki.getTiddlerData(check.MUTES, {})).toEqual({});
		expect(snapshot().areas["R/Area"]).toEqual(["I1"]);
	});

	it("set-field, tag and create do their job", function() {
		put({title: "I1", rtest: "yes", tags: "keep"});
		put({title: "A/set", tags: actions.ACTION_TAG, "wf.recipe": "set-field", "wf.field": "state", "wf.value": "done", caption: "Done"});
		put({title: "A/tag", tags: actions.ACTION_TAG, "wf.recipe": "tag", "wf.mode": "add", "wf.tag": "two words"});
		put({title: "A/untag", tags: actions.ACTION_TAG, "wf.recipe": "tag", "wf.mode": "remove", "wf.tag": "keep"});
		put({title: "A/create", tags: actions.ACTION_TAG, "wf.recipe": "create", "wf.fields": '{"parent": "[<item>]", "caption": "[[Child of ]addsuffix<item>]"}'});
		expect(actions.run(widget, tile("A/set"), "I1", "R/Area").mark).toBe("✓ Done");
		expect(field("I1", "state")).toBe("done");
		expect(actions.run(widget, tile("A/tag"), "I1", "R/Area").mark).toBe("+ two words");
		expect(wiki.getTiddler("I1").hasTag("two words")).toBe(true);
		expect(actions.run(widget, tile("A/untag"), "I1", "R/Area").mark).toBe("- keep");
		expect(wiki.getTiddler("I1").hasTag("keep")).toBe(false);
		var r = actions.run(widget, tile("A/create"), "I1", "R/Area");
		added.push("I1/new");
		expect(r.mark).toBe("＋ I1/new");
		expect(wiki.tiddlerExists("I1/new")).toBe(true);
		expect(field("I1/new", "parent")).toBe("I1");
		expect(field("I1/new", "caption")).toBe("Child of I1");
	});

	it("a run writes the acted mark and re-checks", function() {
		put({title: "I1", due: "20261101", rtest: "yes"});
		var r = actions.run(widget, tile(shipped("day-strip"), "+1d"), "I1", "R/Area");
		expect(r.mark).toMatch(/^→ \w{3} \d+$/);
		expect(acted()["R/Area"].I1).toBe(r.mark);
		expect(snapshot().checked).toMatch(/^\d{17}$/);
	});

	it("acting in one tab marks the row there; another tab lists it normally", function() {
		put({title: "R/Area", "wf.date-field": "due", "wf.filter": "[all[tiddlers]field:rtest[yes]]", "wf.tab": "Tasks", tags: check.AREA_TAG});
		put({title: "R/Later", "wf.filter": "[all[tiddlers]field:rtest[yes]]", "wf.tab": "Tasks", tags: check.AREA_TAG});
		put({title: "R/Other", "wf.filter": "[all[tiddlers]field:rtest[yes]]", "wf.tab": "Consistency", tags: check.AREA_TAG});
		put({title: "I1", due: "20261101", rtest: "yes"});
		var r = actions.run(widget, tile(shipped("day-strip"), "+1d"), "I1", "R/Area");
		var engine = check.importWidget(wiki, "\\import $:/plugins/rimir/work-focus/engine\n");
		function run(filter) { return wiki.filterTiddlers(filter, engine); }
		// tab Tasks: acted row in R/Area with its mark, not a plain row in R/Area or R/Later
		expect(run("[function[wf.acted-in],[R/Area]]")).toEqual(["I1"]);
		expect(run("[function[wf.acted-mark],[I1],[R/Area]]")).toEqual([r.mark]);
		expect(run("[function[wf.rows],[R/Area]]")).toEqual([]);
		expect(run("[function[wf.rows],[R/Later]]")).toEqual([]);
		// tab Consistency: a plain row, no mark
		expect(run("[function[wf.rows],[R/Other]]")).toEqual(["I1"]);
		expect(run("[function[wf.is-acted],[I1],[R/Other]]")).toEqual([]);
		expect(run("[function[wf.acted-in],[R/Other]]")).toEqual([]);
	});

	it("deferred actions leave mark and check to wf-finished", function() {
		put({title: "I1", rtest: "yes"});
		put({title: "A/def", tags: actions.ACTION_TAG, "wf.deferred": "yes", "wf.mark": "later <<value>>", text: "<$action-setfield $tiddler=<<item>> x=y/>"});
		var r = actions.run(widget, tile("A/def"), "I1", "R/Area");
		expect(r.ok).toBe(true);
		expect(r.mark).toBe(null);
		expect(field("I1", "x")).toBe("y");
		expect(acted()).toEqual({});
		expect(wiki.tiddlerExists(check.SNAPSHOT)).toBe(false);
		var w = new Widget({}, {wiki: wiki, parentWidget: $tw.rootWidget, document: $tw.fakeDocument});
		w.invokeActionString("\\import $:/plugins/rimir/work-focus/engine\n<<wf-finished item:'I1' area:'R/Area' mark:'done later'>>", w, null, {});
		expect(acted()["R/Area"].I1).toBe("done later");
		expect(wiki.tiddlerExists(check.SNAPSHOT)).toBe(true);
	});

	it("open leaves no mark and no check", function() {
		put({title: "I1", rtest: "yes"});
		var r = actions.run(widget, tile(shipped("open")), "I1", "R/Area");
		expect(r).toEqual({ok: true, mark: null});
		expect(acted()).toEqual({});
		expect(wiki.tiddlerExists(check.SNAPSHOT)).toBe(false);
	});

	it("a failing action leaves no mark", function() {
		put({title: "I1", rtest: "yes"});
		put({title: "A/bad", tags: actions.ACTION_TAG, text: "<$action-setfield $tiddler=<<item>> a=b/><$action-wf-throw/>"});
		var shown = [], saved = $tw.notifier;
		$tw.notifier = {display: function(title, options) { shown.push([title, options.variables.message]); }};
		var r;
		try {
			r = actions.run(widget, tile("A/bad"), "I1", "R/Area");
		} finally {
			$tw.notifier = saved;
		}
		expect(r.ok).toBe(false);
		expect(r.mark).toBe(null);
		expect(r.error).toBe("boom");
		expect(acted()).toEqual({});
		expect(wiki.tiddlerExists(check.SNAPSHOT)).toBe(false);
		expect(shown).toEqual([[S + "notification", "boom"]]);
		put({title: "A/norecipe", tags: actions.ACTION_TAG, "wf.recipe": "nope"});
		expect(actions.run(widget, tile("A/norecipe"), "I1", "R/Area").ok).toBe(false);
	});

	it("a blank target field changes nothing and fails", function() {
		put({title: "R/NoField", tags: check.AREA_TAG, "wf.filter": "[all[tiddlers]field:rtest[nofield]]"});
		put({title: "I1", text: "keep", rtest: "nofield"});
		put({title: "A/move", tags: actions.ACTION_TAG, "wf.recipe": "move-date"});
		put({title: "A/setblank", tags: actions.ACTION_TAG, "wf.recipe": "set-field", "wf.value": "x"});
		var shown = [], saved = $tw.notifier, r1, r2;
		$tw.notifier = {display: function(title, options) { shown.push(options.variables.message); }};
		try {
			r1 = actions.run(widget, tile("A/move", "+1d"), "I1", "R/NoField");
			r2 = actions.run(widget, tile("A/setblank"), "I1", "R/NoField");
		} finally {
			$tw.notifier = saved;
		}
		expect(r1.ok).toBe(false);
		expect(r1.mark).toBe(null);
		expect(r2.ok).toBe(false);
		expect(field("I1", "text")).toBe("keep");
		expect(acted()).toEqual({});
		expect(wiki.tiddlerExists(check.SNAPSHOT)).toBe(false);
		expect(shown).toEqual(["no field to set", "no field to set"]);
	});

	it("date-relative:<field> reads that field with its own wording", function() {
		put({title: "R/Info", "wf.date-field": "start", "wf.info": "date-relative date-relative:due-date",
			"wf.when-past": "active since <<n>>d", "wf.when-future.due-date": "due in <<n>>d"});
		put({title: "I1", start: day8(-2), "due-date": day8(3)});
		put({title: "I2", start: day8(-2), "due-date": day8(-1)});
		function info(item) {
			return wiki.renderText("text/plain", "text/vnd.tiddlywiki",
				"\\import $:/plugins/rimir/work-focus/engine\n<<wf-info \"" + item + "\" \"R/Info\">>").trim();
		}
		expect(info("I1")).toBe("active since 2ddue in 3d");
		// no wf.when-past.due-date: the default wording, not the area's start-date wording
		expect(info("I2")).toBe("active since 2d1d ago");
	});

	it("hint and mark are rendered with the tile value", function() {
		put({title: "I1", due: "20261101", rtest: "yes"});
		var expected = $tw.utils.formatDateString($tw.utils.parseDate(day8(1) + "000000000"), "[UTC]ddd DD mmm");
		expect(actions.hint(wiki, tile(shipped("day-strip"), "+1d"), "I1", "R/Area")).toBe("due becomes " + expected);
		expect(actions.hint(wiki, tile(shipped("mute"), "+2d"), "I1", "R/Area")).toMatch(/^hidden until \w{3} \d+ \w{3}$/);
		put({title: "A/val", tags: actions.ACTION_TAG, "wf.hint": "hint <<value>> <<item>> <<area>>", "wf.mark": "mark <<value>>", text: ""});
		expect(actions.hint(wiki, tile("A/val", "v1"), "I1", "R/Area")).toBe("hint v1 I1 R/Area");
		expect(actions.run(widget, tile("A/val", "v2"), "I1", "R/Area").mark).toBe("mark v2");
	});

	// Tile values of a group for I1 in R/Area
	function groupValues(groupName) {
		return actions.select(wiki, "I1", "R/Area").groups.filter(function(g) { return g.name === groupName; })[0]
			.tiles.map(function(t) { return t.value; });
	}
	// What the mute action shows today: +2d, next mon, +1w, each day once (first wins).
	// (Module code runs in TW's sandbox, so jasmine's mock clock can't move "today".)
	function expectedDays(list) {
		var seen = {}, today = new Date().getDay();
		return list.filter(function(v) {
			var n = {today: 0, "+1d": 1, "+2d": 2, "+1w": 7}[v];
			if(n === undefined) { n = ((({mon: 1, tue: 2})[v] - today + 6) % 7) + 1; }
			if(seen[n]) { return false; }
			seen[n] = true;
			return true;
		});
	}

	it("day tiles that fall on an earlier tile's day are dropped", function() {
		put({title: "I1", due: "20261101", rtest: "yes"});
		// the rule, independent of today's weekday: +1d = tomorrow's YYYYMMDD, +1w = in 7 days
		put({title: "A/days", tags: actions.ACTION_TAG, "wf.group": "t-days",
			"wf.tiles": "[function[wf.distinct-days],[today +1d " + day8(1) + " " + day8(7) + " +1w " + day8(0) + "]]"});
		expect(groupValues("t-days")).toEqual(["today", "+1d", day8(7)]);
		// the shipped mute action uses it: on Sun Mon repeats Tmrw's day, on Sat Mon repeats +2d
		expect(groupValues("mute")).toEqual(expectedDays(["+2d", "mon", "+1w"]));
	});

	it("the move tiles roll forward from today: today, +1..+4 days, +1 week", function() {
		put({title: "I1", due: "20261101", rtest: "yes"});
		var tiles = actions.select(wiki, "I1", "R/Area").groups.filter(function(g) { return g.name === "move"; })[0].tiles;
		expect(tiles.map(function(t) { return t.value; })).toEqual(["today", "+1d", "+2d", "+3d", "+4d", "+1w"]);
		var offsets = [0, 1, 2, 3, 4, 7];
		var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		offsets.forEach(function(n, i) {
			var d = new Date();
			d.setDate(d.getDate() + n);
			// the resolved date of each tile is today + n days
			expect(wiki.filterTiddlers("[wf-date[" + tiles[i].value + "],[20000101]]")[0]).toBe(day8(n));
			// labels: Today, Tmrw, the weekday, then +1 wk
			var label = i === 0 ? "Today" : i === 1 ? "Tmrw" : i === 5 ? "+1 wk" : names[d.getDay()];
			expect(tiles[i].caption).toBe(label);
		});
	});

	it("shipped groups and actions select for an item with a date", function() {
		put({title: "I1", due: "20261101", rtest: "yes"});
		var groups = actions.select(wiki, "I1", "R/Area").groups.filter(function(g) { return g.name === "move"; });
		expect(groups[0].tiles.length).toBe(6);
		expect(groups[0].defaultTile.value).toBe("+1d");
		// relative labels for today and tomorrow, the weekday otherwise
		expect(groups[0].tiles[0].caption).toBe("Today");
		expect(groups[0].tiles[1].caption).toBe("Tmrw");
		expect(groups[0].tiles[2].caption).toMatch(/^\w{3}$/);
		expect(groups[0].tiles[5].caption).toBe("+1 wk");
		// the sub line carries the date only: the weekday is already the caption
		expect(groups[0].tiles[0].sub).toMatch(/^\d\d \w{3}$/);
		put({title: "R/NoDate", "wf.filter": "[all[current]]"});
		expect(actions.select(wiki, "I1", "R/NoDate").groups.filter(function(g) { return g.name === "move"; }).length).toBe(0);
	});
});
