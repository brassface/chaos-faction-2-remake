import {
    Color,
    Graphics,
    HorizontalTextAlignment,
    instantiate,
    Label,
    Node,
    Prefab,
    UITransform,
    VerticalTextAlignment,
} from 'cc';

export function makeNode(name: string, parent: Node, layer: number): Node {
    const node = new Node(name);
    node.layer = layer;
    parent.addChild(node);
    return node;
}

export function setLayer(node: Node, layer: number) {
    node.layer = layer;
    for (const child of node.children) {
        setLayer(child, layer);
    }
}

export function ensureUI(node: Node, w: number, h: number, ax = 0.5, ay = 0.5): UITransform {
    const ui = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    ui.setContentSize(w, h);
    ui.setAnchorPoint(ax, ay);
    return ui;
}

export function makeLabel(
    parent: Node,
    layer: number,
    text: string,
    fontSize: number,
    width: number,
    height: number,
    color: Color,
): Label {
    const node = makeNode('Label', parent, layer);
    ensureUI(node, width, height);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 4;
    label.useSystemFont = true;
    label.fontFamily = 'Microsoft YaHei, SimHei, Arial';
    label.color = color;
    label.horizontalAlign = HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return label;
}

export function paintRect(g: Graphics, x: number, y: number, w: number, h: number, fill: Color, stroke?: Color) {
    g.fillColor = fill;
    g.rect(x, y, w, h);
    g.fill();
    if (stroke) {
        g.lineWidth = 2;
        g.strokeColor = stroke;
        g.rect(x, y, w, h);
        g.stroke();
    }
}

export function spawnPrefab(prefab: Prefab, parent: Node, layer: number, name: string): Node {
    const node = instantiate(prefab);
    node.name = name;
    parent.addChild(node);
    setLayer(node, layer);
    return node;
}
