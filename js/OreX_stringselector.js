import { app } from "../../scripts/app.js";

const NODE_CLASS = "orex String Selector";

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
        currentLines.splice(lineIndex, 1, editor.value);
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

            const updateHighlight = () => {
                if (!document.body.contains(textarea)) return;
                const text = String(stringsWidget.value ?? "");
                const lines = text.split("\n");
                if (!text.trim()) {
                    textarea.style.backgroundImage = "none";
                    return;
                }

                const selected = Number(selectWidget.value) || 1;
                const index = Math.max(0, selected - 1) % lines.length;
                const { lineHeight, paddingTop } = lineMetrics();
                const startY = paddingTop + index * lineHeight;
                textarea.style.backgroundImage = "linear-gradient(rgba(0,200,50,.35),rgba(0,200,50,.35))";
                textarea.style.backgroundSize = `100% ${lineHeight}px`;
                textarea.style.backgroundPosition = `0 ${startY}px`;
            };

            const lineIndexFromEvent = (event) => {
                const text = String(stringsWidget.value ?? "");
                const lines = text.split("\n");
                if (!text.trim()) return -1;
                const rect = textarea.getBoundingClientRect();
                const scaleY = textarea.offsetHeight > 0 ? rect.height / textarea.offsetHeight : 1;
                const { lineHeight, paddingTop } = lineMetrics();
                const localY = (event.clientY - rect.top) / scaleY + textarea.scrollTop;
                const index = Math.floor((localY - paddingTop) / lineHeight);
                return index >= 0 && index < lines.length ? index : -1;
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

            textarea.addEventListener("click", (event) => {
                const index = lineIndexFromEvent(event);
                if (index < 0) return;
                selectWidget.value = index + 1;
                selectWidget.callback?.(selectWidget.value);
                updateHighlight();
            });

            textarea.addEventListener("dblclick", (event) => {
                const index = lineIndexFromEvent(event);
                if (index < 0) return;
                event.preventDefault();
                event.stopPropagation();
                selectWidget.value = index + 1;
                selectWidget.callback?.(selectWidget.value);
                openLineEditor(node, stringsWidget, textarea, index, updateHighlight);
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
