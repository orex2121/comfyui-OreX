import { app } from "../../../scripts/app.js";

const KONTEXT_HELP_DESCRIPTIONS = [
    { name: "start_instruction", label: "start_instruction / Начало", desc: "Global layout or default system behavior instructions", ru_desc: "Стартовая базовая инструкция, задающая общие правила генерации" },
    { name: "manual_prompt", label: "manual_prompt / Ручной ввод", desc: "User prompt text with optional *image* wildcard support", ru_desc: "Текст вашего запроса; поддерживает замену маски *image* на описание" },
    { name: "image_description_enabled", label: "image_description_enabled", desc: "Toggle substituting *image* wildcard with real description text", ru_desc: "🟢 ON: Включить автоподстановку текста описания вместо тега *image*" },
    { name: "Enable_Preset", label: "Enable_Preset / Базовый пресет", desc: "Toggle inclusion of selected preset from main JSON list", ru_desc: "🟢 ON: Подмешать системный промпт выбранного базового пресета" },
    { name: "preset", label: "preset / Список пресетов", desc: "Select background prompts from OreXKontextPresets.json config", ru_desc: "Выбор готового шаблона из основного конфигурационного файла JSON" },
    { name: "Manual_Preset", label: "Manual_Preset / Ручной пресет", desc: "Toggle inclusion of custom prompt from manual JSON data", ru_desc: "🟢 ON: Подмешать промпт из файла пользовательских пресетов" },
    { name: "manual_preset", label: "manual_preset / Мои пресеты", desc: "Select custom configurations from OreXKontextPresetsManual.json", ru_desc: "Выбор вашего личного шаблона из конфигурации ручных пресетов" },
    { name: "end_instruction", label: "end_instruction / Финал промпта", desc: "Closing instructions or quality modifiers added at the text end", ru_desc: "Заключительные требования или модификаторы качества в самом конце" }
];

app.registerExtension({
    name: "OreXKontextPresets.HelpPanel.Unique",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        // Точное совпадение с ключом из __init__.py
        if (nodeData.name !== "orex Kontext Presets") return;

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
            KONTEXT_HELP_DESCRIPTIONS.forEach((item) => { maxLabelW = Math.max(maxLabelW, ctx.measureText(item.label).width); ctx.font = descFont; maxDescW = Math.max(maxDescW, ctx.measureText(`- ${item.desc} / ${item.ru_desc}`).width); ctx.font = labelFont; });
            let firstWidget = this.widgets?.find(w => w.last_y !== undefined); let lastWidget = this.widgets ? [...this.widgets].reverse().find(w => w.last_y !== undefined) : null;
            let minWidgetY = firstWidget ? firstWidget.last_y : 30; let lastWidgetY = lastWidget ? lastWidget.last_y : this.size[1] - 30;
            const labelX = bx + margin + 10, descX = labelX + maxLabelW + 15; const boxW = (descX - bx) + maxDescW + margin; const by = minWidgetY - 45, boxH = (lastWidgetY + widgetH + 10) - by;
            ctx.fillStyle = "rgba(0,0,0,0.95)"; ctx.strokeStyle = "#00ff44"; ctx.lineWidth = 1.6;
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 12); ctx.fill(); ctx.stroke(); } else { ctx.fillRect(bx, by, boxW, boxH); ctx.strokeRect(bx, by, boxW, boxH); }
            
            ctx.font = "bold 16px Arial"; ctx.textAlign = "left"; ctx.fillStyle = "#fff"; 
            ctx.fillText("Explanations / Описание параметров Kontext Presets", bx + margin, by + 22);
            let fallbackY = by + 55;
            KONTEXT_HELP_DESCRIPTIONS.forEach((item) => {
                const w = this.widgets?.find(wd => wd.name === item.name || wd.label === item.name); const y = (w && w.last_y !== undefined) ? w.last_y + (widgetH / 2) : fallbackY; if (!w || w.last_y === undefined) fallbackY += 32;
                ctx.font = labelFont; ctx.fillStyle = "#fff"; ctx.fillText(item.label, labelX, y); ctx.font = descFont; ctx.fillStyle = "#aaa"; ctx.fillText(`- ${item.desc} / ${item.ru_desc}`, descX, y);
            });
            ctx.restore();
        };
    }
});