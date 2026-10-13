import { Color, Graphics, Node, Prefab, UITransform } from 'cc';
import { GameConfig, px } from '../config/GameConfig';
import { ensureUI, makeNode, paintRect, spawnPrefab } from '../core/NodeFactory';

export interface Platform {
    /** 中心 x（像素，画面中心为 0） */
    x: number;
    /** 可站立的上表面 y */
    top: number;
    w: number;
    h: number;
    /**
     * 相对地面的高度，单位是人物宽度。
     * 0 表示最底层地面，不能下穿。
     */
    elevation: number;
}

export interface Arena {
    name: string;
    platforms: Platform[];
    spawns: { x: number; y: number }[];
}

interface PlatSpec {
    /** 中心，人物宽度，相对画面中心 */
    x: number;
    /** 表面高出地面多少个人物宽度。大于 0 才能下穿。 */
    elevation: number;
    /** 宽度，人物宽度 */
    w: number;
}

interface Layout {
    name: string;
    bg: Color;
    plats: PlatSpec[];
}

/**
 * 第一层高度不超过约 2.6 个角色宽度，保证从地面跳得上去。
 * 更高的平台在水平方向上压住下一层，避免隔空跳不过去。
 */
const Layouts: Layout[] = [
    {
        name: '仓库夹层',
        bg: new Color(28, 36, 52, 255),
        plats: [
            { x: -8, elevation: 2.5, w: 12 },
            { x: 8, elevation: 2.5, w: 12 },
            { x: 0, elevation: 5, w: 10 },
            { x: -5, elevation: 7.4, w: 8 },
            { x: 5, elevation: 7.4, w: 8 },
        ],
    },
    {
        name: '码头台阶',
        bg: new Color(24, 42, 48, 255),
        plats: [
            { x: -11, elevation: 2.4, w: 8 },
            { x: -6, elevation: 4.8, w: 8 },
            { x: 0, elevation: 7.2, w: 8 },
            { x: 6, elevation: 4.8, w: 8 },
            { x: 11, elevation: 2.4, w: 8 },
        ],
    },
    {
        name: '中心塔',
        bg: new Color(42, 32, 36, 255),
        plats: [
            { x: 0, elevation: 2.5, w: 8 },
            { x: -8, elevation: 4.8, w: 10 },
            { x: 8, elevation: 4.8, w: 10 },
            { x: 0, elevation: 7.2, w: 12 },
        ],
    },
    {
        name: '错层巷',
        bg: new Color(32, 40, 32, 255),
        plats: [
            { x: -9, elevation: 2.4, w: 10 },
            { x: 0, elevation: 4.8, w: 10 },
            { x: 8, elevation: 2.4, w: 8 },
            { x: -2, elevation: 7.2, w: 8 },
        ],
    },
];

const GROUND_H = 72;
const PLAT_H = 14;
const GROUND_COLOR = new Color(58, 82, 62, 255);
const GROUND_TOP = new Color(126, 176, 104, 255);
const PLAT_COLOR = new Color(86, 104, 128, 255);
const PLAT_TOP = new Color(176, 196, 214, 255);

export function arenaCount() {
    return Layouts.length;
}

export function buildArena(
    parent: Node,
    layer: number,
    platformPrefab: Prefab | null,
    layoutIndex: number,
): Arena {
    const layout = Layouts[(layoutIndex + Layouts.length) % Layouts.length];
    const groundTop = -GameConfig.designHeight / 2 + GROUND_H;
    const groundW = GameConfig.designWidth - 40;

    const bg = makeNode('BG', parent, layer);
    ensureUI(bg, GameConfig.designWidth, GameConfig.designHeight);
    const bgG = bg.addComponent(Graphics);
    paintRect(bgG, -GameConfig.designWidth / 2, -GameConfig.designHeight / 2, GameConfig.designWidth, GameConfig.designHeight, layout.bg);

    const platforms: Platform[] = [];
    platforms.push(place(parent, layer, platformPrefab, {
        x: 0,
        top: groundTop,
        w: groundW,
        h: GROUND_H,
        elevation: 0,
    }, true));

    for (const spec of layout.plats) {
        platforms.push(place(parent, layer, platformPrefab, {
            x: px(spec.x),
            top: groundTop + px(spec.elevation),
            w: px(spec.w),
            h: PLAT_H,
            elevation: spec.elevation,
        }, false));
    }

    return {
        name: layout.name,
        platforms,
        spawns: [
            { x: px(-10.5), y: groundTop },
            { x: px(10.5), y: groundTop },
        ],
    };
}

function place(parent: Node, layer: number, prefab: Prefab | null, platform: Platform, ground: boolean): Platform {
    const node = prefab
        ? spawnPrefab(prefab, parent, layer, ground ? 'Ground' : 'Platform')
        : makeNode(ground ? 'Ground' : 'Platform', parent, layer);
    node.setPosition(platform.x, platform.top, 0);

    if (prefab) {
        const ui = node.getComponent(UITransform) ?? node.addComponent(UITransform);
        const ow = Math.max(1, ui.width);
        const oh = Math.max(1, ui.height);
        ui.setAnchorPoint(0.5, 1);
        node.setScale(platform.w / ow, platform.h / oh, 1);
    } else {
        ensureUI(node, platform.w, platform.h, 0.5, 1);
        const g = node.addComponent(Graphics);
        const body = ground ? GROUND_COLOR : PLAT_COLOR;
        const lip = ground ? GROUND_TOP : PLAT_TOP;
        paintRect(g, -platform.w / 2, -platform.h, platform.w, platform.h, body);
        paintRect(g, -platform.w / 2, -6, platform.w, 6, lip);
    }
    return platform;
}
