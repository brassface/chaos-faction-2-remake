import { Color, Graphics, Label, Node } from 'cc';
import { GameConfig } from '../config/GameConfig';
import { ensureUI, makeLabel, makeNode, paintRect } from '../core/NodeFactory';

const PANEL = new Color(28, 36, 52, 230);
const PANEL_LINE = new Color(168, 196, 220, 255);
const TEXT = new Color(236, 240, 245, 255);

export function makeButton(parent: Node, layer: number, text: string, x: number, y: number, onClick: () => void) {
    const w = 300;
    const h = 58;
    const node = makeNode(text, parent, layer);
    node.setPosition(x, y, 0);
    ensureUI(node, w, h);
    const g = node.addComponent(Graphics);
    paintRect(g, -w / 2, -h / 2, w, h, PANEL, PANEL_LINE);
    const label = makeLabel(node, layer, text, 26, w, h, TEXT);
    label.node.setPosition(0, 0, 0);
    node.on(Node.EventType.TOUCH_END, () => onClick());
    return node;
}

export function makeDim(parent: Node, layer: number, alpha: number) {
    const node = makeNode('Dim', parent, layer);
    ensureUI(node, GameConfig.designWidth, GameConfig.designHeight);
    const g = node.addComponent(Graphics);
    paintRect(
        g,
        -GameConfig.designWidth / 2,
        -GameConfig.designHeight / 2,
        GameConfig.designWidth,
        GameConfig.designHeight,
        new Color(8, 10, 16, alpha),
    );
    return node;
}

export interface PlayerHud {
    title: Label;
    bar: Graphics;
    hp: Label;
    lives: Label;
    weapon: Label;
}

export function createPlayerHud(parent: Node, layer: number, x: number, title: string, tint: Color): PlayerHud {
    const bottom = -GameConfig.designHeight / 2;
    const root = makeNode(title, parent, layer);
    root.setPosition(x, bottom + 78, 0);
    const name = makeLabel(root, layer, title, 20, 280, 28, tint);
    name.node.setPosition(0, 36, 0);
    const barNode = makeNode('Hp', root, layer);
    barNode.setPosition(0, 8, 0);
    ensureUI(barNode, 260, 18);
    const bar = barNode.addComponent(Graphics);
    const hp = makeLabel(root, layer, '100', 16, 80, 22, TEXT);
    hp.node.setPosition(150, 8, 0);
    const lives = makeLabel(root, layer, '', 18, 280, 24, tint);
    lives.node.setPosition(0, -18, 0);
    const weapon = makeLabel(root, layer, '', 16, 320, 24, TEXT);
    weapon.node.setPosition(0, -42, 0);
    return { title: name, bar, hp, lives, weapon };
}

export function drawHp(bar: Graphics, ratio: number) {
    const w = 240;
    const h = 14;
    const t = Math.max(0, Math.min(1, ratio));
    bar.clear();
    paintRect(bar, -w / 2, -h / 2, w, h, new Color(18, 18, 22, 255));
    paintRect(bar, -w / 2, -h / 2, w * t, h, new Color(255 * (1 - t), 210 * t, 70, 255));
}

export function livesText(lives: number) {
    const safe = Math.max(0, Math.min(GameConfig.lives, lives));
    return `生命 ${'●'.repeat(safe)}${'○'.repeat(GameConfig.lives - safe)}`;
}
