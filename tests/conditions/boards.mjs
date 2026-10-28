// Pixel coordinates in the game's 800 x 800 field. No random spawning.
export const defaults = {
    alpha: 0.7, AIStabilityThreshold: 1.2, animationSpeedFactor: 0.5,
    playerSpeed: 3, aiBonusPerTriangle: 3, humanBonusPerSquare: 3
};

const target = (ID, shape, value, x, y, extra = {}) => ({
    ID, shape, value, urgency: value, x, y, size: 15,
    vx: 0, vy: 0, speed: 0, dx: 0, dy: 0,
    active: true, intercepted: false, AIintercepted: false, ...extra
});
const actor = (x, y) => ({ x, y, width: 30, height: 30 });
const base = { human: actor(160, 400), ai: actor(440, 400) };

export const boards = [
    {
        ...base, id: 'objective-tradeoff', name: 'Objective tradeoff',
        description: 'Nearby level-1 triangle versus a farther level-3 square, both in the AI half.',
        objects: [target(1, 'triangle', 1, 510, 370), target(2, 'square', 3, 540, 450)]
    },
    {
        ...base, id: 'square-on-route', name: 'Square on route',
        description: 'A square blocks the straight route to a triangle. Route hits are predictions, not game catch events.',
        objects: [target(1, 'square', 1, 510, 400), target(2, 'triangle', 3, 620, 400)]
    },
    {
        ...base, id: 'human-commitment', name: 'Human commitment', humanTarget: 1,
        description: 'Human selects a triangle in the AI half; a second triangle is available.',
        objects: [target(1, 'triangle', 3, 520, 350), target(2, 'triangle', 1, 520, 520)]
    },
    {
        ...base, id: 'human-region', name: 'Region avoidance',
        description: 'A level-3 triangle is in the human half; a level-1 triangle is in the AI half.',
        objects: [target(1, 'triangle', 3, 330, 400), target(2, 'triangle', 1, 620, 450)]
    },
    {
        ...base, id: 'only-squares', name: 'No eligible targets',
        description: 'Only squares remain. Every no-harm configuration must hold (ID -2).',
        objects: [target(1, 'square', 2, 530, 330), target(2, 'square', 3, 550, 480)]
    },
    {
        ...base, id: 'human-switch', name: 'Human changes choice', humanTarget: 1, switchTo: 2,
        description: 'At a second paused decision, human switches from triangle 1 to 2. Geometry stays fixed; planner history is retained.',
        objects: [target(1, 'triangle', 3, 520, 330), target(2, 'triangle', 2, 520, 510)]
    },
    {
        ...base, id: 'unavailable-targets', name: 'Caught and inactive targets',
        description: 'Three tempting targets are unavailable; only triangle 4 may be selected.',
        objects: [target(1, 'triangle', 3, 470, 390, { intercepted: true }),
            target(2, 'triangle', 3, 470, 430, { AIintercepted: true }),
            target(3, 'triangle', 3, 490, 410, { active: false }),
            target(4, 'triangle', 1, 600, 500)]
    },
    {
        ...base, id: 'sole-human-target', name: 'Sole human target', humanTarget: 1,
        description: 'Only the human-selected triangle remains. No-harm alone permits it; coordinating excludes it.',
        objects: [target(1, 'triangle', 2, 540, 350)]
    },
    {
        ...base, id: 'moving-target', name: 'Moving target',
        description: 'A moving triangle checks velocity scaling and the predicted interception point.',
        objects: [target(1, 'triangle', 2, 560, 430, { vx: -1, speed: 1, dx: -1 })]
    },
    {
        ...base, id: 'unreachable-target', name: 'Unreachable target',
        description: 'Triangle exits faster than the AI can catch it; planner must hold.',
        objects: [target(1, 'triangle', 2, 770, 400, { vx: 1, speed: 4, dx: 4 })]
    }
];

export const conditions = [];
for (const aiConstraint of ['may-harm', 'no-harm']) {
    for (const aiObjective of ['self-bonus', 'self-urgency-bonus', 'team']) {
        for (const aiAwareness of ['oblivious', 'coordinating']) {
            conditions.push({ aiConstraint, aiObjective, aiAwareness });
        }
    }
}
