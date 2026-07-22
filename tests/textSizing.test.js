import assert from "node:assert/strict";
import test from "node:test";
import { fitFirstNameFontSize, layoutAwardText, layoutFirstNameText } from "../textSizing.js";

test("fitFirstNameFontSize stays visible for long edited names", () => {
    assert.equal(fitFirstNameFontSize("Avery"), 220);
    assert.equal(fitFirstNameFontSize("A very unusually long edited first name"), 72);
});

test("layoutAwardText uses the same bounded layout for live edits and renders", () => {
    const layout = layoutAwardText("A Remarkably Thoughtful Teammate Award", true);

    assert.deepEqual(layout.lines, ["A REMARKABLY", "THOUGHTFUL", "TEAMMATE", "AWARD"]);
    assert.ok(layout.fontSize >= 36 && layout.fontSize <= 180);
    assert.ok(layout.startY > 0);
});

test("layoutFirstNameText wraps edited names through the shared multi-line fitter", () => {
    const layout = layoutFirstNameText("A Very Long First Name", {
        topY: 270,
        bottomY: 545,
    });

    assert.deepEqual(layout.lines, ["A VERY", "LONG FIRST", "NAME"]);
    assert.ok(layout.fontSize >= 64 && layout.fontSize <= 220);
    assert.ok(layout.topY >= 270);
    assert.ok(layout.bottomY <= 545);
});

test("paper-plate award bounds remain independent from GP-sign name bounds", () => {
    const layout = layoutAwardText("A Remarkably Thoughtful Teammate Award", true);

    assert.ok(layout.topY < 270);
    assert.ok(layout.bottomY > 545);
});
