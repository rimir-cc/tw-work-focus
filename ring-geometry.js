/*\
title: $:/plugins/rimir/work-focus/ring-geometry.js
type: application/javascript
module-type: library

Pure geometry of the work-focus drag ring (no DOM): where the ring sits and where each
tile of an arc goes.

Angles: 0 = straight out of the panel edge, positive = downwards; `dir` is +1 when the ring
opens to the right of the edge, -1 to the left. A frame is {cx, cy, dir, vw, vh}.

Rules every layout keeps when it can (and the tests check):
* tiles are sized as hot (scaled) tiles, so even the hot tile stays clear
* no tile sticks out of the viewport (MARGIN)
* no tile reaches behind the edge line through the centre (i.e. over the panel)
* neighbours on an arc do not overlap: they are packed along the chord with a gap

\*/
"use strict";

var INNER_RADIUS = 125,
	ARC_STEP = 100,
	HOT_SCALE = 1.12,
	MARGIN = 8,
	GAPS = [14, 10, 6],
	// inner ring: preferred gap first, the radius grows before the gap shrinks
	INNER_TIERS = [{gap: 14, max: 165}, {gap: 10, max: 205}, {gap: 6, max: 245}],
	RADIUS_STEP = 10,
	ROTATE_STEP = 2 * Math.PI / 180,
	ROTATE_MAX = 90 * Math.PI / 180,
	// outer arcs may move out this far (in steps) when rotating and tighter gaps don't fit
	ARC_GROW = [0, 20, 40, 60],
	// vertical room kept around the centre (share of the first outer radius), so a fan near
	// the top or bottom has a sweep to turn into
	ROOM = 0.6,
	SIZE = {group: {w: 76, h: 52}, action: {w: 64, h: 44}};

exports.INNER_RADIUS = INNER_RADIUS;
exports.ARC_STEP = ARC_STEP;
exports.HOT_SCALE = HOT_SCALE;
exports.MARGIN = MARGIN;
exports.SIZE = SIZE;

function half(rec) {
	return {w: rec.w * HOT_SCALE / 2, h: rec.h * HOT_SCALE / 2};
}

// Extent of a (hot) tile projected on the tangent at angle a
function along(rec, a) {
	return (Math.abs(Math.cos(a)) * rec.h + Math.abs(Math.sin(a)) * rec.w) * HOT_SCALE;
}

// Angles for recs on radius r, centred on `centre`. Neighbours are separated along the
// chord between them (a separating axis), so they never overlap.
function pack(recs, r, centre, gap) {
	function step(i, at) {
		var need = along(recs[i - 1], at) / 2 + along(recs[i], at) / 2 + gap;
		return 2 * Math.asin(Math.min(1, need / (2 * r)));
	}
	function from(start) {
		var angles = [start];
		for(var i = 1; i < recs.length; i++) {
			var prev = angles[i - 1],
				guess = step(i, prev);
			// the chord axis lies at the middle angle: measure there (twice, it converges fast)
			guess = step(i, prev + guess / 2);
			angles.push(prev + Math.max(guess, step(i, prev + guess / 2)));
		}
		return angles;
	}
	var first = from(centre);
	return from(centre - (first[first.length - 1] - first[0]) / 2);
}

function place(frame, a, r) {
	return {x: frame.cx + frame.dir * r * Math.cos(a), y: frame.cy + r * Math.sin(a)};
}

// How far a tile at angle a reaches behind the edge line (over the panel), in pixels
function behind(rec, a, r) {
	return Math.max(0, half(rec).w - r * Math.cos(a));
}

// Pixels a tile sticks out of the viewport or behind the edge (0 = fine)
function violation(frame, rec, a, r) {
	var p = place(frame, a, r), h = half(rec);
	return Math.max(0, MARGIN - (p.x - h.w)) + Math.max(0, p.x + h.w - (frame.vw - MARGIN)) +
		Math.max(0, MARGIN - (p.y - h.h)) + Math.max(0, p.y + h.h - (frame.vh - MARGIN)) +
		behind(rec, a, r) * 10;
}

function score(frame, recs, angles, r) {
	return angles.reduce(function(sum, a, i) { return sum + violation(frame, recs[i], a, r); }, 0);
}

// Vertical reach of an arc around its centre: [top offset, bottom offset]
function span(recs, angles, r) {
	var top = Infinity, bottom = -Infinity;
	angles.forEach(function(a, i) {
		var h = half(recs[i]).h;
		top = Math.min(top, r * Math.sin(a) - h);
		bottom = Math.max(bottom, r * Math.sin(a) + h);
	});
	return {top: top, bottom: bottom};
}

// The inner ring, laid out once at drag start. `edge` = {x, dir} (panel edge and the free
// side), `rowY` the source row's centre, `levels` the deepest arc level that can open.
// Picks radius and gap so all groups fit beside the edge without overlap, then moves the
// centre (horizontally on narrow screens, vertically near the top or bottom) so the inner
// ring is inside the viewport. Returns {frame, radius, angles, ok}.
exports.inner = function(recs, view, edge, rowY, levels) {
	var vh = view.vh, choice = null;
	for(var t = 0; t < INNER_TIERS.length && !choice; t++) {
		for(var r = INNER_RADIUS; r <= INNER_TIERS[t].max && !choice; r += RADIUS_STEP) {
			var angles = pack(recs, r, 0, INNER_TIERS[t].gap),
				s = span(recs, angles, r),
				clear = angles.every(function(a, i) { return behind(recs[i], a, r) === 0; });
			if(clear && s.bottom - s.top <= vh - 2 * MARGIN) {
				choice = {radius: r, angles: angles, span: s, ok: true};
			}
		}
	}
	if(!choice) {
		// too short a viewport: tightest ring, tiles get clamped by the caller
		var rr = INNER_TIERS[INNER_TIERS.length - 1].max, aa = pack(recs, rr, 0, GAPS[GAPS.length - 1]);
		choice = {radius: rr, angles: aa, span: span(recs, aa, rr), ok: false};
	}
	var reach = choice.radius + ARC_STEP * levels + SIZE.group.w * HOT_SCALE / 2 + MARGIN,
		dir = edge.dir,
		cx = dir > 0 ? Math.min(edge.x, view.vw - reach) : Math.max(edge.x, reach),
		room = ROOM * (choice.radius + ARC_STEP),
		top = Math.min(choice.span.top, -room), bottom = Math.max(choice.span.bottom, room),
		cy = bottom - top <= vh - 2 * MARGIN ? Math.max(MARGIN - top, Math.min(vh - MARGIN - bottom, rowY)) :
			Math.max(MARGIN - choice.span.top, Math.min(vh - MARGIN - choice.span.bottom, rowY));
	// first group (the most used) nearest to the row: when the centre had to move up, away
	// from a row near the bottom, the order runs bottom to top (groups share one size, so the
	// mirrored angles keep the packing)
	var angles = cy < rowY - 0.5 ? choice.angles.slice().reverse() : choice.angles;
	return {frame: {cx: cx, cy: cy, dir: dir, vw: view.vw, vh: vh}, radius: choice.radius, reach: reach,
		angles: angles, ok: choice.ok};
};

// An outer arc of `recs` on radius `base` around `centre` (the owner's angle): rotate the
// sweep, smallest turn first, with the preferred gap; then with smaller gaps; then a little
// further out. Returns {angles, radius, ok}; when nothing fits, the best try (the caller clamps).
exports.arc = function(frame, recs, base, centre) {
	var best = null;
	for(var k = 0; k < ARC_GROW.length; k++) {
		var r = base + ARC_GROW[k];
		for(var g = 0; g < GAPS.length; g++) {
			for(var turn = 0; turn <= ROTATE_MAX + 1e-9; turn += ROTATE_STEP) {
				var tries = turn ? [turn, -turn] : [0];
				for(var t = 0; t < tries.length; t++) {
					var angles = pack(recs, r, centre + tries[t], GAPS[g]),
						s = score(frame, recs, angles, r);
					if(s === 0) {
						return {angles: angles, radius: r, ok: true};
					}
					if(!best || s < best.score) {
						best = {angles: angles, radius: r, score: s};
					}
				}
			}
		}
	}
	return {angles: best.angles, radius: best.radius, ok: false};
};

// Centre of a tile at angle a, clamped into the viewport
exports.position = function(frame, rec, a, r) {
	var p = place(frame, a, r), h = half(rec);
	return {
		x: Math.max(MARGIN + h.w, Math.min(frame.vw - MARGIN - h.w, p.x)),
		y: Math.max(MARGIN + h.h, Math.min(frame.vh - MARGIN - h.h, p.y))
	};
};

exports.place = place;
exports.pack = pack;
