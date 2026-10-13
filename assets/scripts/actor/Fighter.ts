import { Animation, Color, Graphics, Node, Prefab, Sprite, UIOpacity, UITransform } from 'cc';
import { GameConfig, px } from '../config/GameConfig';
import { gunSpriteFrame } from '../combat/GunSprites';
import { FighterInput } from '../core/InputHub';
import { ensureUI, makeNode, paintRect, spawnPrefab } from '../core/NodeFactory';
import { Platform } from '../world/ArenaBuilder';
import { createStarterWeapon, KnockDuration, WeaponRuntime } from '../combat/Weapons';

export class Fighter {
    readonly w = GameConfig.charWidth;
    readonly h = GameConfig.charHeight;
    x: number;
    y: number;
    vx = 0;
    vy = 0;
    facing: number;
    hp: number;
    lives: number;
    onGround = true;
    groundElevation = 0;
    jumpsLeft = 2;
    dropCeiling: number | null = null;
    pose: 'idle' | 'run' | 'jump' | 'drop' = 'idle';
    alive = true;
    invuln = 0;
    hurt = 0;
    flash = 0;
    anim = 0;
    weapon: WeaponRuntime;
    readonly node: Node;
    private readonly graphics: Graphics | null;
    private readonly usePrefab: boolean;
    private readonly bodyColor: Color;
    private knockVx = 0;
    private knockT = 0;
    private knockDur = KnockDuration;
    private lastPose = '';
    private readonly gunNode: Node;
    private readonly gunSprite: Sprite;
    private readonly muzzle: Node;

    constructor(
        parent: Node,
        layer: number,
        readonly id: number,
        readonly displayName: string,
        color: Color,
        spawn: { x: number; y: number },
        facing: number,
        prefab: Prefab | null,
    ) {
        this.bodyColor = color;
        this.x = spawn.x;
        this.y = spawn.y;
        this.facing = facing;
        this.hp = GameConfig.hp;
        this.lives = GameConfig.lives;
        this.weapon = createStarterWeapon();
        this.usePrefab = !!prefab;
        this.node = prefab
            ? spawnPrefab(prefab, parent, layer, displayName)
            : makeNode(displayName, parent, layer);
        ensureUI(this.node, this.w, this.h, 0.5, 0);
        this.node.addComponent(UIOpacity);
        this.graphics = prefab ? null : this.node.addComponent(Graphics);
        this.gunNode = makeNode('Gun', this.node, this.node.layer);
        ensureUI(this.gunNode, 16, 10, 0, 0.5);
        this.gunSprite = this.gunNode.addComponent(Sprite);
        this.gunSprite.sizeMode = Sprite.SizeMode.RAW;
        this.gunSprite.color = Color.WHITE;
        this.gunNode.active = false;
        this.muzzle = makeNode('Muzzle', this.gunNode, this.node.layer);
        const flash = this.muzzle.addComponent(Graphics);
        paintRect(flash, 0, -4, 8, 8, new Color(255, 214, 80, 255));
        this.muzzle.active = false;
        this.sync();
    }

    applyKnock(dir: number, charWidths: number) {
        const distance = Math.abs(charWidths) * GameConfig.charWidth;
        this.knockDur = KnockDuration;
        this.knockT = KnockDuration;
        const sign = dir === 0 ? this.facing : Math.sign(dir);
        this.knockVx = sign * (2 * distance / this.knockDur);
    }

    respawn(spawn: { x: number; y: number }) {
        this.hp = GameConfig.hp;
        this.x = spawn.x;
        this.y = spawn.y;
        this.vx = 0;
        this.vy = 0;
        this.onGround = true;
        this.groundElevation = 0;
        this.jumpsLeft = 2;
        this.dropCeiling = null;
        this.invuln = GameConfig.respawnInvuln;
        this.knockT = 0;
        this.alive = true;
        this.hurt = 0;
    }

    sim(dt: number, input: FighterInput, platforms: Platform[], minX: number, maxX: number) {
        if (!this.alive) {
            return;
        }
        this.anim += dt;
        if (this.invuln > 0) {
            this.invuln -= dt;
        }
        if (this.hurt > 0) {
            this.hurt -= dt;
        }
        if (this.flash > 0) {
            this.flash -= dt;
        }
        if (input.axis !== 0) {
            this.facing = input.axis > 0 ? 1 : -1;
        }

        let jumped = false;
        if (input.jump && this.jumpsLeft > 0) {
            this.jumpsLeft -= 1;
            this.vy = px(GameConfig.motion.jumpSpeed);
            this.onGround = false;
            this.dropCeiling = null;
            jumped = true;
        }
        if (!jumped && input.drop && this.onGround && this.groundElevation > 0) {
            this.dropCeiling = this.y - 1;
            this.onGround = false;
            this.vy = -80;
        }

        let knock = 0;
        if (this.knockT > 0) {
            knock = this.knockVx * (this.knockT / this.knockDur);
            this.knockT -= dt;
        }
        const move = input.axis * px(GameConfig.motion.moveSpeed);
        this.x += (move + knock) * dt;
        if (this.x < minX) {
            this.x = minX;
        } else if (this.x > maxX) {
            this.x = maxX;
        }

        if (this.onGround) {
            const support = this.findSupport(platforms);
            if (support) {
                this.y = support.top;
                this.vy = 0;
                this.groundElevation = support.elevation;
                this.jumpsLeft = 2;
            } else {
                this.onGround = false;
            }
        }

        if (!this.onGround) {
            const prevY = this.y;
            this.vy -= px(GameConfig.motion.gravity) * dt;
            const maxFall = -px(GameConfig.motion.maxFall);
            if (this.vy < maxFall) {
                this.vy = maxFall;
            }
            this.y += this.vy * dt;
            if (this.vy <= 0) {
                const landed = this.findLanding(platforms, prevY);
                if (landed) {
                    this.y = landed.top;
                    this.vy = 0;
                    this.onGround = true;
                    this.groundElevation = landed.elevation;
                    this.jumpsLeft = 2;
                    this.dropCeiling = null;
                }
            }
        }

        if (this.dropCeiling !== null && !this.onGround && this.vy < 0) {
            this.pose = 'drop';
        } else if (!this.onGround) {
            this.pose = 'jump';
        } else if (input.axis !== 0) {
            this.pose = 'run';
        } else {
            this.pose = 'idle';
        }
    }

    sync() {
        this.node.active = this.alive;
        if (!this.alive) {
            return;
        }
        this.node.setPosition(this.x, this.y, 0);
        const opacity = this.node.getComponent(UIOpacity);
        if (opacity) {
            const blink = this.invuln > 0 && Math.floor(this.anim * 16) % 2 === 0;
            opacity.opacity = blink ? 90 : 255;
        }
        if (this.usePrefab) {
            this.applyPrefabPose();
        } else {
            this.node.setScale(1, 1, 1);
            this.node.angle = 0;
            this.drawBody();
        }
        this.applyGun();
    }

    private findSupport(platforms: Platform[]) {
        let found: Platform | null = null;
        for (const platform of platforms) {
            if (!this.overlapsX(platform)) {
                continue;
            }
            if (Math.abs(this.y - platform.top) > 8) {
                continue;
            }
            if (!found || platform.top > found.top) {
                found = platform;
            }
        }
        return found;
    }

    private findLanding(platforms: Platform[], prevY: number) {
        let found: Platform | null = null;
        for (const platform of platforms) {
            if (this.dropCeiling !== null && platform.top >= this.dropCeiling) {
                continue;
            }
            if (!this.overlapsX(platform)) {
                continue;
            }
            if (prevY >= platform.top - 2 && this.y <= platform.top + 2) {
                if (!found || platform.top > found.top) {
                    found = platform;
                }
            }
        }
        return found;
    }

    private overlapsX(platform: Platform) {
        return Math.abs(this.x - platform.x) <= (this.w + platform.w) / 2 - 6;
    }

    private applyPrefabPose() {
        const clipName = this.pose === 'idle' ? 'Idle' : this.pose === 'run' ? 'Run' : this.pose === 'jump' ? 'Jump' : 'Drop';
        const anim = this.node.getComponent(Animation);
        let played = false;
        if (anim) {
            const clip = anim.clips.find((item) => item && item.name === clipName);
            if (clip) {
                played = true;
                if (this.lastPose !== this.pose) {
                    anim.play(clipName);
                }
            }
        }
        this.lastPose = this.pose;
        const drop = this.pose === 'drop' && !played;
        this.node.setScale(this.facing * (drop ? 1.2 : 1), drop ? 0.6 : 1, 1);
        this.node.angle = !played && this.pose === 'jump' ? 14 : 0;
    }

    private poseBox() {
        const drop = this.pose === 'drop';
        const jump = this.pose === 'jump';
        return {
            drop,
            jump,
            bw: this.w * (drop ? 1.28 : jump ? 0.86 : 1),
            bh: this.h * (drop ? 0.55 : jump ? 1.06 : 1),
            bob: this.pose === 'run' ? Math.sin(this.anim * 14) * 3 : 0,
        };
    }

    private drawBody() {
        const g = this.graphics;
        if (!g) {
            return;
        }
        g.clear();
        const { drop, bw, bh, bob } = this.poseBox();
        const body = this.hurt > 0 ? new Color(255, 244, 220, 255) : this.bodyColor;
        paintRect(g, -bw / 2, bob, bw, bh, body);

        const headR = drop ? 7 : 9;
        g.fillColor = new Color(255, 224, 196, 255);
        g.circle(this.facing * bw * 0.12, bob + bh - headR, headR);
        g.fill();

        g.fillColor = new Color(20, 24, 32, 255);
        g.circle(this.facing * bw * 0.22, bob + bh - headR, 2);
        g.fill();

        if (gunSpriteFrame(this.weapon.def.id)) {
            return;
        }
        const gunW = 18;
        const gunX = this.facing > 0 ? bw * 0.28 : -bw * 0.28 - gunW;
        paintRect(g, gunX, bob + bh * 0.42, gunW, 6, new Color(32, 36, 42, 255));
        if (this.flash > 0) {
            const mx = this.facing > 0 ? gunX + gunW : gunX - 8;
            paintRect(g, mx, bob + bh * 0.4, 8, 8, new Color(255, 214, 80, 255));
        }
    }

    private applyGun() {
        const frame = gunSpriteFrame(this.weapon.def.id);
        if (!frame) {
            this.gunNode.active = false;
            return;
        }
        this.gunNode.active = true;
        if (this.gunSprite.spriteFrame !== frame) {
            this.gunSprite.spriteFrame = frame;
            const texture = frame.texture;
            if (texture) {
                (texture.setFilters as (min: number, mag: number) => void)(1, 1);
            }
        }
        const ui = this.gunNode.getComponent(UITransform);
        ui?.setAnchorPoint(0, 0.5);
        const { bw, bh, bob } = this.poseBox();
        if (this.usePrefab) {
            this.gunNode.setScale(1, 1, 1);
            this.gunNode.setPosition(this.w * 0.12, this.h * 0.48, 0);
        } else {
            this.gunNode.setScale(this.facing, 1, 1);
            this.gunNode.setPosition(this.facing * bw * 0.1, bob + bh * 0.4, 0);
        }
        const length = ui?.width ?? frame.rect.width;
        this.muzzle.setPosition(length, 0, 0);
        this.muzzle.active = this.flash > 0;
    }
}
