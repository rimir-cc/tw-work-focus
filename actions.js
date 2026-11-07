/*\
title: $:/plugins/rimir/work-focus/actions.js
type: application/javascript
module-type: library

work-focus actions: which tiles and groups the drag ring shows for one item.

\*/
"use strict";

var check = require("$:/plugins/rimir/work-focus/check.js");

var ACTION_TAG = "$:/tags/rimir/work-focus/action";
var GROUP_TAG = "$:/tags/rimir/work-focus/group";
var RECIPE_TAG = "$:/tags/rimir/work-focus/recipe";
var NOTIFICATION = "$:/plugins/rimir/work-focus/notification";
var MAX_GROUPS = 6;
var MAX_DEPTH = 3;

exports.ACTION_TAG = ACTION_TAG;
exports.GROUP_TAG = GROUP_TAG;
exports.RECIPE_TAG = RECIPE_TAG;
exports.MAX_GROUPS = MAX_GROUPS;
exports.MAX_DEPTH = MAX_DEPTH;

// Plain variables shared by selection and running.
exports.context = function(wiki, item, area) {
	var areaTiddler = wiki.getTiddler(area);
	return {
		item: item,
		area: area,
		"date-field": (areaTiddler && areaTiddler.fields["wf.date-field"]) || "",
		currentTiddler: item
	};
};

// A widget exposing plain variables. getVariable reads the parent's variables, so a holder
// carries them and a child is returned. Real widgets (not fake ones): renderText needs
// getAncestorCount. `parent` layers extra variables on top of an earlier variables widget.
function variablesWidget(wiki, vars, parent) {
	var Widget = require("$:/core/modules/widgets/widget.js").widget;
	var document = (parent && parent.document) || (typeof window !== "undefined" ? window.document : $tw.fakeDocument);
	var holder = new Widget({}, {wiki: wiki, parentWidget: parent || $tw.rootWidget, document: document});
	Object.keys(vars).forEach(function(name) { holder.setVariable(name, vars[name]); });
	return new Widget({}, {wiki: wiki, parentWidget: holder, document: document});
}

// Run a filter with source [item] under a variables widget. Returns the result array,
// or null when the filter threw or reported a runtime error (check.runFilter decides).
function runFilter(wiki, filter, widget, item) {
	var result = check.runFilter(wiki, filter, widget, wiki.makeTiddlerIterator([item]));
	return result.error ? null : result.list;
}

// Plain-text render with the engine functions imported (labels, hints and marks use wf.* functions)
var ENGINE_IMPORT = "\\import $:/plugins/rimir/work-focus/engine\n";

function renderText(wiki, text, widget) {
	return text ? wiki.renderText("text/plain", "text/vnd.tiddlywiki", ENGINE_IMPORT + text, {parentWidget: widget}).trim() : "";
}

// Parent for selection and hints: the global functions/macros (as on the page) plus the engine
function filterWidget(wiki) {
	return check.importWidget(wiki, ENGINE_IMPORT, check.globalWidget(wiki));
}

exports.variablesWidget = variablesWidget;
exports.runFilter = runFilter;
exports.renderText = renderText;

// An action matches when its filter result is non-empty (blank filter: always)
function matches(wiki, fields, widget, item) {
	var filter = (fields["wf.filter"] || "").trim();
	if(!filter) {
		return true;
	}
	var result = runFilter(wiki, filter, widget, item);
	return !!result && result.length > 0;
}

function orderOf(value) {
	var n = parseFloat(value);
	return isNaN(n) ? null : n;
}

function compareText(a, b) {
	return a < b ? -1 : (a > b ? 1 : 0);
}

// wf.order first (missing last), then the given text keys
function compareOrder(a, b) {
	if(a.order === b.order) { return 0; }
	if(a.order === null) { return 1; }
	if(b.order === null) { return -1; }
	return a.order - b.order;
}

function compare(a, b) {
	return compareOrder(a, b) || compareText(a.caption, b.caption);
}

// Tiles: order, action caption, then the filter's value order
function compareTiles(a, b) {
	return compareOrder(a, b) || compareText(a._caption, b._caption) || (a._index - b._index);
}

function allTagged(wiki, tag) {
	return wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + tag + "]!is[draft]]");
}

// Group definitions by wf.name
function groupDefs(wiki) {
	var defs = {};
	allTagged(wiki, GROUP_TAG).forEach(function(title) {
		var f = wiki.getTiddler(title).fields, name = f["wf.name"];
		if(name && !defs[name]) {
			defs[name] = f;
		}
	});
	return defs;
}

// The tiles one matching action contributes; `widget` carries the context and action variables.
// _caption/_index are sort keys, removed when the groups are finished.
function tilesFor(wiki, title, fields, widget, item) {
	var order = orderOf(fields["wf.order"]);
	var icon = fields["wf.icon"] || "";
	var actionCaption = fields.caption || title;
	var tilesFilter = (fields["wf.tiles"] || "").trim();
	if(!tilesFilter) {
		return [{action: title, caption: actionCaption, sub: "", icon: icon, value: "", order: order, _caption: actionCaption, _index: 0}];
	}
	var values = runFilter(wiki, tilesFilter, widget, item) || [];
	return values.map(function(value, index) {
		var w = variablesWidget(wiki, {value: value}, widget);
		var caption = fields["wf.tile-label"] ? renderText(wiki, fields["wf.tile-label"], w) : value;
		return {action: title, caption: caption, sub: renderText(wiki, fields["wf.tile-sub"], w), icon: icon, value: value, order: order,
			_caption: actionCaption, _index: index};
	});
}

exports.select = function(wiki, item, area) {
	var vars = exports.context(wiki, item, area);
	var defs = groupDefs(wiki);
	// Matching, visible actions; filters see the global and the engine functions
	var base = variablesWidget(wiki, vars, filterWidget(wiki));
	var found = [];
	allTagged(wiki, ACTION_TAG).forEach(function(title) {
		var fields = wiki.getTiddler(title).fields;
		if((fields["wf.hidden"] || "").trim() === "yes") {
			return;
		}
		var widget = variablesWidget(wiki, {action: title, value: ""}, base);
		if(matches(wiki, fields, widget, item)) {
			found.push({title: title, fields: fields, widget: widget});
		}
	});
	var replaced = {};
	found.forEach(function(a) {
		$tw.utils.parseStringArray(a.fields["wf.replaces"] || "").forEach(function(t) { replaced[t] = true; });
	});
	// Group nodes, created on demand together with their ancestors
	var nodes = {};
	function node(name, guard) {
		if(nodes[name]) {
			return nodes[name];
		}
		var def = defs[name] || {};
		var n = nodes[name] = {name: name, caption: def.caption || name, icon: def["wf.icon"] || "", order: orderOf(def["wf.order"]),
			defaultAction: def["wf.default"] || "", defaultValue: def["wf.default-value"] || "", defaultTile: null, tiles: [], groups: [], parent: null};
		var parentName = def["wf.parent"];
		if(parentName && parentName !== name && !(guard && guard[parentName])) {
			var g = $tw.utils.extend({}, guard);
			g[name] = true;
			n.parent = node(parentName, g);
		}
		return n;
	}
	function depth(n) {
		var d = 1;
		while(n.parent) { d++; n = n.parent; }
		return d;
	}
	function attachTarget(n) {
		var chain = [];
		for(var c = n; c; c = c.parent) { chain.unshift(c); }
		return chain[Math.min(chain.length, MAX_DEPTH) - 1];
	}
	found.forEach(function(a) {
		if(replaced[a.title]) {
			return;
		}
		var groupName = (a.fields["wf.group"] || "").trim();
		if(!groupName) {
			return;
		}
		var target = attachTarget(node(groupName));
		tilesFor(wiki, a.title, a.fields, a.widget, item).forEach(function(tile) {
			if(!tile.icon) { tile.icon = target.icon; }
			target.tiles.push(tile);
		});
	});
	// Link nodes: each node goes under its (possibly capped) parent
	var tops = [];
	Object.keys(nodes).forEach(function(name) {
		var n = nodes[name];
		if(depth(n) > MAX_DEPTH) {
			return;
		}
		if(n.parent) { n.parent.groups.push(n); } else { tops.push(n); }
	});
	function finish(n) {
		n.groups = n.groups.map(finish).filter(Boolean);
		if(!n.tiles.length && !n.groups.length) {
			return null;
		}
		n.tiles.sort(compareTiles);
		n.tiles.forEach(function(t) { delete t._caption; delete t._index; });
		n.groups.sort(compare);
		n.defaultTile = n.tiles.filter(function(t) { return t.action === n.defaultAction && (!n.defaultValue || t.value === n.defaultValue); })[0] || n.tiles[0] || null;
		return {name: n.name, caption: n.caption, icon: n.icon, order: n.order, defaultTile: n.defaultTile, tiles: n.tiles, groups: n.groups};
	}
	var groups = tops.map(finish).filter(Boolean).sort(compare);
	if(groups.length > MAX_GROUPS) {
		var more = {name: "more", caption: "More", icon: "⋯", order: null, defaultTile: null, tiles: [], groups: groups.slice(MAX_GROUPS - 1)};
		groups = groups.slice(0, MAX_GROUPS - 1).concat([more]);
	}
	return {groups: groups};
};

// ---- Running ----

function recipeFields(wiki, actionFields) {
	var name = (actionFields["wf.recipe"] || "").trim(), found = null;
	if(name) {
		allTagged(wiki, RECIPE_TAG).forEach(function(title) {
			var f = wiki.getTiddler(title).fields;
			if(!found && f["wf.name"] === name) {
				found = f;
			}
		});
	}
	return found;
}

// Action field, else the same field of its recipe (blank counts as unset)
function inherited(action, recipe, name) {
	var v = (action[name] || "").trim();
	return v || (recipe && (recipe[name] || "").trim()) || "";
}

exports.actionString = function(wiki, action) {
	var tiddler = wiki.getTiddler(action);
	if(!tiddler) {
		return "";
	}
	var recipe = recipeFields(wiki, tiddler.fields);
	return recipe ? (recipe.text || "") : (tiddler.fields.text || "");
};

// Widget carrying the run variables for one tile
function runWidget(wiki, parent, tile, item, area) {
	var vars = exports.context(wiki, item, area);
	vars.value = tile.value || "";
	vars.action = tile.action;
	return variablesWidget(wiki, vars, parent);
}

function notify(wiki, message) {
	if($tw.notifier) {
		$tw.notifier.display(NOTIFICATION, {variables: {message: message}});
	}
}

exports.hint = function(wiki, tile, item, area) {
	var action = wiki.getTiddler(tile.action);
	if(!action) {
		return "";
	}
	var text = inherited(action.fields, recipeFields(wiki, action.fields), "wf.hint");
	return renderText(wiki, text, runWidget(wiki, filterWidget(wiki), tile, item, area));
};

// Invoke an action tile. ok:false (with a notification) when it throws, its recipe is missing or
// its wf.requires comes back blank;
// mark is the rendered acted mark, null when the action defers, has no mark, or failed.
exports.run = function(widget, tile, item, area) {
	var wiki = widget.wiki, action = wiki.getTiddler(tile.action);
	if(!action) {
		notify(wiki, "Action not found: " + tile.action);
		return {ok: false, mark: null, error: "Action not found: " + tile.action};
	}
	var fields = action.fields, recipe = recipeFields(wiki, fields);
	if((fields["wf.recipe"] || "").trim() && !recipe) {
		notify(wiki, "Recipe not found: " + fields["wf.recipe"]);
		return {ok: false, mark: null, error: "Recipe not found: " + fields["wf.recipe"]};
	}
	var w = runWidget(wiki, widget, tile, item, area);
	// wf.requires: a filter (engine functions imported) whose first value must be non-blank, e.g. the
	// field a recipe writes;
	// otherwise nothing runs and the run fails with wf.requires-message
	var requires = inherited(fields, recipe, "wf.requires");
	if(requires) {
		var got = runFilter(wiki, requires, check.importWidget(wiki, ENGINE_IMPORT, w), item);
		if(!got || !got.length || !String(got[0]).trim()) {
			var missing = inherited(fields, recipe, "wf.requires-message") || "Nothing to do";
			notify(wiki, missing);
			return {ok: false, mark: null, error: missing};
		}
	}
	try {
		w.invokeActionString(ENGINE_IMPORT + exports.actionString(wiki, tile.action), w, null, {});
	} catch(e) {
		var message = String(e && e.message || e);
		notify(wiki, message);
		return {ok: false, mark: null, error: message};
	}
	if(inherited(fields, recipe, "wf.deferred") === "yes" || inherited(fields, recipe, "wf.no-mark") === "yes") {
		return {ok: true, mark: null};
	}
	var mark = renderText(wiki, inherited(fields, recipe, "wf.mark"), w) || tile.caption || "";
	check.write(wiki, new Date(), {acted: {item: item, area: area, mark: mark}});
	return {ok: true, mark: mark};
};
