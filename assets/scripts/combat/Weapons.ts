import { FireMode, findWeapon, GameConfig, px, STARTER_WEAPON_ID, WeaponDef } from '../config/GameConfig';

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
    /** 像素。0 表示飞到场景边界才销毁。 */
    range: number;
}

export type FiredShotKind = 'bullet' | 'mag' | 'pellet' | 'arrow';

export interface AttackButtons {
    held: boolean;
    edge: boolean;
    released: boolean;
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
    private charge = 0;

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
        this.charge = 0;
    }

    hudText(): string {
        if (this.charging) {
            const cap = Math.max(0.001, this.def.primary.chargeTime);
            const percent = Math.round(Math.min(1, this.charge / cap) * 100);
            return `${this.def.name}  拉弓${percent}%  ${this.ammo(false)}/${this.def.primary.magazine}`;
        }
        if (this.def.reloadAmount > 0) {
            if (this.tubeReload > 0) {
                return `${this.def.name}  换弹${this.tubeReload.toFixed(1)}s  备弹${this.reserve}`;
            }
            return `${this.def.name}  ${this.shared}/${this.reserve}`;
        }
        if (this.def.sharedMagazine) {
            return `${this.def.name}  ${this.shared}/${this.def.primary.magazine}`;
        }
        const primary = this.primaryReload > 0
            ? `换弹${this.primaryReload.toFixed(1)}s`
            : `${this.primaryAmmo}/${this.def.primary.magazine}`;
        const special = this.specialReload > 0
            ? `换弹${this.specialReload.toFixed(1)}s`
            : `${this.specialAmmo}/${this.def.special.magazine}`;
        return `${this.def.name}  弹${primary}  匣${special}`;
    }

    tick(dt: number, primary: AttackButtons, special: AttackButtons): { shots: FiredShot[]; revert: boolean } {
        this.primaryCd = Math.max(0, this.primaryCd - dt);
        this.specialCd = Math.max(0, this.specialCd - dt);
        this.tickReload(dt);

        const shots: FiredShot[] = [];
        let revert = false;
        revert = this.tickCharge(dt, primary, shots) || revert;

        if (this.burstLeft > 0) {
            this.burstGap -= dt;
            if (this.burstGap <= 0) {
                const mode = this.burstSpecial ? this.def.special : this.def.primary;
                if (this.ammo(this.burstSpecial) < 1 || this.reloading(this.burstSpecial)) {
                    this.burstLeft = 0;
                } else {
                    const reverted = this.fireOne(mode, this.burstSpecial, shots);
                    if (reverted) {
                        this.burstLeft = 0;
                        revert = true;
                    } else {
                        this.burstLeft -= 1;
                        this.burstGap = mode.burstInterval;
                    }
                }
            }
        }

        if (this.burstLeft === 0 && this.canStart(this.def.special, special, true)) {
            revert = this.begin(this.def.special, true, shots) || revert;
        }
        if (this.def.primary.trigger !== 'charge' && this.canStart(this.def.primary, primary, false)) {
            revert = this.begin(this.def.primary, false, shots) || revert;
        }
        return { shots, revert };
    }

    private tickCharge(dt: number, primary: AttackButtons, shots: FiredShot[]) {
        const mode = this.def.primary;
        if (mode.trigger !== 'charge') {
            return false;
        }
        if (this.reloading(false)) {
            this.charging = false;
            this.charge = 0;
            return false;
        }
        if (!this.charging) {
            if (!(primary.edge && this.canPay(mode, false))) {
                return false;
            }
            this.charging = true;
            this.charge = 0;
        }
        if (primary.held && !primary.released) {
            this.charge = Math.min(mode.chargeTime, this.charge + dt);
            return false;
        }
        const cap = Math.max(0.001, mode.chargeTime);
        const t = Math.max(0, Math.min(1, this.charge / cap));
        const gravity = mode.gravityAtZero + (mode.gravityAtFull - mode.gravityAtZero) * t;
        this.charging = false;
        this.charge = 0;
        if (!this.canPay(mode, false)) {
            return false;
        }
        return this.fireOne(mode, false, shots, gravity);
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
                this.primaryAmmo = this.def.primary.magazine;
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
        const want = mode.trigger === 'semi' ? btn.edge : (btn.held || btn.edge);
        if (!want) {
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
        if (mode.trigger === 'burst' && this.ammo(special) < mode.burstCount) {
            return false;
        }
        return this.canPay(mode, special);
    }

    private canPay(mode: FireMode, special: boolean) {
        const have = this.ammo(special);
        if (mode.partialAmmo) {
            return have >= 1;
        }
        return have >= Math.max(1, mode.ammoCost);
    }

    private begin(mode: FireMode, special: boolean, shots: FiredShot[]) {
        const revert = this.fireOne(mode, special, shots);
        if (!revert && mode.trigger === 'burst') {
            this.burstLeft = mode.burstCount - 1;
            this.burstGap = mode.burstInterval;
            this.burstSpecial = special;
        }
        const cd = 60 / Math.max(1, mode.rpm);
        if (special) {
            this.specialCd = cd;
        } else {
            this.primaryCd = cd;
        }
        return revert;
    }

    private fireOne(mode: FireMode, special: boolean, shots: FiredShot[], gravityOverride?: number) {
        const have = this.ammo(special);
        const cost = mode.partialAmmo ? Math.min(mode.ammoCost, have) : mode.ammoCost;
        if (have < cost || cost <= 0) {
            return false;
        }
        this.setAmmo(special, have - cost);
        const gravity = gravityOverride === undefined ? mode.gravity : gravityOverride;
        const angles = mode.fanAngles.length > 0 ? mode.fanAngles : [0];
        const pellets = Math.max(1, mode.pelletCount);
        for (const angle of angles) {
            for (let i = 0; i < pellets; i++) {
                shots.push({
                    speed: px(mode.speed),
                    damage: mode.damage,
                    spreadDeg: mode.spread,
                    angleOffset: angle,
                    knockback: mode.knockback,
                    gravity: px(gravity),
                    arcVy: px(mode.arcVy),
                    kind: mode.projectile,
                    range: mode.range > 0 ? px(mode.range) : 0,
                });
            }
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

export function createWeapon(id: string) {
    return new WeaponRuntime(findWeapon(id));
}

export function createStarterWeapon() {
    return createWeapon(STARTER_WEAPON_ID);
}

const CRATE_WEAPONS = ['rifle', 'rifleb', 'smg', 'shotgun', 'bow'];

export function randomSpecialWeapon() {
    const id = CRATE_WEAPONS[Math.floor(Math.random() * CRATE_WEAPONS.length)];
    return createWeapon(id);
}

export const KnockDuration = GameConfig.motion.knockTime;
