import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "OreX.ImageMergingV2",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "OrexImageMergingV2") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                this._lastImageCount = -1; 
                this._cachedCaptionInputs = {}; 
                
                // 1. ОДИН РАЗ сортируем виджеты при создании узла.
                // Это вытянет все Caption наверх, ровно под пины. Мы больше не будем ломать массив.
                if (this.widgets) {
                    const standardWidgets = this.widgets.filter(w => !w.name || !w.name.startsWith("caption"));
                    const captionWidgets = this.widgets.filter(w => w.name && w.name.startsWith("caption"));
                    
                    captionWidgets.sort((a, b) => {
                        const numA = parseInt(a.name.replace("caption", ""), 10);
                        const numB = parseInt(b.name.replace("caption", ""), 10);
                        return numA - numB;
                    });
                    
                    this.widgets.length = 0;
                    this.widgets.push(...captionWidgets, ...standardWidgets);
                }

                this.updateImageInputs = function() {
                    const widget = this.widgets?.find(w => w.name === "image_number");
                    if (!widget) return;
                    
                    const count = Math.floor(widget.value);
                    if (count === this._lastImageCount) return;
                    this._lastImageCount = count;
                    
                    // 2. Управляем пинами (ВХОДАМИ слева)
                    if (this.inputs) {
                        for (let i = this.inputs.length - 1; i >= 0; i--) {
                            const inp = this.inputs[i];
                            const match = inp.name?.match(/^(image|caption)(\d+)$/);
                            if (match) {
                                const type = match[1];
                                const idx = parseInt(match[2], 10);
                                if (idx > count) {
                                    // Если удаляем caption-пин, запоминаем его (чтобы потом восстановить как пин)
                                    if (type === "caption") {
                                        this._cachedCaptionInputs[inp.name] = inp.widget ? { widget: { name: inp.widget.name } } : undefined;
                                    }
                                    this.removeInput(i);
                                }
                            }
                        }
                    }

                    // Восстанавливаем/добавляем нужные пины
                    for (let i = 1; i <= count; i++) {
                        const imgName = "image" + i;
                        const capName = "caption" + i;
                        
                        // Гарантируем, что есть пин для картинки
                        if (!this.inputs || !this.inputs.find(inp => inp.name === imgName)) {
                            this.addInput(imgName, "IMAGE");
                        }
                        
                        // Если caption БЫЛ пином до того как его спрятали, возвращаем его как пин
                        if (this._cachedCaptionInputs[capName]) {
                            if (!this.inputs || !this.inputs.find(inp => inp.name === capName)) {
                                this.addInput(capName, "STRING", this._cachedCaptionInputs[capName]);
                            }
                        }
                    }

                    // 3. Управляем ВИДЖЕТАМИ (Скрываем лишние, НЕ удаляя их из массива)
                    // Это гарантирует, что ComfyUI не потеряет связь с виджетами и не сломает их конвертацию.
                    if (this.widgets) {
                        for (let i = 0; i < this.widgets.length; i++) {
                            const w = this.widgets[i];
                            const match = w.name?.match(/^caption(\d+)$/);
                            if (match) {
                                const idx = parseInt(match[1], 10);
                                if (idx > count) {
                                    // Делаем виджет невидимым
                                    if (w.type !== "hidden") {
                                        w.origType = w.type;
                                        w.type = "hidden";
                                        w.origComputeSize = w.computeSize;
                                        w.computeSize = () => [0, -4]; // Убираем его высоту
                                        // Прячем текстовое HTML-поле, если оно есть
                                        if (w.inputEl) w.inputEl.style.display = "none";
                                    }
                                } else {
                                    // Делаем виджет видимым
                                    if (w.type === "hidden") {
                                        w.type = w.origType || "customtext";
                                        if (w.origComputeSize) w.computeSize = w.origComputeSize;
                                        else delete w.computeSize;
                                        if (w.inputEl) w.inputEl.style.display = "block";
                                    }
                                }
                            }
                        }
                    }

                    // Перерисовываем узел под новый размер
                    const sz = this.computeSize();
                    this.setSize([Math.max(this.size[0], sz[0]), sz[1]]);
                    this.setDirtyCanvas(true, true);
                };

                const widget = this.widgets?.find(w => w.name === "image_number");
                if (widget) {
                    let val = widget.value;
                    Object.defineProperty(widget, 'value', {
                        get: function() { return val; },
                        set: (newVal) => {
                            val = newVal;
                            this.updateImageInputs();
                        }
                    });
                }

                // Даем ComfyUI 10мс на загрузку старых связей, прежде чем обновлять интерфейс
                setTimeout(() => this.updateImageInputs(), 10);
                
                return r;
            };
        }
    }
});