import { app } from "../../scripts/app.js";

const presets = {
    Red: "#ff0000", "Red Orange": "#ff5500", "Orange Red": "#ffaa00",
    Yellow: "#ffff00", "Yellow Green": "#aaff00", "Green Yellow": "#55ff00",
    Green: "#00ff00", "Green Cyan": "#00ff55", "Cyan Green": "#00ffaa",
    Cyan: "#00ffff", "Cyan Blue": "#00aaff", "Blue Cyan": "#0055ff",
    Blue: "#0000ff", "Blue Violet": "#5500ff", "Violet Blue": "#aa00ff",
    Violet: "#ff00ff", "Violet Red": "#ff00aa", "Red Violet": "#ff0055",
    White: "#ffffff", Gray: "#808080", Black: "#000000",
};

function normalizeColor(value) {
    const text = String(value ?? "").trim();
    const name = Object.keys(presets).find((item) => item.toLowerCase() === text.toLowerCase());
    return presets[name] || (/^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : "#808080");
}

function openPalette(widget, node, event) {
    document.querySelector(".orex-outpaint-palette")?.remove();

    const panel = document.createElement("div");
    panel.className = "orex-outpaint-palette";
    Object.assign(panel.style, {
        position: "fixed", zIndex: 100000, width: "292px", padding: "14px",
        color: "#f5f5f5", background: "#292929", border: "1px solid #555",
        borderRadius: "8px", boxShadow: "0 12px 32px #000b",
        font: "13px 'Segoe UI', sans-serif", boxSizing: "border-box",
    });

    const title = document.createElement("div");
    title.textContent = "Choose a color";
    Object.assign(title.style, { fontSize: "15px", fontWeight: "600", marginBottom: "12px" });
    panel.append(title);

    const grid = document.createElement("div");
    Object.assign(grid.style, {
        display: "grid", gridTemplateColumns: "repeat(7, 30px)", gap: "7px",
        paddingBottom: "13px", borderBottom: "1px solid #484848",
    });
    panel.append(grid);

    const setColor = (color) => {
        widget.value = normalizeColor(color);
        app.graph.setDirtyCanvas(true, true);
    };

    for (const [name, color] of Object.entries(presets)) {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.title = name;
        Object.assign(swatch.style, {
            width: "30px", height: "30px", padding: "0", cursor: "pointer",
            background: color, border: color === widget.value ? "3px solid #60cdff" : "1px solid #888",
            borderRadius: "4px", boxSizing: "border-box",
        });
        swatch.onclick = () => { setColor(color); panel.remove(); };
        grid.append(swatch);
    }

    const controls = document.createElement("div");
    Object.assign(controls.style, { display: "flex", gap: "8px", marginTop: "13px" });

    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = normalizeColor(widget.value);
    picker.title = "Open the Windows color picker";
    Object.assign(picker.style, {
        flex: "1", height: "36px", padding: "2px", cursor: "pointer",
        border: "1px solid #686868", borderRadius: "4px", background: "#333",
    });
    picker.oninput = () => setColor(picker.value);
    controls.append(picker);

    if (window.EyeDropper) {
        const eyedropper = document.createElement("button");
        eyedropper.type = "button";
        eyedropper.textContent = "⌾  Eyedropper";
        eyedropper.title = "Pick a color anywhere on the screen";
        Object.assign(eyedropper.style, {
            height: "36px", padding: "0 12px", cursor: "pointer", color: "#fff",
            background: "#3b3b3b", border: "1px solid #686868", borderRadius: "4px",
            font: "13px 'Segoe UI', sans-serif",
        });
        eyedropper.onclick = async () => {
            try {
                setColor((await new window.EyeDropper().open()).sRGBHex);
                panel.remove();
            } catch (_) { /* Cancelled by the user. */ }
        };
        controls.append(eyedropper);
    }
    panel.append(controls);

    document.body.append(panel);
    const x = Math.min(event?.clientX ?? 20, innerWidth - panel.offsetWidth - 10);
    const y = Math.min(event?.clientY ?? 20, innerHeight - panel.offsetHeight - 10);
    panel.style.left = `${Math.max(10, x)}px`;
    panel.style.top = `${Math.max(10, y)}px`;

    const close = (e) => {
        if (!panel.contains(e.target)) {
            panel.remove();
            document.removeEventListener("pointerdown", close, true);
        }
    };
    setTimeout(() => document.addEventListener("pointerdown", close, true));
}

app.registerExtension({
    name: "OreX.PadImageForOutpainting",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "OreXPadImageForOutpainting") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const oldWidget = this.widgets?.find((item) => item.name === "color");
            if (!oldWidget) return;

            const index = this.widgets.indexOf(oldWidget);
            const colorWidget = {
                name: "color",
                type: "custom",
                value: normalizeColor(oldWidget.value),
                options: oldWidget.options,
                serializeValue() { return this.value; },
                computeSize(width) { return [width, 26]; },
                draw(ctx, node, width, y, height) {
                    ctx.save();
                    ctx.fillStyle = this.value;
                    ctx.strokeStyle = "#b0b0b0";
                    ctx.lineWidth = 1;
                    ctx.fillRect(width - 45, y + 5, 22, height - 10);
                    ctx.strokeRect(width - 45, y + 5, 22, height - 10);
                    ctx.restore();
                },
                mouse(event, pos, node) {
                    const overSwatch = pos[0] >= node.size[0] - 50 && pos[0] <= node.size[0] - 18;
                    if (overSwatch && (event.type === "pointerdown" || event.type === "mousedown")) {
                        event.preventDefault?.();
                        event.stopPropagation?.();
                        openPalette(this, node, event);
                    }
                    return true;
                },
            };

            this.widgets.splice(index, 1, colorWidget);
        };
    },
});
