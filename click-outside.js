/*\
title: $:/plugins/rimir/work-focus/click-outside.js
type: application/javascript
module-type: startup

Closes the work-focus panel on a click outside dock and panel, like TW popups:
the click is not swallowed and still reaches what is underneath. Clicks in the edit
form (.wf-form) and on the ring (.wf-ring) count as inside.

\*/
"use strict";

var OPEN = "$:/temp/rimir/work-focus/open";

exports.name = "work-focus-click-outside";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

exports.startup = function() {
	// capture phase: runs even if a handler underneath stops propagation
	document.addEventListener("click", function(event) {
		var target = event.target;
		if($tw.wiki.getTiddlerText(OPEN) !== "yes" || (target && target.closest && target.closest(".wf-dock, .wf-panel, .wf-form, .wf-ring"))) {
			return;
		}
		$tw.wiki.deleteTiddler(OPEN);
	}, true);
};
