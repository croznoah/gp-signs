export function fitFirstNameFontSize(firstName) {
    const characterCount = Math.max(Array.from(String(firstName || "").trim()).length, 1);
    const maxTextWidth = 820;
    const estimatedCharacterWidth = 0.55;
    const fittedSize = Math.floor(maxTextWidth / (characterCount * estimatedCharacterWidth));
    return Math.max(72, Math.min(220, fittedSize));
}

function wrapTextLines(text) {
    const words = text.split(/\s+/).filter(Boolean);
    let lines = [];

    if (words.length === 1) {
        lines = [words[0]];
    } else if (words.length === 2) {
        lines = (words.join(" ").length > 7) ? words : [words.join(" ")];
    } else if (words.length === 3) {
        if (text.length > 22) lines = words;
        else if (text.length > 11) lines = [`${words[0]} ${words[1]}`, words[2]];
        else lines = [words.join(" ")];
    } else {
        const maxCharsPerLine = Math.max(10, Math.ceil(text.length / 4));
        let currentLine = "";
        for (const word of words) {
            if (!currentLine) currentLine = word;
            else if (`${currentLine} ${word}`.length <= maxCharsPerLine) currentLine += ` ${word}`;
            else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        if (currentLine) lines.push(currentLine);

        while (lines.length > 4) {
            let shortestPairLength = Infinity;
            let shortestPairIndex = 0;
            for (let index = 0; index < lines.length - 1; index++) {
                const pairLength = lines[index].length + lines[index + 1].length;
                if (pairLength < shortestPairLength) {
                    shortestPairLength = pairLength;
                    shortestPairIndex = index;
                }
            }
            lines[shortestPairIndex] += ` ${lines[shortestPairIndex + 1]}`;
            lines.splice(shortestPairIndex + 1, 1);
        }
    }

    return lines.length > 0 ? lines : [""];
}

function layoutText(text, { maxWidth, maxHeight, maxFontSize, minFontSize, centerY }) {
    const lines = wrapTextLines(text);

    const maxLineLength = Math.max(...lines.map((line) => line.length), 1);
    const lineSpacingFactor = 0.88;
    const widthSize = Math.floor(maxWidth / (maxLineLength * 0.55));
    const heightSize = lines.length === 1
        ? maxHeight
        : Math.floor(maxHeight / ((lines.length - 1) * lineSpacingFactor + 1));
    const fontSize = Math.max(minFontSize, Math.min(maxFontSize, widthSize, heightSize));
    const lineHeight = fontSize * lineSpacingFactor;
    const totalTextHeight = (lines.length - 1) * lineHeight;
    const blockHeight = fontSize + totalTextHeight;

    return {
        lines,
        fontSize,
        lineHeight,
        startY: centerY - (totalTextHeight / 2) + (fontSize * 0.35),
        topY: centerY - (blockHeight / 2),
        bottomY: centerY + (blockHeight / 2),
    };
}

export function layoutAwardText(award, showFullName) {
    const awardText = String(award || "SPECIAL AWARD").toUpperCase().trim();
    return layoutText(awardText, {
        maxWidth: 880,
        maxHeight: showFullName ? 420 : 540,
        maxFontSize: 180,
        minFontSize: 36,
        centerY: showFullName ? 370 : 425,
    });
}

export function layoutFirstNameText(firstName, { topY = 270, bottomY = 545 } = {}) {
    const safeTopY = Math.min(topY, bottomY);
    const safeBottomY = Math.max(topY, bottomY);
    return layoutText(String(firstName || "").toUpperCase().trim(), {
        maxWidth: 820,
        maxHeight: safeBottomY - safeTopY,
        maxFontSize: 220,
        minFontSize: 64,
        centerY: (safeTopY + safeBottomY) / 2,
    });
}
