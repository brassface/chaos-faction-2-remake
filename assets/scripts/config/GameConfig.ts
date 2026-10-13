/**
 * 全游戏可调数值。
 * 距离、速度、击退默认以「人物宽度」为单位，换算像素时乘 charWidth。
 * 说明见 doc/开发文档.md。
 */
export const GameConfig = {
    designWidth: 1280,
    designHeight: 720,
    /** 1 个人物宽度对应的像素。移动、子弹、击退都按这个换算。 */
    charWidth: 40,
    /** 人物身高（像素）。碰撞箱与绘制都用这个高度。 */
    charHeight: 64,
    /** 现在这颗普通子弹的长度（像素）。各武器按倍数拉长。 */
    bulletUnit: 16,

    hp: 100,
    lives: 5,
    respawnInvuln: 1.4,
    crateInterval: 5,

    motion: {
        /** 每秒人物宽度 */
        moveSpeed: 8,
        /** 每秒²人物宽度 */
        gravity: 42,
        /** 起跳竖直速度，人物宽度/秒。约能跳上 3 个角色宽度的高度。 */
        jumpSpeed: 16,
        /** 下落速度上限，人物宽度/秒 */
        maxFall: 22,
        /** 击退滑动时间（秒）。这段时间内位移约等于武器写的击退距离。 */
        knockTime: 0.12,
    },

    /**
     * 散布是角度。实际弹道在 [-spread, +spread] 里随机。
     * 越大越散。
     */
    spread: {
        none: 0,
        rifle: 3,
        smg: 8,
        smgHeavy: 16,
        /** 霰弹枪 A。比步枪 B 的霰弹更收一点。 */
        shotgun: 20,
        /** 步枪 B 特殊攻击，非常散。 */
        shotgunWide: 34,
    },
    /** 弹道超出画面左右、底部多少个人物宽度后销毁。 */
    bulletBounds: {
        side: 5,
        below: 10,
    },
};

export type FireTrigger = 'semi' | 'auto' | 'burst' | 'charge' | 'melee' | 'cloak' | 'cash' | 'dash';
export type EmptyPolicy = 'reload' | 'revert';
export type ProjectileKind = 'bullet' | 'mag' | 'pellet' | 'arrow' | 'missile' | 'knife';
export type MissileGlow = 'none' | 'green' | 'red';

/**
 * 飞过的人物宽度 => 这一段的伤害。按距离升序。
 * 例如 [[0, 20], [4, 18], [8, 16]]：0 到 4 伤害 20，4 到 8 伤害 18，8 以后伤害 16。
 * 某一档伤害为 0 时，子弹飞到该距离就销毁。最后一档不是 0 时，一直用最后的伤害，直到飞出画面。
 */
export type Falloff = [number, number][];

export function damageAt(falloff: Falloff, widths: number): number {
    let damage = 0;
    for (let i = 0; i < falloff.length; i++) {
        if (widths >= falloff[i][0]) {
            damage = falloff[i][1];
        } else {
            break;
        }
    }
    return damage;
}

export interface FireMode {
    /** 子弹速度，人物宽度/秒 */
    speed: number;
    damage: number;
    /** 散布角（度） */
    spread: number;
    /** 击退距离，人物宽度 */
    knockback: number;
    /** 子弹重力，人物宽度/秒²。0 为直线。 */
    gravity: number;
    /** 出手时额外向上的速度，人物宽度/秒。和 gravity 一起形成先升后落。 */
    arcVy: number;
    /** 每分钟射击次数。连发是每分钟能开始几次点射。 */
    rpm: number;
    trigger: FireTrigger;
    /** 一次扳机打出的子弹数。三连发为 3。 */
    burstCount: number;
    /** 连发里两发之间的间隔（秒） */
    burstInterval: number;
    magazine: number;
    /** 秒。仅 onEmpty 为 reload 时使用。 */
    reloadTime: number;
    projectile: ProjectileKind;
    /** 一次扳机打出的弹丸数。普通子弹为 1。 */
    pelletCount: number;
    /** 每发弹丸消耗的弹药。霰弹枪特殊攻击为 2。 */
    ammoCost: number;
    /** 弹药不够 ammoCost 时，只要还有至少 1 发也允许开火，并打光剩余弹药。 */
    partialAmmo: boolean;
    /**
     * 射程伤害。键是飞过的人物宽度，值是伤害。
     * 霰弹最后一档为 0，飞到那里就消失。其他武器不写 0，飞出画面才消失。
     */
    falloff: Falloff;
    /** 子弹长度，以 bulletUnit 为 1。 */
    bulletLengths: number;
    /** 固定俯仰角（度），正数朝上。弓的三支箭用这个，不用随机散布。 */
    fanAngles: number[];
    /** 拉弓满蓄力的时间（秒）。仅 charge。 */
    chargeTime: number;
    /** 为真时，蓄力没满就松开不会发射。 */
    fullCharge: boolean;
    /** 刚按下就松开时的下坠，人物宽度/秒²。 */
    gravityAtZero: number;
    /** 拉满时的下坠，人物宽度/秒²。 */
    gravityAtFull: number;
    /** 开火后进入换弹，并在换弹结束时把普通攻击弹药装满，期间不能普通攻击。 */
    lockPrimary: boolean;
    /** 连发弹药不够 burstCount 时，把剩下的子弹一次打完。 */
    burstFlexible: boolean;
    /** 蓄力时散布从 spreadAtZero 收到 spread。 */
    chargeSpread: boolean;
    spreadAtZero: number;
    /** 蓄力期间不能左右移动。 */
    lockMove: boolean;
    /** 近战距离，人物宽度。0 表示不是近战。 */
    meleeRange: number;
    /** 近战动作时长（秒）。命中发生在动作中段。 */
    meleeTime: number;
    /** 命中附加的眩晕（秒）。 */
    stun: number;
    /** 跟踪最近的敌人，转向有上限。 */
    homing: boolean;
    /** 每秒最多转过的角度。 */
    turnRate: number;
    /** 跟踪持续时间（秒）。0 表示不会失效。 */
    flightTime: number;
    /** 爆炸半径，人物宽度。0 表示不爆炸。 */
    explode: number;
    glow: MissileGlow;
}

export interface WeaponDef {
    id: string;
    name: string;
    /** 普通攻击和特殊攻击共用一个弹匣 */
    sharedMagazine: boolean;
    /** reload：打空后过 reloadTime 装满。revert：打空后这把武器消失，换回手枪。 */
    onEmpty: EmptyPolicy;
    /** 枪外备弹。0 表示没有备弹。霰弹枪是弹匣 2、备弹 4。 */
    reserve: number;
    /** 每次换弹装进枪里的发数。0 表示一次装满。有备弹时打空才换弹，备弹也没了就换回手枪。 */
    reloadAmount: number;
    /** 打出任意一种攻击后，另一种也要等这次的间隔。 */
    sharedCooldown?: boolean;
    primary: FireMode;
    special: FireMode;
}

const semi = (partial: Partial<FireMode>): FireMode => ({
    speed: 8,
    damage: 20,
    spread: 0,
    knockback: 0.5,
    gravity: 0,
    arcVy: 0,
    rpm: 60,
    trigger: 'semi',
    burstCount: 1,
    burstInterval: 0.07,
    magazine: 7,
    reloadTime: 2,
    projectile: 'bullet',
    pelletCount: 1,
    ammoCost: 1,
    partialAmmo: false,
    falloff: [[0, 20]],
    bulletLengths: 1,
    fanAngles: [],
    chargeTime: 0.5,
    fullCharge: false,
    gravityAtZero: 0,
    gravityAtFull: 0,
    lockPrimary: false,
    burstFlexible: false,
    chargeSpread: false,
    spreadAtZero: 0,
    lockMove: false,
    meleeRange: 0,
    meleeTime: 0.3,
    stun: 0,
    homing: false,
    turnRate: 80,
    flightTime: 0,
    explode: 0,
    glow: 'none',
    ...partial,
});

const pistolPrimaryRpm = 500;

const pistolFalloff: Falloff = [[0, 10], [5, 8], [10, 6], [16, 4]];
const goldFalloff: Falloff = [[0, 15], [5, 12], [10, 9], [16, 6]];
const g18Falloff: Falloff = [[0, 6], [5, 4.8], [10, 3.6], [16, 2.4]];
const g18SpecialFalloff: Falloff = [[0, 6], [4, 4.5], [8, 3.3], [14, 2.4]];
const revolverFalloff: Falloff = [[0, 35]];
const revolverSpecialFalloff: Falloff = [[0, 25], [1.8, 15], [3.5, 0]];
const smgFalloff: Falloff = [[0, 10], [4, 7.5], [8, 5.5], [14, 4]];
const bowFalloff: Falloff = [[0, 25], [8, 22], [16, 18], [26, 14]];
const famasFalloff: Falloff = [[0, 22.5], [9.6, 19.8], [19.2, 16.2], [31.2, 12.6]];
const famasBurstFalloff: Falloff = [[0, 25], [9.6, 22], [19.2, 18], [31.2, 14]];
const m4Falloff: Falloff = [[0, 20], [8, 17.6], [16, 14.4], [26, 11.2]];
const akFalloff: Falloff = [[0, 28], [7.2, 25], [14.4, 21], [23.4, 17]];

const riflePrimary = semi({
    speed: 14,
    damage: 22.5,
    spread: 1,
    knockback: 1,
    rpm: 480,
    trigger: 'auto',
    magazine: 25,
    projectile: 'bullet',
    bulletLengths: 4,
    falloff: famasFalloff,
});

const rifleBurst = semi({
    speed: 15.4,
    damage: 25,
    spread: 1,
    knockback: 1,
    /**
     * 每分钟能开始几次三连发。按住时每分钟子弹数是 rpm * 3，
     * 必须低于普通射击，所以三连发只适合点一下。
     */
    rpm: 96,
    trigger: 'burst',
    burstCount: 3,
    burstInterval: 0.07,
    magazine: 25,
    projectile: 'bullet',
    bulletLengths: 4,
    falloff: famasBurstFalloff,
    burstFlexible: true,
});

export const Weapons: WeaponDef[] = [
    {
        id: 'pistol',
        name: 'Desert',
        sharedMagazine: false,
        onEmpty: 'reload',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 16,
            damage: 10,
            spread: GameConfig.spread.none,
            knockback: 0.5,
            gravity: 0,
            arcVy: 0,
            rpm: pistolPrimaryRpm,
            trigger: 'semi',
            magazine: 7,
            reloadTime: 2,
            projectile: 'bullet',
            bulletLengths: 2,
            falloff: pistolFalloff,
        }),
        special: semi({
            speed: 16,
            damage: 5,
            spread: GameConfig.spread.none,
            knockback: 1,
            gravity: 51.2,
            arcVy: 12.8,
            rpm: 200,
            trigger: 'semi',
            magazine: 1,
            reloadTime: 2,
            projectile: 'mag',
            lockPrimary: true,
            stun: 1,
            falloff: [[0, 5], [3, 4], [6, 3]],
        }),
    },
    {
        id: 'desert_gold',
        name: 'Desert_Gold',
        sharedMagazine: true,
        onEmpty: 'reload',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 16,
            damage: 15,
            spread: GameConfig.spread.none,
            knockback: 0.5,
            rpm: pistolPrimaryRpm,
            trigger: 'semi',
            magazine: 9,
            reloadTime: 2,
            projectile: 'bullet',
            bulletLengths: 2,
            falloff: goldFalloff,
        }),
        special: semi({
            speed: 0,
            damage: 0,
            rpm: 120,
            trigger: 'cash',
            magazine: 9,
            ammoCost: 0,
            falloff: [[0, 0]],
        }),
    },
    {
        id: 'desert_double',
        name: 'Desert_Double',
        sharedMagazine: true,
        onEmpty: 'reload',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 16,
            damage: 10,
            spread: GameConfig.spread.none,
            knockback: 0.5,
            rpm: pistolPrimaryRpm,
            trigger: 'semi',
            magazine: 14,
            reloadTime: 2,
            projectile: 'bullet',
            bulletLengths: 2,
            falloff: pistolFalloff,
        }),
        special: semi({
            speed: 16,
            damage: 10,
            spread: GameConfig.spread.none,
            knockback: 0.5,
            rpm: pistolPrimaryRpm,
            trigger: 'semi',
            magazine: 14,
            reloadTime: 2,
            projectile: 'bullet',
            bulletLengths: 2,
            falloff: pistolFalloff,
        }),
    },
    {
        id: 'revolver',
        name: 'Revolver',
        sharedMagazine: true,
        onEmpty: 'reload',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 32,
            damage: 35,
            spread: GameConfig.spread.none,
            knockback: 1.2,
            rpm: pistolPrimaryRpm / 2,
            trigger: 'charge',
            magazine: 6,
            reloadTime: 2,
            projectile: 'bullet',
            bulletLengths: 4,
            falloff: revolverFalloff,
            chargeTime: 0,
            fullCharge: true,
            lockMove: false,
        }),
        special: semi({
            speed: 32,
            damage: 25,
            spread: GameConfig.spread.smgHeavy * 1.5,
            knockback: 0.8,
            rpm: pistolPrimaryRpm * 1.5,
            trigger: 'semi',
            magazine: 6,
            reloadTime: 2,
            projectile: 'bullet',
            bulletLengths: 4,
            falloff: revolverSpecialFalloff,
        }),
    },
    {
        id: 'broadsword',
        name: 'Broadsword',
        sharedMagazine: true,
        onEmpty: 'reload',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 0,
            damage: 20,
            knockback: 0.4,
            rpm: 300,
            trigger: 'melee',
            magazine: 1,
            ammoCost: 0,
            meleeRange: 1.1,
            meleeTime: 0.2,
            falloff: [[0, 20]],
        }),
        special: semi({
            speed: 0,
            damage: 40,
            knockback: 0.8,
            rpm: 60,
            trigger: 'dash',
            magazine: 1,
            ammoCost: 0,
            meleeRange: 1.2,
            meleeTime: 0.28,
            falloff: [[0, 40]],
        }),
    },
    {
        id: 'g18',
        name: 'G18',
        sharedMagazine: true,
        onEmpty: 'reload',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 16,
            damage: 6,
            spread: GameConfig.spread.none,
            knockback: 0.4,
            rpm: pistolPrimaryRpm * 1.8,
            trigger: 'semi',
            magazine: 17,
            reloadTime: 2,
            projectile: 'bullet',
            bulletLengths: 2,
            falloff: g18Falloff,
        }),
        special: semi({
            speed: 13,
            damage: 6,
            spread: GameConfig.spread.smgHeavy,
            knockback: 0.3,
            rpm: 1200 * 0.8,
            trigger: 'auto',
            magazine: 17,
            reloadTime: 2,
            projectile: 'bullet',
            bulletLengths: 2,
            falloff: g18SpecialFalloff,
        }),
    },
    {
        id: 'rifle',
        name: 'FAMAS',
        sharedMagazine: true,
        onEmpty: 'revert',
        reserve: 0,
        reloadAmount: 0,
        primary: riflePrimary,
        special: rifleBurst,
    },
    {
        id: 'rifleb',
        name: 'M4_MK',
        sharedMagazine: true,
        onEmpty: 'revert',
        reserve: 0,
        reloadAmount: 0,
        primary: {
            speed: 14,
            damage: 20,
            spread: 4,
            knockback: 1,
            gravity: 0,
            arcVy: 0,
            rpm: 600,
            trigger: 'auto',
            burstCount: 1,
            burstInterval: 0.07,
            magazine: 30,
            reloadTime: 2,
            projectile: 'bullet',
            pelletCount: 1,
            ammoCost: 1,
            partialAmmo: false,
            falloff: m4Falloff,
            bulletLengths: 4,
            fanAngles: [],
            chargeTime: 0.5,
            fullCharge: false,
            gravityAtZero: 0,
            gravityAtFull: 0,
            lockPrimary: false,
            burstFlexible: false,
            chargeSpread: false,
            spreadAtZero: 0,
            lockMove: false,
            meleeRange: 0,
            meleeTime: 0.3,
            stun: 0,
            homing: false,
            turnRate: 80,
            flightTime: 0,
            explode: 0,
            glow: 'none',
        },
        special: {
            ...rifleBurst,
            trigger: 'auto',
            burstCount: 1,
            damage: 4.9,
            spread: GameConfig.spread.shotgunWide,
            pelletCount: 10,
            ammoCost: 10,
            rpm: 100,
            projectile: 'pellet',
            bulletLengths: 6,
            falloff: [[0, 4.9], [1, 2.8], [2, 0]],
            burstFlexible: false,
            speed: 14,
            ammoCost: 5,
            partialAmmo: true,
        },
    },
    {
        id: 'smg',
        name: 'MAC-10',
        sharedMagazine: true,
        onEmpty: 'revert',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 13,
            damage: 10,
            spread: GameConfig.spread.smg,
            knockback: 0.3,
            rpm: 1000,
            trigger: 'auto',
            magazine: 50,
            projectile: 'bullet',
            bulletLengths: 2,
            falloff: smgFalloff,
        }),
        special: semi({
            speed: 13,
            damage: 10,
            spread: GameConfig.spread.smgHeavy,
            knockback: 0.3,
            rpm: 1200,
            trigger: 'auto',
            magazine: 50,
            projectile: 'bullet',
            bulletLengths: 2,
            falloff: smgFalloff,
        }),
    },
    {
        id: 'shotgun',
        name: 'Sawed_Off',
        sharedMagazine: true,
        onEmpty: 'reload',
        reserve: 4,
        reloadAmount: 2,
        sharedCooldown: true,
        primary: semi({
            speed: riflePrimary.speed,
            damage: 6,
            spread: GameConfig.spread.shotgun,
            knockback: 0.2,
            rpm: pistolPrimaryRpm / 2,
            trigger: 'semi',
            magazine: 2,
            reloadTime: 1.5,
            projectile: 'pellet',
            pelletCount: 15,
            ammoCost: 1,
            bulletLengths: 6,
            falloff: [[0, 6], [1.5, 4], [3, 0]],
        }),
        special: semi({
            speed: riflePrimary.speed,
            damage: 8,
            spread: GameConfig.spread.shotgun,
            knockback: 0.2,
            rpm: pistolPrimaryRpm,
            trigger: 'semi',
            magazine: 2,
            reloadTime: 1.5,
            projectile: 'pellet',
            pelletCount: 15,
            ammoCost: 2,
            partialAmmo: true,
            bulletLengths: 6,
            falloff: [[0, 8], [1.8, 7], [3.5, 0]],
        }),
    },
    {
        id: 'bow',
        name: 'Bow',
        sharedMagazine: true,
        onEmpty: 'revert',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: riflePrimary.speed + 20,
            damage: 25,
            spread: 0,
            knockback: riflePrimary.knockback,
            rpm: 150,
            trigger: 'charge',
            magazine: 9,
            projectile: 'arrow',
            bulletLengths: 5,
            falloff: bowFalloff,
            chargeTime: 0.5,
            gravityAtZero: 12,
            gravityAtFull: 0.75,
        }),
        special: semi({
            speed: riflePrimary.speed + 20,
            damage: 25,
            spread: 0,
            knockback: riflePrimary.knockback,
            rpm: 30,
            trigger: 'charge',
            magazine: 9,
            projectile: 'arrow',
            ammoCost: 3,
            fanAngles: [30, 0, -30],
            bulletLengths: 5,
            falloff: bowFalloff,
            chargeTime: 0.5,
            gravityAtZero: 12,
            gravityAtFull: 0.75,
        }),
    },
    {
        id: 'ak47',
        name: 'AK47',
        sharedMagazine: true,
        onEmpty: 'revert',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 14,
            damage: 28,
            spread: 6,
            knockback: 1,
            rpm: 690,
            trigger: 'auto',
            magazine: 30,
            projectile: 'bullet',
            bulletLengths: 4,
            falloff: akFalloff,
        }),
        special: semi({
            speed: 0,
            damage: 5,
            knockback: 0.5,
            rpm: 150,
            trigger: 'melee',
            magazine: 30,
            ammoCost: 0,
            meleeRange: 1,
            meleeTime: 0.32,
            stun: 0.5,
            falloff: [[0, 5]],
        }),
    },
    {
        id: 'awm',
        name: 'AWM',
        sharedMagazine: true,
        onEmpty: 'reload',
        reserve: 4,
        reloadAmount: 1,
        primary: semi({
            speed: 44,
            damage: 80,
            spread: 0,
            knockback: 1.2,
            rpm: 40,
            trigger: 'charge',
            magazine: 1,
            reloadTime: 0.5,
            projectile: 'bullet',
            bulletLengths: 18,
            falloff: [[0, 80]],
            chargeTime: 1,
            chargeSpread: true,
            spreadAtZero: GameConfig.spread.smgHeavy * 1.5,
            lockMove: true,
        }),
        special: semi({
            speed: 0,
            damage: 0,
            rpm: 300,
            trigger: 'cloak',
            magazine: 1,
            ammoCost: 0,
            falloff: [[0, 0]],
        }),
    },
    {
        id: 'javelin',
        name: 'Javelin',
        sharedMagazine: true,
        onEmpty: 'revert',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 13,
            damage: 40,
            spread: 0,
            knockback: 1,
            rpm: 90,
            trigger: 'semi',
            magazine: 3,
            projectile: 'missile',
            bulletLengths: 2,
            falloff: [[0, 40]],
            homing: true,
            turnRate: 45,
            flightTime: 10,
            explode: 2,
            glow: 'green',
        }),
        special: semi({
            speed: 6.5,
            damage: 40,
            spread: 0,
            knockback: 1,
            rpm: 60,
            trigger: 'semi',
            magazine: 3,
            projectile: 'missile',
            ammoCost: 3,
            fanAngles: [15, 0, -15],
            bulletLengths: 2,
            falloff: [[0, 40]],
            flightTime: 0,
            explode: 2,
            glow: 'red',
        }),
    },
    {
        id: 'knife',
        name: 'Knife',
        sharedMagazine: true,
        onEmpty: 'revert',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 16,
            damage: 20,
            spread: 0,
            knockback: 0.6,
            gravity: 1,
            arcVy: 0,
            rpm: 240,
            trigger: 'semi',
            magazine: 9,
            projectile: 'knife',
            bulletLengths: 2,
            falloff: [[0, 20]],
        }),
        special: semi({
            speed: 0,
            damage: 20,
            knockback: 0.5,
            rpm: 180,
            trigger: 'melee',
            magazine: 9,
            ammoCost: 0,
            meleeRange: 0.8,
            meleeTime: 0.18,
            falloff: [[0, 20]],
        }),
    },
];

export const STARTER_WEAPON_ID = 'pistol';

export const STARTER_OPTIONS: { id: string; name: string }[] = [
    { id: 'pistol', name: 'Desert' },
    { id: 'desert_gold', name: 'Desert_Gold' },
    { id: 'desert_double', name: 'Desert_Double' },
    { id: 'revolver', name: 'Revolver' },
    { id: 'broadsword', name: 'Broadsword' },
    { id: 'g18', name: 'G18' },
    { id: 'random', name: '随机' },
];

export function rollStarterId(): string {
    const pool = STARTER_OPTIONS.filter((item) => item.id !== 'random');
    return pool[Math.floor(Math.random() * pool.length)].id;
}

export function findWeapon(id: string): WeaponDef {
    const found = Weapons.find((w) => w.id === id);
    if (!found) {
        throw new Error(`unknown weapon ${id}`);
    }
    return found;
}

export function px(charWidths: number): number {
    return charWidths * GameConfig.charWidth;
}
