import { resources, SpriteFrame } from 'cc';

const frames = new Map<string, SpriteFrame>();
let started = false;

/** 按武器 id 读取 assets/resources/weapons 里的贴图。图朝右，左手边是握把。 */
export function preloadGunSprites() {
    if (started) {
        return;
    }
    started = true;
    for (const id of ['pistol', 'rifle', 'rifleb', 'smg', 'shotgun', 'bow']) {
        loadOne(id);
    }
}

export function gunSpriteFrame(id: string) {
    return frames.get(id) ?? null;
}

function loadOne(id: string) {
    resources.load(`weapons/${id}/spriteFrame`, SpriteFrame, (err, frame) => {
        if (!err && frame) {
            frames.set(id, frame);
            return;
        }
        resources.load(`weapons/${id}`, SpriteFrame, (err2, frame2) => {
            if (!err2 && frame2) {
                frames.set(id, frame2);
                return;
            }
            console.warn(`[guns] 没加载到 weapons/${id}，先用色块枪。回到编辑器让资源刷新后再预览。`, err2 || err);
        });
    });
}
