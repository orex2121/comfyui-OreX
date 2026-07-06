import { app } from "../../scripts/app.js";

// Вспомогательная функция для отрисовки прямоугольников со скругленными углами
function drawRoundRect(ctx, x, y, width, height, radius, fill, stroke) {
    if (typeof radius === 'undefined') radius = 5;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

app.registerExtension({
    name: "OreX.LoraLoader",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "orex Lora Loader") {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                this.serialize_widgets = true;
                this.widgets = []; // Очищаем стандартные виджеты
                
                // --- 1. Создаем виджет Заголовка ---
                const header = this.addWidget("custom", "header", null, () => {});
                header.computeSize = function(width) { return [width, 20]; };
                header.draw = function(ctx, node, width, Y, height) {
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    ctx.font = "12px Arial";
                    
                    ctx.globalAlpha = 0.6;
                    ctx.fillText("Toggle All", 36, Y + height / 2);
                    
                    ctx.textAlign = "center";
                    ctx.fillText("Trigger Words", width * 0.55, Y + height / 2);
                    ctx.fillText("Strength", width - 68, Y + height / 2);
                    
                    ctx.globalAlpha = 1.0;
                    const isAllOn = node.getAllLorasState();
                    ctx.fillStyle = isAllOn ? "#8B9BB4" : "#444";
                    ctx.beginPath();
                    ctx.arc(20, Y + height / 2, 5, 0, Math.PI * 2);
                    ctx.fill();

                    // Зоны клика
                    header.hitZones = { toggle: [10, 80] };
                };
                
                // Нативный обработчик кликов виджета заголовка
                header.mouse = function(e, pos, node) {
                    if (e.type === "mouseup" || e.type === "pointerup") return false;
                    const x = pos[0];
                    if (header.hitZones && header.hitZones.toggle && x >= header.hitZones.toggle[0] && x <= header.hitZones.toggle[0] + header.hitZones.toggle[1]) {
                        node.toggleAllLoras();
                        return true;
                    }
                    return false;
                };
                this.headerWidget = header;

                // --- 2. Добавляем кнопку "Add Lora" с меню выбора ---
                this.addBtnWidget = this.addWidget("button", "➕ Add Lora", null, (val, canvas, node, pos, e) => {
                    const loraList = this.getLoraList();
                    if (loraList.length === 0) return;
                    
                    const menuEvent = e || app.canvas.last_mouse_event; 
                    
                    new LiteGraph.ContextMenu(loraList, { 
                        event: menuEvent, 
                        callback: (s) => {
                            const loraName = s.content || s;
                            const w = this.addLoraWidget({ 
                                on: true, lora: loraName, strength: 1.00, tw_on: true, trigger_words: "" 
                            });
                            this.fetchTriggerWords(loraName, w);
                        }
                    });
                });
                
                this.size = this.computeSize();
            };

            // Функционал показа ГАЛЕРЕИ ПРЕВЬЮ
            nodeType.prototype.showPreview = async function(loraName) {
                let overlay = document.getElementById("orex-gallery-overlay");
                if (overlay) overlay.remove();

                overlay = document.createElement("div");
                overlay.id = "orex-gallery-overlay";
                Object.assign(overlay.style, {
                    position: "fixed", top: "0", left: "0", width: "100vw", height: "100vh",
                    backgroundColor: "rgba(0,0,0,0.9)", zIndex: "9999", display: "flex",
                    justifyContent: "center", alignItems: "center", opacity: "0", transition: "opacity 0.2s ease-in-out"
                });

                const loadingText = document.createElement("div");
                loadingText.innerText = "⏳ Loading preview...";
                Object.assign(loadingText.style, { color: "white", fontFamily: "Arial", fontSize: "20px" });
                overlay.appendChild(loadingText);
                document.body.appendChild(overlay);

                setTimeout(() => overlay.style.opacity = "1", 10);

                try {
                    const safeName = loraName.replace(/\\/g, '/');
                    const res = await fetch(`/orex/lora_info?name=${encodeURIComponent(safeName)}`);
                    
                    if (!res.ok) throw new Error("API Error");
                    const d = await res.json();
                    const images = d.images || [];

                    if (images.length === 0) {
                        loadingText.innerText = "⚠️ No preview found for " + loraName;
                        overlay.onclick = () => { overlay.style.opacity = "0"; setTimeout(() => overlay.remove(), 200); };
                        return;
                    }

                    loadingText.remove();

                    // Контейнер галереи
                    const container = document.createElement("div");
                    Object.assign(container.style, {
                        position: "relative", width: "90%", height: "90%",
                        display: "flex", justifyContent: "center", alignItems: "center"
                    });
                    overlay.appendChild(container);

                    // Картинка
                    const imgEl = document.createElement("img");
                    Object.assign(imgEl.style, {
                        maxWidth: "100%", maxHeight: "100%", borderRadius: "8px",
                        objectFit: "contain", boxShadow: "0 10px 40px rgba(0,0,0,0.8)", transition: "opacity 0.2s"
                    });
                    container.appendChild(imgEl);

                    // Панель Метаданных (Стиль Glassmorphism)
                    const metaPanel = document.createElement("div");
                    Object.assign(metaPanel.style, {
                        position: "absolute", bottom: "20px", left: "20px", width: "500px", maxWidth: "80%",
                        backgroundColor: "rgba(15, 15, 15, 0.75)", backdropFilter: "blur(12px)",
                        padding: "16px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ddd", fontFamily: "Arial, sans-serif", display: "none",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.6)", cursor: "default"
                    });
                    container.appendChild(metaPanel);

                    let currentIndex = 0;
                    
                    // Кнопки навигации
                    const btnStyle = {
                        position: "absolute", top: "50%", transform: "translateY(-50%)",
                        background: "rgba(0,0,0,0.6)", color: "white", border: "1px solid rgba(255,255,255,0.2)", 
                        cursor: "pointer", padding: "15px", fontSize: "24px", borderRadius: "8px", 
                        transition: "0.2s", zIndex: "10"
                    };
                    
                    const prevBtn = document.createElement("button");
                    prevBtn.innerText = "◀";
                    Object.assign(prevBtn.style, btnStyle, { left: "-20px" });
                    
                    const nextBtn = document.createElement("button");
                    nextBtn.innerText = "▶";
                    Object.assign(nextBtn.style, btnStyle, { right: "-20px" });

                    // Ховер эффекты для кнопок
                    [prevBtn, nextBtn].forEach(btn => {
                        btn.onmouseover = () => btn.style.background = "rgba(40,40,40,0.8)";
                        btn.onmouseout = () => btn.style.background = "rgba(0,0,0,0.6)";
                    });

                    // Счетчик
                    const counter = document.createElement("div");
                    Object.assign(counter.style, {
                        position: "absolute", top: "-30px", right: "0", 
                        color: "#aaa", fontFamily: "Arial", fontSize: "14px"
                    });

                    // Кнопка закрытия
                    const closeBtn = document.createElement("button");
                    closeBtn.innerText = "✖";
                    Object.assign(closeBtn.style, {
                        position: "absolute", top: "-40px", right: "-30px",
                        background: "none", border: "none", color: "#aaa", fontSize: "28px", cursor: "pointer", transition: "0.2s"
                    });
                    closeBtn.onmouseover = () => closeBtn.style.color = "#fff";
                    closeBtn.onmouseout = () => closeBtn.style.color = "#aaa";
                    container.appendChild(closeBtn);

                    if (images.length > 1) {
                        container.appendChild(prevBtn);
                        container.appendChild(nextBtn);
                        container.appendChild(counter);
                    }

                    // Функция обновления UI при смене картинки
                    const updateUI = () => {
                        const item = images[currentIndex];
                        
                        // Анимация затухания
                        imgEl.style.opacity = "0";
                        setTimeout(() => {
                            imgEl.src = item.url;
                            imgEl.onload = () => imgEl.style.opacity = "1";
                        }, 100);

                        counter.innerText = `${currentIndex + 1} / ${images.length}`;

                        if (item.meta && Object.keys(item.meta).length > 0) {
                            let m = item.meta;
                            let html = `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px;">`;
                            
                            // Функция для рисования бейджика
                            const renderBadge = (label, val) => {
                                if(val) html += `<span style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.05); padding:4px 8px; border-radius:6px; font-size:12px; white-space:nowrap;"><span style="color:#999; margin-right:5px;">${label}</span><span style="color:#fff;">${val}</span></span>`;
                            };
                            
                            renderBadge("sampler", m.sampler);
                            renderBadge("cfg", m.cfgScale);
                            renderBadge("steps", m.steps);
                            renderBadge("seed", m.seed);
                            renderBadge("model", m.Model);
                            html += `</div>`;

                            if (m.prompt) {
                                html += `<div style="font-size:14px; max-height:150px; overflow-y:auto; line-height:1.5; padding-right:8px; margin-bottom:8px;">
                                    <span style="color:#aaa; font-weight:bold; display:block; margin-bottom:2px;">Positive Prompt</span>
                                    <span style="color:#eee;">${m.prompt}</span>
                                </div>`;
                            }
                            if (m.negativePrompt && m.negativePrompt !== "-") {
                                html += `<div style="font-size:13px; max-height:80px; overflow-y:auto; line-height:1.5; padding-right:8px;">
                                    <span style="color:#888; font-weight:bold; display:block; margin-bottom:2px;">Negative Prompt</span>
                                    <span style="color:#aaa;">${m.negativePrompt}</span>
                                </div>`;
                            }
                            metaPanel.innerHTML = html;
                            metaPanel.style.display = "block";
                        } else {
                            metaPanel.style.display = "none";
                        }
                    };

                    const closeGallery = () => {
                        overlay.style.opacity = "0";
                        setTimeout(() => overlay.remove(), 200);
                        document.removeEventListener("keydown", keyHandler);
                    };

                    // Обработчики кликов
                    prevBtn.onclick = (e) => { e.stopPropagation(); currentIndex = (currentIndex > 0) ? currentIndex - 1 : images.length - 1; updateUI(); };
                    nextBtn.onclick = (e) => { e.stopPropagation(); currentIndex = (currentIndex < images.length - 1) ? currentIndex + 1 : 0; updateUI(); };
                    closeBtn.onclick = closeGallery;
                    overlay.onclick = (e) => { if (e.target === overlay || e.target === container) closeGallery(); };
                    
                    // Останавливаем клик внутри панели, чтобы окно не закрывалось
                    metaPanel.onclick = (e) => e.stopPropagation();
                    imgEl.onclick = (e) => e.stopPropagation();

                    // Обработчики клавиатуры
                    const keyHandler = (e) => {
                        if (e.key === "ArrowLeft") prevBtn.click();
                        if (e.key === "ArrowRight") nextBtn.click();
                        if (e.key === "Escape") closeGallery();
                    };
                    document.addEventListener("keydown", keyHandler);

                    // Старт
                    updateUI();

                } catch (err) {
                    console.error("[OreX Lora Loader] Gallery Error:", err);
                    loadingText.innerText = "❌ Error fetching preview";
                    overlay.onclick = () => { overlay.style.opacity = "0"; setTimeout(() => overlay.remove(), 200); };
                }
            };

            // Универсальная функция запроса триггерных слов
            nodeType.prototype.fetchTriggerWords = async function(loraName, widget) {
                try {
                    widget.value.trigger_words = "⏳ Loading...";
                    this.setDirtyCanvas(true, true);

                    const safeName = loraName.replace(/\\/g, '/');
                    const res = await fetch(`/orex/lora_info?name=${encodeURIComponent(safeName)}`);
                    
                    if (res.ok) { 
                        const d = await res.json(); 
                        let words = d.trigger_words || d.trainedWords || d.words || d.tags;
                        
                        if (Array.isArray(words)) {
                            words = words.map(w => typeof w === 'string' ? w : (w.word || "")).filter(Boolean).join(", ");
                        }
                        
                        if (words && typeof words === 'string' && words.trim().length > 0) {
                            widget.value.trigger_words = words; 
                        } else {
                            widget.value.trigger_words = "No words (click to add)";
                        }
                    } else {
                        widget.value.trigger_words = "No words (click to add)";
                    }
                } catch (err) { 
                    widget.value.trigger_words = "No words (click to add)";
                }
                this.setDirtyCanvas(true, true);
            };

            // Метод для добавления строки с лорой
            nodeType.prototype.addLoraWidget = function(initialValue = null) {
                const addBtnIndex = this.widgets.indexOf(this.addBtnWidget);
                if (addBtnIndex > -1) this.widgets.splice(addBtnIndex, 1);

                const w = this.addWidget("custom", "lora", initialValue || { 
                    on: true, lora: "None", strength: 1.00, tw_on: true, trigger_words: "" 
                }, () => {});
                
                w.computeSize = function(width) { return [width, 22]; };
                
                w.draw = function(ctx, node, width, Y, height) {
                    const padding = 2;
                    const innerH = height - padding * 2;
                    let currentX = 10;
                    const midY = Y + height / 2;
                    const isOff = !this.value.on;

                    const loraWidgets = node.widgets.filter(wg => wg.name && wg.name.startsWith("lora"));
                    const myIndex = loraWidgets.indexOf(this);
                    const isFirst = myIndex === 0;
                    const isLast = myIndex === loraWidgets.length - 1;

                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    ctx.font = "12px Arial";

                    drawRoundRect(ctx, 5, Y, width - 10, height - 1, 4, "rgba(0,0,0,0.2)");
                    if (isOff) ctx.globalAlpha = 0.4;

                    ctx.fillStyle = this.value.on ? "#8B9BB4" : "#444";
                    ctx.beginPath();
                    ctx.arc(currentX + 10, midY, 5, 0, Math.PI * 2);
                    ctx.fill();
                    currentX += 24;

                    let rightX = width - 10;
                    const iconW = 18;

                    rightX -= iconW;
                    drawRoundRect(ctx, rightX, Y + padding, iconW, innerH, 4, "rgba(200,50,50,0.2)");
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                    ctx.textAlign = "center";
                    ctx.fillText("🗑️", rightX + iconW/2, midY);
                    const trashX = rightX;
                    rightX -= 4;

                    rightX -= 16;
                    ctx.fillStyle = "#888";
                    ctx.fillText("▶", rightX + 8, midY);
                    const strPlusX = rightX;

                    rightX -= 32;
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                    ctx.fillText(this.value.strength.toFixed(2), rightX + 16, midY);
                    const strValX = rightX;

                    rightX -= 16;
                    ctx.fillStyle = "#888";
                    ctx.fillText("◀", rightX + 8, midY);
                    const strMinusX = rightX;

                    let moveUpX = null;
                    let moveDownX = null;

                    rightX -= iconW;
                    if (!isFirst) {
                        drawRoundRect(ctx, rightX, Y + padding, iconW, innerH, 4, "rgba(0,0,0,0.3)");
                        ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                        ctx.fillText("▲", rightX + iconW/2, midY);
                        moveUpX = rightX;
                    } else {
                        drawRoundRect(ctx, rightX, Y + padding, iconW, innerH, 4, "rgba(0,0,0,0.1)");
                        ctx.fillStyle = "rgba(255,255,255,0.2)";
                        ctx.fillText("▲", rightX + iconW/2, midY);
                    }
                    rightX -= 4;

                    rightX -= iconW;
                    if (!isLast) {
                        drawRoundRect(ctx, rightX, Y + padding, iconW, innerH, 4, "rgba(0,0,0,0.3)");
                        ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                        ctx.fillText("▼", rightX + iconW/2, midY);
                        moveDownX = rightX;
                    } else {
                        drawRoundRect(ctx, rightX, Y + padding, iconW, innerH, 4, "rgba(0,0,0,0.1)");
                        ctx.fillStyle = "rgba(255,255,255,0.2)";
                        ctx.fillText("▼", rightX + iconW/2, midY);
                    }
                    rightX -= 4;

                    rightX -= iconW;
                    drawRoundRect(ctx, rightX, Y + padding, iconW, innerH, 4, "rgba(0,0,0,0.2)");
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                    ctx.fillText("👁️", rightX + iconW/2, midY);
                    const eyeX = rightX;

                    rightX -= 8; 

                    const remainingSpace = rightX - currentX;
                    const twToggleBtnW = 24;
                    const loraW = (remainingSpace - twToggleBtnW - 8) * 0.45;
                    const twW = (remainingSpace - twToggleBtnW - 8) * 0.55;

                    ctx.textAlign = "left";
                    
                    drawRoundRect(ctx, currentX, Y + padding, loraW, innerH, 4, "rgba(0,0,0,0.4)");
                    ctx.save(); ctx.beginPath(); ctx.rect(currentX + 4, Y, loraW - 8, height); ctx.clip();
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                    ctx.fillText(this.value.lora || "None", currentX + 6, midY);
                    ctx.restore();
                    const loraNameX = currentX;
                    currentX += loraW + 4;

                    const currentTwAlpha = ctx.globalAlpha;
                    ctx.globalAlpha = (!isOff && !this.value.tw_on) ? 0.3 : (isOff ? 0.5 : 1.0);
                    drawRoundRect(ctx, currentX, Y + padding, twToggleBtnW, innerH, 4, "rgba(0,0,0,0.3)");
                    ctx.textAlign = "center";
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                    ctx.fillText(this.value.tw_on ? "💬" : "🔇", currentX + twToggleBtnW/2, midY);
                    const twToggleX = currentX;
                    currentX += twToggleBtnW + 4;
                    ctx.globalAlpha = currentTwAlpha;

                    drawRoundRect(ctx, currentX, Y + padding, twW, innerH, 4, "rgba(0,0,0,0.4)");
                    ctx.save(); ctx.beginPath(); ctx.rect(currentX + 4, Y, twW - 8, height); ctx.clip();

                    let twText = this.value.trigger_words || "";
                    if (!twText) {
                        ctx.globalAlpha = 0.4;
                        twText = "No words (click to add)";
                    } else if (twText === "⏳ Loading...") {
                        ctx.globalAlpha = 0.8;
                        ctx.fillStyle = "#8B9BB4"; 
                    } else if (!this.value.tw_on) {
                        ctx.globalAlpha = 0.4;
                    }
                    
                    ctx.textAlign = "left";
                    if (twText !== "⏳ Loading...") {
                        ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                    }
                    ctx.fillText(twText, currentX + 6, midY);
                    ctx.restore();
                    const twTextX = currentX;

                    ctx.globalAlpha = 1.0; 

                    w.hitZones = {
                        toggle: [5, 24],
                        loraName: [loraNameX, loraW],
                        twToggle: [twToggleX, twToggleBtnW],
                        twText: [twTextX, twW],
                        strMinus: [strMinusX, 16],
                        strVal: [strValX, 32],
                        strPlus: [strPlusX, 16],
                        eye: [eyeX, iconW],
                        trash: [trashX, iconW]
                    };
                    
                    if (moveDownX !== null) w.hitZones.moveDown = [moveDownX, iconW];
                    if (moveUpX !== null) w.hitZones.moveUp = [moveUpX, iconW];
                };

                w.mouse = function(e, pos, node) {
                    if (e.type === "mouseup" || e.type === "pointerup") return false;
                    
                    const x = pos[0];
                    const hz = w.hitZones;
                    if (!hz) return false;

                    if (hz.toggle && x >= hz.toggle[0] && x <= hz.toggle[0] + hz.toggle[1]) {
                        w.value.on = !w.value.on;
                    }
                    else if (hz.eye && x >= hz.eye[0] && x <= hz.eye[0] + hz.eye[1]) {
                        node.showPreview(w.value.lora);
                    }
                    else if (hz.trash && x >= hz.trash[0] && x <= hz.trash[0] + hz.trash[1]) {
                        const i = node.widgets.indexOf(w);
                        if (i > -1) node.widgets.splice(i, 1);
                        node.reindexLoras();
                        node.size[1] = node.computeSize()[1];
                    }
                    else if (hz.moveUp && x >= hz.moveUp[0] && x <= hz.moveUp[0] + hz.moveUp[1]) {
                        const i = node.widgets.indexOf(w);
                        if (i > 1) { 
                            [node.widgets[i], node.widgets[i-1]] = [node.widgets[i-1], node.widgets[i]]; 
                            node.reindexLoras(); 
                        }
                    }
                    else if (hz.moveDown && x >= hz.moveDown[0] && x <= hz.moveDown[0] + hz.moveDown[1]) {
                        const i = node.widgets.indexOf(w);
                        if (i > 0 && i < node.widgets.length - 2) { 
                            [node.widgets[i], node.widgets[i+1]] = [node.widgets[i+1], node.widgets[i]]; 
                            node.reindexLoras(); 
                        }
                    }
                    else if (hz.strMinus && x >= hz.strMinus[0] && x <= hz.strMinus[0] + hz.strMinus[1]) {
                        w.value.strength = Math.round((w.value.strength - 0.05) * 100) / 100;
                    }
                    else if (hz.strPlus && x >= hz.strPlus[0] && x <= hz.strPlus[0] + hz.strPlus[1]) {
                        w.value.strength = Math.round((w.value.strength + 0.05) * 100) / 100;
                    }
                    else if (hz.strVal && x >= hz.strVal[0] && x <= hz.strVal[0] + hz.strVal[1]) {
                        app.canvas.prompt("Strength", w.value.strength, (v) => { 
                            let p = parseFloat(v); 
                            if(!isNaN(p)) w.value.strength = p; 
                            node.setDirtyCanvas(true, true); 
                        }, e);
                    }
                    else if (hz.twToggle && x >= hz.twToggle[0] && x <= hz.twToggle[0] + hz.twToggle[1]) {
                        w.value.tw_on = !w.value.tw_on;
                    }
                    else if (hz.twText && x >= hz.twText[0] && x <= hz.twText[0] + hz.twText[1]) {
                        app.canvas.prompt("Edit Trigger Words", w.value.trigger_words, (v) => { 
                            w.value.trigger_words = v; 
                            node.setDirtyCanvas(true, true); 
                        }, e);
                    }
                    else if (hz.loraName && x >= hz.loraName[0] && x <= hz.loraName[0] + hz.loraName[1]) {
                        new LiteGraph.ContextMenu(node.getLoraList(), { event: e, callback: (s) => {
                            w.value.lora = s.content || s;
                            w.value.trigger_words = ""; 
                            node.setDirtyCanvas(true, true);
                            node.fetchTriggerWords(w.value.lora, w);
                        }});
                    } else {
                        return false; 
                    }
                    
                    node.setDirtyCanvas(true, true);
                    return true;
                };

                if (this.addBtnWidget) this.widgets.push(this.addBtnWidget);
                
                this.reindexLoras();
                this.size[1] = this.computeSize()[1];
                this.setDirtyCanvas(true, true);
                return w;
            };

            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (info) {
                if (onConfigure) onConfigure.apply(this, arguments);
                
                // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Очищаем значения системных виджетов!
                // LiteGraph при загрузке узла (до вызова onConfigure) по индексу присваивает 
                // виджетам сохраненные значения. Так как при инициализации у нас только 2 виджета, 
                // кнопка addBtn (индекс 1) получает значение первой лоры из сохранения (индекс 1).
                // Сбрасываем это, чтобы при следующем сохранении кнопка не записала себя как дубликат.
                if (this.headerWidget) this.headerWidget.value = null;
                if (this.addBtnWidget) this.addBtnWidget.value = null;

                this.widgets = [this.headerWidget, this.addBtnWidget];
                
                if (info.widgets_values) {
                    const valuesCopy = [...info.widgets_values]; 
                    
                    for (let val of valuesCopy) {
                        if (val && typeof val === "object" && val.lora !== undefined) {
                            this.addLoraWidget(val);
                        }
                    }
                }
                this.reindexLoras();
            };

            nodeType.prototype.reindexLoras = function() {
                let counter = 1;
                for (let w of this.widgets) {
                    if (w.name && w.name.startsWith("lora")) {
                        w.name = "lora_" + String(counter).padStart(3, "0"); 
                        counter++;
                    }
                }
            };

            nodeType.prototype.getAllLorasState = function() {
                let loras = this.widgets.filter(w => w.name && w.name.startsWith("lora"));
                if (loras.length === 0) return false;
                return loras.every(w => w.value.on);
            };

            nodeType.prototype.toggleAllLoras = function() {
                let targetState = !this.getAllLorasState();
                for (let w of this.widgets) {
                    if (w.name && w.name.startsWith("lora")) w.value.on = targetState;
                }
                this.setDirtyCanvas(true, true);
            };

            nodeType.prototype.getLoraList = function() {
                let def = LiteGraph.registered_node_types["LoraLoader"];
                if (def && def.nodeData && def.nodeData.input && def.nodeData.input.required && def.nodeData.input.required.lora_name) {
                    return def.nodeData.input.required.lora_name[0] || [];
                }
                return [];
            };
        }
    }
});