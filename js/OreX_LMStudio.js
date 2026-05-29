import { app } from "../../../scripts/app.js";

// Массив описаний параметров для узла LMStudio (OreX)
const LMSTUDIO_HELP_DESCRIPTIONS = [
    { name: "text_input", label: "Text Input / Входной текст", desc: "Main prompt or question for the language model", ru_desc: "Основной промпт или вопрос для языковой модели" },
    { name: "system_prompt", label: "System Prompt / Системный промпт", desc: "Instructions defining the model's behavior and role", ru_desc: "Инструкции, задающие поведение и роль модели" },
    { name: "system_preset", label: "System Preset / Пресет системы", desc: "Pre-configured system prompt presets from JSON file", ru_desc: "Предустановленные готовые системные промпты из JSON-файла" },
    { name: "model_key", label: "Model Key / Выбор модели", desc: "Select the specific LM Studio model loaded in the server", ru_desc: "Выбор конкретной запущенной модели в интерфейсе LM Studio" },
    { name: "include_reasoning", label: "Include Reasoning / Мышление модели", desc: "Enable or disable deep thinking process (hides/shows <think> tags for R1 models)", ru_desc: "Включение или отключение вывода цепочки рассуждений (скрывает/показывает теги <think>)" },
    { name: "seed", label: "Seed / Сид", desc: "Randomness control for generations", ru_desc: "Контроль случайности для воспроизводимости ответа" },
    { name: "control_after_generate", label: "Control After Generate / Действие сида", desc: "Change seed behavior (randomize, increment, fix)", ru_desc: "Поведение сида после генерации (рандом, инкремент, фиксировать)" },
    { name: "context_length", label: "Context Length / Длина контекста", desc: "Maximum context window size in tokens", ru_desc: "Максимальный размер окна контекста в токенах" },
    { name: "max_tokens", label: "Max Tokens / Максимум токенов", desc: "Limit the maximum number of generated tokens", ru_desc: "Ограничение на максимальное количество генерируемых токенов" },
    { name: "generation_parameters", label: "Gen Parameters / Доп. параметры", desc: "Enable or disable custom sampling configurations below", ru_desc: "Включить или выключить индивидуальные настройки семплирования ниже" },
    { name: "temperature", label: "Temperature / Температура", desc: "Creativity slider. Higher values mean more random and creative output", ru_desc: "Ползунок креативности. Выше значение — более случайный и творческий ответ" },
    { name: "top_k", label: "Top K", desc: "Limits pool of top tokens to choose from", ru_desc: "Ограничение выборки только из K самых вероятных токенов" },
    { name: "top_p", label: "Top P", desc: "Nucleus sampling threshold based on cumulative probability", ru_desc: "Порог выборки по кумулятивной вероятности токенов (ядерное семплирование)" },
    { name: "repeat_penalty", label: "Repeat Penalty / Штраф за повторы", desc: "Prevents the model from repeating the same phrases or looping", ru_desc: "Предотвращает зацикливание и повторение одинаковых фраз" }
];

app.registerExtension({
    name: "OreXLMStudio.Antigravity.Unique",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        // Проверяем соответствие имени системного маппинга для узла LM Studio
        if (nodeData.name !== "orex LMStudio") return;

        const proto = nodeType.prototype;
        const onNodeCreated = proto.onNodeCreated;

        proto.onNodeCreated = function () {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);
            this.isHoveringHelp = false;
            this.showHelpSidebar = false;

            this._globalClickListener = (event) => {
                if (!this.showHelpSidebar || !app.graph._nodes.includes(this)) return;
                const graphPos = app.canvas.convertEventToCanvasOffset(event);
                if (!graphPos) { this.showHelpSidebar = false; this.setDirtyCanvas(true); return; }
                const mx = graphPos[0] - this.pos[0]; const my = graphPos[1] - this.pos[1];
                const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
                if (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]) return;
                this.showHelpSidebar = false; this.setDirtyCanvas(true);
            };
            document.addEventListener("pointerdown", this._globalClickListener, true);
        };

        const onDestroy = proto.onDestroy;
        proto.onDestroy = function () {
            if (this._globalClickListener) document.removeEventListener("pointerdown", this._globalClickListener, true);
            if (onDestroy) onDestroy.apply(this, arguments);
        };

        proto.onMouseDown = function (e, pos) {
            const [mx, my] = pos;
            const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
            if (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]) {
                this.showHelpSidebar = !this.showHelpSidebar; this.setDirtyCanvas(true); return true;
            }
            return false;
        };

        proto.onMouseMove = function (e, pos) {
            const [mx, my] = pos;
            const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
            const wasHoveringHelp = this.isHoveringHelp;
            this.isHoveringHelp = (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]);
            if (wasHoveringHelp !== this.isHoveringHelp) this.setDirtyCanvas(true); if (this.isHoveringHelp) return true;
            return false;
        };

        proto.onDrawForeground = function (ctx) {
            if (this.flags?.collapsed) return;
            const iconX = this.size[0] - 22, iconY = -LiteGraph.NODE_TITLE_HEIGHT + 5, iconR = 8;
            ctx.save(); ctx.fillStyle = this.isHoveringHelp ? "#ff0" : "#fff"; ctx.font = "bold 15px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("?", iconX + iconR, iconY + iconR); if (this.showHelpSidebar) this._drawHelpSidebar(ctx); ctx.restore();
        };

        proto._drawHelpSidebar = function (ctx) {
            const margin = 15, bx = this.size[0] + 15, widgetH = 24; const labelFont = "bold 13px Arial", descFont = "normal 11px Arial";
            ctx.save(); ctx.textBaseline = "middle"; let maxLabelW = 0, maxDescW = 0; ctx.font = labelFont;
            LMSTUDIO_HELP_DESCRIPTIONS.forEach((item) => { maxLabelW = Math.max(maxLabelW, ctx.measureText(item.label).width); ctx.font = descFont; maxDescW = Math.max(maxDescW, ctx.measureText(`- ${item.desc} / ${item.ru_desc}`).width); ctx.font = labelFont; });
            let firstWidget = this.widgets?.find(w => w.last_y !== undefined); let lastWidget = this.widgets ? [...this.widgets].reverse().find(w => w.last_y !== undefined) : null;
            let minWidgetY = firstWidget ? firstWidget.last_y : 30; let lastWidgetY = lastWidget ? lastWidget.last_y : this.size[1] - 30;
            const labelX = bx + margin + 10, descX = labelX + maxLabelW + 15; const boxW = (descX - bx) + maxDescW + margin; const by = minWidgetY - 45, boxH = (lastWidgetY + widgetH + 10) - by;
            ctx.fillStyle = "rgba(0,0,0,0.95)"; ctx.strokeStyle = "#00ff44"; ctx.lineWidth = 1.6;
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 12); ctx.fill(); ctx.stroke(); } else { ctx.fillRect(bx, by, boxW, boxH); ctx.strokeRect(bx, by, boxW, boxH); }
            
            ctx.font = "bold 16px Arial"; ctx.textAlign = "left"; ctx.fillStyle = "#fff"; 
            ctx.fillText("Explanations / Описание", bx + margin, by + 22);
            let fallbackY = by + 60;
            LMSTUDIO_HELP_DESCRIPTIONS.forEach((item) => {
                const w = this.widgets?.find(wd => wd.name === item.name || wd.label === item.name); const y = (w && w.last_y !== undefined) ? w.last_y + (widgetH / 2) : fallbackY; if (!w || w.last_y === undefined) fallbackY += 28;
                ctx.font = labelFont; ctx.fillStyle = "#fff"; ctx.fillText(item.label, labelX, y); ctx.font = descFont; ctx.fillStyle = "#aaa"; ctx.fillText(`- ${item.desc} / ${item.ru_desc}`, descX, y);
            });
            ctx.restore();
        };
    }
});