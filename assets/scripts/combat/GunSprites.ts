import { resources, SpriteFrame } from 'cc';

const frames = new Map<string, SpriteFrame>();
let started = false;

/** 按武器 id 读取 assets/resources/weapons 里的贴图。图朝右，左手边是握把。 */
export function preloadGunSprites() {
    if (started) {
        return;
    }
    started = true;
    for (const id of ['pistol', 'rifle', 'rifleb', 'smg', 'shotgun', 'bow', 'ak47', 'awm', 'javelin', 'knife', 'desert_gold', 'desert_double', 'revolver', 'broadsword', 'g18', 'random', 'm37', 'm37_slug', 'm249', 'gatling']) {
        loadOne(`weapons/${id}`, id);
    }
    for (const id of ['none', 'triple', 'infinite', 'magazine', 'gift', 'heal', 'range', 'rpm']) {
        loadOne(`skills/${id}`, `skill:${id}`);
    }
}

export function gunSpriteFrame(id: string) {
    return frames.get(id) ?? null;
}

export function skillSpriteFrame(id: string) {
    return frames.get(`skill:${id}`) ?? null;
}

function loadOne(path: string, key: string) {
    resources.load(`${path}/spriteFrame`, SpriteFrame, (err, frame) => {
        if (!err && frame) {
            frames.set(key, frame);
            return;
        }
        resources.load(path, SpriteFrame, (err2, frame2) => {
            if (!err2 && frame2) {
                frames.set(key, frame2);
                return;
            }
            console.warn(`[guns] 没加载到 ${path}，先用色块。回到编辑器让资源刷新后再预览。`, err2 || err);
        });
    });
}
