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
    UITransform,
    view,
} from 'cc';
import { Fighter } from '../actor/Fighter';
import { preloadGunSprites } from '../combat/GunSprites';
import { createStarterWeapon, FiredShot, randomSpecialWeapon } from '../combat/Weapons';
import { GameConfig, px } from '../config/GameConfig';
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
    kind: 'bullet' | 'mag' | 'pellet' | 'arrow';
    /** 0 表示只受场景边界限制。 */
    range: number;
    traveled: number;
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
    private platforms: Platform[] = [];
    private spawns: { x: number; y: number }[] = [];
    private crate: Crate | null = null;
    private crateLeft = GameConfig.crateInterval;
    private time = 0;

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
        const title = makeLabel(this.menu, this.layer, '横版枪战', 52, 640, 70, new Color(255, 244, 220, 255));
        title.node.setPosition(0, 200, 0);
        const help = makeLabel(
            this.menu,
            this.layer,
            '玩家1   A/D 移动   W 跳   S 下穿   J 射击   K 特殊\n玩家2   方向键移动/跳/下穿   小键盘1 射击   小键盘2 特殊\n对局中按 Q 打开菜单。小键盘需要打开 NumLock。',
            20,
            900,
            110,
            new Color(210, 220, 230, 255),
        );
        help.node.setPosition(0, -150, 0);
        makeButton(this.menu, this.layer, '开始', 0, 40, () => this.startMatch());
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
        this.arenaLabel.string = `${arena.name}    按 Q 打开菜单`;

        this.itemLayer = makeNode('Items', this.world, this.layer);
        this.actorLayer = makeNode('Actors', this.world, this.layer);
        this.fxLayer = makeNode('FX', this.world, this.layer);

        const parent = this.actorLayer;
        this.fighters = [
            new Fighter(parent, this.layer, 0, '玩家1', P1, arena.spawns[0], 1, this.playerPrefab),
            new Fighter(parent, this.layer, 1, '玩家2', P2, arena.spawns[1], -1, this.playerPrefab),
        ];
        this.crate = null;
        this.crateLeft = GameConfig.crateInterval;
        this.bullets = [];
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
        const minX = -GameConfig.designWidth / 2 + 36;
        const maxX = GameConfig.designWidth / 2 - 36;
        for (const fighter of this.fighters) {
            if (!fighter.alive) {
                continue;
            }
            fighter.sim(dt, readFighterInput(fighter.id), this.platforms, minX + fighter.w / 2, maxX - fighter.w / 2);
        }
        this.tryPickup();
        for (const fighter of this.fighters) {
            if (!fighter.alive) {
                continue;
            }
            const input = readFighterInput(fighter.id);
            const result = fighter.weapon.tick(dt, {
                held: input.fireHeld,
                edge: input.fireEdge,
                released: input.fireReleased,
            }, {
                held: input.specialHeld,
                edge: input.specialEdge,
                released: false,
            });
            for (const shot of result.shots) {
                this.spawnBullet(fighter, shot);
            }
            if (result.shots.length > 0) {
                fighter.flash = 0.08;
            }
            if (result.revert) {
                fighter.weapon = createStarterWeapon();
            }
        }
        this.updateBullets(dt);
        this.updateCrate(dt);
        for (const fighter of this.fighters) {
            fighter.sync();
        }
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
        const node = this.makeProjectile(shot.kind, this.fxLayer);
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
            range: shot.range,
            traveled: 0,
        };
        this.placeBullet(bullet);
        this.bullets.push(bullet);
    }

    private makeProjectile(kind: Bullet['kind'], parent: Node) {
        const prefab = kind === 'mag' ? this.magPrefab : this.bulletPrefab;
        if (prefab) {
            return spawnPrefab(prefab, parent, this.layer, kind);
        }
        const node = makeNode(kind, parent, this.layer);
        ensureUI(node, 20, 12);
        const g = node.addComponent(Graphics);
        if (kind === 'mag') {
            paintRect(g, -8, -5, 16, 10, MAG_COLOR, CRATE_LINE);
        } else if (kind === 'arrow') {
            paintRect(g, -10, -1, 20, 2, new Color(92, 64, 40, 255));
            paintRect(g, 8, -3, 4, 6, new Color(220, 220, 210, 255));
        } else if (kind === 'pellet') {
            paintRect(g, -3, -3, 6, 6, new Color(255, 196, 90, 255));
        } else {
            paintRect(g, -8, -2, 16, 4, BULLET_COLOR);
        }
        return node;
    }

    private updateBullets(dt: number) {
        const left = -GameConfig.designWidth / 2 - px(GameConfig.bulletBounds.side);
        const right = GameConfig.designWidth / 2 + px(GameConfig.bulletBounds.side);
        const bottom = -GameConfig.designHeight / 2 - px(GameConfig.bulletBounds.below);
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bullet = this.bullets[i];
            const x0 = bullet.x;
            const y0 = bullet.y;
            bullet.vy -= bullet.gravity * dt;
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
                const out = bullet.x < left || bullet.x > right || bullet.y < bottom;
                const expired = bullet.range > 0 && bullet.traveled >= bullet.range;
                if (out || expired || this.hitFighters(bullet)) {
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

    private hitFighters(bullet: Bullet) {
        const radius = bullet.kind === 'mag' ? 12 : 7;
        for (const fighter of this.fighters) {
            if (!fighter.alive || fighter.id === bullet.owner) {
                continue;
            }
            const hit = bullet.x >= fighter.x - fighter.w / 2 - radius
                && bullet.x <= fighter.x + fighter.w / 2 + radius
                && bullet.y >= fighter.y - radius
                && bullet.y <= fighter.y + fighter.h + radius;
            if (!hit) {
                continue;
            }
            if (fighter.invuln <= 0) {
                const dir = Math.abs(bullet.vx) > 8 ? Math.sign(bullet.vx) : (bullet.owner === 0 ? 1 : -1);
                this.damage(fighter, bullet.damage, dir, bullet.knockback);
            }
            return true;
        }
        return false;
    }

    private damage(fighter: Fighter, amount: number, dir: number, knock: number) {
        fighter.hp -= amount;
        fighter.hurt = 0.12;
        fighter.applyKnock(dir, knock);
        if (fighter.hp > 0) {
            return;
        }
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
        bullet.node.angle = Math.atan2(bullet.vy, bullet.vx) * 180 / Math.PI;
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
