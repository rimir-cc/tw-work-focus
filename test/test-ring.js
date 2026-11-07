/*\
title: $:/plugins/rimir/work-focus/test/test-ring.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the ring geometry (ring-geometry.js): fits the viewport, clear of the panel, no overlaps.

\*/
"use strict";

var geometry = require("$:/plugins/rimir/work-focus/ring-geometry.js");

describe("work-focus ring geometry", function() {

	var VIEW = {vw: 1280, vh: 800};

	function tiles(n, kind) {
		var list = [];
		for(var i = 0; i < n; i++) {
			list.push({w: geometry.SIZE[kind].w, h: geometry.SIZE[kind].h});
		}
		return list;
	}
	// Hot-sized rectangles of the placed tiles
	function rects(frame, recs, angles, r) {
		return recs.map(function(rec, i) {
			var p = geometry.position(frame, rec, angles[i], r), w = rec.w * geometry.HOT_SCALE, h = rec.h * geometry.HOT_SCALE;
			return {x: p.x - w / 2, y: p.y - h / 2, w: w, h: h};
		});
	}
	function overlap(a, b) {
		return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
	}
	// Problems of a set of rectangles: outside the viewport, over the panel, overlapping
	function problems(list, edge, others) {
		var found = [];
		list.forEach(function(a, i) {
			if(a.x < 0 || a.y < 0 || a.x + a.w > VIEW.vw || a.y + a.h > VIEW.vh) { found.push("viewport " + i); }
			if(edge.dir > 0 ? a.x < edge.x : a.x + a.w > edge.x) { found.push("panel " + i); }
			list.forEach(function(b, j) { if(j > i && overlap(a, b)) { found.push("overlap " + i + "/" + j); } });
			(others || []).forEach(function(b, j) { if(overlap(a, b)) { found.push("inner " + i + "/" + j); } });
		});
		return found;
	}

	[{x: 390, dir: 1}, {x: 890, dir: -1}].forEach(function(edge) {
		[30, 140, 400, 700, 740, 785].forEach(function(rowY) {
			[1, 3, 5, 6].forEach(function(n) {
				it("fits " + n + " groups for a row at y=" + rowY + " (dir " + edge.dir + ") with fanned arcs", function() {
					var groups = tiles(n, "group"),
						inner = geometry.inner(groups, VIEW, edge, rowY, 1),
						innerRects = rects(inner.frame, groups, inner.angles, inner.radius);
					expect(inner.ok).toBe(true);
					expect(problems(innerRects, edge)).toEqual([]);
					// the outer arc of the first and the last group: 6 day tiles
					[0, n - 1].forEach(function(g) {
						var days = tiles(6, "action"), r = inner.radius + geometry.ARC_STEP,
							arc = geometry.arc(inner.frame, days, r, inner.angles[g]);
						expect(arc.ok).toBe(true);
						expect(problems(rects(inner.frame, days, arc.angles, r), edge, innerRects)).toEqual([]);
					});
				});
			});
		});
	});

	it("puts the first group nearest to the row when the centre moves away from an edge", function() {
		var edge = {x: 390, dir: 1}, groups = tiles(5, "group");
		// row near the bottom: centre moved up, first group lowest (largest angle)
		var low = geometry.inner(groups, VIEW, edge, 760, 1);
		expect(low.frame.cy).toBeLessThan(760);
		expect(low.angles[0]).toBe(Math.max.apply(null, low.angles));
		// row near the top: centre moved down, first group highest (smallest angle)
		var high = geometry.inner(groups, VIEW, edge, 30, 1);
		expect(high.frame.cy).toBeGreaterThan(30);
		expect(high.angles[0]).toBe(Math.min.apply(null, high.angles));
		// room around the row: centred on it, first group on top
		var mid = geometry.inner(groups, VIEW, edge, 400, 1);
		expect(mid.frame.cy).toBe(400);
		expect(mid.angles[0]).toBe(Math.min.apply(null, mid.angles));
	});

	it("keeps the inner ring at the row and at 125 px when there is room", function() {
		var inner = geometry.inner(tiles(3, "group"), VIEW, {x: 390, dir: 1}, 400, 1);
		expect(inner.radius).toBe(geometry.INNER_RADIUS);
		expect(inner.frame.cy).toBe(400);
		expect(inner.frame.cx).toBe(390);
	});

	it("moves the centre inward on a narrow viewport so the deepest arc fits", function() {
		var view = {vw: 360, vh: 640}, inner = geometry.inner(tiles(3, "group"), view, {x: 350, dir: 1}, 200, 1);
		expect(inner.frame.cx + inner.reach).toBeLessThanOrEqual(360 + 1e-9);
	});
});
