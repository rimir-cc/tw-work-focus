/*\
title: $:/plugins/rimir/work-focus/check.js
type: application/javascript
module-type: library

The work-focus check: runs every area filter once (first match wins within a tab:
an item shows in at most one area per tab, but may show in several tabs), applies
the mutes of each tab and writes one snapshot tiddler. Never runs on wiki change events.

\*/
"use strict";

var dates = require("$:/plugins/rimir/work-focus/dates.js");
var Widget = require("$:/core/modules/widgets/widget.js").widget;

var SNAPSHOT = "$:/temp/rimir/work-focus/snapshot";
var ACTED = "$:/temp/rimir/work-focus/acted";
var MUTES = "$:/rimir/work-focus/mutes";
var AREA_TAG = "$:/tags/rimir/work-focus/area";
var NO_TAB = "$:/rimir/work-focus/no-tab"; // the unnamed (General) tab, as engine.tid's wf.no-tab
var GLOBAL_IMPORT = "\\import [subfilter{$:/core/config/GlobalImportFilter}]\n";

exports.SNAPSHOT = SNAPSHOT;
exports.ACTED = ACTED;
exports.MUTES = MUTES;
exports.AREA_TAG = AREA_TAG;
exports.NO_TAB = NO_TAB;

// Area titles in tag order (drafts left out).
exports.areas = function(wiki) {
	return wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + AREA_TAG + "]!is[draft]]");
};

// A widget under an `\import` pragma (e.g. "\\import <filter>\n"): filters run under it, or under
// a widget parented on it, see the imported functions and macros.
exports.importWidget = function(wiki, pragma, parent) {
	var parser = wiki.parseText("text/vnd.tiddlywiki", pragma, {parseAsInline: true}),
		widget = wiki.makeWidget(parser, {parentWidget: parent || $tw.rootWidget, document: $tw.fakeDocument});
	widget.render($tw.fakeDocument.createElement("div"), null);
	// the innermost widget is the importvariables widget carrying the imports; variables are
	// looked up from the parent, so hand out a child of it
	while(widget.children && widget.children.length) {
		widget = widget.children[0];
	}
	return new Widget({}, {wiki: wiki, parentWidget: widget, document: $tw.fakeDocument});
};

// A widget that sees the global functions and macros, imported the way the page template does
// (`\import [subfilter{$:/core/config/GlobalImportFilter}]`), so area and action filters can call
// `$:/tags/Global` functions.
exports.globalWidget = function(wiki, parent) {
	return exports.importWidget(wiki, GLOBAL_IMPORT, parent);
};

// Run a filter; never throws. Returns {list, error}: error is the message when the filter threw
// or reported a runtime error ("Filter error: ..." / "Filter Error: ..."), list is then empty.
exports.runFilter = function(wiki, filter, widget, source) {
	var list;
	try {
		list = wiki.filterTiddlers(filter, widget, source);
	} catch(e) {
		return {list: [], error: String(e && e.message || e)};
	}
	if(list.length && /^filter error:/i.test(String(list[0]))) {
		return {list: [], error: String(list[0])};
	}
	return {list: list, error: null};
};

// The tab an area belongs to: its trimmed wf.tab, NO_TAB for the unnamed (General) tab.
exports.tabOf = function(wiki, area) {
	var tiddler = wiki.getTiddler(area);
	return (tiddler && String(tiddler.fields["wf.tab"] || "").trim()) || NO_TAB;
};

// Mutes still in force (the day is after today). The mutes tiddler holds {tab: {item: day}};
// an older entry {item: day} (a string value) mutes the item in every tab.
exports.activeMutes = function(wiki, now) {
	var data = wiki.getTiddlerData(MUTES, {}), result = {};
	function live(day) {
		var days = dates.daysFrom(day, now);
		return days !== null && days > 0;
	}
	Object.keys(data).forEach(function(key) {
		var value = data[key];
		if(value && typeof value === "object") {
			Object.keys(value).forEach(function(item) {
				if(live(value[item])) {
					result[key] = result[key] || {};
					result[key][item] = String(value[item]).trim();
				}
			});
		} else if(live(value)) {
			result[key] = String(value).trim();
		}
	});
	return result;
};

// Is the item muted in the tab (by that tab's mute or an older all-tabs entry)?
function isMuted(mutes, tab, item) {
	var own = mutes[tab];
	return !!(own && typeof own === "object" && Object.prototype.hasOwnProperty.call(own, item)) ||
		(Object.prototype.hasOwnProperty.call(mutes, item) && typeof mutes[item] === "string");
}

exports.compute = function(wiki, now) {
	var mutes = exports.activeMutes(wiki, now),
		snapshot = {checked: $tw.utils.stringifyDate(now), areas: {}, muted: {}, errors: {}}, // muted: {tab: [items]}
		claimed = Object.create(null), // tab -> {item: true}
		widget = exports.globalWidget(wiki);
	exports.areas(wiki).forEach(function(area) {
		var filter = wiki.getTiddler(area).fields["wf.filter"] || "", found = [],
			result = exports.runFilter(wiki, filter, widget),
			tab = exports.tabOf(wiki, area),
			taken = claimed[tab] = claimed[tab] || Object.create(null);
		if(result.error) {
			snapshot.errors[area] = result.error;
		}
		result.list.forEach(function(item) {
			var tiddler = wiki.getTiddler(item);
			if(tiddler && tiddler.fields["draft.of"]) {
				// a draft is never an item
				return;
			}
			if(isMuted(mutes, tab, item)) {
				var muted = snapshot.muted[tab] = snapshot.muted[tab] || [];
				if(muted.indexOf(item) === -1) {
					muted.push(item);
				}
			} else if(!taken[item]) {
				taken[item] = true;
				found.push(item);
			}
		});
		snapshot.areas[area] = found;
	});
	return snapshot;
};

exports.write = function(wiki, now, opts) {
	opts = opts || {};
	var data = wiki.getTiddlerData(MUTES, null), active;
	if(data) {
		active = exports.activeMutes(wiki, now);
		// drop expired mutes and emptied tabs
		if(JSON.stringify(active) !== JSON.stringify(data)) {
			wiki.setTiddlerData(MUTES, active);
		}
	}
	var snapshot = exports.compute(wiki, now);
	wiki.setTiddlerData(SNAPSHOT, snapshot);
	if(opts.clearActed) {
		wiki.deleteTiddler(ACTED);
	}
	// acted marks: {area: {item: mark}}, so an item acted on in one tab stays a plain row in another
	if(opts.acted || opts.unacted) {
		var acted = wiki.getTiddlerData(ACTED, {});
		if(opts.unacted) {
			Object.keys(acted).forEach(function(area) {
				if(opts.unactedTab && exports.tabOf(wiki, area) !== opts.unactedTab) {
					return;
				}
				delete acted[area][opts.unacted];
				if(!Object.keys(acted[area]).length) {
					delete acted[area];
				}
			});
		}
		if(opts.acted) {
			acted[opts.acted.area] = acted[opts.acted.area] || {};
			acted[opts.acted.area][opts.acted.item] = opts.acted.mark;
		}
		wiki.setTiddlerData(ACTED, acted);
	}
	return snapshot;
};
