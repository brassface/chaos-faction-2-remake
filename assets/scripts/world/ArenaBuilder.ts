import { Color, Graphics, Node, Prefab, UITransform } from 'cc';
import { px, SceneConfig } from '../config/GameConfig';
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
    width: number;
    height: number;
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
 * 第一层高出地面不超过约 2.4 个角色宽度，保证从地面跳得上去。
 * 相邻层水平重叠，避免隔空跳不过去。整张图宽是画面的 2 倍，高是画面的 3 倍。
 */
const Layouts: Layout[] = [
    {
        name: '仓库夹层',
        bg: new Color(28, 36, 52, 255),
        plats: [
            { x: -18, elevation: 2.4, w: 18 },
            { x: 18, elevation: 2.4, w: 18 },
            { x: -8, elevation: 4.8, w: 16 },
            { x: 8, elevation: 4.8, w: 16 },
            { x: 0, elevation: 7.2, w: 18 },
            { x: -16, elevation: 9.6, w: 14 },
            { x: 16, elevation: 9.6, w: 14 },
            { x: -6, elevation: 12, w: 14 },
            { x: 6, elevation: 12, w: 14 },
            { x: 0, elevation: 14.4, w: 16 },
            { x: -12, elevation: 16.8, w: 12 },
            { x: 12, elevation: 16.8, w: 12 },
        ],
    },
    {
        name: '码头台阶',
        bg: new Color(24, 42, 48, 255),
        plats: [
            { x: -22, elevation: 2.4, w: 14 },
            { x: -12, elevation: 4.8, w: 14 },
            { x: -2, elevation: 7.2, w: 14 },
            { x: 8, elevation: 9.6, w: 14 },
            { x: 18, elevation: 12, w: 14 },
            { x: 8, elevation: 14.4, w: 12 },
            { x: 4, elevation: 16.8, w: 16 },
            { x: 22, elevation: 2.4, w: 12 },
            { x: 14, elevation: 4.8, w: 10 },
        ],
    },
    {
        name: '中心塔',
        bg: new Color(42, 32, 36, 255),
        plats: [
            { x: 0, elevation: 2.4, w: 16 },
            { x: -14, elevation: 4.8, w: 14 },
            { x: 14, elevation: 4.8, w: 14 },
            { x: 0, elevation: 7.2, w: 18 },
            { x: -16, elevation: 9.6, w: 12 },
            { x: 16, elevation: 9.6, w: 12 },
            { x: 0, elevation: 12, w: 16 },
            { x: -10, elevation: 14.4, w: 12 },
            { x: 10, elevation: 14.4, w: 12 },
            { x: 0, elevation: 16.8, w: 14 },
        ],
    },
    {
        name: '错层巷',
        bg: new Color(32, 40, 32, 255),
        plats: [
            { x: -20, elevation: 2.4, w: 16 },
            { x: 4, elevation: 2.4, w: 16 },
            { x: -8, elevation: 4.8, w: 14 },
            { x: 16, elevation: 4.8, w: 14 },
            { x: 0, elevation: 7.2, w: 16 },
            { x: -18, elevation: 9.6, w: 12 },
            { x: 10, elevation: 9.6, w: 14 },
            { x: -6, elevation: 12, w: 14 },
            { x: 18, elevation: 12, w: 12 },
            { x: 2, elevation: 14.4, w: 16 },
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
    const width = SceneConfig.designWidth * SceneConfig.widthScale;
    const height = SceneConfig.designHeight * SceneConfig.heightScale;
    const groundTop = -height / 2 + GROUND_H;
    const groundW = width - 40;

    const bg = makeNode('BG', parent, layer);
    ensureUI(bg, width, height);
    const bgG = bg.addComponent(Graphics);
    paintRect(bgG, -width / 2, -height / 2, width, height, layout.bg);

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
            { x: px(-12), y: groundTop },
            { x: px(12), y: groundTop },
        ],
        width,
        height,
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
