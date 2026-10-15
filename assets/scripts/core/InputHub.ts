import { EventKeyboard, game, Game, input, Input, KeyCode } from 'cc';

const down = new Set<KeyCode>();
const pressed = new Set<KeyCode>();
const released = new Set<KeyCode>();
let refs = 0;

function onDown(e: EventKeyboard) {
    if (!down.has(e.keyCode)) {
        pressed.add(e.keyCode);
    }
    down.add(e.keyCode);
}

function onUp(e: EventKeyboard) {
    if (down.has(e.keyCode)) {
        released.add(e.keyCode);
    }
    down.delete(e.keyCode);
}

function onHide() {
    down.clear();
    pressed.clear();
    released.clear();
}

/** 玩家 1：A D W S J K。玩家 2：方向键与小键盘 1、2。 */
export const PlayerKeys = [
    {
        left: KeyCode.KEY_A,
        right: KeyCode.KEY_D,
        jump: KeyCode.KEY_W,
        down: KeyCode.KEY_S,
        fire: KeyCode.KEY_J,
        special: KeyCode.KEY_K,
    },
    {
        left: KeyCode.ARROW_LEFT,
        right: KeyCode.ARROW_RIGHT,
        jump: KeyCode.ARROW_UP,
        down: KeyCode.ARROW_DOWN,
        fire: KeyCode.NUM_1,
        special: KeyCode.NUM_2,
    },
] as const;

export interface FighterInput {
    axis: number;
    /** 非 0 时朝这个方向，移动方向可以不同。0 表示跟着移动方向转。 */
    look: number;
    jump: boolean;
    drop: boolean;
    fireHeld: boolean;
    fireEdge: boolean;
    fireReleased: boolean;
    specialHeld: boolean;
    specialEdge: boolean;
    specialReleased: boolean;
}

export const InputHub = {
    acquire() {
        refs += 1;
        if (refs !== 1) {
            return;
        }
        input.on(Input.EventType.KEY_DOWN, onDown);
        input.on(Input.EventType.KEY_UP, onUp);
        game.on(Game.EVENT_HIDE, onHide);
    },

    release() {
        refs = Math.max(0, refs - 1);
        if (refs !== 0) {
            return;
        }
        input.off(Input.EventType.KEY_DOWN, onDown);
        input.off(Input.EventType.KEY_UP, onUp);
        game.off(Game.EVENT_HIDE, onHide);
        down.clear();
        pressed.clear();
        released.clear();
    },

    endFrame() {
        pressed.clear();
        released.clear();
    },

    held(key: KeyCode) {
        return down.has(key);
    },

    pressed(key: KeyCode) {
        return pressed.has(key);
    },

    justReleased(key: KeyCode) {
        return released.has(key);
    },
};

export function readFighterInput(playerIndex: number): FighterInput {
    const keys = PlayerKeys[playerIndex];
    const left = InputHub.held(keys.left);
    const right = InputHub.held(keys.right);
    let axis = 0;
    if (left && !right) {
        axis = -1;
    } else if (right && !left) {
        axis = 1;
    }
    return {
        axis,
        look: 0,
        jump: InputHub.pressed(keys.jump),
        drop: InputHub.pressed(keys.down),
        fireHeld: InputHub.held(keys.fire),
        fireEdge: InputHub.pressed(keys.fire),
        fireReleased: InputHub.justReleased(keys.fire),
        specialHeld: InputHub.held(keys.special),
        specialEdge: InputHub.pressed(keys.special),
        specialReleased: InputHub.justReleased(keys.special),
    };
}
