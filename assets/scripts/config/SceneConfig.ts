/**
 * 画面、地图和武器箱。
 */

export const SceneConfig = {
    designWidth: 1280,
    designHeight: 720,
    /** 地图宽度是画面宽度的倍数。 */
    widthScale: 2,
    /** 地图高度是画面高度的倍数。 */
    heightScale: 3,
    /** 武器箱间隔（秒）。开局也等这么久才刷第一个。 */
    crateInterval: 5,
    /** 弹道超出画面左右、底部多少个人物宽度后销毁。 */
    bulletBounds: {
        side: 5,
        below: 10,
    },
};
