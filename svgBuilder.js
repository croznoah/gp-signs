import embeddedAssetsSource from "./assets_embedded.js?raw";
import { layoutAwardText, layoutFirstNameText } from "./textSizing.js";

export { fitFirstNameFontSize } from "./textSizing.js";

function readEmbeddedAsset(name) {
    return embeddedAssetsSource.match(new RegExp(`const ${name} = "([^"]+)"`))?.[1] || "";
}

export const TEXTURE_B64 = readEmbeddedAsset("TEXTURE_B64");
export const FONT_CAPS_B64 = readEmbeddedAsset("FONT_CAPS_B64");
export const FONT_MINI_B64 = readEmbeddedAsset("FONT_MINI_B64");

// Design System Colors
export const colors = [
    "#906cc4",
    "#ff5c60",
    "#ffae30",
    "#fee250",
    "#2ebf83",
    "#0570e5",
    "#8A93FF",
    "#3debd9",
    "#009bb0",
    "#ac0194"
];

// Stroke definitions
export const strokeDetails = {
    free: { text: "When you swim free<br>first place you'll be!", icon: "0" },
    back: { text: "When you swim back<br>you show no lack!", icon: "1" },
    breast: { text: "When you swim breast<br>you are the best!", icon: "2" },
    fly: { text: "When you swim fly<br>you wave bye-bye!", icon: "3" }
};

function escapeSvgText(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Returns a <rect> clipped to the given clipPath id, filled with color + texture overlay
// This replicates CSS `background-clip: text` behavior in pure SVG
export function texEl(clipId, color, texPatId, W, H, opacity) {
    return `
        <rect x="0" y="0" width="${W}" height="${H}" fill="${color}" clip-path="url(#${clipId})"/>
        <rect x="0" y="0" width="${W}" height="${H}" fill="url(#${texPatId})" clip-path="url(#${clipId})" opacity="${opacity !== undefined ? opacity : 0.45}"/>`;
}

// Build shared defs block. For preview (inline SVG), fonts come from document CSS.
// For export (standalone SVG file), embed fonts as base64.
export function svgDefs(swimmer, forExport) {
    const sid = swimmer.id;
    const fontStyle = forExport ? `<style>
        @font-face{font-family:'Marker Sans';src:url('${FONT_CAPS_B64}') format('truetype');}
        @font-face{font-family:'Marker Sans Mini';src:url('${FONT_MINI_B64}') format('truetype');}
    </style>` : '';

    return `<defs>
        ${fontStyle}
        <pattern id="tp${sid}" patternUnits="userSpaceOnUse" width="70" height="70">
            <image href="${TEXTURE_B64}" x="0" y="0" width="70" height="70" preserveAspectRatio="xMidYMid slice"/>
        </pattern>
        <filter id="ho${sid}" color-interpolation-filters="sRGB">
            <feColorMatrix type="hueRotate" values="${swimmer.outerhue}"/>
        </filter>
        <filter id="hi${sid}" color-interpolation-filters="sRGB">
            <feColorMatrix type="hueRotate" values="${swimmer.innerhue}"/>
        </filter>
    </defs>`;
}

// Build front SVG string
function formatNameForDisplay(name) {
    if (!name) return "";
    const str = name.trim();
    if (str === str.toUpperCase() || str === str.toLowerCase()) {
        return str.replace(/\b\w+/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
    }
    return str;
}

// Build front SVG string
export function buildFrontSVG(swimmer, forExport, pathPrefix = "") {
    const W = 1100, H = 850;
    const sid = swimmer.id;
    const sfx = forExport ? 'e' : 'p'; // 'p'review vs 'e'xport namespace
    const cls = forExport ? '' : 'class="front-svg"';

    if (swimmer.isPaperPlate) {
        const awardText = (swimmer.award || swimmer.firstname || "SPECIAL AWARD").toUpperCase().trim();
        const rawFullName = (swimmer.fullname || `${swimmer.firstname || ''} ${swimmer.lastname || ''}`).trim();
        const showFullName = rawFullName.length > 0 && !swimmer.isHeaderPlate;
        const fullNameText = showFullName ? formatNameForDisplay(rawFullName) : '';

        const { lines, fontSize, lineHeight, startY } = layoutAwardText(awardText, showFullName);

        let awardClips = '', awardEls = '';
        lines.forEach((line, idx) => {
            const lineY = startY + (idx * lineHeight);
            const clipId = `cap${sfx}${sid}_${idx}`;
            const safeLine = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            awardClips += `
                <clipPath id="${clipId}">
                    <text x="${W / 2}" y="${lineY}" font-family="Marker Sans" font-size="${fontSize}" text-anchor="middle" letter-spacing="0.9">${safeLine}</text>
                </clipPath>`;
            awardEls += texEl(clipId, swimmer.namecolor || '#000000', `tp${sid}`, W, H);
        });

        // Bottom Swimmer Name (Marker Sans Mini) placed centered at Y=680 (moved up, not all caps)
        let nameClip = '', nameEl = '';
        if (showFullName) {
            let nameFontSize = Math.min(58, Math.max(34, Math.floor(880 / (fullNameText.length * 0.55))));
            const nameY = 680;
            const nameClipId = `cnmini${sfx}${sid}`;
            const safeName = fullNameText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            nameClip = `
                <clipPath id="${nameClipId}">
                    <text x="${W / 2}" y="${nameY}" font-family="Marker Sans Mini" font-size="${nameFontSize}" text-anchor="middle">${safeName}</text>
                </clipPath>`;
            nameEl = texEl(nameClipId, swimmer.stroketopcolor || '#000000', `tp${sid}`, W, H);
        }

        return `<svg ${cls} viewBox="0 0 ${W} ${H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            ${svgDefs(swimmer, forExport)}
            <defs>
                ${awardClips}
                ${nameClip}
            </defs>
            <rect width="${W}" height="${H}" fill="white"/>
            <image href="${pathPrefix}borders/outer/${swimmer.outerborder || 1}.png" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" filter="url(#ho${sid})"/>
            <image href="${pathPrefix}borders/inner/${swimmer.innerborder || 1}.png" x="${W*0.01}" y="${H*0.01}" width="${W*0.98}" height="${H*0.98}" preserveAspectRatio="none" filter="url(#hi${sid})"/>
            ${awardEls}
            ${nameEl}
        </svg>`;
    }

    const strokeTop = swimmer.strokes[0] ? strokeDetails[swimmer.strokes[0]] : null;
    const strokeBottom = swimmer.strokes[1] ? strokeDetails[swimmer.strokes[1]] : null;

    // --- Name text layout ---
    // Keep the GP-sign name entirely between the bottom of the top stroke
    // graphic and the top of the bottom stroke graphic. Paper plates use their
    // separate award layout above and are intentionally unaffected.
    const topStrokeSize = Number(swimmer.stroketopsize) || 50;
    const bottomStrokeSize = Number(swimmer.strokebottomsize) || 50;
    const topStrokeIconSize = topStrokeSize * 2.17;
    const topGraphicBottom = Math.max(
        (H * 0.18) + (topStrokeIconSize * 0.85),
        (H * 0.18) + (topStrokeSize * 2.1)
    ) + 10;
    const bottomGraphicTop = (H * 0.82) - (bottomStrokeSize * 2.17) - 35 - 10;
    const firstNameLayout = layoutFirstNameText(swimmer.firstname, {
        topY: topGraphicBottom,
        bottomY: bottomGraphicTop,
    });
    let firstNameClips = "";
    let firstNameEls = "";
    firstNameLayout.lines.forEach((line, index) => {
        const lineY = firstNameLayout.startY + (index * firstNameLayout.lineHeight);
        const clipId = `cn${sfx}${sid}_${index}`;
        firstNameClips += `
            <clipPath id="${clipId}">
                <text x="${W / 2}" y="${lineY}" font-family="Marker Sans" font-size="${firstNameLayout.fontSize}" text-anchor="middle" letter-spacing="0.9">${escapeSvgText(line)}</text>
            </clipPath>`;
        firstNameEls += texEl(clipId, swimmer.namecolor, `tp${sid}`, W, H);
    });

    // --- Graphic icon layout ---
    const grX = W * 0.14;
    const grY = H * 0.18 + swimmer.graphicsize * 0.85;

    // --- Stroke top layout ---
    let stTopClips = '', stTopEls = '';
    if (strokeTop) {
        const lines = strokeTop.text.split('<br>');
        const iSz = swimmer.stroketopsize * 2.17;
        const tSz = swimmer.stroketopsize;
        const bx = W * 0.86 - 520;
        const by = H * 0.18;
        const textOffset = iSz * 1.0;
        stTopClips = `
            <clipPath id="csti${sfx}${sid}">
                <text x="${bx}" y="${by + iSz * 0.85}" font-family="Marker Sans Mini" font-size="${iSz}">${strokeTop.icon}</text>
            </clipPath>
            <clipPath id="cst1${sfx}${sid}">
                <text x="${bx + textOffset}" y="${by + tSz}" font-family="Marker Sans Mini" font-size="${tSz}">${lines[0] || ''}</text>
            </clipPath>
            <clipPath id="cst2${sfx}${sid}">
                <text x="${bx + textOffset}" y="${by + tSz * 2.1}" font-family="Marker Sans Mini" font-size="${tSz}">${lines[1] || ''}</text>
            </clipPath>`;
        stTopEls = `
            ${texEl(`csti${sfx}${sid}`, swimmer.stroketopcolor, `tp${sid}`, W, H)}
            ${texEl(`cst1${sfx}${sid}`, swimmer.stroketopcolor, `tp${sid}`, W, H)}
            ${texEl(`cst2${sfx}${sid}`, swimmer.stroketopcolor, `tp${sid}`, W, H)}`;
    }

    // --- Stroke bottom layout ---
    let stBotClips = '', stBotEls = '';
    if (strokeBottom) {
        const lines = strokeBottom.text.split('<br>');
        const iSz = swimmer.strokebottomsize * 2.17;
        const tSz = swimmer.strokebottomsize;
        const bx = W * 0.14;
        const by = H * 0.82 - iSz - 35;
        const textOffset = iSz * 1.0;
        stBotClips = `
            <clipPath id="csbi${sfx}${sid}">
                <text x="${bx}" y="${by + iSz * 0.85}" font-family="Marker Sans Mini" font-size="${iSz}">${strokeBottom.icon}</text>
            </clipPath>
            <clipPath id="csb1${sfx}${sid}">
                <text x="${bx + textOffset}" y="${by + tSz}" font-family="Marker Sans Mini" font-size="${tSz}">${lines[0] || ''}</text>
            </clipPath>
            <clipPath id="csb2${sfx}${sid}">
                <text x="${bx + textOffset}" y="${by + tSz * 2.1}" font-family="Marker Sans Mini" font-size="${tSz}">${lines[1] || ''}</text>
            </clipPath>`;
        stBotEls = `
            ${texEl(`csbi${sfx}${sid}`, swimmer.strokebottomcolor, `tp${sid}`, W, H)}
            ${texEl(`csb1${sfx}${sid}`, swimmer.strokebottomcolor, `tp${sid}`, W, H)}
            ${texEl(`csb2${sfx}${sid}`, swimmer.strokebottomcolor, `tp${sid}`, W, H)}`;
    }

    const sigSVG = swimmer.showSignature
        ? `<image href="${pathPrefix}borders/lovegp.png" x="${W * 0.70}" y="${H * 0.70}" height="${swimmer.signaturesize}" preserveAspectRatio="xMidYMid meet"/>`
        : '';

    return `<svg ${cls} viewBox="0 0 ${W} ${H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        ${svgDefs(swimmer, forExport)}
        <defs>
            ${firstNameClips}
            <clipPath id="cg${sfx}${sid}">
                <text x="${grX}" y="${grY}" font-family="Marker Sans Mini" font-size="${swimmer.graphicsize}">${swimmer.randomgraphic}</text>
            </clipPath>
            ${stTopClips}
            ${stBotClips}
        </defs>
        <rect width="${W}" height="${H}" fill="white"/>
        <image href="${pathPrefix}borders/outer/${swimmer.outerborder}.png" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" filter="url(#ho${sid})"/>
        <image href="${pathPrefix}borders/inner/${swimmer.innerborder}.png" x="${W*0.01}" y="${H*0.01}" width="${W*0.98}" height="${H*0.98}" preserveAspectRatio="none" filter="url(#hi${sid})"/>
        ${firstNameEls}
        ${texEl(`cg${sfx}${sid}`, swimmer.graphiccolor, `tp${sid}`, W, H)}
        ${stTopEls}
        ${stBotEls}
        ${sigSVG}
    </svg>`;
}

// Build back SVG string
export function buildBackSVG(swimmer, forExport, pathPrefix = "") {
    const W = 1100, H = 850;
    const sid = swimmer.id;
    const sfx = forExport ? 'e' : 'p';
    const cls = forExport ? '' : 'class="back-svg"';
    const lastNameY = H / 2 + 160 * 0.35;

    return `<svg ${cls} viewBox="0 0 ${W} ${H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        ${svgDefs(swimmer, forExport)}
        <defs>
            <clipPath id="cl${sfx}${sid}">
                <text x="${W/2}" y="${lastNameY}" font-family="Marker Sans" font-size="160" text-anchor="middle" letter-spacing="0.9">${swimmer.lastname.toUpperCase()}</text>
            </clipPath>
        </defs>
        <rect width="${W}" height="${H}" fill="white"/>
        <image href="${pathPrefix}borders/outer/${swimmer.outerborder}.png" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" filter="url(#ho${sid})"/>
        <image href="${pathPrefix}borders/inner/${swimmer.innerborder}.png" x="${W*0.01}" y="${H*0.01}" width="${W*0.98}" height="${H*0.98}" preserveAspectRatio="none" filter="url(#hi${sid})"/>
        ${texEl(`cl${sfx}${sid}`, '#000000', `tp${sid}`, W, H)}
    </svg>`;
}
