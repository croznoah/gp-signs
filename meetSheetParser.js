const STROKES = ["free", "back", "breast", "fly"];

export function correctName(name) {
    const string = String(name || "").replace(/[^a-zA-Z\s\-']/g, " ");
    return string
        .split(/\s+/)
        .map(word => word.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, ""))
        .filter(word => word.replace(/[^a-zA-Z]/g, "").length > 1)
        .join(" ")
        .trim();
}

export function checkStrokes(stroke) {
    return STROKES.includes(String(stroke || "").toLowerCase());
}

export function detectMeetSheet(lines, useocr = false) {
    const heattable = parseMeetSheetLines(lines, "heats", useocr);
    const entriestable = parseMeetSheetLines(lines, "entries", useocr);

    if (heattable.length < 1 && entriestable.length < 1) {
        return { format: "", table: [] };
    }

    return heattable.length >= entriestable.length
        ? { format: "heats", table: heattable }
        : { format: "entries", table: entriestable };
}

export function parseMeetSheetLines(lines, format, useocr = false) {
    const cleanLines = (lines || [])
        .map(line => normalizeOcrLine(String(line || "")))
        .filter(line => line.trim() !== "");

    if (format === "heats") {
        return parseHeatLines(cleanLines);
    }

    if (format === "entries") {
        return parseEntryLines(cleanLines, useocr);
    }

    return [];
}

function parseHeatLines(lines) {
    const swimmers = new Map();
    let currentStroke = false;

    for (const line of lines) {
        const nextStroke = eventStrokeFromLine(line);
        if (nextStroke !== null) {
            currentStroke = nextStroke;
            continue;
        }

        if (!currentStroke || currentStroke === "IM") continue;

        const person = parseHeatSwimmerLine(line);
        if (!person) continue;

        addSwimmer(swimmers, person.firstname, person.lastname, currentStroke);
    }

    return tableFromMap(swimmers);
}

function parseEntryLines(lines, useocr) {
    const swimmers = new Map();
    let currentKey = null;

    for (const line of lines) {
        const person = parseEntrySwimmerLine(line, useocr);
        if (person) {
            currentKey = addSwimmer(swimmers, person.firstname, person.lastname);
            continue;
        }

        const stroke = strokeFromLine(line);
        if (currentKey && stroke) {
            addStroke(swimmers.get(currentKey), stroke);
        }
    }

    return tableFromMap(swimmers);
}

function normalizeOcrLine(line) {
    return line
        .replace(/[|]/g, "I")
        .replace(/[“”]/g, "\"")
        .replace(/[‘’]/g, "'")
        .replace(/\bP\s*L\b/gi, "PL")
        .replace(/\s+/g, " ")
        .trim();
}

function eventStrokeFromLine(line) {
    const lower = line.toLowerCase();
    const looksLikeEvent = /\bevent\b|^\s*#\s*\d+\b/.test(lower);
    if (!looksLikeEvent) return null;
    if (/\brelay\b/.test(lower)) return false;
    if (/\b(im|lm)\b/.test(lower)) return "IM";
    return strokeFromLine(lower) || false;
}

function strokeFromLine(line) {
    const lower = String(line || "").toLowerCase();
    if (/\bfree(style)?\b/.test(lower)) return "free";
    if (/\bback(stroke)?\b/.test(lower)) return "back";
    if (/\bbreast(stroke)?\b/.test(lower)) return "breast";
    if (/\b(fly|butterfly)\b/.test(lower)) return "fly";
    return false;
}

function parseHeatSwimmerLine(line) {
    if (!hasTeamMarker(line)) return null;

    if (line.includes(",")) {
        const commaIdx = line.indexOf(",");
        const beforeComma = line.slice(0, commaIdx);
        const afterComma = line.slice(commaIdx + 1);
        const lastname = correctName(beforeComma.replace(/^(?:\d+\s+){1,4}/, ""));
        const firstname = correctName(afterComma.split(/\b(?:Parklawn|PL)\b/i)[0]);

        if (!isLikelyName(firstname, lastname)) return null;
        return { firstname, lastname };
    }

    const teamSplit = line.split(/\b(?:Parklawn|PL)\b/i)[0];
    const match = teamSplit.match(/^\s*(?:\d+\s+){1,4}([A-Za-z][A-Za-z'-]+)\s+(.+?)\s+\d{1,2}\s*$/);
    if (!match) return null;

    const lastname = correctName(match[1]);
    const firstname = correctName(match[2]);

    if (!isLikelyName(firstname, lastname)) return null;
    return { firstname, lastname };
}

function parseEntrySwimmerLine(line, useocr) {
    if (!hasTeamMarker(line) || !line.includes(",") || !/\([^)]*\d/.test(line)) return null;
    if (strokeFromLine(line) || /\bevent\b|heat|lane|relay|seed/i.test(line)) return null;

    const teamSplit = line.split(/\b(?:Parklawn|PL)\b/i)[0];
    const commaIdx = teamSplit.indexOf(",");
    if (commaIdx === -1) return null;

    let lastname = correctName(teamSplit.slice(0, commaIdx));
    let firstname = correctName(teamSplit.slice(commaIdx + 1).replace(/\([^)]*$/, ""));

    if (useocr) {
        lastname = lastname.replace(/(?<![a-zA-Z])-(?![a-zA-Z])/g, "").trim();
        firstname = firstname.replace(/(?<![a-zA-Z])-(?![a-zA-Z])/g, "").trim();
    }

    if (!isLikelyName(firstname, lastname)) return null;
    return { firstname, lastname };
}

function hasTeamMarker(line) {
    return /\b(?:Parklawn|PL)\b/i.test(line);
}

function isLikelyName(firstname, lastname) {
    return /^[A-Za-z][A-Za-z\s\-']*$/.test(firstname)
        && /^[A-Za-z][A-Za-z\s\-']*$/.test(lastname)
        && firstname.replace(/[^A-Za-z]/g, "").length >= 2
        && lastname.replace(/[^A-Za-z]/g, "").length >= 2;
}

function nameKey(firstname, lastname) {
    return `${lastname},${firstname}`
        .toLowerCase()
        .replace(/[^a-z]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function addSwimmer(swimmers, firstname, lastname, stroke = null) {
    const key = nameKey(firstname, lastname);
    if (!key) return null;

    if (!swimmers.has(key)) {
        swimmers.set(key, {
            firstname: titleCaseName(firstname),
            lastname: titleCaseName(lastname),
            strokes: []
        });
    }

    if (stroke) {
        addStroke(swimmers.get(key), stroke);
    }

    return key;
}

function addStroke(swimmer, stroke) {
    if (swimmer && checkStrokes(stroke) && !swimmer.strokes.includes(stroke)) {
        swimmer.strokes.push(stroke);
    }
}

function tableFromMap(swimmers) {
    return [...swimmers.values()].map(swimmer => [
        swimmer.firstname,
        swimmer.lastname,
        swimmer.strokes.filter(checkStrokes)
    ]);
}

function titleCaseName(name) {
    return String(name || "")
        .toLowerCase()
        .split(/(\s+|-|')/)
        .map(part => /^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part)
        .join("")
        .trim();
}
