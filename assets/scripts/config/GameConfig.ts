/**
 * 把分类配置收成原来的 GameConfig，供对局代码读取。
 * 改数值时直接改对应文件，不要在这里写新数值。
 */
import { FighterConfig } from './FighterConfig';
import { SceneConfig } from './SceneConfig';
import { bulletUnit, spread } from './WeaponConfig';

export const GameConfig = {
    designWidth: SceneConfig.designWidth,
    designHeight: SceneConfig.designHeight,
    charWidth: FighterConfig.charWidth,
    charHeight: FighterConfig.charHeight,
    bulletUnit,
    hp: FighterConfig.hp,
    lives: FighterConfig.lives,
    respawnInvuln: FighterConfig.respawnInvuln,
    crateInterval: SceneConfig.crateInterval,
    motion: FighterConfig.motion,
    spread,
    bulletBounds: SceneConfig.bulletBounds,
};

export { FighterConfig, px } from './FighterConfig';
export { SceneConfig } from './SceneConfig';
export * from './SkillConfig';
export * from './WeaponConfig';
