import uiTemplate from './ui.html';

// Minimal typings for the blueprint we expect from Gemini
interface BlueprintNode {
        type: 'text' | 'panel' | 'card' | 'list' | 'callout';
        title?: string;
        content?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        fontSize?: number;
        fontWeight?: 'regular' | 'medium' | 'semi-bold' | 'bold';
        color?: string;
        fill?: string;
        stroke?: string;
        cornerRadius?: number;
        spacing?: number;
        nodes?: BlueprintNode[];
}

interface BlueprintFrame {
        name: string;
        description?: string;
        width?: number;
        height?: number;
        background?: string;
        nodes: BlueprintNode[];
}

interface GeminiBlueprint {
        frames: BlueprintFrame[];
}

type GenerationMode = 'screen' | 'user-flow' | 'personas' | 'architecture' | 'storyboard';
type FrameNode = any;
type RGB = { r: number; g: number; b: number };

type StatusTone = 'info' | 'error';

type StatusState = 'idle' | 'busy';

const DEFAULT_FRAME_WIDTH = 1440;
const DEFAULT_FRAME_HEIGHT = 1024;
const DEFAULT_ACCENT = '#6de1d6';

figma.showUI(uiTemplate, {
        width: 520,
        height: 720,
        themeColors: {
                background: '#0b0d11',
                foreground: '#e9edf5',
                primary: DEFAULT_ACCENT
        }
});

figma.ui.onmessage = async (message: any) => {
        if (!message?.type) return;

        switch (message.type) {
                case 'load-api-key':
                        await loadApiKey();
                        break;
                case 'save-api-key':
                        await saveApiKey(message.apiKey);
                        break;
                case 'generate-design':
                        await generateDesign({
                                prompt: message.prompt,
                                mode: message.mode,
                                frameCount: message.frameCount,
                                apiKeyOverride: message.apiKey
                        });
                        break;
                default:
                        notifyUI('Unknown message from UI', 'error');
        }
};

async function loadApiKey() {
        const key = await figma.clientStorage.getAsync('geminiApiKey');
        figma.ui.postMessage({ type: 'api-key-loaded', apiKey: key ?? '' });
}

async function saveApiKey(apiKey: string) {
        if (!apiKey) {
                notifyUI('API key cleared. Paste a Google AI Studio key to generate.', 'info');
                await figma.clientStorage.setAsync('geminiApiKey', '');
                figma.ui.postMessage({ type: 'api-key-saved' });
                return;
        }
        await figma.clientStorage.setAsync('geminiApiKey', apiKey.trim());
        figma.ui.postMessage({ type: 'api-key-saved' });
}

async function generateDesign(params: { prompt: string; mode: GenerationMode; frameCount: number; apiKeyOverride?: string; }) {
        if (!params.prompt) {
                notifyUI('Введите текстовое описание для генерации.', 'error');
                return;
        }

        notifyUI('Готовим запрос для Gemini 3 Pro...', 'info', 'busy');

        const apiKey = params.apiKeyOverride?.trim() || await figma.clientStorage.getAsync('geminiApiKey');
        if (!apiKey) {
                notifyUI('Укажите Gemini API key перед генерацией.', 'error', 'idle');
                return;
        }

        try {
                const prompt = buildPrompt(params.prompt, params.mode, params.frameCount || 3);
                const blueprint = await callGemini(apiKey, prompt);

                if (!blueprint?.frames?.length) {
                        throw new Error('Gemini вернул пустой ответ. Попробуйте уточнить запрос.');
                }

                notifyUI('Рисуем фреймы в тёмной теме...', 'info', 'busy');
                const createdFrames = await renderBlueprint(blueprint, params.mode);

                figma.currentPage.selection = createdFrames;
                figma.viewport.scrollAndZoomIntoView(createdFrames);

                figma.ui.postMessage({ type: 'generation-complete' });
        } catch (error) {
                const message = error instanceof Error ? error.message : 'Не удалось вызвать Gemini API.';
                figma.ui.postMessage({ type: 'generation-error', error: message });
        }
}

function notifyUI(text: string, tone: StatusTone = 'info', state: StatusState = 'idle') {
        figma.ui.postMessage({ type: 'status', text, tone, state });
}

function buildPrompt(userPrompt: string, mode: GenerationMode, frameCount: number): string {
        const schema = `
Return JSON with key "frames" (array length ${frameCount}) using this shape:
{
  "frames": [
    {
      "name": "Concise frame title",
      "description": "Short goal of this artifact",
      "width": 1440,
      "height": 1024,
      "background": "#0b0d11",
      "nodes": [
        {
          "type": "text" | "panel" | "card" | "list" | "callout",
          "title": "Heading text",
          "content": "Body copy or bullet list. Keep copy short.",
          "x": 48,
          "y": 48,
          "width": 420,
          "height": 120,
          "fontSize": 15,
          "fontWeight": "regular" | "medium" | "semi-bold" | "bold",
          "color": "#e9edf5",
          "fill": "#11141b",
          "cornerRadius": 16,
          "spacing": 12,
          "nodes": [] // optional nested items for structure
        }
      ]
    }
  ]
}`;

        const modeSpec: Record<GenerationMode, string> = {
                'screen': 'Design application screens with hero section, navigation, cards, and CTAs. Keep spacing tight and copy concise.',
                'user-flow': 'Describe the journey as sequential swimlanes. Each card is a step with title, goal, and next action.',
                'personas': 'Provide 2-3 personas per frame with name, role, goals, pain points, tools. Use list nodes.',
                'architecture': 'Map subsystems and data flows. Use cards and callouts to describe responsibilities and integration touchpoints.',
                'storyboard': 'Lay out storyboard beats. Each card has scene title, what user sees, and emotion.'
        };

        return `You are a Figma design planner. Reply with ONLY JSON (no markdown, no prose) following the schema. Use a modern dark UI palette (#0b0d11 background, #11141b surfaces, accent ${DEFAULT_ACCENT}). Keep copy succinct. Avoid emojis.

User intent: ${userPrompt}
Mode: ${mode} (${modeSpec[mode]})
Frames requested: ${frameCount}

${schema}`;
}

async function callGemini(apiKey: string, prompt: string): Promise<GeminiBlueprint> {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-client': 'figma-plugin-gemini-designer'
                },
                body: JSON.stringify({
                        contents: [
                                {
                                        role: 'user',
                                        parts: [{ text: prompt }]
                                }
                        ],
                        generationConfig: {
                                temperature: 0.55,
                                topP: 0.85,
                                maxOutputTokens: 2048
                        }
                })
        });

        if (!response.ok) {
                const text = await response.text();
                throw new Error(`Gemini API error ${response.status}: ${text}`);
        }

        const payload = await response.json();
        const combinedText: string = payload?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';

        const jsonText = extractJson(combinedText);
        if (!jsonText) {
                throw new Error('Не удалось разобрать ответ Gemini. Проверьте ключ и запрос.');
        }

        return JSON.parse(jsonText) as GeminiBlueprint;
}

function extractJson(text: string): string | null {
        if (!text) return null;
        const fenceMatch = text.match(/```json([\s\S]*?)```/);
        if (fenceMatch?.[1]) {
                return fenceMatch[1].trim();
        }
        const braceIndex = text.indexOf('{');
        if (braceIndex >= 0) {
                const lastBrace = text.lastIndexOf('}');
                if (lastBrace > braceIndex) {
                        return text.slice(braceIndex, lastBrace + 1);
                }
        }
        return null;
}

async function renderBlueprint(blueprint: GeminiBlueprint, mode: GenerationMode) {
        const frames: FrameNode[] = [];
        let offsetX = figma.viewport.center.x - 100;

        for (const framePlan of blueprint.frames) {
                const frame = figma.createFrame();
                frame.name = framePlan.name || 'Gemini Frame';
                const width = framePlan.width || DEFAULT_FRAME_WIDTH;
                const height = framePlan.height || DEFAULT_FRAME_HEIGHT;
                frame.resize(width, height);
                frame.x = offsetX;
                frame.y = figma.viewport.center.y - height / 2;
                frame.fills = [{ type: 'SOLID', color: hexToRgb(framePlan.background || '#0b0d11') }];

                if (framePlan.description) {
                        await createTextNode(frame, {
                                type: 'text',
                                title: framePlan.name,
                                content: framePlan.description,
                                x: 40,
                                y: 32,
                                fontSize: 18,
                                fontWeight: 'semi-bold',
                                color: '#e5e7eb'
                        });
                }

                await placeNodes(frame, framePlan.nodes || [], 0);

                frames.push(frame);
                offsetX += width + 120;
        }

        figma.notify(`Готово: ${frames.length} ${mode === 'screen' ? 'экрана' : 'артефактов'} добавлено.`);
        return frames;
}

async function placeNodes(parent: FrameNode, nodes: BlueprintNode[], depth: number) {
        let index = 0;
        for (const node of nodes) {
                const x = node.x ?? 40 + (index % 2) * 340 + depth * 16;
                const y = node.y ?? 120 + Math.floor(index / 2) * 220;
                switch (node.type) {
                        case 'text':
                                await createTextNode(parent, { ...node, x, y });
                                break;
                        case 'panel':
                        case 'card':
                        case 'callout':
                        case 'list':
                                await createBlockNode(parent, { ...node, x, y });
                                break;
                        default:
                                await createBlockNode(parent, { ...node, x, y });
                }
                index += 1;
        }
}

const loadedFonts = new Set<string>();
async function ensureFont(style: 'Regular' | 'Medium' | 'Semi Bold' | 'Bold') {
        const key = `Inter-${style}`;
        if (loadedFonts.has(key)) return;
        await figma.loadFontAsync({ family: 'Inter', style });
        loadedFonts.add(key);
}

async function createTextNode(parent: FrameNode, node: BlueprintNode) {
        await ensureFont(node.fontWeight === 'bold' ? 'Bold' : node.fontWeight === 'semi-bold' ? 'Semi Bold' : 'Medium');
        const text = figma.createText();
        text.x = node.x ?? 32;
        text.y = node.y ?? 32;
        text.resize(node.width ?? 520, node.height ?? 120);
        text.characters = (node.title ? `${node.title}\n` : '') + (node.content ?? '');
        text.fontSize = node.fontSize ?? 16;
        text.fontName = {
                family: 'Inter',
                style: node.fontWeight === 'bold' ? 'Bold' : node.fontWeight === 'semi-bold' ? 'Semi Bold' : 'Medium'
        };
        text.fills = [{ type: 'SOLID', color: hexToRgb(node.color || '#e9edf5') }];
        parent.appendChild(text);
}

async function createBlockNode(parent: FrameNode, node: BlueprintNode) {
        const container = figma.createFrame();
        const width = node.width ?? 520;
        const height = node.height ?? 220;
        container.resize(width, height);
        container.x = node.x ?? 32;
        container.y = node.y ?? 32;
        container.name = node.title || 'Block';
        container.cornerRadius = node.cornerRadius ?? 14;
        container.layoutMode = 'VERTICAL';
        container.paddingTop = 16;
        container.paddingRight = 16;
        container.paddingBottom = 16;
        container.paddingLeft = 16;
        container.itemSpacing = node.spacing ?? 12;
        container.fills = [{ type: 'SOLID', color: hexToRgb(node.fill || '#11141b'), opacity: 1 }];
        container.strokes = node.stroke ? [{ type: 'SOLID', color: hexToRgb(node.stroke) }] : [{ type: 'SOLID', color: hexToRgb('#1f2633') }];

        if (node.title || node.content) {
                await ensureFont('Semi Bold');
                const title = figma.createText();
                title.characters = node.title || '';
                title.fontName = { family: 'Inter', style: 'Semi Bold' };
                title.fontSize = 15;
                title.fills = [{ type: 'SOLID', color: hexToRgb(node.color || '#e9edf5') }];
                container.appendChild(title);

                if (node.content) {
                        await ensureFont('Medium');
                        const body = figma.createText();
                        body.characters = node.content;
                        body.fontName = { family: 'Inter', style: 'Medium' };
                        body.fontSize = 13;
                        body.fills = [{ type: 'SOLID', color: hexToRgb('#b7c0d1') }];
                        container.appendChild(body);
                }
        }

        if (node.nodes?.length) {
                await placeNodes(container, node.nodes, (node.nodes?.length || 0) > 0 ? 1 : 0);
        }

        parent.appendChild(container);
}

function hexToRgb(hex: string): RGB {
        const normalized = hex.replace('#', '').trim();
        const bigint = parseInt(normalized.length === 3 ? normalized.repeat(2) : normalized, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return { r: r / 255, g: g / 255, b: b / 255 };
}
