/*\
title: $:/plugins/rimir/work-focus/live-filter.js
type: application/javascript
module-type: library

work-focus live filter: count and first titles of a filter result, for edit mode's live counts.

\*/
"use strict";

var check = require("$:/plugins/rimir/work-focus/check.js");

// Evaluate `filter` under `widget` (its variables are visible). `source` (optional title) makes
// the input [source]. Returns {count, titles (first `limit`), error}. A blank filter is empty;
// a thrown error or a "Filter error: ..." result gives count 0 and the message (check.runFilter).
exports.evaluate = function(wiki, filter, widget, source, limit) {
	var empty = {count: 0, titles: [], error: ""};
	if(!filter || !String(filter).trim()) {
		return empty;
	}
	var input = source ? wiki.makeTiddlerIterator([source]) : undefined;
	var result = check.runFilter(wiki, filter, widget, input);
	if(result.error) {
		empty.error = result.error;
		return empty;
	}
	var max = parseInt(limit, 10);
	return {
		count: result.list.length,
		titles: isNaN(max) ? result.list.slice() : result.list.slice(0, Math.max(max, 0)),
		error: ""
	};
};

// Timer hook for the live widget (specs replace it: module code runs in TW's sandbox,
// so jasmine's mock clock can't reach setTimeout)
exports.timers = {
	set: function(fn, ms) { return setTimeout(fn, ms); },
	clear: function(id) { clearTimeout(id); }
};
