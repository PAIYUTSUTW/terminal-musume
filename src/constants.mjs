export const STATES = Object.freeze(['idle', 'thinking', 'working', 'happy', 'concerned', 'waiting', 'explaining']);
export const LABELS = Object.freeze({ idle: '待命', thinking: '思考', working: '工作中', happy: '開心', concerned: '擔心', waiting: '等你回覆', explaining: '解說' });
export const PROVIDERS = Object.freeze(['codex', 'claude']);
export const APPEARANCE_KEYS = Object.freeze(['backgroundImage', 'backgroundImageAlignment', 'backgroundImageStretchMode', 'backgroundImageOpacity']);
export const ROOT = new URL('../', import.meta.url);
