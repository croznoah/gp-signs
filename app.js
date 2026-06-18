import "./style.css";
import embeddedAssetsSource from "./assets_embedded.js?raw";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import tesseractCoreSrc from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import tesseractWorkerSrc from "tesseract.js/dist/worker.min.js?url";
import { createWorker } from "tesseract.js";
import { jsPDF } from "jspdf";

// Configure pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc;

function readEmbeddedAsset(name) {
    return embeddedAssetsSource.match(new RegExp(`const ${name} = "([^"]+)"`))?.[1] || "";
}

const TEXTURE_B64 = readEmbeddedAsset("TEXTURE_B64");
const FONT_CAPS_B64 = readEmbeddedAsset("FONT_CAPS_B64");
const FONT_MINI_B64 = readEmbeddedAsset("FONT_MINI_B64");
const resolveAssetUrl = (assetUrl) => new URL(assetUrl, window.location.href).href;
const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
const tesseractLangPath = new URL("assets/", appBaseUrl).href;
let ocrWorkerPoolPromise = null;

function loadPDFDocument(fileBuffer) {
    const data = new Uint8Array(fileBuffer.slice(0));
    return pdfjsLib.getDocument({ data }).promise;
}

// Design System Colors
const colors = [
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
const strokeDetails = {
    free: { text: "When you swim free<br>first place you'll be!", icon: "0" },
    back: { text: "When you swim back<br>you show no lack!", icon: "1" },
    breast: { text: "When you swim breast<br>you are the best!", icon: "2" },
    fly: { text: "When you swim fly<br>you wave bye-bye!", icon: "3" }
};

// Global App State
let state = {
    swimmers: [],
    importing: false,
    meetInfo: "Parklawn Sign Generator"
};

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
    loadProject();
    setupEventListeners();
});

// Setup global event listeners
function setupEventListeners() {
    const pdfInput = document.getElementById('pdf-input');
    if (pdfInput) {
        pdfInput.addEventListener('change', handlePDFUpload);
    }
}

// Load project from localStorage (Disabled for fresh starts)
function loadProject() {
    state.swimmers = [];
    showScreen('upload-screen');
}

// Save project to localStorage (Disabled for fresh starts)
function saveProject() {
    updateSwimmerCount();
}

// Screen management
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const activeScreen = document.getElementById(screenId);
    if (activeScreen) {
        activeScreen.classList.add('active');
    }
}

// Go to upload screen
function goToUpload() {
    showScreen('upload-screen');
    // Hide progress bar and reset file input
    const container = document.getElementById('progress-container');
    if (container) container.classList.add('hidden');
    document.getElementById('pdf-input').value = '';
    const uploadZone = document.querySelector('.upload-zone');
    if (uploadZone) uploadZone.classList.remove('hidden');

    // Reset meet info
    state.meetInfo = "Parklawn Sign Generator";
    const meetInput = document.getElementById('meet-info-input');
    if (meetInput) {
        meetInput.value = "Parklawn Sign Generator";
    }
}

// Update the swimmer count badge in header
function updateSwimmerCount() {
    const badge = document.getElementById('swimmer-count-badge');
    if (badge) {
        badge.innerText = `${state.swimmers.length} Swimmer${state.swimmers.length === 1 ? '' : 's'}`;
    }
}

// PDF Upload Handler
async function handlePDFUpload(e) {
    const file = e.target.files[0];
    if (!file || file.type !== "application/pdf") {
        alert("Please select a valid PDF file.");
        return;
    }

    state.importing = true;
    state.uploadedFileName = file.name;
    showProgress("Preparing meet sheet extraction...", 0);

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = async () => {
        const arrayBuffer = reader.result;
        try {
            await extractText(arrayBuffer);
        } catch (err) {
            console.warn("Direct text layer parsing failed. Automatically running OCR fallback...", err);
            try {
                showProgress("Text layer extraction failed. Running Tesseract OCR...", 35);
                await runOCR(arrayBuffer);
            } catch (ocrErr) {
                console.error("OCR extraction also failed:", ocrErr);
                showProgressError("The Meet Sheet could not be parsed. Make sure it is a Parklawn heat or entry sheet.");
            }
        }
    };
}

// Show progress container and update text/fill
function showProgress(text, percentage) {
    const container = document.getElementById('progress-container');
    const barFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const uploadZone = document.querySelector('.upload-zone');

    if (uploadZone) uploadZone.classList.add('hidden');
    if (container) container.classList.remove('hidden');
    if (barFill) {
        barFill.classList.remove('error');
        barFill.style.width = `${percentage}%`;
    }
    if (progressText) progressText.innerText = text;
}

// Show error in progress container
function showProgressError(message) {
    const progressText = document.getElementById('progress-text');
    const barFill = document.getElementById('progress-bar-fill');
    const uploadZone = document.querySelector('.upload-zone');

    if (uploadZone) uploadZone.classList.remove('hidden');
    if (progressText) {
        progressText.innerHTML = `<span class="error-text">Error: ${message}</span>`;
    }
    if (barFill) {
        barFill.classList.add('error');
        barFill.style.width = '100%';
    }
    state.importing = false;
}

// Quick text extraction from PDF
async function extractText(fileBuffer) {
    showProgress("Extracting text layers...", 10);
    
    // Propagate document load errors to trigger fallback OCR
    const pdf = await loadPDFDocument(fileBuffer);

    const pages = pdf.numPages;
    const extractedLines = [];
    let finalstring = "";

    for (let i = 1; i <= pages; i++) {
        showProgress(`Extracting page ${i} of ${pages}...`, 10 + Math.ceil((i / pages) * 20));
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const textItems = textContent.items;
        let line = 0;

        for (let j = 0; j < textItems.length; j++) {
            const item = textItems[j];
            const itemY = item.transform[3] + item.transform[5];
            
            if (line !== 0 && Math.abs(line - itemY) >= 0.01) {
                extractedLines.push(finalstring);
                finalstring = "";
            }
            line = itemY;
            finalstring += item.str.trim() + " ";

            if (j === textItems.length - 1) {
                extractedLines.push(finalstring);
                finalstring = "";
            }
        }
    }

    // Process extracted lines
    await importSheet(extractedLines, fileBuffer);
}

// Import meet sheet data, fallback to OCR if needed
async function importSheet(lines, fileBuffer) {
    const result = detectMeetSheet(lines, false);

    if (result.table.length < 1) {
        showProgress("Text layer empty/insufficient. Running Tesseract OCR...", 35);
        try {
            await runOCR(fileBuffer);
        } catch (ocrErr) {
            console.error("OCR extraction failed:", ocrErr);
            showProgressError("The Meet Sheet could not be parsed. Make sure it is a Parklawn heat or entry sheet.");
        }
    } else {
        showProgress("Processing swimmer list...", 80);
        state.swimmers = generateSwimmersFromTable(result.table);

        // Guess meet info and update input
        const guessedMeetInfo = guessMeetTitleAndDate(lines, state.uploadedFileName);
        state.meetInfo = guessedMeetInfo;
        const meetInput = document.getElementById('meet-info-input');
        if (meetInput) {
            meetInput.value = guessedMeetInfo;
        }

        saveProject();
        renderSwimmerCards();
        setTimeout(() => {
            showScreen('editor-screen');
            state.importing = false;
        }, 800);
    }
}

// Tesseract OCR fallback
async function runOCR(fileBuffer) {
    const pdf = await loadPDFDocument(fileBuffer);
    const totalpages = pdf.numPages;
    const extractedLines = [];
    const [leftWorker, rightWorker] = await getOCRWorkers();

    for (let a = 1; a <= totalpages; a++) {
        showProgress(`Rendering page ${a} of ${totalpages} for scanning...`, 35 + Math.ceil((a / totalpages) * 20));
        
        const page = await pdf.getPage(a);
        const viewport = page.getViewport({ scale: 6 }); // Legacy-matched high-res scale (6) for better OCR accuracy
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        await page.render(renderContext).promise;

        showProgress(`Pre-processing page ${a} image...`, 35 + Math.ceil((a / totalpages) * 25));
        const lefthalf = await preprocessImage(canvas, "left");
        const righthalf = await preprocessImage(canvas, "right");

        showProgress(`OCR analyzing page ${a}...`, 35 + Math.ceil((a / totalpages) * 30));
        const [leftResult, rightResult] = await Promise.all([
            leftWorker.recognize(lefthalf),
            rightWorker.recognize(righthalf)
        ]);

        extractedLines.push(...(leftResult.data.text.split("\n")));
        extractedLines.push(...(rightResult.data.text.split("\n")));
    }

    const result = detectMeetSheet(extractedLines, true);
    if (result.table.length < 1) {
        throw new Error("OCR detected table length is insufficient.");
    } else {
        showProgress("Processing swimmer list...", 90);
        state.swimmers = generateSwimmersFromTable(result.table);

        // Guess meet info and update input
        const guessedMeetInfo = guessMeetTitleAndDate(extractedLines, state.uploadedFileName);
        state.meetInfo = guessedMeetInfo;
        const meetInput = document.getElementById('meet-info-input');
        if (meetInput) {
            meetInput.value = guessedMeetInfo;
        }

        saveProject();
        renderSwimmerCards();
        setTimeout(() => {
            showScreen('editor-screen');
            state.importing = false;
        }, 800);
    }
}

async function getOCRWorkers() {
    if (!ocrWorkerPoolPromise) {
        ocrWorkerPoolPromise = Promise.all([
            createOCRWorker(),
            createOCRWorker()
        ]);
    }
    return ocrWorkerPoolPromise;
}

function createOCRWorker() {
    return createWorker("eng", undefined, {
        workerPath: resolveAssetUrl(tesseractWorkerSrc),
        corePath: resolveAssetUrl(tesseractCoreSrc),
        langPath: tesseractLangPath,
        gzip: true
    });
}

async function terminateOCRWorkers() {
    if (!ocrWorkerPoolPromise) return;
    const workers = await ocrWorkerPoolPromise;
    ocrWorkerPoolPromise = null;
    await Promise.all(workers.map(worker => worker.terminate()));
}

// Clean and contrast-enhance page images for Tesseract
async function preprocessImage(canvas, half) {
    return new Promise((resolve) => {
        const width = canvas.width / 2;
        const height = canvas.height;

        const halfCanvas = document.createElement("canvas");
        const halfCtx = halfCanvas.getContext("2d");
        halfCanvas.width = width;
        halfCanvas.height = height;

        if (half === "left") {
            halfCtx.drawImage(canvas, 0, 0, width, height, 0, 0, width, height);
        } else {
            halfCtx.drawImage(canvas, width, 0, width, height, 0, 0, width, height);
        }

        const imageData = halfCtx.getImageData(0, 0, halfCanvas.width, halfCanvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            data[i] = data[i + 1] = data[i + 2] = avg;
        }
        halfCtx.putImageData(imageData, 0, 0);

        halfCtx.filter = "contrast(200%)";
        halfCtx.drawImage(halfCanvas, 0, 0);

        resolve(halfCanvas);
    });
}

// Clean swimmer names from noise characters
function correctName(name) {
    const string = name.replace(/[^a-zA-Z\s\-]/g, "");
    const words = string.split(" ");
    let finalstring = "";
    for (let k = 0; k < words.length; k++) {
        const word = words[k].replace(/\s+/g, "");
        if (word.replace(/[^a-zA-Z]/g, "").length > 1) {
            finalstring += word + " ";
        }
    }
    return finalstring.trim();
}

// Check if string contains stroke words
function checkStrokes(stroke) {
    if (!stroke) return false;
    const s = stroke.toLowerCase();
    return (s.includes("free") || s.includes("back") || s.includes("breast") || s.includes("fly"));
}

// Meet sheet formatting detection and parsing
function detectMeetSheet(lines, useocr) {
    const heattable = parseMeetSheetLines(lines, "heats", useocr);
    const entriestable = parseMeetSheetLines(lines, "entries", useocr);

    if (heattable.length < 1 && entriestable.length < 1) {
        return { format: "", table: [] };
    } else if (heattable.length >= entriestable.length) {
        return { format: "heats", table: heattable };
    } else {
        return { format: "entries", table: entriestable };
    }
}

// Line parsing implementation
function parseMeetSheetLines(lines, format, useocr) {
    const table = [];
    const rawtable = [];
    const names = new Set();
    let strokearray = [];
    const cleanLines = lines.filter(entry => entry.trim() !== "");

    if (format === "heats") {
        let currentStroke = false;
        for (let i = 0; i < cleanLines.length; i++) {
            const line = String(cleanLines[i]);
            if (line.includes("Event") || line.includes("#")) {
                if (line.toLowerCase().includes("free")) {
                    currentStroke = "free";
                } else if (line.toLowerCase().includes("back")) {
                    currentStroke = "back";
                } else if (line.toLowerCase().includes("breast")) {
                    currentStroke = "breast";
                } else if (line.toLowerCase().includes("butter")) {
                    currentStroke = "fly";
                } else if (line.toLowerCase().includes("im") || line.toLowerCase().includes("lm")) {
                    currentStroke = "IM";
                } else {
                    currentStroke = false;
                }
            } else if ((line.includes("Parklawn") || line.includes("PL")) && line.includes(",") && !line.includes(":")) {
                if (useocr) {
                    const rawperson = line.replace(/^.*?(\d+)(.*?)(\d+).*$/, "$2").trim();
                    const commaIdx = rawperson.indexOf(",");
                    let lastname = "";
                    let firstname = "";
                    if (commaIdx !== -1) {
                        lastname = correctName(rawperson.substring(0, commaIdx));
                        firstname = correctName(rawperson.substring(commaIdx + 1));
                    } else {
                        // Fallback name splitting logic in case OCR misrecognizes or leaves out the comma
                        const spaceIdx = rawperson.lastIndexOf(" ");
                        if (spaceIdx !== -1) {
                            lastname = correctName(rawperson.substring(spaceIdx + 1));
                            firstname = correctName(rawperson.substring(0, spaceIdx));
                        } else {
                            firstname = correctName(rawperson);
                        }
                    }

                    if (currentStroke && currentStroke !== "IM") {
                        let exists = false;
                        for (let d = 0; d < table.length; d++) {
                            if (table[d][0].toLowerCase().trim() === firstname.toLowerCase() && 
                                table[d][1].toLowerCase().trim() === lastname.toLowerCase()) {
                                exists = d;
                                break;
                            }
                        }

                        if (exists === false) {
                            table.push([firstname, lastname, [currentStroke]]);
                        } else {
                            table[exists][2].push(currentStroke);
                        }
                    }
                } else {
                    const person = line.replace("NT", "").replace(/[^a-zA-Z-, ]/g, "").replace("Parklawn", "").replace("PL", "").trim();
                    const commaIdx = person.indexOf(",");
                    if (commaIdx === -1) continue;
                    const lastname = person.substring(0, commaIdx).trim();
                    const firstname = person.substring(commaIdx + 1).trim();
                    if (currentStroke && currentStroke !== "IM") {
                        rawtable.push([firstname, lastname, currentStroke]);
                        names.add(lastname + "," + firstname);
                    }
                }
            }
        }

        if (!useocr) {
            names.forEach(personStr => {
                const commaIdx = personStr.indexOf(",");
                const lastname = personStr.substring(0, commaIdx).trim();
                const firstname = personStr.substring(commaIdx + 1).trim();
                let strokes = [];
                for (let c = 0; c < rawtable.length; c++) {
                    if (rawtable[c][0] === firstname && rawtable[c][1] === lastname) {
                        strokes.push(rawtable[c][2]);
                    }
                }
                strokes = [...new Set(strokes)].filter(checkStrokes);
                table.push([firstname, lastname, strokes]);
            });
        }
    } else if (format === "entries") {
        for (let i = 0; i < cleanLines.length; i++) {
            const line = String(cleanLines[i]);
            if (line.includes("(")) {
                strokearray = [];
                const person = line.replace(/[^a-zA-Z-, ]/g, "").replace("PL", "").trim();
                let lastname = "";
                let firstname = "";

                if (person.includes(",")) {
                    const commaIdx = person.indexOf(",");
                    lastname = person.substring(0, commaIdx).trim();
                    firstname = person.substring(commaIdx + 1).trim();
                } else {
                    const spaceIdx = person.indexOf(" ");
                    if (spaceIdx === -1) {
                        firstname = person;
                    } else {
                        firstname = person.substring(0, spaceIdx).trim();
                        lastname = person.substring(spaceIdx + 1).trim();
                    }
                }

                if (useocr) {
                    lastname = lastname.replace(/(?<![a-zA-Z])-(?![a-zA-Z])/g, "").trim();
                    firstname = firstname.replace(/(?<![a-zA-Z])-(?![a-zA-Z])/g, "").trim();
                }

                table.push([firstname, lastname, strokearray]);
            } else {
                const event = line.toLowerCase();
                let stroke = false;
                if (event.includes("free")) {
                    stroke = "free";
                } else if (event.includes("back")) {
                    stroke = "back";
                } else if (event.includes("breast")) {
                    stroke = "breast";
                } else if (event.includes("fly")) {
                    stroke = "fly";
                }

                if (stroke) {
                    strokearray.push(stroke);
                }
            }
        }
        // Deduplicate strokes in the arrays
        table.forEach(row => {
            row[2] = [...new Set(row[2])].filter(checkStrokes);
        });
    }
    return table;
}

// Helper function to shuffle an array
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Update meet info title and date
function updateMeetInfo(value) {
    state.meetInfo = value;
}

// Guess meet title and date from text lines and filename
function guessMeetTitleAndDate(lines, filename) {
    let dateStr = "";
    let titleStr = "";

    // Regexes for Date
    const slashesDateRegex = /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](\d{2,4})\b/;
    const monthDateRegex = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?,\s*(\d{4})\b/i;

    // 1. Try to find a date in filename
    if (filename) {
        const fileMatch1 = filename.match(slashesDateRegex);
        if (fileMatch1) {
            dateStr = fileMatch1[0];
        } else {
            const fileMatch2 = filename.match(monthDateRegex);
            if (fileMatch2) {
                dateStr = fileMatch2[0];
            }
        }
    }

    // 2. Try to find a date in the lines (first 40 lines)
    if (!dateStr && lines && lines.length > 0) {
        const limit = Math.min(lines.length, 40);
        for (let i = 0; i < limit; i++) {
            const line = lines[i];
            const match1 = line.match(slashesDateRegex);
            if (match1) {
                dateStr = match1[0];
                break;
            }
            const match2 = line.match(monthDateRegex);
            if (match2) {
                dateStr = match2[0];
                break;
            }
        }
    }

    // If no date found, default to today's date formatted as M/D/YYYY
    if (!dateStr) {
        const d = new Date();
        dateStr = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    }

    // 3. Try to find a title in lines (first 40 lines)
    let titleCandidates = [];
    if (lines && lines.length > 0) {
        const limit = Math.min(lines.length, 40);
        for (let i = 0; i < limit; i++) {
            let line = lines[i].trim();
            if (!line) continue;

            // Ignore swimmer lines or events/headers
            if (line.includes(",") && (line.includes("Parklawn") || line.includes("PL")) && !line.includes(":")) {
                continue;
            }
            if (line.includes("Event") || line.startsWith("#") || line.toLowerCase().includes("page")) {
                continue;
            }
            if (line.length < 5 || line.length > 80) continue;
            if (/^\d+$/.test(line)) continue;

            let score = 0;
            const lowerLine = line.toLowerCase();

            if (lowerLine.includes("vs") || lowerLine.includes("vs.") || lowerLine.includes(" at ") || lowerLine.includes(" @ ")) score += 10;
            if (lowerLine.includes("swim") || lowerLine.includes("meet") || lowerLine.includes("sheet")) score += 5;
            if (lowerLine.includes("trial") || lowerLine.includes("trials")) score += 8;
            if (lowerLine.includes("parklawn") || lowerLine.includes("pl")) score += 4;
            if (lowerLine.includes("championship") || lowerLine.includes("divisional") || lowerLine.includes("relay")) score += 6;

            if (score > 0) {
                let cleaned = line;
                cleaned = cleaned.replace(slashesDateRegex, "");
                cleaned = cleaned.replace(monthDateRegex, "");
                cleaned = cleaned.replace(/[-–—_]+$/, "").trim();
                cleaned = cleaned.replace(/\s+/g, " ");
                if (cleaned.length >= 5) {
                    titleCandidates.push({ text: cleaned, score: score, index: i });
                }
            }
        }
    }

    titleCandidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
    });

    if (titleCandidates.length > 0) {
        titleStr = titleCandidates[0].text;
    } else if (filename) {
        let name = filename.replace(/\.pdf$/i, "");
        name = name.replace(/[_-]+/g, " ");
        name = name.replace(slashesDateRegex, "");
        name = name.replace(monthDateRegex, "");
        name = name.trim();
        if (name.length > 3) {
            titleStr = name;
        }
    }

    if (!titleStr) {
        titleStr = "Parklawn Meet";
    }

    titleStr = titleStr.split(" ").map(w => {
        if (w.toLowerCase() === "vs" || w.toLowerCase() === "vs.") return "vs.";
        if (w.toLowerCase() === "at") return "at";
        return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");

    titleStr = titleStr.replace(/[\s\-–—_]+$/, "").trim();

    return `${titleStr} - ${dateStr}`;
}

// Convert extracted swimmers table to active objects
function generateSwimmersFromTable(tableRows) {
    return tableRows.map((row, idx) => {
        const firstname = row[0];
        const lastname = row[1];
        
        let strokes = [...row[2]];
        if (strokes.length > 2) {
            // Select a random two from the list
            strokes = shuffleArray(strokes).slice(0, 2);
        } else {
            // Render the two strokes in a random order always
            strokes = shuffleArray(strokes);
        }

        // Random borders, hues, and unique colors
        const innerborder = Math.floor(Math.random() * 8) + 1;
        const outerborder = Math.floor(Math.random() * 17) + 1;
        const randomgraphic = Math.floor(Math.random() * 6) + 4; // 4 to 9

        const innerhue = Math.floor(Math.random() * 36) * 10;
        const outerhue = Math.floor(Math.random() * 36) * 10;

        let namecolor = colors[Math.floor(Math.random() * colors.length)];
        let stroketopcolor = colors[Math.floor(Math.random() * colors.length)];
        let strokebottomcolor = colors[Math.floor(Math.random() * colors.length)];
        let graphiccolor = colors[Math.floor(Math.random() * colors.length)];

        while (stroketopcolor === namecolor) {
            stroketopcolor = colors[Math.floor(Math.random() * colors.length)];
        }
        while (strokebottomcolor === namecolor || strokebottomcolor === stroketopcolor) {
            strokebottomcolor = colors[Math.floor(Math.random() * colors.length)];
        }
        while (graphiccolor === namecolor || graphiccolor === stroketopcolor || graphiccolor === strokebottomcolor) {
            graphiccolor = colors[Math.floor(Math.random() * colors.length)];
        }

        // Font sizes based on name length (matches legacy)
        const nameinputsize = firstname.length > 6 ? (220 - (20 * (firstname.length - 6))) : 220;

        return {
            id: Date.now() + idx,
            firstname: firstname,
            lastname: lastname,
            strokes: strokes,
            namecolor: namecolor,
            stroketopcolor: stroketopcolor,
            strokebottomcolor: strokebottomcolor,
            graphiccolor: graphiccolor,
            innerborder: innerborder,
            outerborder: outerborder,
            randomgraphic: randomgraphic,
            innerhue: innerhue,
            outerhue: outerhue,
            showSignature: true,
            nameinputsize: nameinputsize,
            graphicsize: 130,
            stroketopsize: 50,
            strokebottomsize: 50,
            signaturesize: 100
        };
    });
}

// Generate a blank swimmer sign
function addBlankSign() {
    const defaultSwimmer = generateSwimmersFromTable([["Swimmer", "Name", []]])[0];
    defaultSwimmer.id = Date.now();
    state.swimmers.push(defaultSwimmer);
    saveProject();
    renderSwimmerCards();

    // Scroll to the bottom of the viewport
    const viewport = document.getElementById('editor-viewport');
    if (viewport) {
        setTimeout(() => {
            viewport.scrollTop = viewport.scrollHeight;
        }, 100);
    }
}

// Clear all signs
function clearAllSigns() {
    if (confirm("Are you sure you want to clear all swimmers? This cannot be undone.")) {
        state.swimmers = [];
        state.meetInfo = "Parklawn Sign Generator";
        const meetInput = document.getElementById('meet-info-input');
        if (meetInput) {
            meetInput.value = "Parklawn Sign Generator";
        }
        saveProject();
        renderSwimmerCards();
        goToUpload();
    }
}

// Card flip removed from preview

// Delete specific swimmer
function deleteSwimmer(id) {
    if (confirm("Delete this swimmer?")) {
        state.swimmers = state.swimmers.filter(s => s.id !== id);
        saveProject();
        renderSwimmerCards();
        if (state.swimmers.length === 0) {
            goToUpload();
        }
    }
}

// Duplicate specific swimmer
function duplicateSwimmer(id) {
    const original = state.swimmers.find(s => s.id === id);
    if (original) {
        const clone = JSON.parse(JSON.stringify(original));
        clone.id = Date.now();
        // Insert right after original
        const idx = state.swimmers.findIndex(s => s.id === id);
        state.swimmers.splice(idx + 1, 0, clone);
        saveProject();
        renderSwimmerCards();
    }
}

// Update first name from input — re-renders SVG preview
// Update first name — rebuilds only the front SVG preview for that card
function updateSwimmerFirstName(id, value) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (swimmer) {
        swimmer.firstname = value;
        swimmer.nameinputsize = value.length > 6 ? (220 - (20 * (value.length - 6))) : 220;
        saveProject();
        const frontDiv = document.querySelector(`.swimmer-card[data-id="${id}"] .card-preview.front`);
        if (frontDiv) frontDiv.innerHTML = buildFrontSVG(swimmer, false);
    }
}

// Update last name — updates state only (no back preview in UI)
function updateSwimmerLastName(id, value) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (swimmer) {
        swimmer.lastname = value;
        saveProject();
    }
}

// Toggle swimmer stroke selection (max 2 active)
function toggleSwimmerStroke(id, stroke) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (swimmer) {
        const idx = swimmer.strokes.indexOf(stroke);
        if (idx > -1) {
            swimmer.strokes.splice(idx, 1);
        } else {
            if (swimmer.strokes.length >= 2) {
                // Remove first stroke to make room
                swimmer.strokes.shift();
            }
            swimmer.strokes.push(stroke);
        }
        saveProject();
        renderSwimmerCards(); // Full card re-render since SVG layouts change
    }
}

// Shuffle Colors
function shuffleSwimmerColors(id) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (swimmer) {
        let namecolor = colors[Math.floor(Math.random() * colors.length)];
        let stroketopcolor = colors[Math.floor(Math.random() * colors.length)];
        let strokebottomcolor = colors[Math.floor(Math.random() * colors.length)];
        let graphiccolor = colors[Math.floor(Math.random() * colors.length)];

        while (stroketopcolor === namecolor) {
            stroketopcolor = colors[Math.floor(Math.random() * colors.length)];
        }
        while (strokebottomcolor === namecolor || strokebottomcolor === stroketopcolor) {
            strokebottomcolor = colors[Math.floor(Math.random() * colors.length)];
        }
        while (graphiccolor === namecolor || graphiccolor === stroketopcolor || graphiccolor === strokebottomcolor) {
            graphiccolor = colors[Math.floor(Math.random() * colors.length)];
        }

        swimmer.namecolor = namecolor;
        swimmer.stroketopcolor = stroketopcolor;
        swimmer.strokebottomcolor = strokebottomcolor;
        swimmer.graphiccolor = graphiccolor;

        saveProject();
        renderSwimmerCards();
    }
}

// Shuffle Borders
function shuffleSwimmerBorders(id) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (swimmer) {
        swimmer.innerborder = Math.floor(Math.random() * 8) + 1;
        swimmer.outerborder = Math.floor(Math.random() * 17) + 1;
        swimmer.innerhue = Math.floor(Math.random() * 36) * 10;
        swimmer.outerhue = Math.floor(Math.random() * 36) * 10;

        saveProject();
        renderSwimmerCards();
    }
}

// Shuffle swim icon graphic
function shuffleSwimmerGraphic(id) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (swimmer) {
        swimmer.randomgraphic = Math.floor(Math.random() * 6) + 4; // 4 to 9
        saveProject();
        renderSwimmerCards();
    }
}

// Toggle signature panel display
function toggleSwimmerSignature(id) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (swimmer) {
        swimmer.showSignature = !swimmer.showSignature;
        saveProject();
        renderSwimmerCards();
    }
}


// Render all cards inside #editor-viewport
function renderSwimmerCards() {
    const viewport = document.getElementById('editor-viewport');
    if (!viewport) return;
    viewport.innerHTML = '';
    updateSwimmerCount();

    state.swimmers.forEach((swimmer, index) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'swimmer-card';
        cardEl.dataset.id = swimmer.id;
        cardEl.innerHTML = `
            <div class="card-header">
                <span class="card-number">Sign #${index + 1}</span>
                <button class="btn-card-delete" onclick="event.stopPropagation();deleteSwimmer(${swimmer.id})">Delete</button>
            </div>
            <div class="card-preview front">${buildFrontSVG(swimmer, false)}</div>
            <div class="card-controls">
                <div class="control-row">
                    <div class="input-group">
                        <label>First Name</label>
                        <input type="text" value="${swimmer.firstname}" oninput="updateSwimmerFirstName(${swimmer.id},this.value)" placeholder="First Name"/>
                    </div>
                    <div class="input-group">
                        <label>Last Name</label>
                        <input type="text" value="${swimmer.lastname}" oninput="updateSwimmerLastName(${swimmer.id},this.value)" placeholder="Last Name"/>
                    </div>
                </div>
                <div class="stroke-picker">
                    <div class="stroke-buttons">
                        <button class="btn-stroke ${swimmer.strokes.includes('free')?'active':''}" onclick="toggleSwimmerStroke(${swimmer.id},'free')">Free</button>
                        <button class="btn-stroke ${swimmer.strokes.includes('back')?'active':''}" onclick="toggleSwimmerStroke(${swimmer.id},'back')">Back</button>
                        <button class="btn-stroke ${swimmer.strokes.includes('breast')?'active':''}" onclick="toggleSwimmerStroke(${swimmer.id},'breast')">Breast</button>
                        <button class="btn-stroke ${swimmer.strokes.includes('fly')?'active':''}" onclick="toggleSwimmerStroke(${swimmer.id},'fly')">Fly</button>
                    </div>
                </div>
            </div>`;
        viewport.appendChild(cardEl);
    });
}

// SVG defs: embedded fonts + texture grain filter + hue filters

// ---------- SVG BUILDER HELPERS ----------

// Returns a <rect> clipped to the given clipPath id, filled with color + texture overlay
// This replicates CSS `background-clip: text` behavior in pure SVG
function texEl(clipId, color, texPatId, W, H, opacity) {
    return `
        <rect x="0" y="0" width="${W}" height="${H}" fill="${color}" clip-path="url(#${clipId})"/>
        <rect x="0" y="0" width="${W}" height="${H}" fill="url(#${texPatId})" clip-path="url(#${clipId})" opacity="${opacity !== undefined ? opacity : 0.45}"/>`;
}

// Build shared defs block. For preview (inline SVG), fonts come from document CSS.
// For export (standalone SVG file), embed fonts as base64.
function svgDefs(swimmer, forExport) {
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
function buildFrontSVG(swimmer, forExport) {
    const W = 1100, H = 850;
    const sid = swimmer.id;
    const sfx = forExport ? 'e' : 'p'; // 'p'review vs 'e'xport namespace
    const cls = forExport ? '' : 'class="front-svg"';

    const strokeTop = swimmer.strokes[0] ? strokeDetails[swimmer.strokes[0]] : null;
    const strokeBottom = swimmer.strokes[1] ? strokeDetails[swimmer.strokes[1]] : null;

    // --- Name text layout ---
    const nameX = W / 2;
    const nameY = H / 2 + swimmer.nameinputsize * 0.35;

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
        ? `<image href="borders/lovegp.png" x="${W * 0.70}" y="${H * 0.70}" height="${swimmer.signaturesize}" preserveAspectRatio="xMidYMid meet"/>`
        : '';

    return `<svg ${cls} viewBox="0 0 ${W} ${H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        ${svgDefs(swimmer, forExport)}
        <defs>
            <clipPath id="cn${sfx}${sid}">
                <text x="${nameX}" y="${nameY}" font-family="Marker Sans" font-size="${swimmer.nameinputsize}" text-anchor="middle" letter-spacing="0.9">${swimmer.firstname.toUpperCase()}</text>
            </clipPath>
            <clipPath id="cg${sfx}${sid}">
                <text x="${grX}" y="${grY}" font-family="Marker Sans Mini" font-size="${swimmer.graphicsize}">${swimmer.randomgraphic}</text>
            </clipPath>
            ${stTopClips}
            ${stBotClips}
        </defs>
        <rect width="${W}" height="${H}" fill="white"/>
        <image href="borders/outer/${swimmer.outerborder}.png" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" filter="url(#ho${sid})"/>
        <image href="borders/inner/${swimmer.innerborder}.png" x="${W*0.01}" y="${H*0.01}" width="${W*0.98}" height="${H*0.98}" preserveAspectRatio="none" filter="url(#hi${sid})"/>
        ${texEl(`cn${sfx}${sid}`, swimmer.namecolor, `tp${sid}`, W, H)}
        ${texEl(`cg${sfx}${sid}`, swimmer.graphiccolor, `tp${sid}`, W, H)}
        ${stTopEls}
        ${stBotEls}
        ${sigSVG}
    </svg>`;
}

// Build back SVG string
function buildBackSVG(swimmer, forExport) {
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
        <image href="borders/outer/${swimmer.outerborder}.png" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" filter="url(#ho${sid})"/>
        <image href="borders/inner/${swimmer.innerborder}.png" x="${W*0.01}" y="${H*0.01}" width="${W*0.98}" height="${H*0.98}" preserveAspectRatio="none" filter="url(#hi${sid})"/>
        ${texEl(`cl${sfx}${sid}`, '#000000', `tp${sid}`, W, H)}
    </svg>`;
}

// Cache for border image base64 data, keyed by relative URL
const _borderCache = {};

// Fetch an image URL and return a base64 data URI (cached)
async function fetchAsBase64(url) {
    if (_borderCache[url]) return _borderCache[url];
    const resp = await fetch(url);
    const blob = await resp.blob();
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            _borderCache[url] = reader.result;
            resolve(reader.result);
        };
        reader.readAsDataURL(blob);
    });
}

// Replace all <image href="..."> external URLs in an SVG string with inline base64
async function inlineSVGImages(svgStr) {
    // Find all href values pointing to local files (not data: URIs)
    const hrefRegex = /href="([^"]+)"/g;
    const matches = [];
    let m;
    while ((m = hrefRegex.exec(svgStr)) !== null) {
        if (!m[1].startsWith('data:')) {
            matches.push(m[1]);
        }
    }
    // Deduplicate
    const unique = [...new Set(matches)];
    // Fetch all in parallel
    const b64map = {};
    await Promise.all(unique.map(async (url) => {
        b64map[url] = await fetchAsBase64(url);
    }));
    // Replace in SVG string
    let result = svgStr;
    for (const [url, b64] of Object.entries(b64map)) {
        result = result.split(`href="${url}"`).join(`href="${b64}"`);
    }
    return result;
}

// Render an SVG string to a canvas at the given pixel dimensions
function svgToCanvas(svgStr, widthPx, heightPx) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = widthPx;
            canvas.height = heightPx;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, widthPx, heightPx);
            ctx.drawImage(img, 0, 0, widthPx, heightPx);
            URL.revokeObjectURL(url);
            resolve(canvas);
        };
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
    });
}

// Show/hide a simple export progress overlay
function showExportOverlay(message) {
    let overlay = document.getElementById('export-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'export-overlay';
        overlay.innerHTML = `
            <div class="export-modal">
                <div class="export-loader"></div>
                <div id="export-overlay-msg"></div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    overlay.classList.add('active');
    document.getElementById('export-overlay-msg').textContent = message || '';
}

function hideExportOverlay() {
    const overlay = document.getElementById('export-overlay');
    if (overlay) overlay.classList.remove('active');
}

// Main PDF export — landscape letter, two pages per swimmer:
//   Page 1: front sign SVG filling the whole landscape page
//   Page 2: blank white page, last name in top-left corner (20pt, black)
async function exportToPDF() {
    if (state.swimmers.length === 0) { alert('No swimmers to export.'); return; }

    const btn = document.getElementById('export-pdf-btn');
    if (btn) btn.disabled = true;

    // Letter landscape: 279.4 × 215.9 mm
    const PAGE_W_MM = 279.4, PAGE_H_MM = 215.9;

    // Front SVG native aspect: 1100 × 850 — identical to letter landscape ratio (no margin)
    const MARGIN_MM = 0;
    const FRONT_W_MM = PAGE_W_MM;
    const FRONT_H_MM = PAGE_H_MM;
    const FRONT_TOP_MM = 0;

    // Canvas render resolution (2× for crisp output)
    const SCALE = 2;
    const FRONT_CANVAS_W = 1100 * SCALE;
    const FRONT_CANVAS_H = 850 * SCALE;

    try {
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });

        let backPageFont = 'helvetica';
        try {
            const fontUrl = 'fonts/Figtree/Figtree-Regular.ttf';
            const fontData = await fetchAsBase64(fontUrl);
            const fontBase64 = fontData.split(',')[1];
            doc.addFileToVFS('Figtree-Regular.ttf', fontBase64);
            doc.addFont('Figtree-Regular.ttf', 'Figtree', 'normal');
            backPageFont = 'Figtree';
        } catch (fontErr) {
            console.warn('Could not load Figtree font for PDF, falling back to Helvetica:', fontErr);
        }

        for (let i = 0; i < state.swimmers.length; i++) {
            const swimmer = state.swimmers[i];
            showExportOverlay(`Rendering ${swimmer.firstname} ${swimmer.lastname} (${i + 1} / ${state.swimmers.length})…`);

            // ── PAGE 1: Front sign — full landscape page ───────────────
            const frontSVGRaw = buildFrontSVG(swimmer, true);
            const frontSVG = await inlineSVGImages(frontSVGRaw);
            const frontCanvas = await svgToCanvas(frontSVG, FRONT_CANVAS_W, FRONT_CANVAS_H);

            if (i > 0) doc.addPage('letter', 'landscape');

            doc.addImage(
                frontCanvas.toDataURL('image/jpeg', 0.93),
                'JPEG',
                MARGIN_MM, FRONT_TOP_MM, FRONT_W_MM, FRONT_H_MM
            );

            // ── PAGE 2: Back — blank white, last name label top-left ───
            doc.addPage('letter', 'landscape');

            // Blank white page (default) — write last name as small text
            doc.setFont(backPageFont, 'normal');
            doc.setFontSize(20);
            doc.setTextColor(0, 0, 0);
            doc.text(swimmer.lastname, 10, 15);
        }

        showExportOverlay('Saving PDF…');
        const pdfFilename = state.meetInfo 
            ? `${state.meetInfo.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_signs.pdf`
            : 'parklawn_signs.pdf';
        doc.save(pdfFilename);

    } catch (err) {
        console.error('PDF export failed:', err);
        alert('PDF export failed. See console for details.');
    } finally {
        hideExportOverlay();
        if (btn) btn.disabled = false;
    }
}

// Legacy SVG download kept for reference (not exposed in UI)
function downloadSVG(svgStr, filename) {
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

window.addEventListener('beforeunload', () => {
    terminateOCRWorkers().catch((err) => console.warn('OCR worker cleanup failed:', err));
});

Object.assign(window, {
    addBlankSign,
    clearAllSigns,
    deleteSwimmer,
    duplicateSwimmer,
    updateSwimmerFirstName,
    updateSwimmerLastName,
    toggleSwimmerStroke,
    shuffleSwimmerColors,
    shuffleSwimmerBorders,
    shuffleSwimmerGraphic,
    toggleSwimmerSignature,
    exportToPDF,
    updateMeetInfo
});
