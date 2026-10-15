/**
 * 人物体型和移动。距离、速度以人物宽度为单位。
 */

export const FighterConfig = {
    /** 1 个人物宽度对应的像素。移动、子弹、击退都按这个换算。 */
    charWidth: 40,
    /** 人物身高（像素）。碰撞箱与绘制都用这个高度。 */
    charHeight: 64,
    hp: 100,
    lives: 5,
    respawnInvuln: 1.4,
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
};

export function px(charWidths: number): number {
    return charWidths * FighterConfig.charWidth;
}
