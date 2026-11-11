/*\
title: $:/plugins/rimir/work-focus/action-wf-check.js
type: application/javascript
module-type: widget

Action widget `<$action-wf-check/>` — runs the work-focus check.

Attributes:
  clear-acted   "yes" deletes the acted marks
  acted-item, acted-area, acted-mark   record one acted mark (per area)
  unacted-item  drops that item's acted marks (unacted-tab: only in the areas of that tab)
\*/
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;
var check = require("$:/plugins/rimir/work-focus/check.js");

var ActionCheckWidget = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
};

ActionCheckWidget.prototype = Object.create(Widget.prototype);

ActionCheckWidget.prototype.render = function(parent,nextSibling) {
	this.computeAttributes();
	this.execute();
};

ActionCheckWidget.prototype.execute = function() {};

ActionCheckWidget.prototype.refresh = function(changedTiddlers) {
	return this.refreshChildren(changedTiddlers);
};

ActionCheckWidget.prototype.invokeAction = function(triggeringWidget,event) {
	var opts = {}, item = this.getAttribute("acted-item", "");
	if(this.getAttribute("clear-acted") === "yes") {
		opts.clearActed = true;
	}
	if(item) {
		opts.acted = {item: item, area: this.getAttribute("acted-area", ""), mark: this.getAttribute("acted-mark", "")};
	}
	if(this.getAttribute("unacted-item", "")) {
		opts.unacted = this.getAttribute("unacted-item");
		opts.unactedTab = this.getAttribute("unacted-tab", "");
	}
	check.write(this.wiki, new Date(), opts);
	return true;
};

exports["action-wf-check"] = ActionCheckWidget;
