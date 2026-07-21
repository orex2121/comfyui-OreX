import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Внедряем CSS-стили
const styleEl = document.createElement("style");
styleEl.textContent = `
.orex-styles-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    height: 100%;
    padding: 8px;
    background: var(--bg-color, #1e1e1e);
    border-radius: 8px;
    box-sizing: border-box;
}
.orex-tags-container {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 85px;
    overflow-y: auto;
    padding-bottom: 6px;
    border-bottom: 1px solid #333;
    flex-shrink: 0; 
}
.orex-tags-container:empty {
    display: none;
    border-bottom: none;
    padding-bottom: 0;
}
.orex-tag {
    background: #333;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    cursor: grab;
    user-select: none;
    transition: background 0.2s, border-color 0.2s;
}
.orex-tag:active {
    cursor: grabbing;
}
.orex-tag.drag-over {
    border-color: #4CAF50;
    background: #444;
}
.orex-tag-close {
    cursor: pointer;
    color: #ff5555;
    font-weight: bold;
    font-size: 14px;
    line-height: 1;
}
.orex-tag-close:hover {
    color: #ff8888;
}

/* Строка поиска и кнопка сброса */
.orex-search-row {
    display: flex;
    gap: 8px;
    width: 100%;
    align-items: center;
    flex-shrink: 0; 
}
.orex-reset-btn {
    background: transparent;
    border: 1px solid #555;
    color: #ccc;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    min-width: 28px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    transition: 0.2s;
    padding: 0;
}
.orex-reset-btn:hover {
    background: #444;
    color: #fff;
    border-color: #888;
}
.orex-search-bar {
    flex-grow: 1;
    padding: 6px 10px;
    background: #00000050;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    box-sizing: border-box;
}

/* Сетка стилей */
.orex-styles-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(77px, 1fr));
    gap: 10px;
    overflow-y: auto;
    flex-grow: 1;       
    min-height: 0;      
    align-content: start;
    width: 100%;
    box-sizing: border-box;
}
.orex-style-card {
    background: #2a2a2a;
    border: 2px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    height: 100px; 
}
.orex-style-card:hover {
    transform: scale(1.02);
}
.orex-style-card.selected {
    border-color: #4CAF50;
}

/* Галочка выбора слева вверху */
.orex-style-card.selected::after {
    content: '✓';
    position: absolute;
    top: 5px;
    left: 5px;
    background: #4CAF50;
    color: white;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    z-index: 20;
}

/* Кнопка ИЗБРАННОГО справа вверху */
.orex-fav-btn {
    position: absolute;
    top: 5px;
    right: 5px;
    font-size: 16px;
    cursor: pointer;
    z-index: 20;
    color: rgba(0,0,0,0.5);
    text-shadow: 0px 0px 2px rgba(255,255,255,0.8);
    transition: transform 0.2s, color 0.2s;
    user-select: none;
}
.orex-fav-btn:hover {
    transform: scale(1.25);
}
.orex-fav-btn.favorited {
    color: #ff4444;
    text-shadow: 0px 0px 4px rgba(0,0,0,0.5);
}

.orex-style-card > img {
    width: 100%;
    height: 77px;
    object-fit: cover;
    background: #111;
}

/* --- Стили для слайдера До/После --- */
.orex-slider-container {
    position: relative;
    width: 100%;
    height: 77px;
    background: #111;
    flex-shrink: 0;
}
.orex-slider-container .img-after,
.orex-slider-container .img-before {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none; /* Мышь сквозь картинки */
}
.orex-slider-container .img-before {
    clip-path: polygon(0 0, 50% 0, 50% 100%, 0 100%);
}
.orex-slider-line {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 2px;
    background: white;
    transform: translateX(-50%);
    pointer-events: none;
    box-shadow: 0 0 3px rgba(0,0,0,0.5);
    z-index: 5;
}
.orex-slider-range {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: col-resize;
    margin: 0;
    z-index: 10; 
}
/* ---------------------------------- */

.orex-style-card .title {
    padding: 4px;
    font-size: 8.5px;
    text-align: center;
    color: #ddd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: #222;
}
.orex-styles-grid::-webkit-scrollbar { width: 8px; }
.orex-styles-grid::-webkit-scrollbar-track { background: #111; border-radius: 4px; }
.orex-styles-grid::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
.orex-styles-grid::-webkit-scrollbar-thumb:hover { background: #777; }

/* Тултип */
.orex-style-tooltip {
    position: fixed;
    background: #1a1a1acc;
    backdrop-filter: blur(4px);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 12px;
    width: 260px;
    z-index: 10001;
    pointer-events: none;
    display: none;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.7);
    font-family: sans-serif;
}
.orex-style-tooltip img {
    width: 100%;
    height: 150px;
    object-fit: cover;
    border-radius: 4px;
    background: #111;
}
.orex-style-tooltip h4 { 
    margin: 0; 
    color: #fff; 
    font-size: 14px;
    font-weight: 600;
}
.orex-style-tooltip .prompt-block {
    font-size: 11px;
    line-height: 1.4;
    word-break: break-word;
    max-height: 120px;
    overflow-y: auto;
}
.orex-style-tooltip .pos { color: #4CAF50; }
.orex-style-tooltip .neg { color: #F44336; }
`;
document.head.appendChild(styleEl);

let tooltip = document.getElementById("orex-style-tooltip");
if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "orex-style-tooltip";
    tooltip.className = "orex-style-tooltip";
    document.body.appendChild(tooltip);
}

app.registerExtension({
    name: "OreX.StyleSelector",
    async nodeCreated(node) {
        if (node.comfyClass === "OrexStyleSelector") {
            
            const selectStylesWidget = node.widgets.find(w => w.name === "select_styles");
            
            if (selectStylesWidget) {
                selectStylesWidget.computeSize = () => [0, -4];
                selectStylesWidget.draw = () => {}; 
                if (selectStylesWidget.inputEl) {
                    selectStylesWidget.inputEl.style.display = "none";
                }
            }

            const container = document.createElement("div");
            container.className = "orex-styles-container";

            const tagsContainer = document.createElement("div");
            tagsContainer.className = "orex-tags-container";
            container.appendChild(tagsContainer);

            const searchRow = document.createElement("div");
            searchRow.className = "orex-search-row";

            const resetBtn = document.createElement("button");
            resetBtn.className = "orex-reset-btn";
            resetBtn.innerHTML = "↺"; 
            resetBtn.title = "Clear all styles";
            resetBtn.onclick = () => {
                updateSelection([]); 
            };
            searchRow.appendChild(resetBtn);

            const searchInput = document.createElement("input");
            searchInput.className = "orex-search-bar";
            searchInput.placeholder = "🔍 Search styles...";
            searchRow.appendChild(searchInput);

            container.appendChild(searchRow);

            const grid = document.createElement("div");
            grid.className = "orex-styles-grid";
            container.appendChild(grid);

            node.addDOMWidget("styles_grid", "custom", container, {
                getValue: () => selectStylesWidget ? selectStylesWidget.value : "",
                setValue: (v) => { if (selectStylesWidget) selectStylesWidget.value = v; },
                hideOnZoom: false
            });

            node.setSize([460, 520]);

            let allStyles = [];
            let favoriteNames = []; 
            let draggedStyle = null; 

            // Вспомогательная функция получения URL картинки
            const getImageUrl = (imgName) => {
                if (!imgName) return "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
                if (imgName.startsWith("http") || imgName.startsWith("data:")) return imgName;
                return `/orex/image?img=${encodeURIComponent(imgName)}`;
            };

            const fetchFavoritesList = async () => {
                try {
                    const response = await api.fetchApi("/orex/styles?name=favorite");
                    if (response.ok) {
                        const favData = await response.json();
                        favoriteNames = favData.map(s => s.name);
                    }
                } catch (e) {
                    console.warn("Failed to load favorites.json", e);
                }
            };

            const updateSelection = (newSelectionArray) => {
                const cleanedSelection = newSelectionArray.filter(Boolean);
                if (selectStylesWidget) {
                    selectStylesWidget.value = cleanedSelection.join(",");
                }
                renderTags(cleanedSelection);
                
                grid.querySelectorAll(".orex-style-card").forEach(card => {
                    if (cleanedSelection.includes(card.dataset.name)) {
                        card.classList.add("selected");
                    } else {
                        card.classList.remove("selected");
                    }
                });
                node.setDirtyCanvas(true, true);
            };

            const renderTags = (selectedArray) => {
                tagsContainer.innerHTML = "";
                selectedArray.forEach(styleName => {
                    const tag = document.createElement("div");
                    tag.className = "orex-tag";
                    tag.draggable = true;
                    
                    tag.addEventListener("dragstart", (e) => {
                        draggedStyle = styleName;
                        e.dataTransfer.effectAllowed = "move";
                        setTimeout(() => tag.style.opacity = "0.4", 0);
                    });

                    tag.addEventListener("dragend", (e) => {
                        tag.style.opacity = "1";
                        draggedStyle = null;
                        document.querySelectorAll(".orex-tag").forEach(t => t.classList.remove("drag-over"));
                    });

                    tag.addEventListener("dragover", (e) => {
                        e.preventDefault(); 
                        e.dataTransfer.dropEffect = "move";
                        tag.classList.add("drag-over");
                    });

                    tag.addEventListener("dragleave", (e) => {
                        tag.classList.remove("drag-over");
                    });

                    tag.addEventListener("drop", (e) => {
                        e.preventDefault();
                        tag.classList.remove("drag-over");
                        
                        if (draggedStyle && draggedStyle !== styleName) {
                            const currentSelection = selectStylesWidget ? selectStylesWidget.value.split(",").filter(Boolean) : [];
                            const fromIndex = currentSelection.indexOf(draggedStyle);
                            const toIndex = currentSelection.indexOf(styleName);
                            
                            if (fromIndex !== -1 && toIndex !== -1) {
                                currentSelection.splice(fromIndex, 1);
                                currentSelection.splice(toIndex, 0, draggedStyle);
                                updateSelection(currentSelection);
                            }
                        }
                    });
                    
                    const nameSpan = document.createElement("span");
                    const styleData = allStyles.find(s => s.name === styleName);
                    nameSpan.textContent = styleData ? (styleData.name_cn || styleData.name) : styleName;
                    
                    const closeBtn = document.createElement("span");
                    closeBtn.className = "orex-tag-close";
                    closeBtn.textContent = "×";
                    closeBtn.onclick = (e) => {
                        e.stopPropagation();
                        const currentSelection = selectStylesWidget ? selectStylesWidget.value.split(",").filter(Boolean) : [];
                        updateSelection(currentSelection.filter(s => s !== styleName));
                    };
                    
                    tag.appendChild(nameSpan);
                    tag.appendChild(closeBtn);
                    tagsContainer.appendChild(tag);
                });
            };

            const renderStyles = (filter = "") => {
                grid.innerHTML = "";
                const selectedStyles = selectStylesWidget && selectStylesWidget.value ? selectStylesWidget.value.split(",").filter(Boolean) : [];

                renderTags(selectedStyles);

                allStyles.forEach(item => {
                    const displayName = item.name_cn || item.name;
                    if (filter && !displayName.toLowerCase().includes(filter.toLowerCase())) return;

                    const card = document.createElement("div");
                    card.className = "orex-style-card";
                    card.dataset.name = item.name;
                    if (selectedStyles.includes(item.name)) card.classList.add("selected");

                    // === Добавляем Сердечко ===
                    const favBtn = document.createElement("div");
                    const isFav = favoriteNames.includes(item.name);
                    favBtn.className = "orex-fav-btn" + (isFav ? " favorited" : "");
                    favBtn.innerHTML = "❤";
                    favBtn.title = isFav ? "Remove from favorites" : "Add to favorites";
                    
                    favBtn.onclick = async (e) => {
                        e.stopPropagation(); 
                        const currentlyFav = favBtn.classList.contains("favorited");
                        const action = currentlyFav ? "remove" : "add";
                        
                        if (currentlyFav) {
                            favBtn.classList.remove("favorited");
                            favBtn.title = "Add to favorites";
                            favoriteNames = favoriteNames.filter(n => n !== item.name);
                        } else {
                            favBtn.classList.add("favorited");
                            favBtn.title = "Remove from favorites";
                            favoriteNames.push(item.name);
                        }
                        
                        try {
                            await api.fetchApi("/orex/favorite", {
                                method: "POST",
                                body: JSON.stringify({ style: item, action: action })
                            });
                        } catch (err) {
                            console.error("[OreX] Error saving favorite:", err);
                        }
                    };
                    card.appendChild(favBtn);

                    // === Логика отрисовки картинки ИЛИ слайдера ===
                    const hasSlider = item.thumbnail_variant === "compareSlider" && Array.isArray(item.thumbnail) && item.thumbnail.length >= 2;
                    
                    if (hasSlider) {
                        const sliderContainer = document.createElement("div");
                        sliderContainer.className = "orex-slider-container";
                        
                        const imgAfter = document.createElement("img");
                        imgAfter.className = "img-after";
                        imgAfter.src = getImageUrl(item.thumbnail[0]); // Результат
                        imgAfter.onerror = () => { imgAfter.src = getImageUrl(""); };
                        
                        const imgBefore = document.createElement("img");
                        imgBefore.className = "img-before";
                        imgBefore.src = getImageUrl(item.thumbnail[1]); // Исходник
                        imgBefore.onerror = () => { imgBefore.src = getImageUrl(""); };
                        
                        const line = document.createElement("div");
                        line.className = "orex-slider-line";
                        
                        const range = document.createElement("input");
                        range.type = "range";
                        range.min = 0;
                        range.max = 100;
                        range.value = 50;
                        range.className = "orex-slider-range";
                        
                        // Сдвиг линии
                        range.addEventListener("input", (e) => {
                            const val = e.target.value;
                            imgBefore.style.clipPath = `polygon(0 0, ${val}% 0, ${val}% 100%, 0 100%)`;
                            line.style.left = `${val}%`;
                        });

                        // Предотвращение выделения карточки при перетаскивании ползунка
                        let startX = 0;
                        range.addEventListener("pointerdown", (e) => {
                            startX = e.clientX;
                        });
                        range.addEventListener("click", (e) => {
                            if (Math.abs(e.clientX - startX) > 5) {
                                e.stopPropagation(); 
                            }
                        });

                        sliderContainer.appendChild(imgAfter);
                        sliderContainer.appendChild(imgBefore);
                        sliderContainer.appendChild(line);
                        sliderContainer.appendChild(range);
                        
                        card.appendChild(sliderContainer);
                    } else {
                        // Обычное изображение, если нет compareSlider
                        const img = document.createElement("img");
                        let imgName = "";
                        if (Array.isArray(item.thumbnail)) {
                            imgName = item.thumbnail[0];
                        } else if (typeof item.thumbnail === "string") {
                            imgName = item.thumbnail;
                        }
                        img.src = getImageUrl(imgName);
                        img.onerror = () => { img.src = getImageUrl(""); };
                        
                        card.appendChild(img);
                    }
                    // ===============================================

                    const title = document.createElement("div");
                    title.className = "title";
                    title.textContent = displayName;
                    card.appendChild(title);

                    card.onclick = () => {
                        const currentSelected = selectStylesWidget ? selectStylesWidget.value.split(",").filter(Boolean) : [];
                        if (currentSelected.includes(item.name)) {
                            updateSelection(currentSelected.filter(s => s !== item.name));
                        } else {
                            currentSelected.push(item.name);
                            updateSelection(currentSelected);
                        }
                    };

                    card.onmouseenter = () => {
                        const containerRect = container.getBoundingClientRect();
                        
                        // Для тултипа берем первую картинку всегда (даже если есть слайдер)
                        let tImg = "";
                        if (Array.isArray(item.thumbnail)) {
                            tImg = item.thumbnail[0];
                        } else if (typeof item.thumbnail === "string") {
                            tImg = item.thumbnail;
                        }
                        
                        tooltip.innerHTML = `
                            <img src="${getImageUrl(tImg)}">
                            <h4>${displayName}</h4>
                            ${item.prompt ? `<div class="prompt-block pos"><b>Positive:</b> ${item.prompt}</div>` : ''}
                            ${item.negative_prompt ? `<div class="prompt-block neg"><b>Negative:</b> ${item.negative_prompt}</div>` : ''}
                        `;
                        
                        tooltip.style.display = "flex";
                        
                        let leftPos = containerRect.left - 275; 
                        if (leftPos < 0) {
                            leftPos = containerRect.right + 15; 
                        }
                        tooltip.style.left = leftPos + "px";
                        
                        let topPos = containerRect.top + (containerRect.height / 2) - (tooltip.offsetHeight / 2);
                        if (topPos < 10) topPos = 10;
                        if (topPos + tooltip.offsetHeight > window.innerHeight) {
                            topPos = window.innerHeight - tooltip.offsetHeight - 10;
                        }
                        tooltip.style.top = topPos + "px";
                    };

                    card.onmouseleave = () => {
                        tooltip.style.display = "none";
                    };

                    grid.appendChild(card);
                });
            };

            const loadStyles = async (jsonName) => {
                grid.innerHTML = "<div style='color:#fff; text-align:center; padding:20px;'>Loading styles...</div>";
                try {
                    await fetchFavoritesList();
                    
                    const response = await api.fetchApi(`/orex/styles?name=${jsonName}`);
                    if (!response.ok) throw new Error("Network Error");
                    allStyles = await response.json();
                    renderStyles(searchInput.value);
                } catch (e) {
                    grid.innerHTML = "<div style='color:#ff5555; text-align:center; padding:20px;'>Failed to load styles</div>";
                    console.error("[OreX StyleSelector] Error:", e);
                }
            };

            searchInput.addEventListener("input", (e) => renderStyles(e.target.value));

            const stylesComboWidget = node.widgets.find(w => w.name === "styles");
            if (stylesComboWidget) {
                const origCallback = stylesComboWidget.callback;
                stylesComboWidget.callback = function (val) {
                    if (selectStylesWidget) selectStylesWidget.value = ""; 
                    loadStyles(val);
                    if (origCallback) origCallback.apply(this, arguments);
                };
                setTimeout(() => loadStyles(stylesComboWidget.value), 100);
            }
        }
    }
});