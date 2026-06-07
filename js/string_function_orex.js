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
                    let inserted = false;
                    
                    if (textWidget.inputEl) {
                        const el = textWidget.inputEl;
                        const start = el.selectionStart;
                        const end = el.selectionEnd;
                        
                        if (start !== undefined && end !== undefined) {
                            const val = el.value;
                            el.value = val.substring(0, start) + textToInsert + val.substring(end);
                            el.selectionStart = el.selectionEnd = start + textToInsert.length;
                            
                            textWidget.value = el.value;
                            if (textWidget.callback) textWidget.callback(textWidget.value);
                            inserted = true;
                        }
                    }
                    
                    if (!inserted) {
                        textWidget.value = (textWidget.value || "") + textToInsert;
                        if (textWidget.callback) textWidget.callback(textWidget.value);
                    }
                    app.graph.setDirtyCanvas(true, false);
                };

                const btnWidget = this.addWidget("custom", "insert_buttons", null, () => {});
                btnWidget.serialize = false; 
                btnWidget.computeSize = function(width) {
                    return [width, 30];
                };
                
                // Отрисовка четырех кнопок в один ряд
                btnWidget.draw = function(ctx, node, widget_width, y, widget_height) {
                    const margin = 5;
                    const spacing = 5;
                    const btnWidth = (widget_width - margin * 2 - spacing * 3) / 4;
                    const labels = ["{A}", "{B}", "{C}", "{D}"];
                    
                    ctx.save();
                    ctx.font = "14px Arial";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    
                    for(let i = 0; i < 4; i++) {
                        const x = margin + i * (btnWidth + spacing);
                        ctx.fillStyle = "#333";
                        ctx.fillRect(x, y + 2, btnWidth, widget_height - 4);
                        ctx.strokeStyle = "#555";
                        ctx.strokeRect(x, y + 2, btnWidth, widget_height - 4);
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
                        const btnWidth = (widget_width - margin * 2 - spacing * 3) / 4;
                        const x = pos[0];
                        
                        if (x >= margin && x <= widget_width - margin) {
                            for(let i=0; i<4; i++) {
                                const btnX1 = margin + i * (btnWidth + spacing);
                                const btnX2 = btnX1 + btnWidth;
                                if (x >= btnX1 && x <= btnX2) {
                                    const labels = ["{A}", "{B}", "{C}", "{D}"];
                                    insertText(labels[i]);
                                    return true;
                                }
                            }
                        }
                    }
                    return false;
                };

                // Глобальный слушатель кликов для закрытия подсказки при клике мимо неё
                this._globalClickListener = (event) => {
                    if (!this.showHelpSidebar || !app.graph._nodes.includes(this)) return;

                    const graphPos = app.canvas.convertEventToCanvasOffset(event);
                    if (!graphPos) {
                        this.showHelpSidebar = false;
                        app.graph.setDirtyCanvas(true, false);
                        return;
                    }

                    const mx = graphPos[0] - this.pos[0];
                    const my = graphPos[1] - this.pos[1];
                    const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
                    
                    // Если клик был по самой кнопке вопроса, игнорируем (обработается в onMouseDown)
                    if (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]) return;

                    this.showHelpSidebar = false;
                    app.graph.setDirtyCanvas(true, false);
                };

                document.addEventListener("pointerdown", this._globalClickListener, true);

                return r;
            };

            // Очистка при удалении узла
            const onDestroy = nodeType.prototype.onDestroy;
            nodeType.prototype.onDestroy = function () {
                if (this._globalClickListener) {
                    document.removeEventListener("pointerdown", this._globalClickListener, true);
                }
                if (onDestroy) onDestroy.apply(this, arguments);
            };

            // Обработка клика по кнопке с вопросом
            const onMouseDown = nodeType.prototype.onMouseDown;
            nodeType.prototype.onMouseDown = function(e, local_pos, canvas) {
                let r = false;
                if (onMouseDown) r = onMouseDown.apply(this, arguments);
                
                const [mx, my] = local_pos;
                const iconArea = [this.size[0] - 25, -LiteGraph.NODE_TITLE_HEIGHT, 25, LiteGraph.NODE_TITLE_HEIGHT];
                
                // Проверяем клик в зоне кнопки вопроса
                if (mx >= iconArea[0] && mx <= iconArea[0] + iconArea[2] && my >= iconArea[1] && my <= iconArea[1] + iconArea[3]) {
                    this.showHelpSidebar = !this.showHelpSidebar;
                    app.graph.setDirtyCanvas(true, false);
                    return true; 
                }
                
                return r;
            };

            // Обработка наведения (hover) на кнопку с вопросом
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

            // Отрисовка интерфейса поверх узла
            const onDrawForeground = nodeType.prototype.onDrawForeground;
            nodeType.prototype.onDrawForeground = function (ctx) {
                if (onDrawForeground) onDrawForeground.apply(this, arguments);
                
                // Скрываем знак вопроса, если узел свернут (решает проблему улетания вправо)
                if (this.flags && this.flags.collapsed) return;
                
                // Координаты иконки вопроса на основе высоты заголовка (LiteGraph.NODE_TITLE_HEIGHT)
                const iconX = this.size[0] - 22;
                const iconY = -LiteGraph.NODE_TITLE_HEIGHT + 5;
                const iconR = 8;
                
                ctx.save();
                ctx.fillStyle = this.isHoveringHelp ? "#fff" : "#ff0";
                ctx.font = "bold 15px Arial"; 
                ctx.textAlign = "center"; 
                ctx.textBaseline = "middle";
                ctx.fillText("?", iconX + iconR, iconY + iconR);
                
                // Отрисовка панели подсказки, если она активна
                if (this.showHelpSidebar) {
                    this._drawHelpSidebar(ctx);
                }
                ctx.restore();
            };

            // Метод для отрисовки боковой панели подсказки в стиле crop_orex
            nodeType.prototype._drawHelpSidebar = function (ctx) {
                const margin = 15;
                const bx = this.size[0] + 15; // Смещение вправо от узла
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

                // Вычисляем максимальную ширину для колонок
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
                
                // Привязываем высоту окна подсказки к высоте заголовка узла
                const by = -LiteGraph.NODE_TITLE_HEIGHT; 
                const rowHeight = 30;
                const boxH = 50 + (helpDescriptions.length * rowHeight);

                // Отрисовка фона (темно-серый/черный с неоново-зеленой рамкой)
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

                // Отрисовка заголовка
                ctx.font = "bold 16px Arial"; 
                ctx.textAlign = "left"; 
                ctx.fillStyle = "#00ff44";
                ctx.fillText("Explanations / Описание", bx + margin, by + 22);

                // Отрисовка строк с подсказками
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