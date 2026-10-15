import { Fighter } from '../actor/Fighter';
import { FireMode, GameConfig, px } from '../config/GameConfig';
import { FighterInput } from './InputHub';
import { Platform } from '../world/ArenaBuilder';

export interface BotShot {
    x: number;
    y: number;
    vx: number;
    vy: number;
    owner: number;
}

export interface BotCrate {
    x: number;
    y: number;
}

type StepAction = 'move' | 'jump' | 'drop';

export interface BotMemory {
    dodgeLeft: number;
    dodgeAxis: number;
    dodgeJump: boolean;
    dodgeCd: number;
    hold: number;
    tapCd: number;
    specCd: number;
    hopLock: boolean;
    leftGround: boolean;
    planLeft: number;
    airAxis: number;
    stepX: number;
    stepDy: number;
    stepAction: StepAction;
    wantDouble: boolean;
    didDouble: boolean;
    fireWindow: number;
    fireRest: number;
    separate: number;
    input: FighterInput;
}

const blankInput = (): FighterInput => ({
    axis: 0,
    look: 0,
    jump: false,
    drop: false,
    fireHeld: false,
    fireEdge: false,
    fireReleased: false,
    specialHeld: false,
    specialEdge: false,
    specialReleased: false,
});

export function emptyBotMemory(): BotMemory {
    return {
        dodgeLeft: 0,
        dodgeAxis: 0,
        dodgeJump: false,
        dodgeCd: 0,
        hold: 0,
        tapCd: 0,
        specCd: 0,
        hopLock: false,
        leftGround: false,
        planLeft: 0,
        airAxis: 0,
        stepX: 0,
        stepDy: 0,
        stepAction: 'move',
        wantDouble: false,
        didDouble: false,
        fireWindow: 0.2,
        fireRest: 0.15,
        separate: 0,
        input: blankInput(),
    };
}

const ONE_JUMP = px(2.7);
const TWO_JUMP = px(5.1);

function reachPx(mode: FireMode) {
    if (mode.trigger === 'melee' || mode.trigger === 'dash' || mode.meleeRange > 0) {
        return px(Math.max(mode.meleeRange, 0.8) + 0.35);
    }
    let far = 18;
    for (const [distance, damage] of mode.falloff) {
        if (damage <= 0) {
            far = Math.min(far, distance);
        }
    }
    return px(far);
}

function bodyDist(a: Fighter, x: number, y: number) {
    return Math.hypot(a.x - x, a.y + a.h * 0.5 - y);
}

function canHit(self: Fighter, other: Fighter, mode: FireMode, look: number) {
    const ahead = (other.x - self.x) * look;
    const dy = Math.abs((other.y + other.h * 0.5) - (self.y + self.h * 0.5));
    const reach = reachPx(mode);
    if (mode.trigger === 'melee' || mode.trigger === 'dash') {
        return ahead > -self.w * 0.25 && ahead < reach + self.w && dy < self.h * 1.35;
    }
    return ahead > self.w * 0.2 && ahead < reach && dy < self.h * 0.75;
}

function nearestOther(self: Fighter, others: Fighter[]) {
    let best: Fighter | null = null;
    let bestD = Infinity;
    for (const other of others) {
        if (!other.alive || other.id === self.id) {
            continue;
        }
        const d = bodyDist(other, self.x, self.y + self.h * 0.5);
        if (d < bestD) {
            best = other;
            bestD = d;
        }
    }
    return best;
}

function wantsCrate(self: Fighter, others: Fighter[], crate: BotCrate | null) {
    if (!crate) {
        return false;
    }
    const mine = bodyDist(self, crate.x, crate.y);
    let best = Infinity;
    for (const other of others) {
        if (!other.alive || other.id === self.id) {
            continue;
        }
        best = Math.min(best, bodyDist(other, crate.x, crate.y));
    }
    return mine < best;
}

function considerDodge(self: Fighter, shots: BotShot[], memory: BotMemory) {
    if (memory.dodgeCd > 0 || memory.dodgeLeft > 0) {
        return;
    }
    for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        if (shot.owner === self.id) {
            continue;
        }
        if (Math.abs(shot.vx) < 30 && Math.abs(shot.vy) < 30) {
            continue;
        }
        const t = Math.abs(shot.vx) > 30 ? (self.x - shot.x) / shot.vx : 0.2;
        if (t < 0 || t > 0.3) {
            continue;
        }
        const yAt = shot.y + shot.vy * t;
        if (yAt < self.y - 12 || yAt > self.y + self.h + 12) {
            continue;
        }
        const xAt = shot.x + shot.vx * t;
        if (Math.abs(xAt - self.x) > self.w * 1.4) {
            continue;
        }
        memory.dodgeCd = 0.5;
        if (Math.random() > 0.6) {
            return;
        }
        memory.dodgeLeft = 0.18;
        memory.dodgeJump = self.onGround && Math.abs(shot.vy) < px(10);
        memory.dodgeAxis = Math.abs(shot.x - self.x) < 8 ? 0 : Math.sign(self.x - shot.x);
        return;
    }
}

function segmentGap(a: Platform, b: Platform) {
    const a1 = a.x + a.w / 2;
    const b0 = b.x - b.w / 2;
    if (a1 < b0) {
        return b0 - a1;
    }
    const b1 = b.x + b.w / 2;
    const a0 = a.x - a.w / 2;
    if (b1 < a0) {
        return a0 - b1;
    }
    return 0;
}

function closestX(platform: Platform, x: number) {
    const pad = 18;
    const left = platform.x - platform.w / 2 + pad;
    const right = platform.x + platform.w / 2 - pad;
    if (left > right) {
        return platform.x;
    }
    return Math.max(left, Math.min(right, x));
}

function approachX(from: Platform, to: Platform) {
    if (segmentGap(from, to) <= 0) {
        return closestX(from, to.x);
    }
    if (to.x >= from.x) {
        return from.x + from.w / 2 - 22;
    }
    return from.x - from.w / 2 + 22;
}

function feetPlatform(self: Fighter, platforms: Platform[]) {
    let best: Platform | null = null;
    let bestDy = 28;
    for (let i = 0; i < platforms.length; i++) {
        const platform = platforms[i];
        if (Math.abs(self.x - platform.x) > (self.w + platform.w) / 2 - 4) {
            continue;
        }
        const dy = Math.abs(self.y - platform.top);
        if (dy < bestDy) {
            bestDy = dy;
            best = platform;
        }
    }
    return best;
}

function platformNear(x: number, y: number, platforms: Platform[]) {
    let best: Platform | null = null;
    let score = Infinity;
    for (let i = 0; i < platforms.length; i++) {
        const platform = platforms[i];
        const inside = Math.abs(x - platform.x) <= platform.w / 2;
        const dy = Math.abs(platform.top - y);
        const value = (inside ? dy : dy + 500) + Math.abs(platform.x - x) * 0.02;
        if (value < score) {
            score = value;
            best = platform;
        }
    }
    return best;
}

function link(from: Platform, to: Platform) {
    const dy = to.top - from.top;
    const gap = segmentGap(from, to);
    if (Math.abs(dy) <= 14) {
        if (gap < 28) {
            return { action: 'move' as StepAction, cost: gap + 30, dy };
        }
        if (gap < px(4.5)) {
            return { action: 'jump' as StepAction, cost: gap + 80, dy };
        }
        return null;
    }
    if (dy > 14 && dy <= ONE_JUMP && gap <= px(5.5)) {
        return { action: 'jump' as StepAction, cost: gap + dy, dy };
    }
    if (dy > ONE_JUMP && dy <= TWO_JUMP && gap <= px(4)) {
        return { action: 'jump' as StepAction, cost: gap + dy + 120, dy };
    }
    if (dy < -14 && gap <= px(3.5)) {
        return { action: 'drop' as StepAction, cost: gap + Math.abs(dy), dy };
    }
    return null;
}

function planStep(current: Platform, goal: Platform, goalX: number, platforms: Platform[]) {
    if (current === goal) {
        return { x: closestX(goal, goalX), action: 'move' as StepAction, dy: 0 };
    }
    const n = platforms.length;
    const dist = new Array<number>(n);
    const prev = new Array<number>(n);
    const how: StepAction[] = new Array(n);
    const rise = new Array<number>(n);
    let start = 0;
    let end = 0;
    for (let i = 0; i < n; i++) {
        dist[i] = Infinity;
        prev[i] = -1;
        how[i] = 'move';
        rise[i] = 0;
        if (platforms[i] === current) {
            start = i;
        }
        if (platforms[i] === goal) {
            end = i;
        }
    }
    dist[start] = 0;
    const seen = new Array<boolean>(n);
    for (let iter = 0; iter < n; iter++) {
        let u = -1;
        let best = Infinity;
        for (let i = 0; i < n; i++) {
            if (!seen[i] && dist[i] < best) {
                best = dist[i];
                u = i;
            }
        }
        if (u < 0) {
            break;
        }
        seen[u] = true;
        if (u === end) {
            break;
        }
        const from = platforms[u];
        for (let v = 0; v < n; v++) {
            if (v === u) {
                continue;
            }
            const edge = link(from, platforms[v]);
            if (!edge) {
                continue;
            }
            const next = dist[u] + edge.cost;
            if (next < dist[v]) {
                dist[v] = next;
                prev[v] = u;
                how[v] = edge.action;
                rise[v] = edge.dy;
            }
        }
    }
    if (!Number.isFinite(dist[end])) {
        const dy = goal.top - current.top;
        const action: StepAction = dy > px(1.1) ? 'jump' : dy < -px(1) ? 'drop' : 'move';
        return { x: action === 'move' ? closestX(goal, goalX) : approachX(current, goal), action, dy };
    }
    let node = end;
    let before = prev[node];
    if (before < 0) {
        return { x: closestX(goal, goalX), action: 'move' as StepAction, dy: 0 };
    }
    while (before !== start && before >= 0) {
        node = before;
        before = prev[node];
    }
    const action = how[node];
    const next = platforms[node];
    const x = action === 'move' ? closestX(next, goalX) : approachX(current, next);
    return { x, action, dy: rise[node] };
}

function sidePlatform(from: Platform, platforms: Platform[]) {
    let best: Platform | null = null;
    let bestCost = Infinity;
    for (let i = 0; i < platforms.length; i++) {
        const platform = platforms[i];
        if (platform === from) {
            continue;
        }
        const dy = Math.abs(platform.top - from.top);
        if (dy < px(1.2) || dy > px(3.3)) {
            continue;
        }
        const gap = segmentGap(from, platform);
        if (gap > px(5)) {
            continue;
        }
        const cost = gap + Math.abs(dy - px(2.4));
        if (cost < bestCost) {
            bestCost = cost;
            best = platform;
        }
    }
    return best;
}

function pressCharge(mode: FireMode, lined: boolean, charging: boolean, memory: BotMemory, dt: number) {
    if (charging) {
        memory.hold += dt;
        const need = mode.chargeTime <= 0.05 ? 0 : mode.chargeTime * 0.9;
        if (memory.hold >= need) {
            memory.hold = 0;
            return { held: false, edge: false, released: true };
        }
        return { held: true, edge: false, released: false };
    }
    if (!lined || memory.tapCd > 0) {
        memory.hold = 0;
        return { held: false, edge: false, released: false };
    }
    memory.tapCd = 0.2;
    memory.hold = 0;
    return { held: true, edge: true, released: mode.chargeTime <= 0.05 };
}

/** 沿平台走到目标附近，错开高度，开枪留间隔。 */
export function thinkBot(
    self: Fighter,
    others: Fighter[],
    platforms: Platform[],
    crate: BotCrate | null,
    shots: BotShot[],
    memory: BotMemory,
    dt: number,
): FighterInput {
    memory.dodgeLeft = Math.max(0, memory.dodgeLeft - dt);
    memory.dodgeCd = Math.max(0, memory.dodgeCd - dt);
    memory.tapCd = Math.max(0, memory.tapCd - dt);
    memory.specCd = Math.max(0, memory.specCd - dt);
    memory.fireRest = Math.max(0, memory.fireRest - dt);
    memory.separate = Math.max(0, memory.separate - dt);
    memory.planLeft -= dt;
    considerDodge(self, shots, memory);

    const prey = nearestOther(self, others);
    const chasing = wantsCrate(self, others, crate);
    const here = self.onGround ? feetPlatform(self, platforms) : null;
    const preyPlat = prey ? platformNear(prey.x, prey.y, platforms) : null;
    let goal = preyPlat;
    let goalX = prey ? prey.x : self.x;
    if (chasing && crate) {
        goal = platformNear(crate.x, crate.y, platforms);
        goalX = crate.x;
    } else if (memory.separate > 0 && here && preyPlat) {
        const side = sidePlatform(here.top === preyPlat.top ? here : preyPlat, platforms);
        if (side) {
            goal = side;
            goalX = side.x;
        }
    } else if (prey && preyPlat) {
        const melee = self.weapon.def.primary.trigger === 'melee' || self.weapon.def.primary.trigger === 'dash';
        const gap = melee ? px(0.55) : px(3);
        const lookDir = prey.x >= self.x ? 1 : -1;
        goalX = prey.x - lookDir * gap;
    }

    if (self.onGround && here && goal && memory.planLeft <= 0) {
        const step = planStep(here, goal, goalX, platforms);
        memory.stepX = step.x;
        memory.stepAction = step.action;
        memory.stepDy = step.dy;
        memory.planLeft = 0.2;
    } else if (!here && memory.planLeft <= 0) {
        memory.stepX = goalX;
        memory.stepAction = 'move';
        memory.planLeft = 0.2;
    }

    const look = prey ? (prey.x >= self.x ? 1 : -1) : 0;
    let axis = 0;
    let jump = false;
    let drop = false;
    if (self.onGround) {
        if (memory.leftGround) {
            memory.hopLock = false;
            memory.didDouble = false;
        }
        memory.leftGround = false;
        const dx = memory.stepX - self.x;
        if (Math.abs(dx) > 20) {
            axis = Math.sign(dx);
        }
        const close = Math.abs(dx) <= 32;
        if (!memory.hopLock && close && memory.stepAction === 'jump') {
            jump = true;
            memory.hopLock = true;
            memory.wantDouble = memory.stepDy > ONE_JUMP;
        }
        if (close && memory.stepAction === 'drop' && self.groundElevation > 0) {
            drop = true;
        }
        memory.airAxis = axis;
    } else {
        memory.leftGround = true;
        axis = memory.airAxis;
        if (memory.wantDouble && !memory.didDouble && self.jumpsLeft > 0 && self.vy < px(5)) {
            jump = true;
            memory.didDouble = true;
            memory.wantDouble = false;
        }
    }

    if (memory.dodgeLeft > 0) {
        axis = memory.dodgeAxis;
        memory.airAxis = axis;
    }
    if (memory.dodgeJump) {
        jump = true;
        drop = false;
        memory.dodgeJump = false;
    }

    const primary = self.weapon.def.primary;
    const special = self.weapon.def.special;
    const hitPrimary = prey ? canHit(self, prey, primary, look || self.facing) : false;
    const hitSpecial = prey ? canHit(self, prey, special, look || self.facing) : false;
    const meleeKit = primary.trigger === 'melee' || primary.trigger === 'dash'
        || special.trigger === 'melee' || special.trigger === 'dash';
    let useSpecial = false;
    if (special.trigger === 'cloak') {
        const far = !prey || bodyDist(self, prey.x, prey.y + prey.h * 0.5) > px(8);
        useSpecial = memory.specCd <= 0 && memory.fireRest <= 0 && ((far && !self.weapon.cloaked) || (!far && self.weapon.cloaked));
        if (useSpecial) {
            memory.specCd = 1.5;
        }
    } else if (special.trigger !== 'cash' && hitSpecial && memory.specCd <= 0 && memory.fireRest <= 0) {
        const close = special.trigger === 'melee' || special.trigger === 'dash' || special.trigger === 'auto'
            || (prey !== null && bodyDist(self, prey.x, prey.y + prey.h * 0.5) < px(6));
        useSpecial = close && !(primary.trigger === 'charge' && special.trigger === 'charge');
    }

    const charging = self.weapon.isCharging();
    const wantPrimary = hitPrimary && !(meleeKit && useSpecial);
    const busy = wantPrimary || useSpecial || charging;
    if (busy && !charging && memory.fireRest <= 0) {
        memory.fireWindow -= dt;
        if (memory.fireWindow <= 0) {
            memory.fireWindow = primary.trigger === 'auto' || special.trigger === 'auto' ? 0.16 : 0.08;
            memory.fireRest = 0.62;
            memory.separate = chasing ? 0 : 0.85;
        }
    }

    const gate = memory.fireRest <= 0 || charging;
    const input = memory.input;
    input.axis = axis;
    input.look = look;
    input.jump = jump;
    input.drop = drop;
    input.fireHeld = false;
    input.fireEdge = false;
    input.fireReleased = false;
    input.specialHeld = false;
    input.specialEdge = false;
    input.specialReleased = false;

    if (primary.trigger === 'charge') {
        const btn = pressCharge(primary, wantPrimary && gate, charging, memory, dt);
        input.fireHeld = btn.held;
        input.fireEdge = btn.edge;
        input.fireReleased = btn.released;
        if (btn.released) {
            memory.fireRest = Math.max(memory.fireRest, 0.62);
            memory.separate = chasing ? 0 : 0.85;
        }
    } else if (primary.trigger === 'auto') {
        input.fireHeld = wantPrimary && gate;
        input.fireEdge = input.fireHeld && memory.tapCd <= 0;
        if (input.fireEdge) {
            memory.tapCd = 0.08;
        }
    } else if (wantPrimary && gate && memory.tapCd <= 0) {
        input.fireHeld = true;
        input.fireEdge = true;
        input.fireReleased = true;
        memory.tapCd = meleeKit ? 0.48 : 0.42;
    }

    if (useSpecial && memory.specCd <= 0 && special.trigger !== 'auto' && special.trigger !== 'cloak') {
        memory.specCd = meleeKit ? 0.48 : 0.7;
    }
    if (special.trigger === 'charge' && !(primary.trigger === 'charge' && input.fireHeld)) {
        const btn = pressCharge(special, useSpecial && gate, charging && !input.fireHeld, memory, dt);
        input.specialHeld = btn.held;
        input.specialEdge = btn.edge;
        input.specialReleased = btn.released;
    } else if (special.trigger === 'auto') {
        input.specialHeld = useSpecial && gate;
        input.specialEdge = input.specialHeld;
    } else if (useSpecial && gate) {
        input.specialHeld = true;
        input.specialEdge = true;
        input.specialReleased = true;
    }
    return input;
}
