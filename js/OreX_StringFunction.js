import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "orex.StringFunction",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "orex String Function") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                // Состояния для нового меню подсказки
                this.showHelpSidebar = false;
                this.isHoveringHelp = false;
                
                const textWidget = this.widgets.find(w => w.name === "string_function");
                
                const insertText = (textToInsert) => {
                    if (!textWidget) return;
                    
                    // Безопасная вставка с вызовом событий (чтобы ComfyUI обновил историю и состояние)
                    if (textWidget.inputEl) {
                        const el = textWidget.inputEl;
                        const start = el.selectionStart;
                        const end = el.selectionEnd;
                        
                        if (start !== undefined && end !== undefined) {
                            const val = el.value;
                            el.value = val.substring(0, start) + textToInsert + val.substring(end);
                            
                            // Возвращаем фокус и курсор на нужное место
                            el.focus();
                            el.selectionStart = el.selectionEnd = start + textToInsert.length;
                            
                            textWidget.value = el.value;
                            
                            // Диспатчим событие, чтобы сработали внутренние хуки ComfyUI
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            if (textWidget.callback) textWidget.callback(textWidget.value);
                            
                            app.graph.setDirtyCanvas(true, false);
                            return;
                        }
                    }
                    
                    // Фолбэк, если элемента ввода нет (например, узел свернут)
                    textWidget.value = (textWidget.value || "") + textToInsert;
                    if (textWidget.callback) textWidget.callback(textWidget.value);
                    app.graph.setDirtyCanvas(true, false);
                };

                const btnWidget = this.addWidget("custom", "insert_buttons", null, () => {});
                btnWidget.serialize = false; 
                btnWidget.computeSize = function(width) {
                    return [width, 30];
                };
                
                // Отрисовка кнопок в один ряд (теперь их 5)
                btnWidget.draw = function(ctx, node, widget_width, y, widget_height) {
                    const margin = 5;
                    const spacing = 5;
                    const labels = ["{A}", "{B}", "{C}", "{D}", "->"];
                    // Высчитываем ширину одной кнопки с учетом 5 кнопок
                    const btnWidth = (widget_width - margin * 2 - spacing * (labels.length - 1)) / labels.length;
                    
                    ctx.save();
                    ctx.font = "14px Arial";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    
                    for(let i = 0; i < labels.length; i++) {
                        const x = margin + i * (btnWidth + spacing);
                        
                        // Меняем цвет для кнопки "->", чтобы она немного выделялась
                        ctx.fillStyle = labels[i] === "->" ? "#2a4d69" : "#333";
                        
                        if (ctx.roundRect) {
                            ctx.beginPath();
                            ctx.roundRect(x, y + 2, btnWidth, widget_height - 4, 4);
                            ctx.fill();
                            ctx.strokeStyle = "#555";
                            ctx.stroke();
                        } else {
                            ctx.fillRect(x, y + 2, btnWidth, widget_height - 4);
                            ctx.strokeStyle = "#555";
                            ctx.strokeRect(x, y + 2, btnWidth, widget_height - 4);
                        }
                        
                        ctx.fillStyle = "#fff";
                        ctx.fillText(labels[i], x + btnWidth/2, y + widget_height/2);
                    }
                    ctx.restore();
                };
                
                // Обработка кликов по кастомным кнопкам
                btnWidget.mouse = function(event, pos, node) {
                    if (event.type === "pointerdown" || event.type === "mousedown") {
                        const margin = 5;
                        const spacing = 5;
                        const widget_width = node.size[0];
                        const labels = ["{A}", "{B}", "{C}", "{D}", "->"];
                        const btnWidth = (widget_width - margin * 2 - spacing * (labels.length - 1)) / labels.length;
                        const x = pos[0];
                        
                        // Удалена ошибочная проверка высоты клика (y), которая блокировала нажатие
                        
                        if (x >= margin && x <= widget_width - margin) {
                            for(let i = 0; i < labels.length; i++) {
                                const btnX1 = margin + i * (btnWidth + spacing);
                                const btnX2 = btnX1 + btnWidth;
                                if (x >= btnX1 && x <= btnX2) {
                                    insertText(labels[i]);
                                    return true;
                                }
                            }
                        }
                    }
                    return false;
                };

                // Глобальный слушатель кликов вынесен отдельно, чтобы избежать утечек памяти
                this._globalClickListener = (event) => {
                    if (!this.showHelpSidebar) return;
                    
                    if (!app.graph._nodes.includes(this)) {
                        this.cleanupListener();
                        return;
                    }

                    const graphPos = app.canvas.convertEventToCanvasOffset(event);
                    if (!graphPos) {
                        this.showHelpSidebar = false;
                        app.graph.setDirtyCanvas(true, false);
                        return;
                    }

                    const mx = graphPos[0] - this.pos[0];
                    const my = graphPos[1] - this.pos[1];
                    const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
                    
                    if (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]) return;

                    this.showHelpSidebar = false;
                    app.graph.setDirtyCanvas(true, false);
                };

                this.setupListener = () => {
                    document.addEventListener("pointerdown", this._globalClickListener, true);
                };

                this.cleanupListener = () => {
                    document.removeEventListener("pointerdown", this._globalClickListener, true);
                };

                this.setupListener();
                return r;
            };

            const onDestroy = nodeType.prototype.onDestroy;
            nodeType.prototype.onDestroy = function () {
                if (this.cleanupListener) this.cleanupListener();
                if (onDestroy) onDestroy.apply(this, arguments);
            };

            const onMouseDown = nodeType.prototype.onMouseDown;
            nodeType.prototype.onMouseDown = function(e, local_pos, canvas) {
                let r = false;
                if (onMouseDown) r = onMouseDown.apply(this, arguments);
                
                const [mx, my] = local_pos;
                const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
                
                if (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]) {
                    this.showHelpSidebar = !this.showHelpSidebar;
                    app.graph.setDirtyCanvas(true, false);
                    return true; 
                }
                
                return r;
            };

            const onMouseMove = nodeType.prototype.onMouseMove;
            nodeType.prototype.onMouseMove = function(e, local_pos, canvas) {
                let r = false;
                if (onMouseMove) r = onMouseMove.apply(this, arguments);

                const [mx, my] = local_pos;
                const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
                const wasHoveringHelp = this.isHoveringHelp;
                
                this.isHoveringHelp = (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]);
                
                if (wasHoveringHelp !== this.isHoveringHelp) {
                    app.graph.setDirtyCanvas(true, false);
                }
                
                if (this.isHoveringHelp) return true;

                return r;
            };

            const onDrawForeground = nodeType.prototype.onDrawForeground;
            nodeType.prototype.onDrawForeground = function (ctx) {
                if (onDrawForeground) onDrawForeground.apply(this, arguments);
                
                if (this.flags && this.flags.collapsed) return;
                
                const iconX = this.size[0] - 22;
                const iconY = -LiteGraph.NODE_TITLE_HEIGHT + 5;
                const iconR = 8;
                
                ctx.save();
                ctx.fillStyle = this.isHoveringHelp ? "#fff" : "#ff0";
                ctx.font = "bold 15px Arial"; 
                ctx.textAlign = "center"; 
                ctx.textBaseline = "middle";
                ctx.fillText("?", iconX + iconR, iconY + iconR);
                
                if (this.showHelpSidebar) {
                    this._drawHelpSidebar(ctx);
                }
                ctx.restore();
            };

            nodeType.prototype._drawHelpSidebar = function (ctx) {
                const margin = 15;
                const bx = this.size[0] + 15; 
                const labelFont = "bold 13px Arial"; 
                const descFont = "normal 11px Arial";

                const helpDescriptions = [
                    { icon: "📝", label: "Variables / Переменные", desc: "{A}, {B}, {C}, {D}" },
                    { icon: "🔄", label: "Replace / Замена", desc: "{A}(old->new)" },
                    { icon: "💡", label: "Example 1 / Пример 1", desc: "{A}(cat->dog) -> replaces 'cat' with 'dog'" },
                    { icon: "💡", label: "Example 2 / Пример 2", desc: "{A}(cat->{B}) -> replaces 'cat' with var {B}" }
                ];

                ctx.save();
                ctx.textBaseline = "middle";

                let maxLabelW = 0, maxDescW = 0;
                ctx.font = labelFont;
                
                helpDescriptions.forEach((item) => {
                    maxLabelW = Math.max(maxLabelW, ctx.measureText(item.label).width);
                    ctx.font = descFont;
                    maxDescW = Math.max(maxDescW, ctx.measureText(`- ${item.desc}`).width);
                    ctx.font = labelFont;
                });

                const labelX = bx + margin + 28;
                const descX = labelX + maxLabelW + 15;
                const boxW = (descX - bx) + maxDescW + margin;
                
                const by = -LiteGraph.NODE_TITLE_HEIGHT; 
                const rowHeight = 30;
                const boxH = 50 + (helpDescriptions.length * rowHeight);

                ctx.fillStyle = "rgba(0,0,0,0.95)"; 
                ctx.strokeStyle = "#00ff44"; 
                ctx.lineWidth = 1.6;
                if (ctx.roundRect) { 
                    ctx.beginPath(); 
                    ctx.roundRect(bx, by, boxW, boxH, 12); 
                    ctx.fill(); 
                    ctx.stroke(); 
                } else { 
                    ctx.fillRect(bx, by, boxW, boxH); 
                    ctx.strokeRect(bx, by, boxW, boxH); 
                }

                ctx.font = "bold 16px Arial"; 
                ctx.textAlign = "left"; 
                ctx.fillStyle = "#00ff44";
                ctx.fillText("Explanations / Описание", bx + margin, by + 22);

                helpDescriptions.forEach((item, index) => {
                    const y = by + 60 + (index * rowHeight);
                    
                    ctx.font = "14px Arial"; 
                    ctx.fillStyle = "#fff"; 
                    ctx.fillText(item.icon, bx + margin, y);
                    
                    ctx.font = labelFont; 
                    ctx.fillText(item.label, labelX, y);
                    
                    ctx.font = descFont; 
                    ctx.fillStyle = "#aaa"; 
                    ctx.fillText(`- ${item.desc}`, descX, y);
                });
                
                ctx.restore();
            };
        }
    }
});