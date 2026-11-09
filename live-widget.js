/*\
title: $:/plugins/rimir/work-focus/live-widget.js
type: application/javascript
module-type: widget

<$wf-live filter=… source=… delay="300" limit="3">children</$wf-live>

Debounced live filter. Children see live-count, live-titles ([[ ]]-quoted title list),
live-error and live-pending (yes while a change waits for its pause). The filter runs once at
render; when `filter` or `source` changes it runs again `delay` ms after the last change.
Any other wiki change only refreshes the children, the filter is not re-run.

\*/
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var DEFAULT_DELAY = 300,
	DEFAULT_LIMIT = 3;

var LiveWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
	this.timer = null;
	this.result = null;
};

LiveWidget.prototype = Object.create(Widget.prototype);

// looked up at call time so specs can spy on it / swap the timers
function lib() {
	return require("$:/plugins/rimir/work-focus/live-filter.js");
}

LiveWidget.prototype.evaluate = function() {
	this.result = lib().evaluate(this.wiki, this.filter, this, this.source, this.limit);
};

LiveWidget.prototype.readAttributes = function() {
	this.filter = this.getAttribute("filter", "");
	this.source = this.getAttribute("source", "");
	var delay = parseInt(this.getAttribute("delay", ""), 10);
	this.delay = isNaN(delay) || delay < 0 ? DEFAULT_DELAY : delay;
	var limit = parseInt(this.getAttribute("limit", ""), 10);
	this.limit = isNaN(limit) ? DEFAULT_LIMIT : limit;
};

LiveWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.readAttributes();
	if(!this.result) {
		this.evaluate();
	}
	this.execute();
	this.renderChildren(parent, nextSibling);
};

LiveWidget.prototype.execute = function() {
	var result = this.result || {count: 0, titles: [], error: ""};
	this.setVariable("live-count", String(result.count));
	this.setVariable("live-titles", $tw.utils.stringifyList(result.titles));
	this.setVariable("live-error", result.error);
	this.setVariable("live-pending", this.timer ? "yes" : "no");
	this.makeChildWidgets();
};

LiveWidget.prototype.rebuild = function() {
	// not removeChildDomNodes(): that destroys this widget (and its timer) too
	$tw.utils.each(this.children, function(child) { child.removeChildDomNodes(); });
	this.children = [];
	this.execute();
	this.renderChildren(this.parentDomNode, this.findNextSiblingDomNode());
};

LiveWidget.prototype.refresh = function(changedTiddlers) {
	var oldFilter = this.filter, oldSource = this.source;
	var changed = this.computeAttributes();
	this.readAttributes();
	if(this.filter !== oldFilter || this.source !== oldSource) {
		var self = this;
		if(this.timer) {
			lib().timers.clear(this.timer);
		}
		this.timer = lib().timers.set(function() {
			self.timer = null;
			self.evaluate();
			self.rebuild();
		}, this.delay);
		this.rebuild();
		return true;
	}
	if(Object.keys(changed).length) {
		// delay or limit changed: nothing to re-run, children read the stored result
		this.rebuild();
		return true;
	}
	return this.refreshChildren(changedTiddlers);
};

LiveWidget.prototype.destroy = function(options) {
	if(this.timer) {
		lib().timers.clear(this.timer);
		this.timer = null;
	}
	Widget.prototype.destroy.call(this, options);
};

exports["wf-live"] = LiveWidget;
