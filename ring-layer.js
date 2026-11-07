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
	SVG_NS = "http://www.w3.org/2000/svg";

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
	var press = this.press, groups = [];
	clearTimeout(press.timer);
	press.started = true;
	try {
		groups = actions.select(this.wiki, press.item, press.area).groups;
	} catch(e) {
		groups = [];
	}
	if(!groups.length || !this.buildRing(groups)) {
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

function fans(group) {
	return group.groups.length > 0 || group.tiles.length > 1;
}

// Deepest arc level a group list at `level` can open
function reach(groups, level) {
	return groups.reduce(function(max, g) {
		return fans(g) ? Math.max(max, reach(g.groups, level + 1)) : max;
	}, level);
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
RingLayerWidget.prototype.findRow = function() {
	var press = this.press, rows = this.host.querySelectorAll(".wf-item[data-wf-item]");
	for(var i = 0; i < rows.length; i++) {
		if(rows[i].getAttribute("data-wf-item") === press.item && (rows[i].getAttribute("data-wf-area") || "") === press.area) {
			return rows[i];
		}
	}
	return null;
};

RingLayerWidget.prototype.markPanel = function(on) {
	var panel = this.findPanel(), row = this.findRow();
	if(panel) { panel.classList.toggle("wf-dragging", on); }
	if(row) { row.classList.toggle("wf-src", on); }
	this.document.documentElement.classList.toggle("wf-grabbing", on);
};

RingLayerWidget.prototype.buildRing = function(groups) {
	var doc = this.document, layer = this.host.querySelector(".wf-layer"),
		panel = this.findPanel(), row = this.findRow();
	if(!layer || !panel || !row) {
		return false;
	}
	var view = {vw: doc.documentElement.clientWidth, vh: doc.documentElement.clientHeight},
		p = panel.getBoundingClientRect(), r = row.getBoundingClientRect(),
		dir = (view.vw - p.right) >= p.left ? 1 : -1,
		recs = groups.map(function(g) { return {kind: "group", data: g, w: SIZE.group.w, h: SIZE.group.h}; }),
		// the inner ring is laid out once here: radius, centre and angles never change during the drag
		inner = geometry.inner(recs, view, {x: dir > 0 ? p.right : p.left, dir: dir}, r.top + r.height / 2, reach(groups, 0)),
		frame = inner.frame, extent = inner.reach;
	// the ring root covers the half disc on the free side
	var root = el(doc, "div", "wf-ring wf-ring-" + (dir > 0 ? "right" : "left"));
	root.style.left = (dir > 0 ? frame.cx : frame.cx - extent) + "px";
	root.style.top = (frame.cy - extent) + "px";
	root.style.width = extent + "px";
	root.style.height = (2 * extent) + "px";
	var svg = doc.createElementNS(SVG_NS, "svg");
	svg.setAttribute("class", "wf-ring-guides");
	svg.setAttribute("aria-hidden", "true");
	root.appendChild(svg);
	var ghost = el(doc, "div", "wf-ghost", this.press.label);
	var hint = el(doc, "div", "wf-hint");
	root.appendChild(ghost);
	root.appendChild(hint);
	this.ring = {root: root, svg: svg, ghost: ghost, hint: hint, frame: frame, dir: dir,
		recs: [], arcs: [], hot: null, fanTimer: null};
	this.addArc(0, null, recs, inner.angles, inner.radius);
	layer.appendChild(root);
	this.markPanel(true);
	return true;
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
	var doc = this.document, d = rec.data,
		node = el(doc, "div", "wf-tile wf-tile-" + rec.kind);
	node.setAttribute("data-wf-kind", rec.kind);
	node.setAttribute("data-wf-level", String(rec.level));
	node.setAttribute("title", d.caption);
	if(rec.kind === "group") {
		node.setAttribute("data-wf-group", d.name);
		node.appendChild(el(doc, "span", "wf-tile-icon", d.icon || "•"));
		node.appendChild(el(doc, "span", "wf-tile-caption", d.caption));
		if(fans(d)) {
			node.appendChild(el(doc, "span", "wf-tile-more", "▸"));
		}
	} else {
		node.setAttribute("data-wf-action", d.action);
		node.setAttribute("data-wf-value", d.value);
		// a sub line (e.g. the date) replaces the icon: both would crowd the small tile
		if(!d.sub && d.icon) {
			node.appendChild(el(doc, "span", "wf-tile-icon", d.icon));
		}
		node.appendChild(el(doc, "span", "wf-tile-caption", d.caption));
		if(d.sub) {
			node.appendChild(el(doc, "span", "wf-tile-sub", d.sub));
		}
	}
	node.style.left = rec.x + "px";
	node.style.top = rec.y + "px";
	node.style.animationDelay = Math.min(index, 8) * 12 + "ms";
	return node;
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
	var rec = this.hit(x, y);
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
	rec.el.classList.add(runnable(rec) ? "wf-hot" : "wf-over");
	this.showHint(rec);
	var self = this;
	ring.fanTimer = setTimeout(function() { self.dwell(rec); }, FAN_DELAY);
};

// Resting on a tile: deeper arcs of other branches close, a fanning group opens its arc
RingLayerWidget.prototype.dwell = function(rec) {
	var ring = this.ring;
	if(!ring || ring.hot !== rec) {
		return;
	}
	var owned = ring.arcs.some(function(arc) { return arc.owner === rec; });
	if(owned) {
		return;
	}
	this.closeDeeper(rec.level);
	if(rec.kind === "group" && fans(rec.data)) {
		var g = rec.data,
			recs = g.tiles.map(function(t) { return {kind: "action", data: t, w: SIZE.action.w, h: SIZE.action.h}; })
				.concat(g.groups.map(function(sub) { return {kind: "group", data: sub, w: SIZE.group.w, h: SIZE.group.h}; }));
		// one ARC_STEP outside the owner's arc (outer arcs may have moved out a little)
		var fan = geometry.arc(this.ring.frame, recs, rec.r + ARC_STEP, rec.angle);
		this.addArc(rec.level + 1, rec, recs, fan.angles, fan.radius);
	}
	// the outermost arc may have changed: move the hint outside it
	this.showHint(rec);
};

RingLayerWidget.prototype.hintText = function(rec) {
	if(rec.hint === undefined) {
		var tile = rec.kind === "action" ? rec.data : rec.data.defaultTile, text = "";
		if(tile) {
			try {
				text = actions.hint(this.wiki, tile, this.press.item, this.press.area);
			} catch(e) {
				text = "";
			}
			text = "Release → " + (text || tile.caption);
		}
		rec.hint = text;
	}
	return rec.hint;
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

exports["wf-ring-layer"] = RingLayerWidget;
