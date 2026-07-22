// Character coverage read from the bundled Marker Sans font files.
// Keep this list in sync if either custom font is replaced.
const FONT_RANGES = {
    caps: [
        [0x20, 0x23], [0x26, 0x27], [0x2c, 0x2f], [0x30, 0x3b], [0x3f, 0x3f],
        [0x41, 0x5a], [0x61, 0x7a], [0x7e, 0x7e], [0xa0, 0xa0],
        [0x2010, 0x2010], [0x2018, 0x201a], [0x201c, 0x201e]
    ],
    mini: [
        [0x20, 0x23], [0x27, 0x27], [0x2c, 0x3b], [0x3f, 0x3f],
        [0x41, 0x5a], [0x61, 0x7a], [0x7e, 0x7e], [0xa0, 0xa0],
        [0x2018, 0x201a], [0x201c, 0x201e]
    ]
};

function isSupported(character, font) {
    const codePoint = character.codePointAt(0);
    return FONT_RANGES[font].some(([start, end]) => codePoint >= start && codePoint <= end);
}

export function getUnsupportedCharacters(value, font) {
    return [...new Set([...String(value || "")].filter(character => !isSupported(character, font)))];
}

export function getFontFallbackWarnings(swimmer) {
    const fields = swimmer.isPaperPlate
        ? [
            { label: "Award title", value: (swimmer.award || swimmer.firstname || "SPECIAL AWARD").toUpperCase().trim(), font: "caps", fontName: "GP Sans Caps" },
            { label: "Swimmer name", value: swimmer.isHeaderPlate ? "" : (swimmer.fullname || `${swimmer.firstname || ""} ${swimmer.lastname || ""}`).trim(), font: "mini", fontName: "GP Sans Mini" }
        ]
        : [
            { label: "First name", value: swimmer.firstname, font: "caps", fontName: "GP Sans Caps" }
        ];

    return fields.flatMap(({ label, value, font, fontName }) => {
        const characters = getUnsupportedCharacters(value, font);
        return characters.length ? [{ label, fontName, characters }] : [];
    });
}
