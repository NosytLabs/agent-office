/* Deterministic room behavior. This module reads scene snapshots only: no DOM,
 * timers, storage, observer events, XP, usage, or model calls. */
"use strict";
class OfficePetController {
  constructor(planner) {
    this.planner = planner;
    this.pets = new Map();
    this.geometry = null;
  }
  random(pet) {
    pet.seed = (Math.imul(pet.seed, 1664525) + 1013904223) >>> 0;
    return pet.seed / 4294967296;
  }
  clear(point, world) {
    return (
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= 12 &&
      point.x <= world.w - 12 &&
      point.y >= 46 &&
      point.y <= world.h - 12 &&
      !world.blocked.some(
        (b) =>
          point.x > b.x - 7 &&
          point.x < b.x + b.w + 7 &&
          point.y > b.y - 1 &&
          point.y < b.y + b.h + 17,
      )
    );
  }
  safePlace(origin, world) {
    const clamp = (p) => ({
      x: Math.max(12, Math.min(world.w - 12, p.x)),
      y: Math.max(46, Math.min(world.h - 12, p.y)),
    });
    const center = clamp(origin),
      candidates = [center];
    // At most 77 placement checks. A fully obstructed room hides the pet until
    // space becomes available instead of leaving it inside a wall or furniture.
    for (let radius = 8; radius <= 72; radius += 8)
      for (let direction = 0; direction < 8; direction++)
        candidates.push(
          clamp({
            x: center.x + Math.cos((direction * Math.PI) / 4) * radius,
            y: center.y + Math.sin((direction * Math.PI) / 4) * radius,
          }),
        );
    candidates.push(
      { x: 12, y: 46 },
      { x: world.w - 12, y: 46 },
      { x: 12, y: world.h - 12 },
      { x: world.w - 12, y: world.h - 12 },
    );
    return candidates.find((p) => this.clear(p, world)) || null;
  }
  busy(agent) {
    return (
      ["working", "thinking", "waiting"].includes(agent.status) ||
      (agent.quiet && ["working", "thinking"].includes(agent.recorded_status))
    );
  }
  route(pet, target, world) {
    // Reuse the office's collision-aware pathfinder in a small local window.
    // Even a very tall office cannot turn one pet decision into a whole-floor BFS.
    const left = Math.max(12, pet.x - 72),
      right = Math.min(world.w - 12, pet.x + 72),
      top = Math.max(46, pet.y - 72),
      bottom = Math.min(world.h - 12, pet.y + 72),
      origin = { x: left - 10, y: top - 30 },
      goal = {
        x: Math.max(left, Math.min(right, target.x)),
        y: Math.max(top, Math.min(bottom, target.y)),
      };
    if (
      !this.clear(goal, world) ||
      Math.hypot(goal.x - pet.x, goal.y - pet.y) < 8
    )
      return null;
    const blocked = world.blocked.map((b) => ({
      x: b.x - 3 - origin.x,
      y: b.y + 3 - origin.y,
      w: b.w + 6,
      h: b.h + 10,
    }));
    const path = this.planner(
      { x: pet.x - origin.x, y: pet.y - origin.y },
      { x: goal.x - origin.x, y: goal.y - origin.y },
      { w: right - left + 20, h: bottom - top + 41 },
      blocked,
    );
    if (!Array.isArray(path) || !path.length || path.length > 512) return null;
    const absolute = path.map((p) => ({
      x: p.x + origin.x,
      y: p.y + origin.y,
    }));
    return absolute.every((p) => this.clear(p, world)) ? absolute : null;
  }
  decide(pet, world, active) {
    let mode = "wander",
      candidates = [];
    if (active) {
      mode = "retreat";
      let dx = pet.x - active.x,
        dy = pet.y - active.y,
        d = Math.hypot(dx, dy);
      if (d < 1) {
        dx = pet.key === "cat" ? -1 : 1;
        dy = 1;
        d = Math.SQRT2;
      }
      for (const turn of [0, 0.65, -0.65]) {
        const x = dx / d,
          y = dy / d;
        candidates.push({
          x: pet.x + (x * Math.cos(turn) - y * Math.sin(turn)) * 58,
          y: pet.y + (x * Math.sin(turn) + y * Math.cos(turn)) * 58,
        });
      }
    } else {
      const cycle = pet.cycle++;
      const idle = world.agents
        .filter((a) => !this.busy(a) && ["idle", "done"].includes(a.status))
        .sort(
          (a, b) =>
            Math.hypot(a.x - pet.x, a.y - pet.y) -
            Math.hypot(b.x - pet.x, b.y - pet.y),
        );
      if (cycle % 4 === 2) {
        mode = "sleep";
        if (Math.hypot(pet.x - pet.home.x, pet.y - pet.home.y) < 15) {
          pet.mode = "sleep";
          pet.wait = 10 + this.random(pet) * 5;
          return;
        }
        candidates = [
          pet.home,
          { x: pet.home.x + 16, y: pet.home.y },
          { x: pet.home.x - 16, y: pet.home.y },
        ];
      } else if (
        cycle % 2 === 1 &&
        idle.length &&
        Math.hypot(idle[0].x - pet.x, idle[0].y - pet.y) < 130
      ) {
        mode = "visit";
        const a = idle[0];
        candidates = [
          { x: a.x - 38, y: a.y + 18 },
          { x: a.x + 38, y: a.y + 18 },
          { x: a.x, y: a.y + 45 },
        ];
      } else {
        const angle = this.random(pet) * Math.PI * 2;
        for (const turn of [0, 2.1, 4.2])
          candidates.push({
            x: pet.x + Math.cos(angle + turn) * 48,
            y: pet.y + Math.sin(angle + turn) * 48,
          });
      }
    }
    pet.cooldown = 1.5;
    for (const point of candidates.slice(0, 3)) {
      const path = this.route(pet, point, world);
      if (!path) continue;
      pet.path = path;
      pet.mode = mode;
      pet.wait = 0;
      return;
    }
    pet.path = [];
    pet.mode = "rest";
    pet.wait = 2.5;
  }
  hold(key) {
    const pet = this.pets.get(key);
    if (!pet?.visible) return false;
    pet.path = [];
    pet.mode = "rest";
    pet.wait = 1.8;
    pet.cooldown = 1.8;
    return true;
  }
  step(delta, source, options = {}) {
    if (options.enabled === false) return [];
    if (
      !Number.isFinite(source?.w) ||
      !Number.isFinite(source?.h) ||
      source.w < 50 ||
      source.h < 70
    )
      return [];
    const world = {
      ...source,
      blocked: (source.blocked || []).filter(
        (b) =>
          [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0,
      ),
      agents: (source.agents || []).filter(
        (a) => Number.isFinite(a.x) && Number.isFinite(a.y),
      ),
    };
    const geometry = String(world.key) + ":" + world.w + ":" + world.h,
      changed = geometry !== this.geometry,
      dt =
        options.paused || options.hidden || options.roam === false
          ? 0
          : Math.max(0, Math.min(0.1, Number.isFinite(delta) ? delta : 0)),
      keys = options.secondCat ? ["cat", "blackcat"] : ["cat"];
    this.geometry = geometry;
    if (!options.secondCat) this.pets.delete("blackcat");
    const result = [];
    for (const [index, key] of keys.entries()) {
      let pet = this.pets.get(key);
      const home = world.homes?.[key] || {
        x: key === "cat" ? 58 : world.w - 68,
        y: world.h - 18,
      };
      if (!pet) {
        pet = {
          key,
          x: home.x,
          y: home.y,
          home,
          seed: key === "cat" ? 7047 : 17239,
          cycle: 0,
          mode: "rest",
          wait: 0.6 + index * 0.8,
          cooldown: 0,
          path: [],
          facing: 1,
          visible: false,
        };
        this.pets.set(key, pet);
      }
      pet.home = home;
      if (changed) {
        pet.path = [];
        pet.wait = 0.6 + index * 0.8;
        pet.mode = "rest";
      }
      if (changed || !this.clear(pet, world) || !pet.visible) {
        const safe = this.safePlace(
          changed && this.clear(pet, world) ? pet : home,
          world,
        );
        pet.visible = !!safe;
        if (safe) {
          pet.x = safe.x;
          pet.y = safe.y;
          pet.path = [];
        }
      }
      if (!pet.visible) continue;
      if (dt > 0) {
        pet.cooldown = Math.max(0, pet.cooldown - dt);
        const active = world.agents.find(
          (a) => this.busy(a) && Math.hypot(a.x - pet.x, a.y - pet.y) < 58,
        );
        if (active && pet.mode !== "retreat" && pet.cooldown === 0)
          this.decide(pet, world, active);
        if (pet.path.length) {
          let remaining = 18 * dt;
          for (
            let count = 0;
            count < 4 && pet.path.length && remaining > 0;
            count++
          ) {
            const next = pet.path[0],
              dx = next.x - pet.x,
              dy = next.y - pet.y,
              d = Math.hypot(dx, dy),
              distance = Math.min(d, remaining),
              ratio = d ? distance / d : 0,
              point = { x: pet.x + dx * ratio, y: pet.y + dy * ratio };
            const other = [...this.pets.values()].some(
              (p) =>
                p !== pet &&
                p.visible &&
                point.x + 5 > p.x - 5 &&
                point.x - 5 < p.x + 5 &&
                point.y > p.y - 15 &&
                point.y - 15 < p.y,
            );
            if (!this.clear(point, world) || other) {
              pet.path = [];
              pet.mode = "rest";
              pet.wait = 2.5;
              break;
            }
            if (Math.abs(dx) > 0.01) pet.facing = dx < 0 ? -1 : 1;
            pet.x = point.x;
            pet.y = point.y;
            remaining -= distance;
            if (d <= distance + 0.001) pet.path.shift();
          }
          if (!pet.path.length && pet.wait === 0) {
            pet.wait =
              pet.mode === "sleep" ? 12 : pet.mode === "visit" ? 5 : 3.5;
            if (!["sleep", "visit"].includes(pet.mode)) pet.mode = "rest";
          }
        } else {
          pet.wait = Math.max(0, pet.wait - dt);
          if (pet.wait === 0) this.decide(pet, world, active);
        }
      }
      result.push({
        key,
        x: pet.x,
        y: pet.y,
        mode: pet.mode,
        moving: pet.path.length > 0,
        facing: pet.facing,
      });
    }
    return result;
  }
}
