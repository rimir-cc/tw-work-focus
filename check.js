/*\
title: $:/plugins/rimir/work-focus/check.js
type: application/javascript
module-type: library

The work-focus check: runs every area filter once (first match wins), applies
mutes and writes one snapshot tiddler. Never runs on wiki change events.

\*/
"use strict";

var dates = require("$:/plugins/rimir/work-focus/dates.js");
var Widget = require("$:/core/modules/widgets/widget.js").widget;

var SNAPSHOT = "$:/temp/rimir/work-focus/snapshot";
var ACTED = "$:/temp/rimir/work-focus/acted";
var MUTES = "$:/rimir/work-focus/mutes";
var AREA_TAG = "$:/tags/rimir/work-focus/area";
var GLOBAL_IMPORT = "\\import [subfilter{$:/core/config/GlobalImportFilter}]\n";

exports.SNAPSHOT = SNAPSHOT;
exports.ACTED = ACTED;
exports.MUTES = MUTES;
exports.AREA_TAG = AREA_TAG;

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

// Mutes still in force: value is a day after today.
exports.activeMutes = function(wiki, now) {
	var data = wiki.getTiddlerData(MUTES, {}), result = {};
	Object.keys(data).forEach(function(item) {
		var days = dates.daysFrom(data[item], now);
		if(days !== null && days > 0) {
			result[item] = String(data[item]).trim();
		}
	});
	return result;
};

exports.compute = function(wiki, now) {
	var mutes = exports.activeMutes(wiki, now),
		snapshot = {checked: $tw.utils.stringifyDate(now), areas: {}, muted: [], errors: {}},
		claimed = Object.create(null),
		widget = exports.globalWidget(wiki);
	exports.areas(wiki).forEach(function(area) {
		var filter = wiki.getTiddler(area).fields["wf.filter"] || "", found = [],
			result = exports.runFilter(wiki, filter, widget);
		if(result.error) {
			snapshot.errors[area] = result.error;
		}
		result.list.forEach(function(item) {
			var tiddler = wiki.getTiddler(item);
			if(tiddler && tiddler.fields["draft.of"]) {
				// a draft is never an item
				return;
			}
			if(Object.prototype.hasOwnProperty.call(mutes, item)) {
				if(snapshot.muted.indexOf(item) === -1) {
					snapshot.muted.push(item);
				}
			} else if(!claimed[item]) {
				claimed[item] = true;
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
		if(Object.keys(active).length !== Object.keys(data).length) {
			wiki.setTiddlerData(MUTES, active);
		}
	}
	var snapshot = exports.compute(wiki, now);
	wiki.setTiddlerData(SNAPSHOT, snapshot);
	if(opts.clearActed) {
		wiki.deleteTiddler(ACTED);
	}
	if(opts.acted) {
		var acted = wiki.getTiddlerData(ACTED, {});
		acted[opts.acted.item] = {area: opts.acted.area, mark: opts.acted.mark};
		wiki.setTiddlerData(ACTED, acted);
	}
	return snapshot;
};
