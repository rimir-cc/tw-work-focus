/*\
title: $:/plugins/rimir/work-focus/datalist.js
type: application/javascript
module-type: startup

Edit mode: <$edit-text> can't set an input's `list` attribute, so inputs with the class
`wf-fields-input` get list="wf-fields" (the field names of the live matches, area-card.tid),
and inputs with a class `wf-list-<id>` get list="<id>" (form.tid, action-form.tid), when they
take the focus.

\*/
"use strict";

exports.name = "work-focus-datalist";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

exports.startup = function() {
	document.addEventListener("focusin", function(event) {
		var target = event.target, match;
		if(!target || !target.classList || target.getAttribute("list")) {
			return;
		}
		if(target.classList.contains("wf-fields-input")) {
			target.setAttribute("list", "wf-fields");
		} else if(typeof target.className === "string" && (match =/(?:^|\s)wf-list-(\S+)/.exec(target.className))) {
			target.setAttribute("list", match[1]);
		}
	}, true);
};
