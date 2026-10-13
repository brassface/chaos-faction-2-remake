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

    hp: 100,
    lives: 5,
    respawnInvuln: 1.4,
    crateInterval: 15,

    motion: {
        /** 每秒人物宽度 */
        moveSpeed: 4,
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

export type FireTrigger = 'semi' | 'auto' | 'burst' | 'charge';
export type EmptyPolicy = 'reload' | 'revert';
export type ProjectileKind = 'bullet' | 'mag' | 'pellet' | 'arrow';

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
    /** 飞行距离上限，人物宽度。0 表示不按距离销毁。 */
    range: number;
    /** 固定俯仰角（度），正数朝上。弓的三支箭用这个，不用随机散布。 */
    fanAngles: number[];
    /** 拉弓满蓄力的时间（秒）。仅 charge。 */
    chargeTime: number;
    /** 刚按下就松开时的下坠，人物宽度/秒²。 */
    gravityAtZero: number;
    /** 拉满时的下坠，人物宽度/秒²。 */
    gravityAtFull: number;
    /** 开火后进入换弹，并在换弹结束时把普通攻击弹药装满，期间不能普通攻击。 */
    lockPrimary: boolean;
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
    range: 0,
    fanAngles: [],
    chargeTime: 0.5,
    gravityAtZero: 0,
    gravityAtFull: 0,
    lockPrimary: false,
    ...partial,
});

const pistolPrimaryRpm = 500;

const riflePrimary = semi({
    speed: 10,
    damage: 25,
    spread: GameConfig.spread.rifle,
    knockback: 1,
    rpm: 600,
    trigger: 'auto',
    magazine: 30,
    projectile: 'bullet',
});

const rifleBurst = semi({
    speed: 8,
    damage: 25,
    spread: GameConfig.spread.none,
    knockback: 1,
    rpm: 400,
    trigger: 'burst',
    burstCount: 3,
    burstInterval: 0.07,
    magazine: 30,
    projectile: 'bullet',
});

export const Weapons: WeaponDef[] = [
    {
        id: 'pistol',
        name: '手枪A',
        sharedMagazine: false,
        onEmpty: 'reload',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 8,
            damage: 20,
            spread: GameConfig.spread.none,
            knockback: 0.5,
            gravity: 0,
            arcVy: 0,
            rpm: pistolPrimaryRpm,
            trigger: 'semi',
            magazine: 7,
            reloadTime: 2,
            projectile: 'bullet',
        }),
        special: semi({
            speed: 8,
            damage: 15,
            spread: GameConfig.spread.none,
            knockback: 1,
            gravity: 18,
            arcVy: 11,
            rpm: 200,
            trigger: 'semi',
            magazine: 1,
            reloadTime: 2,
            projectile: 'mag',
            lockPrimary: true,
        }),
    },
    {
        id: 'rifle',
        name: '步枪A',
        sharedMagazine: true,
        onEmpty: 'revert',
        reserve: 0,
        reloadAmount: 0,
        primary: riflePrimary,
        special: rifleBurst,
    },
    {
        id: 'rifleb',
        name: '步枪B',
        sharedMagazine: true,
        onEmpty: 'revert',
        reserve: 0,
        reloadAmount: 0,
        primary: { ...riflePrimary },
        special: {
            ...rifleBurst,
            trigger: 'auto',
            burstCount: 1,
            damage: 7,
            spread: GameConfig.spread.shotgunWide,
            pelletCount: 10,
            ammoCost: 10,
            range: 1.5,
            projectile: 'pellet',
        },
    },
    {
        id: 'smg',
        name: '冲锋枪A',
        sharedMagazine: true,
        onEmpty: 'revert',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: 9,
            damage: 20,
            spread: GameConfig.spread.smg,
            knockback: 0.3,
            rpm: 1000,
            trigger: 'auto',
            magazine: 50,
            projectile: 'bullet',
        }),
        special: semi({
            speed: 9,
            damage: 20,
            spread: GameConfig.spread.smgHeavy,
            knockback: 0.3,
            rpm: 1200,
            trigger: 'auto',
            magazine: 50,
            projectile: 'bullet',
        }),
    },
    {
        id: 'shotgun',
        name: '霰弹枪A',
        sharedMagazine: true,
        onEmpty: 'reload',
        reserve: 4,
        reloadAmount: 2,
        primary: semi({
            speed: riflePrimary.speed,
            damage: 6,
            spread: GameConfig.spread.shotgun,
            knockback: 0.2,
            rpm: pistolPrimaryRpm,
            trigger: 'semi',
            magazine: 2,
            reloadTime: 1.5,
            projectile: 'pellet',
            pelletCount: 15,
            ammoCost: 1,
            range: 2.5,
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
            range: 3,
        }),
    },
    {
        id: 'bow',
        name: '弓箭',
        sharedMagazine: true,
        onEmpty: 'revert',
        reserve: 0,
        reloadAmount: 0,
        primary: semi({
            speed: riflePrimary.speed,
            damage: riflePrimary.damage,
            spread: 0,
            knockback: riflePrimary.knockback,
            rpm: 600,
            trigger: 'charge',
            magazine: 9,
            projectile: 'arrow',
            chargeTime: 0.5,
            gravityAtZero: 20,
            gravityAtFull: 4,
        }),
        special: semi({
            speed: riflePrimary.speed,
            damage: riflePrimary.damage,
            spread: 0,
            knockback: riflePrimary.knockback,
            gravity: 4,
            rpm: 120,
            trigger: 'semi',
            magazine: 9,
            projectile: 'arrow',
            ammoCost: 3,
            fanAngles: [30, 0, -30],
        }),
    },
];

export const STARTER_WEAPON_ID = 'pistol';

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
