import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "OreX.ImageMerging",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // Имя узла должно точно совпадать с ключом из __init__.py (NODE_CLASS_MAPPINGS)
        if (nodeData.name === "orex Image Merging") {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                // Переменная для отслеживания текущего количества пинов, 
                // чтобы избежать лагов при плавном перетаскивании ползунка
                this._lastImageCount = -1; 
                
                this.updateImageInputs = function() {
                    const widget = this.widgets?.find(w => w.name === "image_number");
                    if (!widget) return;
                    
                    const count = Math.floor(widget.value);
                    
                    // Прерываем функцию, если целое число не изменилось
                    if (count === this._lastImageCount) return;
                    this._lastImageCount = count;
                    
                    // 1. Добавляем недостающие пины (входы)
                    for (let i = 1; i <= count; i++) {
                        const inputName = "image" + i;
                        const exists = this.inputs && this.inputs.find(inp => inp.name === inputName);
                        if (!exists) {
                            this.addInput(inputName, "IMAGE");
                        }
                    }
                    
                    // 2. Удаляем лишние пины, если ползунок уменьшили
                    if (this.inputs) {
                        for (let i = this.inputs.length - 1; i >= 0; i--) {
                            const inp = this.inputs[i];
                            if (inp.name.startsWith("image")) {
                                const idx = parseInt(inp.name.replace("image", ""));
                                if (idx > count) {
                                    this.removeInput(i);
                                }
                            }
                        }
                    }

                    // 3. Динамически перерисовываем размер узла
                    const sz = this.computeSize();
                    if (sz[0] < this.size[0]) sz[0] = this.size[0];
                    if (sz[1] < this.size[1]) sz[1] = this.size[1];
                    this.size = sz;
                    this.setDirtyCanvas(true, true);
                };

                // Задержка нужна, чтобы виджеты успели проинициализироваться
                setTimeout(() => {
                    const widget = this.widgets?.find(w => w.name === "image_number");
                    if (widget) {
                        // Жесткий перехватчик изменения значения для гарантии срабатывания
                        let val = widget.value;
                        Object.defineProperty(widget, 'value', {
                            get: function() { return val; },
                            set: (newVal) => {
                                val = newVal;
                                // this сохраняется благодаря стрелочной функции
                                this.updateImageInputs();
                            }
                        });
                        
                        // Инициализируем пины при первом появлении узла
                        this.updateImageInputs();
                    }
                }, 50);

                return r;
            };
            
            // Восстанавливаем пины при загрузке сохраненного рабочего процесса
            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (info) {
                if (onConfigure) {
                    onConfigure.apply(this, arguments);
                }
                if (this.widgets) {
                    setTimeout(() => this.updateImageInputs(), 50);
                }
            };
        }
    }
});