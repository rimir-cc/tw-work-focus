/*\
title: $:/plugins/rimir/work-focus/date-operators.js
type: application/javascript
module-type: filteroperator

Filter operators wf-date and wf-days.
  [wf-date[<expr>],[<sample>]]  one date string (empty when expr is unknown)
  [<dates>wf-days[]]            whole days from today per input; unparsable dropped

\*/
"use strict";

var dates = require("$:/plugins/rimir/work-focus/dates.js");

exports["wf-date"] = function(source, operator, options) {
	var d = dates.resolve(operator.operands && operator.operands.length ? operator.operands[0] : operator.operand, new Date());
	return d ? [dates.format(d, operator.operands ? operator.operands[1] : "", options.wiki)] : [];
};

exports["wf-days"] = function(source, operator, options) {
	var results = [], now = new Date();
	source(function(tiddler, title) {
		var n = dates.daysFrom(title, now);
		if(n !== null) {
			results.push(String(n));
		}
	});
	return results;
};
