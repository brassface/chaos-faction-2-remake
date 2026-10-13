import {
    _decorator,
    Camera,
    Canvas,
    Color,
    Component,
    Graphics,
    KeyCode,
    Layers,
    Node,
    Prefab,
    ResolutionPolicy,
    Sprite,
    UITransform,
    UIOpacity,
    view,
} from 'cc';
import { Fighter } from '../actor/Fighter';
import { gunSpriteFrame, preloadGunSprites } from '../combat/GunSprites';
import { createWeapon, FiredShot, MeleeHit, randomSpecialWeapon } from '../combat/Weapons';
import { damageAt, Falloff, GameConfig, MissileGlow, px, rollStarterId, STARTER_OPTIONS } from '../config/GameConfig';
import { InputHub, readFighterInput } from './InputHub';
import { ensureUI, makeLabel, makeNode, paintRect, spawnPrefab } from './NodeFactory';
import { createPlayerHud, drawHp, livesText, makeButton, makeDim, PlayerHud } from '../ui/GameWidgets';
import { arenaCount, buildArena, Platform } from '../world/ArenaBuilder';

const { ccclass, property } = _decorator;

type Phase = 'menu' | 'play' | 'pause' | 'over';

interface Bullet {
    node: Node;
    x: number;
    y: number;
    vx: number;
    vy: number;
    gravity: number;
    damage: number;
    knockback: number;
    owner: number;
    kind: 'bullet' | 'mag' | 'pellet' | 'arrow' | 'missile' | 'knife';
    traveled: number;
    /** 沿飞行方向的长度（像素）。 */
    length: number;
    /** 飞行方向（弧度）。 */
    angle: number;
    falloff: Falloff;
    homing: boolean;
    turnRate: number;
    tracking: boolean;
    /** 小于 0 表示没有失效时间。 */
    flightLeft: number;
    explode: number;
    glow: MissileGlow;
    speed: number;
    target: number;
    /** 已进入红外末制导。 */
    terminal: boolean;
    /** 目标离开导引头视场，丢失锁定。 */
    seekerLost: boolean;
    prevLos: number;
    /** 命中后的眩晕秒数。 */
    stun: number;
    /** 飞刀自转角度（度）。 */
    spin: number;
}

interface Dust {
    node: Node;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    max: number;
}

interface Crate {
    node: Node;
    x: number;
    y: number;
    s: number;
}

const P1 = new Color(72, 148, 255, 255);
const P2 = new Color(255, 92, 96, 255);
const BULLET_COLOR = new Color(255, 220, 90, 255);
const MAG_COLOR = new Color(196, 132, 64, 255);
const CRATE_COLOR = new Color(240, 186, 60, 255);
const CRATE_LINE = new Color(90, 58, 16, 255);

/** 线段是否穿过轴对齐盒子。 */
function segmentHitsAabb(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
): boolean {
    let t0 = 0;
    let t1 = 1;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) {
                return false;
            }
            continue;
        }
        const r = q[i] / p[i];
        if (p[i] < 0) {
            if (r > t1) {
                return false;
            }
            if (r > t0) {
                t0 = r;
            }
        } else {
            if (r < t0) {
                return false;
            }
            if (r < t1) {
                t1 = r;
            }
        }
    }
    return t0 <= t1;
}

function distPointSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) {
        t = ((px - x1) * dx + (py - y1) * dy) / len2;
        if (t < 0) {
            t = 0;
        } else if (t > 1) {
            t = 1;
        }
    }
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/**
 * 挂到场景任意节点上即可。画面、菜单、角色都由这个组件在运行时生成。
 * 做法见 doc/开发文档.md。
 */
@ccclass('GameApp')
export class GameApp extends Component {
    @property({ type: Prefab, tooltip: '可选。平台外观。锚点会在生成时改成顶部居中，并按平台宽高缩放。' })
    platformPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '可选。人物外观，脚底对准根节点。朝右为正面。有名为 Idle/Run/Jump/Drop 的动画则会播放。' })
    playerPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '可选。武器箱外观。' })
    cratePrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '可选。普通子弹外观，朝右。' })
    bulletPrefab: Prefab | null = null;

    @property({ type: Prefab, tooltip: '可选。手枪特殊攻击弹匣外观，朝右。' })
    magPrefab: Prefab | null = null;

    private phase: Phase = 'menu';
    private layer = Layers.Enum.UI_2D;
    private owned: Node[] = [];
    private menu!: Node;
    private battle!: Node;
    private world!: Node;
    private hud!: Node;
    private pause!: Node;
    private over!: Node;
    private arenaLabel!: ReturnType<typeof makeLabel>;
    private overTitle!: ReturnType<typeof makeLabel>;
    private huds: PlayerHud[] = [];
    private itemLayer: Node | null = null;
    private actorLayer: Node | null = null;
    private fxLayer: Node | null = null;
    private fighters: Fighter[] = [];
    private bullets: Bullet[] = [];
    private dusts: Dust[] = [];
    private aimG: Graphics | null = null;
    private arenaW = GameConfig.designWidth;
    private arenaH = GameConfig.designHeight;
    private platforms: Platform[] = [];
    private spawns: { x: number; y: number }[] = [];
    private crate: Crate | null = null;
    private crateLeft = GameConfig.crateInterval;
    private time = 0;
    /** 开局把两名玩家框进画面时的缩放，也是允许的最大放大。 */
    private cameraCap = 1;
    private camScale = 1;
    private camX = 0;
    private camY = 0;
    private camSnap = true;
    private starterPick = ['pistol', 'pistol'];
    private lifeStarter = ['pistol', 'pistol'];
    private menuCards: { player: number; id: string; box: Graphics; icon: Sprite }[] = [];
    private bills: Dust[] = [];

    onLoad() {
        InputHub.acquire();
        preloadGunSprites();
        this.bootstrap();
    }

    onDestroy() {
        InputHub.release();
        for (const node of this.owned) {
            if (node.isValid) {
                node.destroy();
            }
        }
    }

    update(dt: number) {
        const step = Math.min(dt, 0.05);
        if (this.phase === 'menu') {
            this.paintMenuCards();
        }
        if (this.phase === 'play' && InputHub.pressed(KeyCode.KEY_Q)) {
            this.enterPause();
        }
        if (this.phase === 'play') {
            this.updatePlay(step);
        }
        InputHub.endFrame();
    }

    private bootstrap() {
        const scene = this.node.scene;
        view.setDesignResolutionSize(GameConfig.designWidth, GameConfig.designHeight, ResolutionPolicy.SHOW_ALL);

        let canvas = scene.getComponentInChildren(Canvas);
        let createdCanvas = false;
        if (!canvas) {
            canvas = this.createCanvas(scene);
            createdCanvas = true;
        }
        const cam = canvas.cameraComponent;
        if (cam) {
            cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            cam.clearColor = new Color(16, 20, 32, 255);
            cam.priority = Math.max(cam.priority, 1);
        }
        this.layer = canvas.node.layer;
        for (const other of scene.getComponentsInChildren(Camera)) {
            if (other !== cam) {
                other.enabled = false;
            }
        }

        const root = makeNode('BattleUI', canvas.node, this.layer);
        if (createdCanvas) {
            this.owned.push(canvas.node);
        } else {
            this.owned.push(root);
        }

        this.menu = makeNode('Menu', root, this.layer);
        this.battle = makeNode('Battle', root, this.layer);
        this.world = makeNode('World', this.battle, this.layer);
        this.hud = makeNode('Hud', root, this.layer);
        this.pause = makeNode('Pause', root, this.layer);
        this.over = makeNode('GameOver', root, this.layer);

        this.buildMenu();
        this.buildHud();
        this.buildPause();
        this.buildGameOver();
        this.battle.active = false;
        this.hud.active = false;
        this.pause.active = false;
        this.over.active = false;
    }

    private createCanvas(scene: Node) {
        const canvasNode = new Node('Canvas');
        canvasNode.layer = Layers.Enum.UI_2D;
        scene.addChild(canvasNode);
        const ui = canvasNode.addComponent(UITransform);
        ui.setContentSize(GameConfig.designWidth, GameConfig.designHeight);
        ui.setAnchorPoint(0.5, 0.5);

        const camNode = new Node('UICamera');
        camNode.layer = Layers.Enum.UI_2D;
        canvasNode.addChild(camNode);
        camNode.setPosition(0, 0, 1000);
        const camera = camNode.addComponent(Camera);
        camera.projection = Camera.ProjectionType.ORTHO;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor = new Color(16, 20, 32, 255);
        camera.visibility = Layers.BitMask.UI_2D;
        camera.near = 0.1;
        camera.far = 2000;
        camera.priority = 1;
        camera.orthoHeight = GameConfig.designHeight / 2;

        const canvas = canvasNode.addComponent(Canvas);
        canvas.alignCanvasWithScreen = true;
        canvas.cameraComponent = camera;
        return canvas;
    }

    private buildMenu() {
        makeDim(this.menu, this.layer, 255);
        const height = GameConfig.designHeight;
        const band = height * 0.2;
        const split = -height / 2 + band;
        const rule = makeNode('Rule', this.menu, this.layer);
        ensureUI(rule, GameConfig.designWidth, 2);
        rule.setPosition(0, split, 0);
        const line = rule.addComponent(Graphics);
        paintRect(line, -GameConfig.designWidth / 2, -1, GameConfig.designWidth, 2, new Color(90, 110, 130, 255));
        makeButton(this.menu, this.layer, '开始游戏', 0, -height / 2 + band / 2, () => this.startMatch());

        const hints = [
            'A/D 移动   W 跳   S 下穿\nJ 射击   K 特殊',
            '方向键 移动/跳/下穿\n小键盘 1 射击   2 特殊\n小键盘需打开 NumLock',
        ];
        for (let player = 0; player < 2; player++) {
            const x = player === 0 ? -300 : 300;
            const name = makeLabel(this.menu, this.layer, player === 0 ? 'P1' : 'P2', 36, 240, 48, player === 0 ? P1 : P2);
            name.node.setPosition(x, 250, 0);
            const panel = makeNode(player === 0 ? 'P1Guns' : 'P2Guns', this.menu, this.layer);
            panel.setPosition(x, 40, 0);
            const cols = STARTER_OPTIONS.length;
            const cardW = 68;
            const gap = 6;
            const rowW = cols * cardW + (cols - 1) * gap;
            ensureUI(panel, rowW + 16, 108);
            const bg = panel.addComponent(Graphics);
            paintRect(bg, -(rowW + 16) / 2, -54, rowW + 16, 108, new Color(22, 28, 40, 230), new Color(120, 150, 176, 255));
            STARTER_OPTIONS.forEach((option, index) => {
                const card = makeNode(option.id, panel, this.layer);
                const cx = -rowW / 2 + cardW / 2 + index * (cardW + gap);
                card.setPosition(cx, 6, 0);
                ensureUI(card, cardW, 88);
                const box = card.addComponent(Graphics);
                const iconNode = makeNode('Icon', card, this.layer);
                iconNode.setPosition(0, 14, 0);
                ensureUI(iconNode, 56, 28);
                const icon = iconNode.addComponent(Sprite);
                icon.sizeMode = Sprite.SizeMode.CUSTOM;
                const title = makeLabel(card, this.layer, option.name, 11, cardW - 4, 28, new Color(230, 236, 242, 255));
                title.node.setPosition(0, -28, 0);
                card.on(Node.EventType.TOUCH_END, () => {
                    this.starterPick[player] = option.id;
                    this.paintMenuCards();
                });
                this.menuCards.push({ player, id: option.id, box, icon });
            });
            const hint = makeLabel(this.menu, this.layer, hints[player], 18, 520, 64, new Color(198, 210, 220, 255));
            hint.node.setPosition(x, -150, 0);
        }
        this.paintMenuCards();
    }

    private paintMenuCards() {
        for (const card of this.menuCards) {
            const on = this.starterPick[card.player] === card.id;
            card.box.clear();
            paintRect(
                card.box,
                -32,
                -42,
                64,
                84,
                on ? new Color(64, 52, 24, 255) : new Color(32, 40, 54, 255),
                on ? new Color(240, 196, 80, 255) : new Color(70, 86, 104, 255),
            );
            const frame = gunSpriteFrame(card.id);
            if (frame && card.icon.spriteFrame !== frame) {
                card.icon.spriteFrame = frame;
                const texture = frame.texture;
                if (texture) {
                    (texture.setFilters as (min: number, mag: number) => void)(1, 1);
                }
            }
        }
    }

    private buildHud() {
        this.arenaLabel = makeLabel(this.hud, this.layer, '', 22, 760, 32, new Color(230, 236, 240, 255));
        this.arenaLabel.node.setPosition(0, GameConfig.designHeight / 2 - 28, 0);
        this.huds = [
            createPlayerHud(this.hud, this.layer, -360, '玩家1', P1),
            createPlayerHud(this.hud, this.layer, 360, '玩家2', P2),
        ];
    }

    private buildPause() {
        makeDim(this.pause, this.layer, 160);
        const title = makeLabel(this.pause, this.layer, '暂停', 40, 300, 56, new Color(255, 255, 255, 255));
        title.node.setPosition(0, 160, 0);
        makeButton(this.pause, this.layer, '继续', 0, 50, () => this.resume());
        makeButton(this.pause, this.layer, '重新开始', 0, -20, () => this.startMatch());
        makeButton(this.pause, this.layer, '回到主界面', 0, -90, () => this.backToMenu());
    }

    private buildGameOver() {
        makeDim(this.over, this.layer, 170);
        this.overTitle = makeLabel(this.over, this.layer, '', 42, 640, 60, new Color(255, 236, 180, 255));
        this.overTitle.node.setPosition(0, 150, 0);
        makeButton(this.over, this.layer, '重新开始', 0, 20, () => this.startMatch());
        makeButton(this.over, this.layer, '回到主界面', 0, -50, () => this.backToMenu());
    }

    private startMatch() {
        this.clearWorld();
        this.phase = 'play';
        this.menu.active = false;
        this.pause.active = false;
        this.over.active = false;
        this.hud.active = true;
        this.battle.active = true;

        const index = Math.floor(Math.random() * arenaCount());
        const arena = buildArena(this.world, this.layer, this.platformPrefab, index);
        this.platforms = arena.platforms;
        this.spawns = arena.spawns;
        this.arenaW = arena.width;
        this.arenaH = arena.height;
        this.arenaLabel.string = `${arena.name}    按 Q 打开菜单`;

        this.itemLayer = makeNode('Items', this.world, this.layer);
        this.actorLayer = makeNode('Actors', this.world, this.layer);
        this.fxLayer = makeNode('FX', this.world, this.layer);
        const aimNode = makeNode('Aim', this.fxLayer, this.layer);
        this.aimG = aimNode.addComponent(Graphics);
        this.dusts = [];
        this.bills = [];

        const parent = this.actorLayer;
        this.fighters = [
            new Fighter(parent, this.layer, 0, '玩家1', P1, arena.spawns[0], 1, this.playerPrefab),
            new Fighter(parent, this.layer, 1, '玩家2', P2, arena.spawns[1], -1, this.playerPrefab),
        ];
        for (const fighter of this.fighters) {
            this.equipStarter(fighter, true);
        }
        this.crate = null;
        this.crateLeft = GameConfig.crateInterval;
        this.bullets = [];
        this.cameraCap = this.openingScale(arena.spawns);
        this.camSnap = true;
        this.refreshHud();
    }

    private enterPause() {
        this.phase = 'pause';
        this.pause.active = true;
    }

    private resume() {
        if (this.phase !== 'pause') {
            return;
        }
        this.phase = 'play';
        this.pause.active = false;
    }

    private backToMenu() {
        this.clearWorld();
        this.phase = 'menu';
        this.menu.active = true;
        this.pause.active = false;
        this.over.active = false;
        this.hud.active = false;
        this.battle.active = false;
    }

    private clearWorld() {
        this.fighters = [];
        this.bullets = [];
        this.dusts = [];
        this.bills = [];
        this.aimG = null;
        this.platforms = [];
        this.crate = null;
        this.itemLayer = null;
        this.actorLayer = null;
        this.fxLayer = null;
        if (!this.world) {
            return;
        }
        const kids = this.world.children.slice();
        for (const kid of kids) {
            kid.removeFromParent();
            kid.destroy();
        }
    }

    private updatePlay(dt: number) {
        this.time += dt;
        const minX = -this.arenaW / 2 + 36;
        const maxX = this.arenaW / 2 - 36;
        for (const fighter of this.fighters) {
            if (!fighter.alive) {
                continue;
            }
            const raw = readFighterInput(fighter.id);
            const stunned = fighter.stun > 0;
            fighter.sim(dt, {
                ...raw,
                axis: stunned ? 0 : raw.axis,
                jump: stunned ? false : raw.jump,
                drop: stunned ? false : raw.drop,
            }, this.platforms, minX + fighter.w / 2, maxX - fighter.w / 2);
            if (fighter.wantsDust) {
                fighter.wantsDust = false;
                this.spawnDust(fighter);
            }
        }
        this.tryPickup();
        const quiet = { held: false, edge: false, released: false };
        for (const fighter of this.fighters) {
            if (!fighter.alive) {
                continue;
            }
            const input = readFighterInput(fighter.id);
            const stunned = fighter.stun > 0;
            const keepAim = stunned && fighter.weapon.locksMove();
            const result = fighter.weapon.tick(dt, stunned ? (keepAim ? { held: true, edge: false, released: false } : quiet) : {
                held: input.fireHeld,
                edge: input.fireEdge,
                released: input.fireReleased,
            }, stunned ? quiet : {
                held: input.specialHeld,
                edge: input.specialEdge,
                released: input.specialReleased,
            });
            for (const hit of result.melees) {
                this.applyMelee(fighter, hit);
            }
            for (const shot of result.shots) {
                this.spawnBullet(fighter, shot);
            }
            if (result.shots.length > 0 || result.melees.length > 0) {
                fighter.flash = 0.08;
            }
            if (result.cashes > 0) {
                this.throwCash(fighter);
            }
            if (result.revert) {
                this.equipStarter(fighter, false);
            }
        }
        this.updateAim();
        this.updateDust(dt);
        this.updateBills(dt);
        this.updateBullets(dt);
        this.updateCrate(dt);
        for (const fighter of this.fighters) {
            fighter.sync();
        }
        this.focusCamera(dt);
        this.refreshHud();
        this.checkWin();
    }

    private spawnBullet(owner: Fighter, shot: FiredShot) {
        if (!this.fxLayer) {
            return;
        }
        const aim = (shot.angleOffset + (Math.random() * 2 - 1) * shot.spreadDeg) * Math.PI / 180;
        const ang = owner.facing > 0 ? aim : -aim;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const baseVx = owner.facing * shot.speed;
        const baseVy = shot.arcVy;
        const vx = baseVx * cos - baseVy * sin;
        const vy = baseVx * sin + baseVy * cos;
        const node = this.makeProjectile(shot.kind, shot.length, this.fxLayer);
        const bullet: Bullet = {
            node,
            x: owner.x + owner.facing * (owner.w * 0.55 + 6),
            y: owner.y + owner.h * 0.62,
            vx,
            vy,
            gravity: shot.gravity,
            damage: shot.damage,
            knockback: shot.knockback,
            owner: owner.id,
            kind: shot.kind,
            traveled: 0,
            length: shot.kind === 'mag' ? 0 : shot.length,
            angle: Math.atan2(vy, vx),
            falloff: shot.falloff,
            homing: shot.homing,
            turnRate: shot.turnRate,
            tracking: shot.homing,
            flightLeft: shot.flightTime > 0 ? shot.flightTime : -1,
            explode: shot.explode,
            glow: shot.glow,
            speed: Math.hypot(vx, vy),
            target: shot.homing ? this.nearestEnemy(owner.x, owner.y + owner.h * 0.5, owner.id) : -1,
            terminal: false,
            seekerLost: false,
            prevLos: Math.atan2(vy, vx),
            stun: shot.stun,
            spin: 0,
        };
        if (bullet.homing) {
            this.aimDirect(bullet);
        }
        if (shot.kind === 'missile') {
            this.paintMissile(bullet);
        }
        this.placeBullet(bullet);
        this.bullets.push(bullet);
    }

    private makeProjectile(kind: Bullet['kind'], length: number, parent: Node) {
        const prefab = kind === 'mag' ? this.magPrefab : this.bulletPrefab;
        if (prefab && kind !== 'arrow' && kind !== 'pellet' && kind !== 'missile' && kind !== 'knife') {
            const node = spawnPrefab(prefab, parent, this.layer, kind);
            const ui = node.getComponent(UITransform);
            const base = ui && ui.contentSize.width > 1 ? ui.contentSize.width : GameConfig.bulletUnit;
            if (ui) {
                ui.setAnchorPoint(0, 0.5);
            }
            node.setScale(length / base, 1, 1);
            return node;
        }
        const node = makeNode(kind, parent, this.layer);
        const h = kind === 'arrow' ? 8 : 6;
        ensureUI(node, Math.max(length, 8), h, 0, 0.5);
        const g = node.addComponent(Graphics);
        if (kind === 'mag') {
            paintRect(g, -8, -5, 16, 10, MAG_COLOR, CRATE_LINE);
        } else if (kind === 'arrow') {
            const head = 6;
            paintRect(g, 0, -1, Math.max(4, length - head), 2, new Color(92, 64, 40, 255));
            paintRect(g, length - head, -3, head, 6, new Color(220, 220, 210, 255));
        } else if (kind === 'pellet') {
            paintRect(g, 0, -1.5, length, 3, new Color(255, 196, 90, 255));
        } else if (kind === 'knife') {
            paintRect(g, 0, -1.5, Math.max(8, length - 6), 3, new Color(214, 220, 230, 255));
            paintRect(g, Math.max(8, length - 8), -4, 8, 8, new Color(120, 82, 48, 255));
        } else if (kind === 'missile') {
            paintRect(g, 0, -2, Math.max(8, length - 8), 4, new Color(70, 74, 82, 255));
        } else {
            paintRect(g, 0, -2, length, 4, BULLET_COLOR);
        }
        return node;
    }

    private updateBullets(dt: number) {
        const left = -this.arenaW / 2 - px(GameConfig.bulletBounds.side);
        const right = this.arenaW / 2 + px(GameConfig.bulletBounds.side);
        const bottom = -this.arenaH / 2 - px(GameConfig.bulletBounds.below);
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bullet = this.bullets[i];
            if (bullet.kind === 'knife') {
                bullet.spin += 900 * dt;
            }
            this.steerMissile(bullet, dt);
            const x0 = bullet.x;
            const y0 = bullet.y;
            if (!bullet.tracking) {
                bullet.vy -= bullet.gravity * dt;
            }
            const endX = bullet.x + bullet.vx * dt;
            const endY = bullet.y + bullet.vy * dt;
            const totalDist = Math.hypot(endX - x0, endY - y0);
            const steps = Math.max(1, Math.ceil(totalDist / 12));
            let removed = false;
            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                bullet.x = x0 + (endX - x0) * t;
                bullet.y = y0 + (endY - y0) * t;
                bullet.traveled = bullet.traveled + totalDist / steps;
                bullet.angle = bullet.tracking ? bullet.angle : Math.atan2(bullet.vy, bullet.vx);
                const out = bullet.x < left || bullet.x > right || bullet.y < bottom;
                const harm = damageAt(bullet.falloff, bullet.traveled / GameConfig.charWidth);
                if (out || harm <= 0 || this.hitFighters(bullet, harm)) {
                    this.removeBullet(i);
                    removed = true;
                    break;
                }
            }
            if (!removed) {
                this.placeBullet(bullet);
            }
        }
    }

    private hitFighters(bullet: Bullet, harm: number) {
        for (const fighter of this.fighters) {
            if (!fighter.alive || fighter.id === bullet.owner) {
                continue;
            }
            if (!this.overlapsFighter(bullet, fighter)) {
                continue;
            }
            if (bullet.explode > 0) {
                this.explode(bullet, harm);
                return true;
            }
            if (fighter.invuln <= 0) {
                if (bullet.kind === 'knife' || bullet.kind === 'arrow') {
                    this.stickProjectile(fighter, bullet);
                }
                const dir = Math.abs(bullet.vx) > 8 ? Math.sign(bullet.vx) : (bullet.owner === 0 ? 1 : -1);
                const owner = this.fighters.find((item) => item.id === bullet.owner) ?? null;
                const lives = fighter.lives;
                this.damage(fighter, harm * this.ownerScale(bullet.owner), dir, bullet.knockback, owner);
                this.applyStun(fighter, bullet.stun, lives);
            }
            return true;
        }
        return false;
    }

    private overlapsFighter(bullet: Bullet, fighter: Fighter) {
        const pad = bullet.kind === 'mag' ? 12 : 4;
        const minX = fighter.x - fighter.w / 2 - pad;
        const maxX = fighter.x + fighter.w / 2 + pad;
        const minY = fighter.y - pad;
        const maxY = fighter.y + fighter.h + pad;
        if (bullet.length <= 0) {
            return bullet.x >= minX && bullet.x <= maxX && bullet.y >= minY && bullet.y <= maxY;
        }
        const x2 = bullet.x + Math.cos(bullet.angle) * bullet.length;
        const y2 = bullet.y + Math.sin(bullet.angle) * bullet.length;
        return segmentHitsAabb(bullet.x, bullet.y, x2, y2, minX, minY, maxX, maxY);
    }

    private damage(fighter: Fighter, amount: number, dir: number, knock: number, attacker: Fighter | null = null) {
        const before = fighter.hp;
        fighter.hp -= amount;
        fighter.hurt = 0.12;
        fighter.applyKnock(dir, knock);
        if (fighter.hp > 0) {
            return;
        }
        if (attacker && attacker !== fighter && attacker.alive && attacker.cashStacks > 0 && before > 0) {
            attacker.hp = Math.min(GameConfig.hp, attacker.hp + attacker.cashStacks * 5);
        }
        fighter.clearStuck();
        this.equipStarter(fighter, true);
        fighter.lives -= 1;
        if (fighter.lives <= 0) {
            fighter.lives = 0;
            fighter.hp = 0;
            fighter.alive = false;
            return;
        }
        const spawn = this.spawns[fighter.id];
        if (spawn) {
            fighter.respawn(spawn);
        }
    }

    private removeBullet(index: number) {
        const bullet = this.bullets[index];
        bullet.node.destroy();
        this.bullets.splice(index, 1);
    }

    private placeBullet(bullet: Bullet) {
        bullet.node.setPosition(bullet.x, bullet.y, 0);
        bullet.node.angle = bullet.kind === 'knife' ? bullet.spin : bullet.angle * 180 / Math.PI;
    }

    private nearestEnemy(x: number, y: number, owner: number) {
        let best = -1;
        let bestD = Infinity;
        for (const fighter of this.fighters) {
            if (!fighter.alive || fighter.id === owner) {
                continue;
            }
            const d = Math.hypot(fighter.x - x, fighter.y + fighter.h * 0.5 - y);
            if (d < bestD) {
                bestD = d;
                best = fighter.id;
            }
        }
        return best;
    }

    private aimDirect(bullet: Bullet) {
        const target = this.fighters.find((fighter) => fighter.id === bullet.target && fighter.alive);
        if (!target) {
            return;
        }
        const dx = target.x - bullet.x;
        const dy = target.y + target.h * 0.5 - bullet.y;
        bullet.angle = Math.atan2(dy, dx);
        bullet.prevLos = bullet.angle;
        const speed = bullet.speed > 1 ? bullet.speed : Math.hypot(bullet.vx, bullet.vy);
        bullet.speed = speed;
        bullet.vx = Math.cos(bullet.angle) * speed;
        bullet.vy = Math.sin(bullet.angle) * speed;
    }

    private steerMissile(bullet: Bullet, dt: number) {
        if (!bullet.homing || !bullet.tracking) {
            return;
        }
        const target = this.fighters.find((fighter) => fighter.id === bullet.target && fighter.alive);
        if (target && !bullet.seekerLost) {
            const dx = target.x - bullet.x;
            const dy = target.y + target.h * 0.5 - bullet.y;
            const dist = Math.hypot(dx, dy);
            const los = Math.atan2(dy, dx);
            if (!bullet.terminal && dist <= px(3)) {
                bullet.terminal = true;
                bullet.prevLos = los;
            }
            let off = los - bullet.angle;
            while (off > Math.PI) {
                off -= Math.PI * 2;
            }
            while (off < -Math.PI) {
                off += Math.PI * 2;
            }
            const behind = Math.PI / 2;
            const seeker = bullet.terminal ? 40 * Math.PI / 180 : behind;
            if (Math.abs(off) > seeker) {
                bullet.seekerLost = true;
            } else {
                const maxRate = Math.max(1, bullet.turnRate) * Math.PI / 180;
                let turn = off / Math.max(dt, 0.0001);
                if (bullet.terminal) {
                    let rate = los - bullet.prevLos;
                    while (rate > Math.PI) {
                        rate -= Math.PI * 2;
                    }
                    while (rate < -Math.PI) {
                        rate += Math.PI * 2;
                    }
                    rate /= Math.max(dt, 0.0001);
                    turn = 4 * rate;
                }
                if (turn > maxRate) {
                    turn = maxRate;
                } else if (turn < -maxRate) {
                    turn = -maxRate;
                }
                bullet.angle += turn * dt;
                bullet.prevLos = los;
            }
        }
        const speed = bullet.speed > 1 ? bullet.speed : Math.hypot(bullet.vx, bullet.vy);
        bullet.vx = Math.cos(bullet.angle) * speed;
        bullet.vy = Math.sin(bullet.angle) * speed;
        if (bullet.flightLeft < 0) {
            return;
        }
        bullet.flightLeft -= dt;
        if (bullet.flightLeft > 0) {
            return;
        }
        bullet.tracking = false;
        bullet.homing = false;
        bullet.glow = 'none';
        bullet.gravity = px(18);
        this.paintMissile(bullet);
    }

    private paintMissile(bullet: Bullet) {
        const g = bullet.node.getComponent(Graphics);
        if (!g) {
            return;
        }
        g.clear();
        const len = Math.max(8, bullet.length);
        paintRect(g, 0, -2, len - 8, 4, new Color(70, 74, 82, 255));
        const glow = bullet.glow === 'green'
            ? new Color(80, 255, 120, 255)
            : bullet.glow === 'red'
                ? new Color(255, 64, 48, 255)
                : new Color(90, 92, 96, 255);
        paintRect(g, len - 8, -4, 8, 8, glow);
    }

    private explode(bullet: Bullet, harm: number) {
        const x2 = bullet.x + Math.cos(bullet.angle) * bullet.length;
        const y2 = bullet.y + Math.sin(bullet.angle) * bullet.length;
        for (const fighter of this.fighters) {
            if (!fighter.alive || fighter.id === bullet.owner || fighter.invuln > 0) {
                continue;
            }
            const cx = fighter.x;
            const cy = fighter.y + fighter.h * 0.5;
            if (distPointSegment(cx, cy, bullet.x, bullet.y, x2, y2) > bullet.explode) {
                continue;
            }
            const dir = Math.abs(cx - bullet.x) > 4 ? Math.sign(cx - bullet.x) : (bullet.owner === 0 ? 1 : -1);
            const owner = this.fighters.find((item) => item.id === bullet.owner) ?? null;
            this.damage(fighter, harm * this.ownerScale(bullet.owner), dir, bullet.knockback, owner);
        }
    }

    private stickProjectile(fighter: Fighter, bullet: Bullet) {
        const node = makeNode(bullet.kind === 'arrow' ? 'StuckArrow' : 'StuckKnife', fighter.node, this.layer);
        ensureUI(node, Math.max(28, bullet.length), 10, 0, 0.5);
        const g = node.addComponent(Graphics);
        if (bullet.kind === 'arrow') {
            const head = 6;
            const len = Math.max(12, bullet.length);
            paintRect(g, 0, -1, Math.max(4, len - head), 2, new Color(92, 64, 40, 255));
            paintRect(g, len - head, -3, head, 6, new Color(220, 220, 210, 255));
        } else {
            paintRect(g, 0, -1.5, 22, 3, new Color(214, 220, 230, 255));
            paintRect(g, 18, -4, 8, 8, new Color(120, 82, 48, 255));
        }
        fighter.attachStuck(node, bullet.x - fighter.x, bullet.y - fighter.y, bullet.angle * 180 / Math.PI);
    }

    private applyMelee(attacker: Fighter, hit: MeleeHit) {
        const front = attacker.x + attacker.facing * attacker.w * 0.5;
        const far = front + attacker.facing * hit.range;
        const minX = Math.min(front, far);
        const maxX = Math.max(front, far);
        for (const other of this.fighters) {
            if (!other.alive || other.id === attacker.id || other.invuln > 0) {
                continue;
            }
            const overlapX = other.x + other.w / 2 >= minX && other.x - other.w / 2 <= maxX;
            const extraY = attacker.h * Math.max(0, hit.reachY - 1) / 2;
            const overlapY = other.y < attacker.y + attacker.h + extraY && other.y + other.h > attacker.y - extraY;
            if (!overlapX || !overlapY) {
                continue;
            }
            const lives = other.lives;
            this.damage(other, hit.damage * attacker.damageScale, attacker.facing, hit.knockback, attacker);
            this.applyStun(other, hit.stun, lives);
        }
    }

    private spawnDust(fighter: Fighter) {
        if (!this.fxLayer) {
            return;
        }
        const life = 0.28;
        const speed = px(1) / life;
        for (let i = 0; i < 8; i++) {
            const ang = (Math.PI * 2 * i) / 8;
            const node = makeNode('Dust', this.fxLayer, this.layer);
            node.addComponent(UIOpacity);
            const g = node.addComponent(Graphics);
            paintRect(g, -3, -2, 6, 4, new Color(196, 184, 156, 255));
            this.dusts.push({
                node,
                x: fighter.x,
                y: fighter.y,
                vx: Math.cos(ang) * speed,
                vy: Math.sin(ang) * speed,
                life,
                max: life,
            });
        }
    }

    private updateDust(dt: number) {
        for (let i = this.dusts.length - 1; i >= 0; i--) {
            const dust = this.dusts[i];
            dust.life -= dt;
            if (dust.life <= 0) {
                dust.node.destroy();
                this.dusts.splice(i, 1);
                continue;
            }
            dust.x += dust.vx * dt;
            dust.y += dust.vy * dt;
            dust.node.setPosition(dust.x, dust.y, 0);
            const opacity = dust.node.getComponent(UIOpacity);
            if (opacity) {
                opacity.opacity = Math.round(220 * (dust.life / dust.max));
            }
        }
    }

    private updateAim() {
        if (!this.aimG) {
            return;
        }
        this.aimG.clear();
        this.aimG.lineWidth = 2;
        this.aimG.strokeColor = new Color(255, 72, 72, 210);
        const reach = this.arenaW;
        for (const fighter of this.fighters) {
            if (!fighter.alive) {
                continue;
            }
            const spread = fighter.weapon.aimSpread();
            if (spread === null) {
                continue;
            }
            const x = fighter.x + fighter.facing * (fighter.w * 0.55 + 6);
            const y = fighter.y + fighter.h * 0.62;
            const angles = Math.abs(spread) < 0.35 ? [0] : [spread, -spread];
            for (const deg of angles) {
                const aim = deg * Math.PI / 180;
                const ang = fighter.facing > 0 ? aim : -aim;
                const dir = fighter.facing;
                this.aimG.moveTo(x, y);
                this.aimG.lineTo(x + Math.cos(ang) * dir * reach, y + Math.sin(ang) * dir * reach);
            }
        }
        this.aimG.stroke();
    }

    private ownerScale(owner: number) {
        const fighter = this.fighters.find((item) => item.id === owner);
        return fighter ? fighter.damageScale : 1;
    }

    private equipStarter(fighter: Fighter, reroll: boolean) {
        const pick = this.starterPick[fighter.id] ?? 'pistol';
        let id = pick;
        if (pick === 'random') {
            const kept = this.lifeStarter[fighter.id];
            id = !reroll && kept && kept !== 'random' ? kept : rollStarterId();
        }
        this.lifeStarter[fighter.id] = id;
        fighter.weapon = createWeapon(id);
        if (reroll) {
            fighter.damageScale = 1;
            fighter.cashStacks = 0;
        }
    }

    private throwCash(fighter: Fighter) {
        fighter.holster = 0.55;
        fighter.cashStacks += 1;
        fighter.damageScale = 1 + fighter.cashStacks * 0.05;
        this.spawnBills(fighter);
        this.damage(fighter, 10, 0, 0);
    }

    private spawnBills(fighter: Fighter) {
        if (!this.fxLayer) {
            return;
        }
        for (let i = 0; i < 10; i++) {
            const node = makeNode('Bill', this.fxLayer, this.layer);
            ensureUI(node, 14, 8);
            const g = node.addComponent(Graphics);
            paintRect(g, -7, -4, 14, 8, new Color(64, 176, 86, 255), new Color(210, 255, 180, 255));
            paintRect(g, -2, -3, 4, 6, new Color(230, 255, 210, 255));
            const life = 0.9;
            this.bills.push({
                node,
                x: fighter.x + fighter.facing * 8,
                y: fighter.y + fighter.h * 0.7,
                vx: (Math.random() * 2 - 1) * 90,
                vy: 50 + Math.random() * 80,
                life,
                max: life,
            });
        }
    }

    private updateBills(dt: number) {
        for (let i = this.bills.length - 1; i >= 0; i--) {
            const bill = this.bills[i];
            bill.life -= dt;
            if (bill.life <= 0) {
                bill.node.destroy();
                this.bills.splice(i, 1);
                continue;
            }
            bill.vy -= px(18) * dt;
            bill.x += bill.vx * dt;
            bill.y += bill.vy * dt;
            bill.node.setPosition(bill.x, bill.y, 0);
            bill.node.angle += 240 * dt;
        }
    }

    private applyStun(fighter: Fighter, seconds: number, livesBefore: number) {
        if (seconds <= 0 || !fighter.alive || fighter.lives !== livesBefore) {
            return;
        }
        fighter.stun = Math.max(fighter.stun, seconds);
    }

    private openingScale(spawns: { x: number; y: number }[]) {
        if (spawns.length === 0) {
            return 1;
        }
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        const half = GameConfig.charWidth / 2;
        for (const spawn of spawns) {
            minX = Math.min(minX, spawn.x - half);
            maxX = Math.max(maxX, spawn.x + half);
            minY = Math.min(minY, spawn.y);
            maxY = Math.max(maxY, spawn.y + GameConfig.charHeight);
        }
        return this.frameScale(minX, maxX, minY, maxY);
    }

    private frameScale(minX: number, maxX: number, minY: number, maxY: number) {
        const pad = px(4);
        const needW = Math.max(1, maxX - minX + pad * 2);
        const needH = Math.max(1, maxY - minY + pad * 2);
        return Math.min(GameConfig.designWidth / needW, GameConfig.designHeight / needH);
    }

    private focusCamera(dt: number) {
        if (!this.world) {
            return;
        }
        const alive = this.fighters.filter((fighter) => fighter.alive);
        if (alive.length === 0) {
            this.world.setScale(1, 1, 1);
            this.world.setPosition(0, 0, 0);
            return;
        }
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const fighter of alive) {
            minX = Math.min(minX, fighter.x - fighter.w / 2);
            maxX = Math.max(maxX, fighter.x + fighter.w / 2);
            minY = Math.min(minY, fighter.y);
            maxY = Math.max(maxY, fighter.y + fighter.h);
        }
        if (this.crate) {
            const half = this.crate.s / 2;
            minX = Math.min(minX, this.crate.x - half);
            maxX = Math.max(maxX, this.crate.x + half);
            minY = Math.min(minY, this.crate.y - half);
            maxY = Math.max(maxY, this.crate.y + half);
        }
        const scale = Math.min(this.frameScale(minX, maxX, minY, maxY), this.cameraCap);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const tx = -cx * scale;
        const ty = -cy * scale;
        if (this.camSnap || scale >= this.camScale) {
            this.camSnap = false;
            this.camScale = scale;
            this.camX = tx;
            this.camY = ty;
        } else {
            const blend = 1 - Math.exp(-dt * 3.5);
            this.camScale += (scale - this.camScale) * blend;
            this.camX += (tx - this.camX) * blend;
            this.camY += (ty - this.camY) * blend;
        }
        this.world.setScale(this.camScale, this.camScale, 1);
        this.world.setPosition(this.camX, this.camY, 0);
    }

    private updateCrate(dt: number) {
        this.crateLeft -= dt;
        if (this.crate) {
            const bob = Math.sin(this.time * 3) * 4;
            this.crate.node.setPosition(this.crate.x, this.crate.y + bob, 0);
        }
        if (this.crateLeft <= 0) {
            this.crateLeft = GameConfig.crateInterval;
            this.spawnCrate();
        }
    }

    private spawnCrate() {
        if (!this.itemLayer || this.platforms.length === 0) {
            return;
        }
        if (this.crate) {
            this.crate.node.destroy();
            this.crate = null;
        }
        const platform = this.platforms[Math.floor(Math.random() * this.platforms.length)];
        const span = Math.max(0, platform.w / 2 - 18);
        const x = platform.x + (Math.random() * 2 - 1) * span;
        const s = 32;
        const y = platform.top + s / 2;
        const node = this.cratePrefab
            ? spawnPrefab(this.cratePrefab, this.itemLayer, this.layer, 'Crate')
            : makeNode('Crate', this.itemLayer, this.layer);
        if (!this.cratePrefab) {
            ensureUI(node, s, s);
            const g = node.addComponent(Graphics);
            paintRect(g, -s / 2, -s / 2, s, s, CRATE_COLOR, CRATE_LINE);
            const label = makeLabel(node, this.layer, '箱', 16, s, s, new Color(60, 36, 8, 255));
            label.node.setPosition(0, 0, 0);
        }
        node.setPosition(x, y, 0);
        this.crate = { node, x, y, s };
    }

    private tryPickup() {
        const crate = this.crate;
        if (!crate) {
            return;
        }
        for (const fighter of this.fighters) {
            if (!fighter.alive) {
                continue;
            }
            const overlap = Math.abs(fighter.x - crate.x) < (fighter.w + crate.s) / 2
                && fighter.y < crate.y + crate.s / 2
                && fighter.y + fighter.h > crate.y - crate.s / 2;
            if (!overlap) {
                continue;
            }
            const rolled = randomSpecialWeapon();
            if (fighter.weapon.def.id === rolled.def.id) {
                fighter.weapon.refill();
            } else {
                fighter.weapon = rolled;
            }
            crate.node.destroy();
            this.crate = null;
            return;
        }
    }

    private checkWin() {
        if (this.phase !== 'play') {
            return;
        }
        if (!this.fighters.some((fighter) => !fighter.alive)) {
            return;
        }
        const winner = this.fighters.find((fighter) => fighter.alive);
        this.phase = 'over';
        this.over.active = true;
        this.overTitle.string = winner ? `${winner.displayName} 获胜` : '平局';
    }

    private refreshHud() {
        this.fighters.forEach((fighter, index) => {
            const hud = this.huds[index];
            if (!hud) {
                return;
            }
            drawHp(hud.bar, fighter.hp / GameConfig.hp);
            hud.hp.string = `${Math.max(0, Math.ceil(fighter.hp))}`;
            hud.lives.string = livesText(fighter.lives);
            hud.weapon.string = fighter.weapon.hudText();
        });
    }
}
