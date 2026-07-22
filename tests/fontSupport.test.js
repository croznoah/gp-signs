import test from "node:test";
import assert from "node:assert/strict";
import { getFontFallbackWarnings, getUnsupportedCharacters } from "../fontSupport.js";

test("reports characters outside the exact GP Sans Caps coverage", () => {
    assert.deepEqual(getUnsupportedCharacters("Zoë 0", "caps"), ["ë"]);
});

test("reports characters outside the exact GP Sans Mini coverage", () => {
    assert.deepEqual(getUnsupportedCharacters("A&B 0", "mini"), ["&"]);
});

test("checks the font used by each paper-plate field", () => {
    const warnings = getFontFallbackWarnings({
        isPaperPlate: true,
        award: "MVP 0 Friend",
        fullname: "Zoë",
        isHeaderPlate: false
    });

    assert.deepEqual(warnings, [
        { label: "Swimmer name", fontName: "GP Sans Mini", characters: ["ë"] }
    ]);
});

test("does not check the GP-sign back-page last name", () => {
    assert.deepEqual(getFontFallbackWarnings({
        isPaperPlate: false,
        firstname: "Avery",
        lastname: "Zoë"
    }), []);
});
