/**
 * 人物技能。每人开局选一个。
 */

export type SkillId = 'none' | 'triple' | 'infinite' | 'magazine' | 'gift' | 'heal' | 'range' | 'rpm';

export const SKILL_OPTIONS: { id: SkillId; name: string }[] = [
    { id: 'none', name: '无' },
    { id: 'triple', name: '三连跳' },
    { id: 'infinite', name: '无限弹匣' },
    { id: 'magazine', name: '更长弹匣' },
    { id: 'gift', name: '复活礼包' },
    { id: 'heal', name: '击杀回复' },
    { id: 'range', name: '无限射程' },
    { id: 'rpm', name: '更高射速' },
];

