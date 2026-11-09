/*\
title: $:/plugins/rimir/work-focus/ring-layer.js
type: application/javascript
module-type: widget

<$wf-ring-layer> wraps the work-focus layer and owns the drag gesture of the panel rows.

* idle it has exactly one listener: `pointerdown` on its host (delegated to `.wf-item`)
* a press adds move/up/cancel/key listeners on the document and blur on the window; the
  release removes them. Losing the window (blur, alt-tab) cancels: no pointerup may follow
* moving past DRAG_THRESHOLD (mouse, pen) or holding LONG_PRESS (touch) starts the drag:
  actions.select() decides the ring; nothing selected → the drag is dead, no ring
* the ring is a half ring on the panel edge facing the larger free space, centred on the
  source row: groups on the inner ring, a hovered group fans its tiles and sub-groups out on
  the next arc after FAN_DELAY; every arc is laid out once when it opens (ring-geometry.js:
  inside the viewport, clear of the panel, no overlaps), so nothing moves under the pointer
* releasing on an action tile runs it, on a group runs its default tile; elsewhere or Esc
  cancels. The ring is removed first; the panel re-renders from the new snapshot by the
  normal TW refresh. The click that follows a drag is eaten (capture phase on window, so
  click-outside.js does not close the panel and nothing underneath is clicked)

Tiles are plain DOM built from the Tile/Group data of actions.js, not wikitext.

Edit mode ($:/temp/rimir/work-focus/edit = yes; mockup dock-v4 part 2):
* the drag selects with {edit: true} (hidden actions and groups dimmed, empty groups too);
  every group fans; tiles carry ✎, the inner ring ends in "+ group", the arc of a real
  group ends in "+ add…" (a small menu: action / sub-group)
* releasing anywhere pins the ring instead of running anything (the click is still eaten).
  While pinned the gesture listeners are gone; hover works through the tiles' own
  pointerenter/leave, clicks open forms (wf-form-open in edit-engine) or arcs, and only two
  document listeners exist: Esc and a pointerdown outside ring, form and panel close it.
  Leaving edit mode or closing the panel closes it too (refresh)
* a change to an action, group or recipe tiddler (or one the ring shows) rebuilds the ring
  in place: same frame, the same arcs reopened by group name

\*/
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;
var actions = require("$:/plugins/rimir/work-focus/actions.js");
var geometry = require("$:/plugins/rimir/work-focus/ring-geometry.js");

var DRAG_THRESHOLD = 5,
	LONG_PRESS = 400,
	FAN_DELAY = 150,
	CLICK_EAT_MS = 400,
	ARC_STEP = geometry.ARC_STEP,
	MARGIN = geometry.MARGIN,
	SIZE = geometry.SIZE,
	HOT_SCALE = geometry.HOT_SCALE,
	// the form beside a pinned ring (form.tid .wf-form width; gap to the arcs and the window)
	FORM_WIDTH = 340,
	FORM_GAP = 16,
	FORM_MIN_HEIGHT = 420,
	SVG_NS = "http://www.w3.org/2000/svg",
	EDIT = "$:/temp/rimir/work-focus/edit",
	OPEN = "$:/temp/rimir/work-focus/open",
	FORM = "$:/temp/rimir/work-focus/form",
	// dock, panel and form state (incl. the form buffer): never a reason to rebuild the pinned ring
	STATE_PREFIX = "$:/temp/rimir/work-focus/",
	CONFIG_TAGS = [actions.ACTION_TAG, actions.GROUP_TAG, actions.RECIPE_TAG];

var RingLayerWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

RingLayerWidget.prototype = Object.create(Widget.prototype);

RingLayerWidget.prototype.render = function(parent, nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();
	var host = this.document.createElement("div");
	host.className = "wf-ring-host";
	parent.insertBefore(host, nextSibling);
	this.renderChildren(host, null);
	this.domNodes.push(host);
	this.host = host;
	this.listeners = [];
	if($tw.browser && host.addEventListener) {
		this.onDown = this.onPointerDown.bind(this);
		host.addEventListener("pointerdown", this.onDown);
	}
};

RingLayerWidget.prototype.refresh = function(changedTiddlers) {
	var changed = this.refreshChildren(changedTiddlers);
	if(this.ring && this.ring.pinned) {
		this.refreshPinned(changedTiddlers);
	}
	// A refresh during a drag may re-render panel or rows: put the drag marks back
	if(this.ring) {
		this.markPanel(true);
	}
	return changed;
};

RingLayerWidget.prototype.destroy = function(options) {
	if(this.onDown) {
		this.host.removeEventListener("pointerdown", this.onDown);
	}
	this.end();
	Widget.prototype.destroy.call(this, options);
};

// ---------- listeners (only while pressed) ----------

RingLayerWidget.prototype.listen = function(target, type, handler, options) {
	target.addEventListener(type, handler, options || false);
	this.listeners.push([target, type, handler, options || false]);
};

RingLayerWidget.prototype.unlisten = function() {
	this.listeners.forEach(function(l) {
		l[0].removeEventListener(l[1], l[2], l[3]);
	});
	this.listeners = [];
};

function prevent(event) {
	event.preventDefault();
}

// ---------- gesture ----------

RingLayerWidget.prototype.onPointerDown = function(event) {
	if(this.press || (event.pointerType === "mouse" && event.button !== 0)) {
		return;
	}
	var row = event.target && event.target.closest && event.target.closest(".wf-item[data-wf-item]");
	if(!row) {
		return;
	}
	if(this.ring) {
		// a pinned ring (edit mode) gives way to a press on a row
		this.end();
	}
	var self = this, doc = this.document;
	this.press = {
		x: event.clientX, y: event.clientY, pointerId: event.pointerId, touch: event.pointerType === "touch",
		item: row.getAttribute("data-wf-item"), area: row.getAttribute("data-wf-area") || "",
		label: (row.querySelector(".wf-item-label") || row).textContent,
		started: false, dead: false, timer: null
	};
	this.listen(doc, "pointermove", function(e) { self.onPointerMove(e); });
	this.listen(doc, "pointerup", function(e) { self.onPointerUp(e); });
	this.listen(doc, "pointercancel", function(e) { if(e.pointerId === self.press.pointerId) { self.end(); } });
	this.listen(doc, "keydown", function(e) { self.onKeyDown(e); }, true);
	this.listen(doc.defaultView, "blur", function() { self.end(); });
	if(this.press.touch) {
		// long press starts the drag; the system menu of a long press is suppressed
		this.listen(doc, "contextmenu", prevent, true);
		this.press.timer = setTimeout(function() { self.start(self.press.x, self.press.y); }, LONG_PRESS);
	}
};

RingLayerWidget.prototype.onPointerMove = function(event) {
	var press = this.press;
	if(event.pointerId !== press.pointerId) {
		return;
	}
	if(!press.started) {
		if(Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y) <= DRAG_THRESHOLD) {
			return;
		}
		if(press.touch) {
			// moved before the long press: a scroll, not a drag
			this.end();
			return;
		}
		this.start(event.clientX, event.clientY);
	}
	if(this.ring) {
		this.track(event.clientX, event.clientY);
	}
};

RingLayerWidget.prototype.onPointerUp = function(event) {
	var press = this.press;
	if(event.pointerId !== press.pointerId) {
		return;
	}
	if(!press.started) {
		// a plain click: let it through to the row (navigates)
		this.end();
		return;
	}
	if(this.ring && this.ring.edit) {
		// edit mode: the release pins the ring, nothing runs
		this.eatClick();
		this.pin();
		return;
	}
	var rec = this.ring ? this.hit(event.clientX, event.clientY) : null,
		tile = rec && (rec.kind === "action" ? rec.data : rec.data.defaultTile);
	this.end();
	this.eatClick();
	if(tile) {
		actions.run(this, tile, press.item, press.area);
	}
};

RingLayerWidget.prototype.onKeyDown = function(event) {
	if(event.key !== "Escape") {
		return;
	}
	// cancel the drag, keep the panel open; the release then only eats its click
	event.preventDefault();
	event.stopPropagation();
	clearTimeout(this.press.timer);
	this.press.started = true;
	this.press.dead = true;
	this.removeRing();
};

RingLayerWidget.prototype.start = function(x, y) {
	var press = this.press, groups = [], edit = this.wiki.getTiddlerText(EDIT) === "yes";
	clearTimeout(press.timer);
	press.started = true;
	try {
		groups = edit ? actions.select(this.wiki, press.item, press.area, {edit: true}).groups : actions.select(this.wiki, press.item, press.area).groups;
	} catch(e) {
		groups = [];
	}
	// edit mode shows a ring even without groups: it still has "+ group"
	if((!groups.length && !edit) || !this.buildRing(groups, edit)) {
		press.dead = true;
		return;
	}
	if(press.touch) {
		// keep the page from scrolling while a finger drags
		this.listen(this.document, "touchmove", prevent, {passive: false});
	}
	this.track(x, y);
};

// Remove ring, marks and every listener; the widget is idle again
RingLayerWidget.prototype.end = function() {
	if(this.press) {
		clearTimeout(this.press.timer);
	}
	this.removeRing();
	this.unlisten();
	this.press = null;
};

// The click that follows a drag: eaten before click-outside.js or the row see it
RingLayerWidget.prototype.eatClick = function() {
	var win = this.document.defaultView, timer;
	function eat(event) {
		event.stopPropagation();
		event.preventDefault();
		done();
	}
	function done() {
		clearTimeout(timer);
		win.removeEventListener("click", eat, true);
	}
	win.addEventListener("click", eat, true);
	timer = setTimeout(done, CLICK_EAT_MS);
};

// ---------- ring ----------

// In edit mode every group opens an arc (its tiles with ✎, "+ add…")
function fans(group, edit) {
	return !!edit || group.groups.length > 0 || group.tiles.length > 1;
}

// Deepest arc level a group list at `level` can open
function reach(groups, level, edit) {
	return groups.reduce(function(max, g) {
		return fans(g, edit) ? Math.max(max, reach(g.groups, level + 1, edit)) : max;
	}, level);
}

// The "More" group of actions.select: no tiddler, no tiles of its own (implicit groups have tiles)
function isMore(group) {
	return !group.title && !group.tiles.length;
}

function groupRec(g, depth) {
	return {kind: "group", data: g, depth: depth, w: SIZE.group.w, h: SIZE.group.h};
}

function actionRec(t) {
	return {kind: "action", data: t, w: SIZE.action.w, h: SIZE.action.h};
}

// "+" tiles: add = "group" (inner ring, group sized) or "in" (end of `owner`'s arc, action sized)
function addRec(add, owner) {
	var size = add === "group" ? SIZE.group : SIZE.action;
	return {kind: "add", data: {add: add, owner: owner}, w: size.w, h: size.h};
}

// Titles the ring shows: a change (or deletion) of one of them rebuilds a pinned ring
function shownTitles(groups, shown) {
	groups.forEach(function(g) {
		if(g.title) {
			shown[g.title] = true;
		}
		g.tiles.forEach(function(t) { shown[t.action] = true; });
		shownTitles(g.groups, shown);
	});
	return shown;
}

function el(doc, tag, className, text) {
	var node = doc.createElement(tag);
	node.className = className;
	if(text) {
		node.textContent = text;
	}
	return node;
}

RingLayerWidget.prototype.findPanel = function() {
	return this.host.querySelector(".wf-panel");
};

// The source row; titles are compared as attributes (no selector escaping)
RingLayerWidget.prototype.findRow = function(item, area) {
	var rows = this.host.querySelectorAll(".wf-item[data-wf-item]");
	for(var i = 0; i < rows.length; i++) {
		if(rows[i].getAttribute("data-wf-item") === item && (rows[i].getAttribute("data-wf-area") || "") === area) {
			return rows[i];
		}
	}
	return null;
};

RingLayerWidget.prototype.markPanel = function(on) {
	var ring = this.ring, panel = this.findPanel(), row = ring && this.findRow(ring.item, ring.area);
	if(panel) { panel.classList.toggle("wf-dragging", on); }
	if(row) { row.classList.toggle("wf-src", on); }
	// a pinned ring is clicked, not dragged
	this.document.documentElement.classList.toggle("wf-grabbing", on && !(ring && ring.pinned));
};

RingLayerWidget.prototype.buildRing = function(groups, edit) {
	var doc = this.document, press = this.press, layer = this.host.querySelector(".wf-layer"),
		panel = this.findPanel(), row = this.findRow(press.item, press.area);
	if(!layer || !panel || !row) {
		return false;
	}
	var view = {vw: doc.documentElement.clientWidth, vh: doc.documentElement.clientHeight},
		p = panel.getBoundingClientRect(), r = row.getBoundingClientRect(),
		dir = (view.vw - p.right) >= p.left ? 1 : -1;
	this.ring = {item: press.item, area: press.area, label: press.label, edit: !!edit, pinned: false,
		layout: {view: view, edge: {x: dir > 0 ? p.right : p.left, dir: dir}, rowY: r.top + r.height / 2}};
	this.drawRing(groups, null, layer);
	this.markPanel(true);
	return true;
};

// Lay out and draw the ring of `groups` into this.ring (item, area, label, edit, pinned, layout).
// The inner ring is laid out once here: radius, centre and angles never change during the drag.
// `keep` is the frame to keep (a rebuild of a pinned ring: the centre must not jump).
RingLayerWidget.prototype.drawRing = function(groups, keep, layer) {
	var doc = this.document, ring = this.ring, lay = ring.layout, edit = ring.edit,
		recs = groups.map(function(g) { return groupRec(g, isMore(g) ? 0 : 1); });
	if(edit) {
		recs.push(addRec("group", null));
	}
	var inner = geometry.inner(recs, lay.view, lay.edge, lay.rowY, reach(groups, 0, edit)),
		frame = keep || inner.frame, extent = inner.reach, dir = frame.dir;
	// the ring root covers the half disc on the free side
	var root = el(doc, "div", "wf-ring wf-ring-" + (dir > 0 ? "right" : "left") + (edit ? " wf-ring-edit" : "") + (ring.pinned ? " wf-pinned" : ""));
	root.style.left = (dir > 0 ? frame.cx : frame.cx - extent) + "px";
	root.style.top = (frame.cy - extent) + "px";
	root.style.width = extent + "px";
	root.style.height = (2 * extent) + "px";
	var svg = doc.createElementNS(SVG_NS, "svg");
	svg.setAttribute("class", "wf-ring-guides");
	svg.setAttribute("aria-hidden", "true");
	root.appendChild(svg);
	var ghost = el(doc, "div", "wf-ghost", ring.label);
	var hint = el(doc, "div", "wf-hint");
	root.appendChild(ghost);
	root.appendChild(hint);
	$tw.utils.extend(ring, {root: root, svg: svg, ghost: ghost, hint: hint, frame: frame, dir: dir,
		recs: [], arcs: [], hot: null, fanTimer: null, menu: null, shown: edit ? shownTitles(groups, {}) : null});
	this.addArc(0, null, recs, inner.angles, inner.radius);
	layer.appendChild(root);
};

RingLayerWidget.prototype.removeRing = function() {
	var ring = this.ring;
	if(!ring) {
		return;
	}
	clearTimeout(ring.fanTimer);
	if(ring.root.parentNode) {
		ring.root.parentNode.removeChild(ring.root);
	}
	this.markPanel(false);
	this.ring = null;
};

RingLayerWidget.prototype.place = function(a, r) {
	return geometry.place(this.ring.frame, a, r);
};

// Show one arc, laid out once: level 0 = the groups of the inner ring (angles from
// geometry.inner), deeper levels fan out of `owner` (geometry.arc around its angle)
RingLayerWidget.prototype.addArc = function(level, owner, recs, angles, r) {
	var self = this, ring = this.ring, doc = this.document,
		arc = {level: level, owner: owner, recs: recs, radius: r, guide: null};
	recs.forEach(function(rec, i) {
		var p = geometry.position(ring.frame, rec, angles[i], r);
		rec.level = level;
		rec.r = r;
		rec.angle = angles[i];
		rec.x = p.x;
		rec.y = p.y;
		rec.el = self.tileNode(rec, i);
		ring.root.appendChild(rec.el);
		ring.recs.push(rec);
	});
	// dashed guide along the arc, a little beyond its first and last tile
	// (from the smallest to the largest angle: a mirrored inner ring lists them bottom first)
	var pad = 18 / r, a0 = Math.min.apply(null, angles) - pad, a1 = Math.max.apply(null, angles) + pad,
		s = this.place(a0, r), e = this.place(a1, r),
		path = doc.createElementNS(SVG_NS, "path");
	path.setAttribute("class", "wf-ring-guide wf-ring-guide-" + Math.min(level, 1));
	path.setAttribute("d", "M" + s.x + " " + s.y + " A" + r + " " + r + " 0 " + (a1 - a0 > Math.PI ? 1 : 0) + " " + (ring.dir > 0 ? 1 : 0) + " " + e.x + " " + e.y);
	ring.svg.appendChild(path);
	arc.guide = path;
	ring.arcs.push(arc);
	if(owner) {
		owner.el.classList.add("wf-open");
	}
};

RingLayerWidget.prototype.closeDeeper = function(level) {
	var ring = this.ring;
	ring.arcs = ring.arcs.filter(function(arc) {
		if(arc.level <= level) {
			return true;
		}
		arc.recs.forEach(function(rec) {
			ring.root.removeChild(rec.el);
			ring.recs.splice(ring.recs.indexOf(rec), 1);
		});
		ring.svg.removeChild(arc.guide);
		if(arc.owner) {
			arc.owner.el.classList.remove("wf-open");
		}
		return false;
	});
};

RingLayerWidget.prototype.tileNode = function(rec, index) {
	var doc = this.document, d = rec.data, ring = this.ring, edit = ring.edit, node;
	if(rec.kind === "add") {
		node = this.addNode(rec);
	} else {
		node = el(doc, "div", "wf-tile wf-tile-" + rec.kind);
		node.setAttribute("data-wf-kind", rec.kind);
		node.setAttribute("title", d.caption);
		// edit mode: a hidden one says so in its sub line
		var sub = edit && d.hidden ? "hidden" : (rec.kind === "group" ? "" : d.sub);
		if(rec.kind === "group") {
			node.setAttribute("data-wf-group", d.name);
			node.appendChild(el(doc, "span", "wf-tile-icon", d.icon || "•"));
			node.appendChild(el(doc, "span", "wf-tile-caption", d.caption));
			if(!edit && fans(d)) {
				node.appendChild(el(doc, "span", "wf-tile-more", "▸"));
			}
		} else {
			node.setAttribute("data-wf-action", d.action);
			node.setAttribute("data-wf-value", d.value);
			// a sub line (e.g. the date) replaces the icon: both would crowd the small tile
			if(!sub && d.icon) {
				node.appendChild(el(doc, "span", "wf-tile-icon", d.icon));
			}
			node.appendChild(el(doc, "span", "wf-tile-caption", d.caption));
		}
		if(sub) {
			node.appendChild(el(doc, "span", "wf-tile-sub", sub));
		}
		if(edit) {
			this.decorate(node, rec);
		}
	}
	node.setAttribute("data-wf-level", String(rec.level));
	node.style.left = rec.x + "px";
	node.style.top = rec.y + "px";
	if(ring.still) {
		// a rebuild redraws in place: no entry animation
		node.style.animation = "none";
	} else {
		node.style.animationDelay = Math.min(index, 8) * 12 + "ms";
	}
	if(edit) {
		this.tileListeners(node, rec);
	}
	return node;
};

// Edit mode: ✎ badge on actions and groups (not on "More"), dimmed hidden ones, the action's
// caption in the tooltip of its tiles
RingLayerWidget.prototype.decorate = function(node, rec) {
	var d = rec.data;
	if(rec.kind === "group" && isMore(d)) {
		return;
	}
	node.classList.add("wf-tile-edit");
	if(d.hidden) {
		node.classList.add("wf-tile-hidden");
	}
	var badge = el(this.document, "span", "wf-tile-badge", "✎");
	badge.setAttribute("aria-hidden", "true");
	node.appendChild(badge);
	if(rec.kind === "action") {
		var caption = this.actionCaption(d.action);
		node.setAttribute("title", caption === d.caption ? d.caption : d.caption + " · " + caption);
	}
};

RingLayerWidget.prototype.addNode = function(rec) {
	var doc = this.document, d = rec.data, group = d.add === "group",
		node = el(doc, "div", "wf-tile wf-tile-add wf-tile-" + (group ? "group" : "action"));
	node.setAttribute("data-wf-kind", "add");
	node.setAttribute("data-wf-add", d.add);
	node.setAttribute("role", "button");
	node.appendChild(el(doc, "span", "wf-tile-icon", "＋"));
	if(group) {
		node.setAttribute("title", "New group");
		node.appendChild(el(doc, "span", "wf-tile-caption", "group"));
	} else {
		node.setAttribute("data-wf-group", d.owner.data.name);
		node.setAttribute("title", "Add to " + d.owner.data.caption);
		node.appendChild(el(doc, "span", "wf-tile-sub", "add…"));
	}
	return node;
};

RingLayerWidget.prototype.actionCaption = function(title) {
	var tiddler = this.wiki.getTiddler(title);
	return (tiddler && tiddler.fields.caption) || title;
};

// ---------- hover ----------

RingLayerWidget.prototype.hit = function(x, y) {
	var target = this.document.elementFromPoint(x, y),
		node = target && target.closest && target.closest(".wf-tile");
	if(!node) {
		return null;
	}
	return this.ring.recs.filter(function(rec) { return rec.el === node; })[0] || null;
};

function runnable(rec) {
	return rec.kind === "action" || !!rec.data.defaultTile;
}

RingLayerWidget.prototype.track = function(x, y) {
	var ring = this.ring;
	// ghost sits on the panel side of the pointer, away from the tiles
	ring.ghost.style.transform = "translate(" + (x + (ring.dir > 0 ? -14 : 14)) + "px," + (y - 14) + "px)" +
		(ring.dir > 0 ? " translateX(-100%)" : "") + " rotate(-2deg)";
	this.setHot(this.hit(x, y));
};

// The tile under the pointer (null: none); resting on it for FAN_DELAY dwells
RingLayerWidget.prototype.setHot = function(rec) {
	var ring = this.ring;
	if(rec === ring.hot) {
		return;
	}
	if(ring.hot) {
		ring.hot.el.classList.remove("wf-hot", "wf-over");
	}
	ring.hot = rec;
	// over a tile the hot tile and its hint speak; the ghost steps back so it covers nothing
	ring.root.classList.toggle("wf-ring-aimed", !!rec);
	clearTimeout(ring.fanTimer);
	if(!rec) {
		this.showHint(null);
		return;
	}
	// edit mode runs nothing: no tile is "hot" (release → run), they are only pointed at
	rec.el.classList.add(!ring.edit && runnable(rec) ? "wf-hot" : "wf-over");
	this.showHint(rec);
	var self = this;
	ring.fanTimer = setTimeout(function() { self.dwell(rec); }, FAN_DELAY);
};

// Resting on a tile: deeper arcs of other branches close, a fanning group opens its arc.
// A pinned ring with an open form keeps its arcs (the way to the form must not change them):
// then only a click opens an arc.
RingLayerWidget.prototype.dwell = function(rec) {
	var ring = this.ring;
	if(!ring || ring.hot !== rec || (ring.pinned && this.wiki.tiddlerExists(FORM))) {
		return;
	}
	var owned = ring.arcs.some(function(arc) { return arc.owner === rec; });
	if(owned) {
		return;
	}
	this.openArc(rec);
	// the outermost arc may have changed: move the hint outside it
	this.showHint(rec);
};

// Close the arcs deeper than rec; a fanning group opens its arc one ARC_STEP outside its own
// (outer arcs may have moved out a little). Edit mode: a real group's arc ends in "+ add…".
RingLayerWidget.prototype.openArc = function(rec) {
	var ring = this.ring, g = rec.data;
	this.closeDeeper(rec.level);
	if(rec.kind !== "group" || !fans(g, ring.edit)) {
		return;
	}
	var recs = g.tiles.map(actionRec).concat(g.groups.map(function(sub) { return groupRec(sub, rec.depth + 1); }));
	if(ring.edit && g.title) {
		recs.push(addRec("in", rec));
	}
	var fan = geometry.arc(ring.frame, recs, rec.r + ARC_STEP, rec.angle);
	this.addArc(rec.level + 1, rec, recs, fan.angles, fan.radius);
};

RingLayerWidget.prototype.hintText = function(rec) {
	if(this.ring.edit) {
		return this.editHint(rec);
	}
	if(rec.hint === undefined) {
		var tile = rec.kind === "action" ? rec.data : rec.data.defaultTile, text = "";
		if(tile) {
			try {
				text = actions.hint(this.wiki, tile, this.ring.item, this.ring.area);
			} catch(e) {
				text = "";
			}
			text = "Release → " + (text || tile.caption);
		}
		rec.hint = text;
	}
	return rec.hint;
};

RingLayerWidget.prototype.editHint = function(rec) {
	var d = rec.data, text;
	if(!this.ring.pinned) {
		return "Release: the ring stays open for editing";
	}
	if(rec.kind === "add") {
		return d.add === "group" ? "New group" : "Add an action or a sub-group to " + d.owner.data.caption;
	}
	if(rec.kind === "action") {
		text = "Edit action \u201c" + this.actionCaption(d.action) + "\u201d";
	} else if(isMore(d)) {
		return "More groups";
	} else {
		text = "Open \u201c" + d.caption + "\u201d · ✎ edits the group";
	}
	return d.hidden ? text + " (hidden)" : text;
};

// The hint pill sits just outside the outermost open arc, at the hot tile's angle
RingLayerWidget.prototype.showHint = function(rec) {
	var ring = this.ring, hint = ring.hint, text = rec ? this.hintText(rec) : "";
	if(!text) {
		hint.classList.remove("wf-shown");
		return;
	}
	hint.textContent = text;
	var outer = ring.arcs.reduce(function(max, arc) { return Math.max(max, arc.radius); }, 0),
		p = this.place(rec.angle, outer + SIZE.group.w / 2 + 12),
		w = hint.offsetWidth, h = hint.offsetHeight,
		left = ring.dir > 0 ? p.x : p.x - w;
	left = Math.max(MARGIN, Math.min(ring.frame.vw - MARGIN - w, left));
	var top = Math.max(MARGIN, Math.min(ring.frame.vh - MARGIN - h, p.y - h / 2));
	hint.style.transform = "translate(" + left + "px," + top + "px)";
	hint.classList.add("wf-shown");
};

// ---------- edit mode: the pinned ring ----------

// The release pinned the ring: gesture listeners go, the close listeners come
RingLayerWidget.prototype.pin = function() {
	var self = this, doc = this.document, ring = this.ring;
	clearTimeout(this.press.timer);
	this.unlisten();
	this.press = null;
	ring.pinned = true;
	ring.root.classList.add("wf-pinned");
	ring.root.classList.remove("wf-ring-aimed");
	this.markPanel(true);
	this.showHint(ring.hot);
	this.listen(doc, "keydown", function(e) { self.onPinnedKey(e); }, true);
	this.listen(doc, "pointerdown", function(e) { self.onPinnedDown(e); }, true);
};

// Hover and clicks of a pinned ring come from the tiles themselves (no document listeners)
RingLayerWidget.prototype.tileListeners = function(node, rec) {
	var self = this;
	node.addEventListener("pointerenter", function() {
		if(self.ring && self.ring.pinned) {
			self.setHot(rec);
		}
	});
	node.addEventListener("pointerleave", function() {
		if(self.ring && self.ring.pinned && self.ring.hot === rec) {
			self.setHot(null);
		}
	});
	node.addEventListener("click", function(event) {
		if(self.ring && self.ring.pinned && self.ring.recs.indexOf(rec) !== -1) {
			self.onTileClick(rec, event);
		}
	});
};

RingLayerWidget.prototype.onTileClick = function(rec, event) {
	var d = rec.data, ring = this.ring,
		badge = event.target && event.target.closest && event.target.closest(".wf-tile-badge");
	if(rec.kind === "add") {
		if(d.add === "group") {
			this.openForm("group", "", null, null, rec);
		} else {
			this.toggleMenu(rec);
		}
	} else if(rec.kind === "action") {
		this.openForm("action", d.action, null, rec);
	} else if(badge && d.title) {
		this.openForm("group", d.title, null, rec);
	} else if(badge) {
		// an implicit group (named by actions only) has no tiddler yet: a new one with its name
		this.openForm("group", "", {"wf.name": d.name, caption: d.caption}, rec);
	} else if(!ring.arcs.some(function(arc) { return arc.owner === rec; })) {
		// a click opens a group's arc at once
		clearTimeout(ring.fanTimer);
		this.openArc(rec);
		this.showHint(rec);
	}
};

// Open the action or group form beside the ring, on its free side; titles travel as variables.
// `rec` is the tile being edited (marked), `anchor` the tile the form lines up with (default rec).
RingLayerWidget.prototype.openForm = function(kind, target, preset, rec, anchor) {
	var ring = this.ring, at = this.formPlace(anchor || rec);
	ring.sel = rec ? {kind: rec.kind, action: rec.data.action, value: rec.data.value, name: rec.data.name} : null;
	this.invokeActionString("<<wf-form-open>>", this, null, {
		kind: kind, target: target, item: ring.item, area: ring.area,
		preset: preset ? JSON.stringify(preset) : "", side: ring.dir > 0 ? "right" : "left",
		value: rec && rec.kind === "action" ? rec.data.value || "" : "",
		left: at ? String(at.left) : "", top: at ? String(at.top) : ""
	});
	this.markEditing();
};

// Where the form goes next to the ring: just outside the outermost open arc on the free side,
// level with the tile (a little above it), kept FORM_MIN_HEIGHT clear of the bottom when it can.
// Fixed at open time (arcs opening later or a rebuild don't move it). null = it doesn't fit
// beside the ring: form.tid puts it at the window edge of the free side instead.
RingLayerWidget.prototype.formPlace = function(rec) {
	var ring = this.ring, doc = this.document.documentElement;
	if(!rec) {
		return null;
	}
	var vw = doc.clientWidth, vh = doc.clientHeight,
		outer = ring.arcs.reduce(function(max, arc) { return Math.max(max, arc.radius); }, 0),
		reach = outer + SIZE.group.w * HOT_SCALE / 2 + FORM_GAP,
		left = ring.dir > 0 ? ring.frame.cx + reach : ring.frame.cx - reach - FORM_WIDTH;
	if(left < FORM_GAP || left + FORM_WIDTH > vw - FORM_GAP) {
		return null;
	}
	var top = Math.max(FORM_GAP, Math.min(rec.y - 40, vh - FORM_GAP - FORM_MIN_HEIGHT));
	return {left: Math.round(left), top: Math.round(top)};
};

// The tile whose form is open is marked (cleared when the form closes)
RingLayerWidget.prototype.markEditing = function() {
	var ring = this.ring, sel = this.wiki.tiddlerExists(FORM) ? ring.sel : null;
	if(!sel) {
		ring.sel = null;
	}
	ring.recs.forEach(function(rec) {
		var d = rec.data,
			on = !!sel && rec.kind === sel.kind && (rec.kind === "action" ? d.action === sel.action && d.value === sel.value : d.name === sel.name);
		rec.el.classList.toggle("wf-tile-editing", on);
	});
};

// "+ add…": a small menu beside the tile, below it (above when there is no room), clamped
RingLayerWidget.prototype.toggleMenu = function(rec) {
	var ring = this.ring, open = ring.menu && ring.menu.rec;
	this.closeMenu();
	if(open === rec) {
		return;
	}
	var self = this, doc = this.document, owner = rec.data.owner, g = owner.data,
		menu = el(doc, "div", "wf-add-menu");
	menu.setAttribute("role", "menu");
	function item(text, kind, preset) {
		var button = el(doc, "button", "wf-add-menu-item", text);
		button.type = "button";
		button.setAttribute("role", "menuitem");
		button.setAttribute("data-wf-add-kind", kind);
		button.addEventListener("click", function() {
			self.closeMenu();
			self.openForm(kind, "", preset, null, rec);
		});
		menu.appendChild(button);
	}
	item("＋ action in " + g.caption, "action", {"wf.group": g.name});
	if(owner.depth < actions.MAX_DEPTH) {
		item("＋ sub-group in " + g.caption, "group", {"wf.parent": g.name});
	}
	ring.root.appendChild(menu);
	var w = menu.offsetWidth, h = menu.offsetHeight, half = rec.h * HOT_SCALE / 2,
		// towards the panel, its edge a little past the tile's centre (the free side stays clear for the form)
		left = ring.dir > 0 ? rec.x + 30 - w : rec.x - 30,
		top = rec.y + half + 6;
	if(top + h > ring.frame.vh - MARGIN) {
		top = rec.y - half - 6 - h;
	}
	menu.style.left = Math.max(MARGIN, Math.min(ring.frame.vw - MARGIN - w, left)) + "px";
	menu.style.top = Math.max(MARGIN, Math.min(ring.frame.vh - MARGIN - h, top)) + "px";
	ring.menu = {node: menu, rec: rec};
	rec.el.classList.add("wf-open");
	menu.firstChild.focus();
};

RingLayerWidget.prototype.closeMenu = function() {
	var ring = this.ring;
	if(ring && ring.menu) {
		ring.menu.node.parentNode.removeChild(ring.menu.node);
		ring.menu.rec.el.classList.remove("wf-open");
		ring.menu = null;
	}
};

// Esc: the menu first; with a form open the layer's Esc closes the form (when the focus is
// outside the layer it can't hear it: then it runs here); otherwise the ring closes
RingLayerWidget.prototype.onPinnedKey = function(event) {
	if(event.key !== "Escape") {
		return;
	}
	if(this.wiki.tiddlerExists(FORM) && !this.ring.menu) {
		var target = event.target;
		if(!(target && target.closest && target.closest(".wf-keys"))) {
			event.preventDefault();
			event.stopPropagation();
			this.invokeActionString("<<wf-escape>>", this, null, {});
		}
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	if(this.ring.menu) {
		this.closeMenu();
	} else {
		this.end();
	}
};

// A press outside the menu closes it; outside ring, form and panel the ring closes
RingLayerWidget.prototype.onPinnedDown = function(event) {
	var target = event.target, ring = this.ring,
		inside = function(selector) { return !!(target && target.closest && target.closest(selector)); };
	if(ring.menu && !inside(".wf-add-menu") && !ring.menu.rec.el.contains(target)) {
		this.closeMenu();
	}
	if(!inside(".wf-ring, .wf-form, .wf-panel")) {
		this.end();
	}
};

RingLayerWidget.prototype.refreshPinned = function(changedTiddlers) {
	var wiki = this.wiki, ring = this.ring;
	// the ring's source rows are the Actions view: switching to Areas ends it
	if(wiki.getTiddlerText(EDIT) !== "yes" || wiki.getTiddlerText(OPEN) !== "yes" ||
		wiki.getTiddlerText("$:/temp/rimir/work-focus/edit-view") !== "actions") {
		this.end();
		return;
	}
	if(!ring.root.parentNode || !this.host.contains(ring.root)) {
		// the layer element was re-rendered: move the ring into the new one
		var layer = this.host.querySelector(".wf-layer");
		if(!layer) {
			this.end();
			return;
		}
		layer.appendChild(ring.root);
	}
	if(this.configChanged(changedTiddlers)) {
		this.rebuild();
	} else if(changedTiddlers[FORM]) {
		this.markEditing();
	}
};

// An action, group or recipe tiddler changed, or one the ring shows (also a deletion)
RingLayerWidget.prototype.configChanged = function(changedTiddlers) {
	var wiki = this.wiki, shown = this.ring.shown;
	return Object.keys(changedTiddlers).some(function(title) {
		if(title.indexOf(STATE_PREFIX) === 0) {
			return false;
		}
		if(shown[title]) {
			return true;
		}
		var tiddler = wiki.getTiddler(title);
		return !!tiddler && !tiddler.fields["draft.of"] && CONFIG_TAGS.some(function(tag) { return tiddler.hasTag(tag); });
	});
};

// Select again and redraw in place: same frame, the open arcs reopened by group name
RingLayerWidget.prototype.rebuild = function() {
	var ring = this.ring, groups,
		chain = ring.arcs.filter(function(arc) { return arc.owner; }).map(function(arc) { return arc.owner.data.name; });
	try {
		groups = actions.select(this.wiki, ring.item, ring.area, {edit: true}).groups;
	} catch(e) {
		groups = [];
	}
	clearTimeout(ring.fanTimer);
	var layer = ring.root.parentNode;
	layer.removeChild(ring.root);
	ring.still = true;
	this.drawRing(groups, ring.frame, layer);
	for(var level = 0; level < chain.length; level++) {
		var owner = ring.recs.filter(function(rec) {
			return rec.level === level && rec.kind === "group" && rec.data.name === chain[level];
		})[0];
		if(!owner) {
			break;
		}
		this.openArc(owner);
	}
	ring.still = false;
	this.markEditing();
};

exports["wf-ring-layer"] = RingLayerWidget;
