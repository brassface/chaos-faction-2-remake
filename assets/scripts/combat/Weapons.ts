import { boostAmmo, Falloff, FireMode, findWeapon, GameConfig, isStarterWeapon, MissileGlow, px, STARTER_WEAPON_ID, WeaponDef } from '../config/GameConfig';

export interface FiredShot {
    speed: number;
    damage: number;
    spreadDeg: number;
    /** 固定俯仰角，度。正数朝上，和朝向无关。 */
    angleOffset: number;
    knockback: number;
    gravity: number;
    arcVy: number;
    kind: FiredShotKind;
    /** 沿飞行方向的长度（像素）。尾部在生成点，头部朝前。 */
    length: number;
    /** 飞过的人物宽度 => 伤害。伤害为 0 的那一档会销毁子弹。 */
    falloff: Falloff;
    homing: boolean;
    /** 每秒最多转过的角度。 */
    turnRate: number;
    /** 跟踪秒数。0 表示不会失效。 */
    flightTime: number;
    /** 爆炸半径（像素）。0 表示不爆炸。 */
    explode: number;
    glow: MissileGlow;
    /** 命中后的眩晕秒数。0 表示不眩晕。 */
    stun: number;
    /** 飞过这么多像素后分裂成三枚。0 表示不分裂。 */
    splitAfter: number;
}

export type FiredShotKind = 'bullet' | 'mag' | 'pellet' | 'arrow' | 'missile' | 'knife';

export interface AttackButtons {
    held: boolean;
    edge: boolean;
    released: boolean;
}

export interface MeleeHit {
    range: number;
    damage: number;
    knockback: number;
    stun: number;
    /** 垂直判定相对身高校准。1 表示与身高相同。 */
    reachY: number;
}

export class WeaponRuntime {
    primaryAmmo: number;
    specialAmmo: number;
    shared: number;
    reserve: number;
    private primaryCd = 0;
    private specialCd = 0;
    private primaryReload = 0;
    private specialReload = 0;
    private tubeReload = 0;
    private burstLeft = 0;
    private burstGap = 0;
    private burstSpecial = false;
    private charging = false;
    private chargeSpecial = false;
    private charge = 0;
    private swing = 0;
    private swingHit = 0;
    private swingMode: FireMode | null = null;
    private swingKind: 'stock' | 'slash' | 'thrust' | 'chop' = 'stock';
    private nextLight: 'slash' | 'thrust' = 'slash';
    private comboLeft = 0;
    private recover = 0;
    private dashLeft = 0;
    private dashSpan = 1;
    private dashGo = false;
    private dashFollow: 'slash' | 'thrust' | 'chop' | null = null;
    private dashMode: FireMode | null = null;
    /** 起跳竖直速度（人物宽度/秒），下一帧由角色消耗。 */
    private hopSpeed = 0;
    /** 重击已经起跳，落地前不能再放。 */
    private heavyAir = false;
    private grounded = true;
    private poseKind: 'none' | 'slash' | 'thrust' | 'chop' | 'dash' = 'none';
    private poseFrom = 0;
    cloaked = false;
    /** 初始武器不消耗子弹。Desert 特殊攻击仍会进入换弹。 */
    freeStarter = false;
    /** 武士刀后摇除以这个数。 */
    swingHaste = 1;
    /** 两种攻击打出后共同等待的时间。 */
    private cycleLeft = 0;
    /** M37 当前是独头弹。 */
    private slug = false;
    /** M249 架枪进度，0 到 1。趴下完成后保持 1。 */
    private deploying = 0;
    private prone = false;
    /** 加特林枪管正在转。 */
    private spinOn = false;
    /** 加特林已转动的秒数，满 1 秒才能射击。 */
    private spool = 0;

    constructor(readonly def: WeaponDef) {
        this.primaryAmmo = def.primary.magazine;
        this.specialAmmo = def.special.magazine;
        this.shared = def.primary.magazine;
        this.reserve = def.reserve;
    }

    refill() {
        this.primaryAmmo = this.def.primary.magazine;
        this.specialAmmo = this.def.special.magazine;
        this.shared = this.def.primary.magazine;
        this.reserve = this.def.reserve;
        this.primaryReload = 0;
        this.specialReload = 0;
        this.tubeReload = 0;
        this.burstLeft = 0;
        this.charging = false;
        this.chargeSpecial = false;
        this.charge = 0;
        this.swing = 0;
        this.swingHit = 0;
        this.swingMode = null;
        this.swingKind = 'stock';
        this.nextLight = 'slash';
        this.comboLeft = 0;
        this.recover = 0;
        this.dashLeft = 0;
        this.dashSpan = 1;
        this.dashGo = false;
        this.dashFollow = null;
        this.dashMode = null;
        this.hopSpeed = 0;
        this.heavyAir = false;
        this.grounded = true;
        this.poseKind = 'none';
        this.poseFrom = 0;
        this.cloaked = false;
        this.cycleLeft = 0;
        this.slug = false;
        this.deploying = 0;
        this.prone = false;
        this.spinOn = false;
        this.spool = 0;
    }

    /** 蓄力瞄准中的散布角（度）。没有瞄准线时返回 null。 */
    aimSpread(): number | null {
        if (!this.charging) {
            return null;
        }
        const mode = this.chargeSpecial ? this.def.special : this.def.primary;
        if (!mode.chargeSpread) {
            return null;
        }
        const cap = Math.max(0.001, mode.chargeTime);
        const t = Math.max(0, Math.min(1, this.charge / cap));
        return mode.spreadAtZero + (mode.spread - mode.spreadAtZero) * t;
    }

    /** 近战或冲刺的画面进度。0 表示没在做，1 表示这一下结束。 */
    actionPose(): { kind: 'none' | 'slash' | 'thrust' | 'chop' | 'dash' | 'stock'; t: number } {
        if (this.poseKind === 'dash') {
            const total = Math.max(1, px(this.dashSpan));
            return { kind: 'dash', t: Math.max(0, Math.min(1, 1 - this.dashLeft / total)) };
        }
        if (this.poseKind === 'none' || this.swing <= 0) {
            if (this.def.id === 'ak47' && this.swing > 0 && this.swingMode) {
                return { kind: 'stock', t: 1 - this.swing / this.swingMode.meleeTime };
            }
            return { kind: 'none', t: 0 };
        }
        const dur = Math.max(0.001, this.poseFrom);
        return { kind: this.poseKind, t: Math.max(0, Math.min(1, 1 - this.swing / dur)) };
    }

    /** 近战挥击进度。0 表示没在挥，1 表示挥完。 */
    meleeMotion(): number {
        const pose = this.actionPose();
        if (pose.kind === 'stock') {
            return pose.t;
        }
        if (this.swing <= 0 || !this.swingMode || this.swingMode.meleeTime <= 0) {
            return 0;
        }
        return 1 - this.swing / this.swingMode.meleeTime;
    }

    isDashing() {
        return this.dashGo;
    }

    /** 本帧冲刺位移（像素）。 */
    takeDash(dt: number) {
        if (this.dashLeft <= 0) {
            return 0;
        }
        const step = Math.min(this.dashLeft, (px(this.dashSpan) / 0.1) * dt);
        this.dashLeft -= step;
        return step;
    }

    /** 角色本帧是否站在平台上。重击落地判定用。 */
    setGrounded(value: boolean) {
        this.grounded = value;
        if (value) {
            this.heavyAir = false;
        }
    }

    /** 取出并清掉一次起跳速度（人物宽度/秒）。 */
    takeHop() {
        const speed = this.hopSpeed;
        this.hopSpeed = 0;
        return speed;
    }

    isCharging() {
        return this.charging;
    }

    viewId() {
        if (this.def.id === 'm37') {
            return this.slug ? 'm37_slug' : 'm37';
        }
        return this.def.id;
    }

    isSpinning() {
        return this.spinOn;
    }

    spoolReady() {
        return this.def.id === 'gatling' && this.spool >= 1;
    }

    spoolLevel() {
        return this.spool;
    }

    locksJump() {
        return this.def.id === 'gatling' && this.spinOn;
    }

    /** 1 是正常移速。趴下是 0.1，转枪管是 0.8。 */
    moveScale() {
        if (this.def.id === 'm249' && (this.prone || this.deploying > 0)) {
            return 0.1;
        }
        if (this.def.id === 'gatling' && this.spinOn) {
            return 0.8;
        }
        return 1;
    }

    /** 跳跃或下探时立刻站起来。 */
    cancelProne() {
        this.prone = false;
        this.deploying = 0;
    }

    /** 0 站立，1 完全趴下。 */
    stance() {
        if (this.def.id !== 'm249') {
            return 0;
        }
        if (this.prone) {
            return 1;
        }
        return Math.max(0, Math.min(1, this.deploying));
    }

    locksMove() {
        if (!this.charging) {
            return false;
        }
        const mode = this.chargeSpecial ? this.def.special : this.def.primary;
        return mode.lockMove;
    }

    hudText(): string {
        if (this.cloaked) {
            return `${this.def.name}  隐身  ${this.ammoLine()}`;
        }
        if (this.charging) {
            const mode = this.chargeSpecial ? this.def.special : this.def.primary;
            const cap = Math.max(0.001, mode.chargeTime);
            const percent = Math.round(Math.min(1, this.charge / cap) * 100);
            const verb = mode.projectile === 'arrow' ? '拉弓' : '蓄力';
            return `${this.def.name}  ${verb}${percent}%  ${this.stockText()}`;
        }
        if (this.def.id === 'm37') {
            return `${this.def.name}  ${this.slug ? '独头' : '霰弹'}  ${this.ammoLine()}`;
        }
        if (this.def.id === 'm249' && (this.prone || this.deploying > 0)) {
            const word = this.prone ? '架枪' : `趴下${Math.round(this.deploying * 100)}%`;
            return `${this.def.name}  ${word}  ${this.ammoLine()}`;
        }
        if (this.def.id === 'gatling' && this.spinOn) {
            const word = this.spool >= 1 ? '转管' : `转管${Math.round(this.spool * 100)}%`;
            return `${this.def.name}  ${word}  ${this.ammoLine()}`;
        }
        if (this.def.primary.ammoCost <= 0 && this.def.special.ammoCost <= 0) {
            return this.def.name;
        }
        return `${this.def.name}  ${this.ammoLine()}`;
    }

    private stockText() {
        const current = this.def.sharedMagazine ? this.shared : this.primaryAmmo;
        if (this.def.reloadAmount > 0) {
            return `${current}/${this.reserve}`;
        }
        if (isStarterWeapon(this.def.id)) {
            return `${current}/∞`;
        }
        return `${current}/0`;
    }

    private ammoLine() {
        if (this.tubeReload > 0) {
            return `换弹${this.tubeReload.toFixed(1)}s  ${this.stockText()}`;
        }
        if (this.cycleLeft > 0) {
            return `换弹${this.cycleLeft.toFixed(1)}s  ${this.stockText()}`;
        }
        if (this.def.reloadAmount > 0) {
            return this.stockText();
        }
        if (this.def.sharedMagazine) {
            if (this.primaryReload > 0) {
                return `换弹${this.primaryReload.toFixed(1)}s  ${this.stockText()}`;
            }
            return this.stockText();
        }
        if (this.primaryReload > 0) {
            return `换弹${this.primaryReload.toFixed(1)}s  ${this.stockText()}`;
        }
        return this.stockText();
    }

    tick(dt: number, primary: AttackButtons, special: AttackButtons): { shots: FiredShot[]; revert: boolean; melees: MeleeHit[]; cashes: number } {
        this.primaryCd = Math.max(0, this.primaryCd - dt);
        this.specialCd = Math.max(0, this.specialCd - dt);
        this.cycleLeft = Math.max(0, this.cycleLeft - dt);
        this.tickReload(dt);
        this.tickDeploy(dt);
        this.tickSpool(dt, primary, special);
        this.didCash = false;

        const shots: FiredShot[] = [];
        const melees: MeleeHit[] = [];
        let revert = false;
        if (this.swing > 0) {
            this.swing -= dt;
            if (this.swingHit > 0) {
                this.swingHit -= dt;
                if (this.swingHit <= 0 && this.swingMode) {
                    const range = this.def.id === 'broadsword' && this.swingKind === 'thrust' ? 1.35 : this.swingMode.meleeRange;
                    const reachY = this.def.id === 'broadsword' && this.swingKind === 'chop' ? 1.5 : 1;
                    melees.push({
                        range: px(range),
                        damage: this.swingMode.damage,
                        knockback: this.swingMode.knockback,
                        stun: this.swingMode.stun,
                        reachY,
                    });
                    this.swingHit = 0;
                }
            }
            if (this.swing <= 0) {
                this.swing = 0;
                this.poseKind = 'none';
                this.recover = this.endlag(this.swingKind);
            }
            return { shots, revert, melees, cashes: 0 };
        }
        if (this.dashGo) {
            if (this.dashLeft <= 0) {
                this.dashGo = false;
                this.poseKind = 'none';
                const follow = this.dashFollow;
                const mode = this.dashMode;
                this.dashFollow = null;
                this.dashMode = null;
                if (follow && mode) {
                    this.startSwing(mode, follow);
                }
            }
            return { shots, revert, melees, cashes: 0 };
        }
        if (this.recover > 0) {
            this.recover -= dt;
            if (this.recover > 0) {
                return { shots, revert, melees, cashes: 0 };
            }
            this.recover = 0;
            this.comboLeft = this.def.id === 'broadsword' ? 0.5 : 0;
        }
        if (this.comboLeft > 0) {
            this.comboLeft -= dt;
            if (this.comboLeft <= 0) {
                this.comboLeft = 0;
                this.nextLight = 'slash';
            }
        }

        revert = this.tickCharge(dt, primary, special, shots) || revert;

        if (this.burstLeft > 0) {
            this.burstGap -= dt;
            if (this.burstGap <= 0) {
                const mode = this.burstSpecial ? this.def.special : this.def.primary;
                const before = this.ammo(this.burstSpecial);
                if (before < 1 || this.reloading(this.burstSpecial)) {
                    this.burstLeft = 0;
                } else {
                    const reverted = this.fireOne(mode, this.burstSpecial, shots);
                    const spent = before - this.ammo(this.burstSpecial);
                    const fired = reverted || spent > 0 || this.freeStarter;
                    if (!fired || reverted) {
                        this.burstLeft = 0;
                        revert = reverted || revert;
                    } else {
                        this.burstLeft -= 1;
                        this.burstGap = mode.burstInterval;
                    }
                }
            }
        }

        if (this.def.special.trigger !== 'charge' && this.burstLeft === 0 && this.canStart(this.def.special, special, true)) {
            revert = this.begin(this.def.special, true, shots) || revert;
        }
        if (this.def.primary.trigger !== 'charge' && this.burstLeft === 0 && this.swing <= 0 && !this.dashGo && this.canStart(this.def.primary, primary, false)) {
            revert = this.begin(this.def.primary, false, shots) || revert;
        }
        const cashes = this.didCash ? 1 : 0;
        return { shots, revert, melees, cashes };
    }

    private endlag(kind: 'stock' | 'slash' | 'thrust' | 'chop') {
        if (this.def.id !== 'broadsword') {
            return 0;
        }
        if (kind === 'slash') {
            return 0.1 / this.swingHaste;
        }
        if (kind === 'thrust') {
            return 0.15 / this.swingHaste;
        }
        if (kind === 'chop') {
            return 0.5 / this.swingHaste;
        }
        return 0;
    }

    private startSwing(mode: FireMode, kind: 'stock' | 'slash' | 'thrust' | 'chop') {
        const visual = kind === 'thrust' ? 0.22 : mode.meleeTime;
        this.swingKind = kind;
        this.swingMode = mode;
        this.poseKind = kind === 'stock' ? 'none' : kind;
        this.poseFrom = visual;
        this.swing = visual;
        this.swingHit = visual * 0.55;
    }

    /** 弓射出后要等下一支箭。其他蓄力武器不受这段间隔限制。 */
    private canNock(special: boolean) {
        if (this.cycleLeft > 0) {
            return false;
        }
        if (this.def.id !== 'bow') {
            return true;
        }
        return (special ? this.specialCd : this.primaryCd) <= 0;
    }

    private tickCharge(dt: number, primary: AttackButtons, special: AttackButtons, shots: FiredShot[]) {
        const primaryCharge = this.def.primary.trigger === 'charge';
        const specialCharge = this.def.special.trigger === 'charge';
        if (!primaryCharge && !specialCharge) {
            return false;
        }
        if (!this.charging) {
            if (specialCharge && special.edge && this.canNock(true) && this.canPay(this.def.special, true) && !this.reloading(true)) {
                this.charging = true;
                this.chargeSpecial = true;
                this.charge = 0;
            } else if (primaryCharge && primary.edge && this.canNock(false) && this.canPay(this.def.primary, false) && !this.reloading(false)) {
                this.charging = true;
                this.chargeSpecial = false;
                this.charge = 0;
            } else {
                return false;
            }
        }
        const mode = this.chargeSpecial ? this.def.special : this.def.primary;
        const btn = this.chargeSpecial ? special : primary;
        if (this.reloading(this.chargeSpecial)) {
            this.charging = false;
            this.charge = 0;
            return false;
        }
        if (btn.held && !btn.released) {
            this.charge = Math.min(mode.chargeTime, this.charge + dt);
            return false;
        }
        if (mode.fullCharge && this.charge + 0.0001 < mode.chargeTime) {
            this.charging = false;
            this.charge = 0;
            return false;
        }
        const cap = Math.max(0.001, mode.chargeTime);
        const t = Math.max(0, Math.min(1, this.charge / cap));
        const gravity = mode.gravityAtZero + (mode.gravityAtFull - mode.gravityAtZero) * t;
        const spread = mode.chargeSpread
            ? mode.spreadAtZero + (mode.spread - mode.spreadAtZero) * t
            : undefined;
        const asSpecial = this.chargeSpecial;
        this.charging = false;
        this.charge = 0;
        if (!this.canPay(mode, asSpecial)) {
            return false;
        }
        return this.fireOne(mode, asSpecial, shots, gravity, spread);
    }

    private tickReload(dt: number) {
        if (this.tubeReload > 0) {
            this.tubeReload -= dt;
            if (this.tubeReload <= 0) {
                this.tubeReload = 0;
                const amount = Math.min(this.def.reloadAmount, this.reserve);
                this.shared += amount;
                this.reserve -= amount;
            }
        }
        if (this.def.onEmpty !== 'reload' || this.def.reloadAmount > 0) {
            return;
        }
        if (this.primaryReload > 0) {
            this.primaryReload -= dt;
            if (this.primaryReload <= 0) {
                this.primaryReload = 0;
                if (this.def.sharedMagazine) {
                    this.shared = this.def.primary.magazine;
                } else {
                    this.primaryAmmo = this.def.primary.magazine;
                }
            }
        }
        if (this.specialReload > 0) {
            this.specialReload -= dt;
            if (this.specialReload <= 0) {
                this.specialReload = 0;
                this.specialAmmo = this.def.special.magazine;
            }
        }
    }

    private canStart(mode: FireMode, btn: AttackButtons, special: boolean) {
        const want = mode.trigger === 'semi' || mode.trigger === 'melee' || mode.trigger === 'cloak'
            || mode.trigger === 'cash' || mode.trigger === 'dash' || mode.trigger === 'swap' || mode.trigger === 'deploy'
            ? btn.edge
            : (btn.held || btn.edge);
        if (!want) {
            return false;
        }
        if (mode.trigger === 'spool') {
            return false;
        }
        if (this.cycleLeft > 0) {
            return false;
        }
        if (this.def.id === 'gatling' && !special && this.spool < 1) {
            return false;
        }
        if (!special && this.def.id === 'm249' && this.deploying > 0 && !this.prone) {
            return false;
        }
        if ((special ? this.specialCd : this.primaryCd) > 0) {
            return false;
        }
        if (this.reloading(special)) {
            return false;
        }
        if (mode.trigger === 'burst' && this.burstLeft > 0) {
            return false;
        }
        if (mode.trigger === 'burst' && this.ammo(special) < (mode.burstFlexible ? 1 : mode.burstCount)) {
            return false;
        }
        if (this.def.id === 'broadsword' && special && this.heavyAir && !this.grounded) {
            return false;
        }
        return this.canPay(mode, special);
    }

    private canPay(mode: FireMode, special: boolean) {
        if (mode.ammoCost <= 0) {
            return true;
        }
        const have = this.ammo(special);
        if (mode.partialAmmo) {
            return have >= 1;
        }
        return have >= Math.max(1, mode.ammoCost);
    }

    private didCash = false;

    private begin(mode: FireMode, special: boolean, shots: FiredShot[]) {
        if (mode.trigger === 'swap') {
            this.slug = !this.slug;
            this.cycleLeft = Math.max(this.cycleLeft, this.def.cycleTime ?? 0.5);
            return false;
        }
        if (mode.trigger === 'deploy') {
            if (this.prone || this.deploying > 0) {
                this.cancelProne();
                return false;
            }
            this.deploying = 0.0001;
            return false;
        }
        if (mode.trigger === 'cloak') {
            this.cloaked = !this.cloaked;
            this.armCooldown(mode, special);
            return false;
        }
        if (mode.trigger === 'cash') {
            this.didCash = true;
            this.armCooldown(mode, special);
            return false;
        }
        if (mode.trigger === 'dash') {
            this.hopSpeed = GameConfig.motion.jumpSpeed * Math.sqrt(0.8);
            this.heavyAir = true;
            this.startSwing(mode, 'chop');
            this.armCooldown(mode, special);
            return false;
        }
        if (mode.trigger === 'melee') {
            let kind: 'stock' | 'slash' | 'thrust' = 'stock';
            if (this.def.id === 'broadsword') {
                kind = this.nextLight;
                this.nextLight = kind === 'slash' ? 'thrust' : 'slash';
                this.comboLeft = 0;
                this.dashSpan = 1;
                this.dashLeft = px(this.dashSpan);
                this.dashGo = true;
                this.dashFollow = kind;
                this.dashMode = mode;
                this.poseKind = 'dash';
                this.armCooldown(mode, special);
                return false;
            } else if (this.def.id === 'knife') {
                kind = 'thrust';
            }
            this.startSwing(mode, kind);
            this.armCooldown(mode, special);
            return false;
        }
        const before = this.ammo(special);
        const per = Math.max(1, mode.ammoCost);
        const shotsPlanned = mode.trigger === 'burst'
            ? (mode.burstFlexible ? Math.min(mode.burstCount, Math.floor(before / per)) : mode.burstCount)
            : 1;
        const revert = this.fireOne(mode, special, shots);
        const spent = before - this.ammo(special);
        const fired = spent > 0 || this.freeStarter;
        if (fired && !revert && mode.trigger === 'burst') {
            this.burstLeft = Math.max(0, shotsPlanned - 1);
            this.burstGap = mode.burstInterval;
            this.burstSpecial = special;
        }
        this.armCooldown(mode, special);
        return revert;
    }

    private shotRpm(mode: FireMode, special: boolean) {
        if (this.def.id === 'm249' && this.prone && !special) {
            return mode.rpm * 1.2;
        }
        return mode.rpm;
    }

    /** M37 切到独头后，弹道改用特殊攻击上写的独头参数。 */
    private ballistics(mode: FireMode) {
        if (this.def.id === 'm37' && this.slug) {
            return this.def.special;
        }
        return mode;
    }

    private tickDeploy(dt: number) {
        if (this.def.id !== 'm249' || this.prone || this.deploying <= 0) {
            return;
        }
        this.deploying += dt;
        if (this.deploying >= 1) {
            this.deploying = 1;
            this.prone = true;
        }
    }

    private tickSpool(dt: number, primary: AttackButtons, special: AttackButtons) {
        if (this.def.id !== 'gatling') {
            return;
        }
        if (primary.held) {
            this.spinOn = true;
        } else if (special.edge) {
            this.spinOn = !this.spinOn;
        }
        if (this.spinOn) {
            this.spool = Math.min(1, this.spool + dt);
        } else {
            this.spool = 0;
        }
    }

    private armCooldown(mode: FireMode, special: boolean) {
        const cd = 60 / Math.max(1, this.shotRpm(mode, special));
        if (this.def.sharedCooldown) {
            this.primaryCd = Math.max(this.primaryCd, cd);
            this.specialCd = Math.max(this.specialCd, cd);
            return;
        }
        if (special) {
            this.specialCd = cd;
        } else {
            this.primaryCd = cd;
        }
    }

    private fireOne(mode: FireMode, special: boolean, shots: FiredShot[], gravityOverride?: number, spreadOverride?: number) {
        const have = this.ammo(special);
        const cost = mode.partialAmmo ? Math.min(mode.ammoCost, have) : mode.ammoCost;
        if (!this.freeStarter && (have < cost || cost <= 0)) {
            return false;
        }
        if (!this.freeStarter) {
            this.setAmmo(special, have - cost);
        }
        const shot = this.ballistics(mode);
        const gravity = gravityOverride === undefined ? shot.gravity : gravityOverride;
        let spreadDeg = spreadOverride === undefined ? shot.spread : spreadOverride;
        if (spreadOverride === undefined && this.def.id === 'm249' && this.prone && !special) {
            spreadDeg *= 0.7;
        }
        const angles = shot.fanAngles.length > 0 ? shot.fanAngles : [0];
        const pellets = Math.max(1, shot.pelletCount);
        for (const angle of angles) {
            for (let i = 0; i < pellets; i++) {
                shots.push({
                    speed: px(shot.speed),
                    damage: shot.damage,
                    spreadDeg,
                    angleOffset: angle,
                    knockback: shot.knockback,
                    gravity: px(gravity),
                    arcVy: px(shot.arcVy),
                    kind: shot.projectile,
                    length: GameConfig.bulletUnit * Math.max(1, shot.bulletLengths),
                    falloff: shot.falloff,
                    homing: shot.homing,
                    turnRate: shot.turnRate,
                    flightTime: shot.flightTime,
                    explode: shot.explode > 0 ? px(shot.explode) : 0,
                    glow: shot.glow,
                    stun: shot.stun,
                    splitAfter: shot.splitAfter > 0 ? px(shot.splitAfter) : 0,
                });
            }
        }
        if ((this.def.cycleTime ?? 0) > 0) {
            this.cycleLeft = this.def.cycleTime ?? 0;
        }
        if (mode.lockPrimary) {
            this.primaryReload = mode.reloadTime;
            this.charging = false;
            this.charge = 0;
        }
        if (this.def.sharedMagazine && this.shared <= 0) {
            this.burstLeft = 0;
            if (this.def.reloadAmount > 0) {
                if (this.reserve > 0 && this.tubeReload <= 0) {
                    this.tubeReload = this.def.primary.reloadTime;
                    return false;
                }
                return true;
            }
            if (this.def.onEmpty === 'revert') {
                return true;
            }
            this.armReload(this.def.primary, false);
        }
        if (!this.def.sharedMagazine && this.def.onEmpty === 'reload' && this.ammo(special) <= 0) {
            this.armReload(mode, special);
        }
        return false;
    }

    private armReload(mode: FireMode, special: boolean) {
        if (special) {
            if (this.specialReload <= 0) {
                this.specialReload = mode.reloadTime;
            }
        } else if (this.primaryReload <= 0) {
            this.primaryReload = mode.reloadTime;
        }
    }

    private reloading(special: boolean) {
        if (this.tubeReload > 0) {
            return true;
        }
        if (this.def.onEmpty !== 'reload' || this.def.reloadAmount > 0) {
            return false;
        }
        if (this.def.sharedMagazine) {
            return this.primaryReload > 0;
        }
        return special ? this.specialReload > 0 : this.primaryReload > 0;
    }

    private ammo(special: boolean) {
        if (this.def.sharedMagazine) {
            return this.shared;
        }
        return special ? this.specialAmmo : this.primaryAmmo;
    }

    private setAmmo(special: boolean, value: number) {
        if (this.def.sharedMagazine) {
            this.shared = value;
            return;
        }
        if (special) {
            this.specialAmmo = value;
        } else {
            this.primaryAmmo = value;
        }
    }
}

export function createWeapon(id: string, tune?: { magazine?: boolean; faster?: boolean; infinite?: boolean }) {
    let def = findWeapon(id);
    if (tune?.magazine || tune?.faster) {
        def = {
            ...def,
            reserve: tune.magazine ? boostAmmo(def.reserve) : def.reserve,
            primary: { ...def.primary },
            special: { ...def.special },
        };
        if (tune.magazine) {
            def.primary.magazine = boostAmmo(def.primary.magazine);
            def.special.magazine = boostAmmo(def.special.magazine);
        }
        if (tune.faster) {
            def.primary.rpm *= 1.3;
            def.special.rpm *= 1.3;
            def.primary.burstInterval /= 1.3;
            def.special.burstInterval /= 1.3;
            if (def.primary.chargeTime > 0) {
                def.primary.chargeTime /= 1.3;
            }
            if (def.special.chargeTime > 0) {
                def.special.chargeTime /= 1.3;
            }
        }
    }
    const weapon = new WeaponRuntime(def);
    weapon.freeStarter = !!tune?.infinite;
    weapon.swingHaste = tune?.faster ? 1.3 : 1;
    return weapon;
}

export function createStarterWeapon() {
    return createWeapon(STARTER_WEAPON_ID);
}

const CRATE_WEAPONS = ['rifle', 'rifleb', 'smg', 'shotgun', 'bow', 'ak47', 'awm', 'javelin', 'knife', 'm37', 'm249', 'gatling'];

export function rollCrateWeaponId() {
    return CRATE_WEAPONS[Math.floor(Math.random() * CRATE_WEAPONS.length)];
}

export function randomSpecialWeapon() {
    return createWeapon(rollCrateWeaponId());
}

export const KnockDuration = GameConfig.motion.knockTime;
