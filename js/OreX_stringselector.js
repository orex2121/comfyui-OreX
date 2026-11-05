import { app } from "../../scripts/app.js";

const NODE_CLASS = "orex String Selector";

// Ширина зоны корзины справа (px) и ширина самой иконки
const TRASH_ZONE = 28;
const ICON_W = 18;

function button(text, primary = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    Object.assign(element.style, {
        flex: "1 1 0", minHeight: "34px", borderRadius: "6px",
        border: primary ? "1px solid #43a85b" : "1px solid #686868",
        background: primary ? "#28773a" : "#3b3b3b", color: "#f2f2f2",
        fontWeight: "600", cursor: "pointer",
    });
    return element;
}

function openLineEditor(node, stringsWidget, sourceTextarea, lineIndex, updateHighlight) {
    document.querySelector(`[data-orex-string-editor="${node.id}"]`)?.remove();
    const linesAtOpen = String(stringsWidget.value ?? "").split("\n");
    if (lineIndex < 0 || lineIndex >= linesAtOpen.length) return;

    const overlay = document.createElement("div");
    overlay.dataset.orexStringEditor = String(node.id);
    Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "100000", display: "flex",
        alignItems: "center", justifyContent: "center", padding: "24px",
        boxSizing: "border-box", background: "rgba(0,0,0,.62)", pointerEvents: "auto",
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
        width: "min(720px,85vw)", maxHeight: "80vh", display: "flex",
        flexDirection: "column", gap: "10px", padding: "16px", boxSizing: "border-box",
        border: "1px solid #666", borderRadius: "10px", background: "#292929",
        boxShadow: "0 18px 60px rgba(0,0,0,.55)", color: "#eee",
        font: "13px Arial,sans-serif",
    });

    const title = document.createElement("div");
    title.textContent = `Edit string ${lineIndex + 1}`;
    Object.assign(title.style, { fontSize: "15px", fontWeight: "700" });

    const label = document.createElement("label");
    label.textContent = "Text";
    Object.assign(label.style, { fontWeight: "600", color: "#d8d8d8" });

    const editor = document.createElement("textarea");
    editor.value = linesAtOpen[lineIndex];
    editor.rows = 12;
    editor.spellcheck = false;
    Object.assign(editor.style, {
        width: "100%", minHeight: "220px", maxHeight: "55vh", resize: "vertical",
        boxSizing: "border-box", padding: "10px", border: "1px solid #606060",
        borderRadius: "6px", outline: "none", background: "#181818", color: "#f0f0f0",
        font: "13px/1.45 monospace", whiteSpace: "pre-wrap",
    });

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", gap: "8px" });
    const saveButton = button("Save", true);
    const cancelButton = button("Cancel");
    actions.append(saveButton, cancelButton);
    panel.append(title, label, editor, actions);
    overlay.append(panel);
    document.body.append(overlay);

    const close = () => {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
    };

    const save = () => {
        const currentLines = String(stringsWidget.value ?? "").split("\n");
        if (lineIndex >= currentLines.length) return close();
        if (editor.value.trim() === "") {
            // Пустой текст: строка удаляется целиком, а не остаётся пустой
            currentLines.splice(lineIndex, 1);
        } else {
            currentLines.splice(lineIndex, 1, editor.value);
        }
        const updatedText = currentLines.join("\n");
        stringsWidget.value = updatedText;
        sourceTextarea.value = updatedText;
        stringsWidget.callback?.(updatedText);
        sourceTextarea.dispatchEvent(new Event("input", { bubbles: true }));
        node.graph?.setDirtyCanvas(true, true);
        updateHighlight();
        close();
    };

    function onKeyDown(event) {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            save();
        }
    }

    saveButton.addEventListener("click", save);
    cancelButton.addEventListener("click", close);
    document.addEventListener("keydown", onKeyDown, true);
    requestAnimationFrame(() => {
        editor.focus();
        editor.setSelectionRange(editor.value.length, editor.value.length);
    });
}

app.registerExtension({
    name: "OreX.StringSelector",
    async nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;

        setTimeout(() => {
            const stringsWidget = node.widgets?.find((widget) => widget.name === "strings");
            const selectWidget = node.widgets?.find((widget) => widget.name === "select");
            const textarea = stringsWidget?.inputEl;
            if (!stringsWidget || !selectWidget || !textarea) return;

            textarea.style.backgroundAttachment = "local";
            textarea.style.backgroundRepeat = "no-repeat";
            textarea.style.whiteSpace = "pre";
            textarea.style.overflowX = "auto";
            // Место справа под корзину, чтобы текст не заезжал под иконку
            textarea.style.paddingRight = `${TRASH_ZONE}px`;

            // `line-height: normal` differs between browsers. That tiny error
            // accumulated on every line and made the green highlight drift.
            const initialStyle = window.getComputedStyle(textarea);
            const fontSize = parseFloat(initialStyle.fontSize) || 12;
            textarea.style.lineHeight = `${Math.round(fontSize * 1.4 * 100) / 100}px`;

            const lineMetrics = () => {
                const computed = window.getComputedStyle(textarea);
                return {
                    lineHeight: parseFloat(computed.lineHeight),
                    paddingTop: parseFloat(computed.paddingTop) || 0,
                };
            };

            // Ограничивает счётчик диапазоном [1 .. количество строк].
            // На последней строке стрелка вправо ничего не меняет, на первой - стрелка влево.
            const clampSelect = () => {
                const text = String(stringsWidget.value ?? "");
                const count = text.trim() ? text.split("\n").length : 1;
                if (selectWidget.options) selectWidget.options.max = count;
                let value = Math.round(Number(selectWidget.value)) || 1;
                value = Math.min(Math.max(value, 1), count);
                if (selectWidget.value !== value) selectWidget.value = value;
            };

            // Картинка с корзинами для всех строк (одна SVG на весь список)
            let trashKey = "";
            let trashUrl = "";
            const trashImage = (count, lineHeight) => {
                const key = `${count}x${lineHeight}`;
                if (key !== trashKey) {
                    const iconSize = 12;
                    const offsetY = (lineHeight - iconSize) / 2;
                    let rows = "";
                    for (let i = 0; i < count; i++) {
                        rows += `<g transform='translate(3,${i * lineHeight + offsetY})' fill='none' stroke='#e0463c' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'><path d='M1 3h10M4 3V1.5h4V3M2.5 3l.6 8h5.8l.6-8M5 5.5v3.5M7 5.5v3.5'/></g>`;
                    }
                    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${ICON_W}' height='${count * lineHeight}'>${rows}</svg>`;
                    trashUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
                    trashKey = key;
                }
                return trashUrl;
            };

            const updateHighlight = () => {
                if (!document.body.contains(textarea)) return;
                clampSelect();
                const text = String(stringsWidget.value ?? "");
                const lines = text.split("\n");
                if (!text.trim()) {
                    textarea.style.backgroundImage = "none";
                    return;
                }

                const selected = Number(selectWidget.value) || 1;
                const index = Math.min(Math.max(0, selected - 1), lines.length - 1);
                const { lineHeight, paddingTop } = lineMetrics();
                const startY = paddingTop + index * lineHeight;
                const scrollLeft = textarea.scrollLeft;
                const iconX = scrollLeft + textarea.clientWidth - TRASH_ZONE + (TRASH_ZONE - ICON_W) / 2;

                textarea.style.backgroundImage =
                    `${trashImage(lines.length, lineHeight)}, linear-gradient(rgba(0,200,50,.35),rgba(0,200,50,.35))`;
                textarea.style.backgroundSize =
                    `${ICON_W}px ${lines.length * lineHeight}px, 100% ${lineHeight}px`;
                textarea.style.backgroundPosition =
                    `${iconX}px ${paddingTop}px, ${scrollLeft}px ${startY}px`;
            };

            // Координаты мыши внутри текстового поля с учётом масштаба холста
            const localPoint = (event) => {
                const rect = textarea.getBoundingClientRect();
                const scaleX = textarea.offsetWidth > 0 ? rect.width / textarea.offsetWidth : 1;
                const scaleY = textarea.offsetHeight > 0 ? rect.height / textarea.offsetHeight : 1;
                return {
                    x: (event.clientX - rect.left) / scaleX - textarea.clientLeft,
                    y: (event.clientY - rect.top) / scaleY + textarea.scrollTop,
                };
            };

            const lineIndexFromEvent = (event) => {
                const text = String(stringsWidget.value ?? "");
                const lines = text.split("\n");
                if (!text.trim()) return -1;
                const { lineHeight, paddingTop } = lineMetrics();
                const { y } = localPoint(event);
                const index = Math.floor((y - paddingTop) / lineHeight);
                return index >= 0 && index < lines.length ? index : -1;
            };

            const isInTrashZone = (event) => {
                const { x } = localPoint(event);
                return x >= textarea.clientWidth - TRASH_ZONE && x <= textarea.clientWidth;
            };

            // Защита от случайного двойного удаления: после удаления строки
            // следующая строка встаёт под курсор, и быстрый второй клик удалил бы и её
            let lastDeleteTime = 0;
            const deleteLine = (index) => {
                const now = Date.now();
                if (now - lastDeleteTime < 400) return;
                lastDeleteTime = now;

                const currentLines = String(stringsWidget.value ?? "").split("\n");
                if (index < 0 || index >= currentLines.length) return;
                currentLines.splice(index, 1);
                const updatedText = currentLines.join("\n");

                // Если удалили строку выше выбранной, выбранная остаётся той же (номер сдвигается)
                const selected = Number(selectWidget.value) || 1;
                if (index + 1 < selected) selectWidget.value = selected - 1;

                stringsWidget.value = updatedText;
                textarea.value = updatedText;
                stringsWidget.callback?.(updatedText);
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
                node.graph?.setDirtyCanvas(true, true);
                updateHighlight();
            };

            const originalStringsCallback = stringsWidget.callback;
            stringsWidget.callback = function () {
                const result = originalStringsCallback?.apply(this, arguments);
                updateHighlight();
                return result;
            };

            const originalSelectCallback = selectWidget.callback;
            selectWidget.callback = function () {
                const result = originalSelectCallback?.apply(this, arguments);
                updateHighlight();
                return result;
            };

            const originalOnConfigure = node.onConfigure;
            node.onConfigure = function () {
                const result = originalOnConfigure?.apply(this, arguments);
                setTimeout(updateHighlight, 50);
                return result;
            };

            // Корзина должна ехать вместе с содержимым при прокрутке
            textarea.addEventListener("scroll", updateHighlight);

            // Курсор-«рука» над корзиной
            textarea.addEventListener("mousemove", (event) => {
                const overTrash = lineIndexFromEvent(event) >= 0 && isInTrashZone(event);
                textarea.style.cursor = overTrash ? "pointer" : "text";
            });

            // Клик по корзине не должен ставить курсор в текст
            textarea.addEventListener("mousedown", (event) => {
                if (lineIndexFromEvent(event) >= 0 && isInTrashZone(event)) {
                    event.preventDefault();
                }
            });

            textarea.addEventListener("click", (event) => {
                const index = lineIndexFromEvent(event);
                if (index < 0) return;
                if (isInTrashZone(event)) {
                    event.preventDefault();
                    event.stopPropagation();
                    deleteLine(index);
                    return;
                }
                selectWidget.value = index + 1;
                selectWidget.callback?.(selectWidget.value);
                updateHighlight();
            });

            textarea.addEventListener("dblclick", (event) => {
                const index = lineIndexFromEvent(event);
                if (index < 0) return;
                event.preventDefault();
                event.stopPropagation();
                // Двойной клик по корзине не открывает окно редактирования
                if (isInTrashZone(event)) return;
                selectWidget.value = index + 1;
                selectWidget.callback?.(selectWidget.value);
                openLineEditor(node, stringsWidget, textarea, index, updateHighlight);
            });

            // Зелёная подсветка и счётчик следуют за текстовым курсором
            // при перемещении клавишами (стрелки, PageUp/PageDown, Home/End)
            const syncSelectToCaret = () => {
                const text = textarea.value;
                const caret = textarea.selectionDirection === "backward"
                    ? textarea.selectionStart
                    : textarea.selectionEnd;
                const lineNumber = text.slice(0, caret).split("\n").length;
                if (Number(selectWidget.value) === lineNumber) return;
                selectWidget.value = lineNumber;
                selectWidget.callback?.(selectWidget.value);
                updateHighlight();
            };

            const NAVIGATION_KEYS = new Set([
                "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
                "PageUp", "PageDown", "Home", "End",
            ]);
            textarea.addEventListener("keydown", (event) => {
                if (!NAVIGATION_KEYS.has(event.key)) return;
                // Курсор переместится уже после обработки клавиши браузером
                setTimeout(syncSelectToCaret, 0);
            });

            // Когда курсор уходит из текстового поля, пустые строки удаляются целиком.
            // Во время набора текста это не делается, чтобы Enter не стирал только что созданную строку.
            textarea.addEventListener("blur", () => {
                // Пока открыто окно редактирования, номера строк трогать нельзя
                if (document.querySelector(`[data-orex-string-editor="${node.id}"]`)) return;

                const currentLines = String(stringsWidget.value ?? "").split("\n");
                const keptLines = currentLines.filter((line) => line.trim() !== "");
                if (keptLines.length === currentLines.length) return;

                // Если пустые строки были выше выбранной, номер сдвигается, чтобы выбранная строка осталась той же
                const selected = Number(selectWidget.value) || 1;
                const removedAbove = currentLines
                    .slice(0, Math.max(0, selected - 1))
                    .filter((line) => line.trim() === "").length;
                if (removedAbove > 0) selectWidget.value = Math.max(1, selected - removedAbove);

                const updatedText = keptLines.join("\n");
                stringsWidget.value = updatedText;
                textarea.value = updatedText;
                stringsWidget.callback?.(updatedText);
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
                node.graph?.setDirtyCanvas(true, true);
                updateHighlight();
            });

            const originalOnRemoved = node.onRemoved;
            node.onRemoved = function () {
                document.querySelector(`[data-orex-string-editor="${node.id}"]`)?.remove();
                return originalOnRemoved?.apply(this, arguments);
            };

            updateHighlight();
        }, 100);
    },
});
