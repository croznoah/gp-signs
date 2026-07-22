import "./style.css";
import figtreeRegularUrl from "./fonts/Figtree/Figtree-Regular.ttf?url";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import {
    colors,
    buildFrontSVG
} from "./svgBuilder.js";
import { fitFirstNameFontSize } from "./textSizing.js";
import { getFontFallbackWarnings } from "./fontSupport.js";
import {
    swimtopiaPasswordLogin,
    getParklawnSwimtopiaMeets,
    fetchMeetSwimmers,
    getStoredToken,
    clearToken
} from "./swimtopiaApi.js";

const resolveAssetUrl = (assetUrl) => new URL(assetUrl, window.location.href).href;

// Global App State
let state = {
    swimmers: [],
    importing: false,
    meetInfo: "Parklawn Sign Generator",
    availableMeets: [],
    editorActiveFilter: 'all'
};

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
    loadProject();
    initSwimtopiaUI();
    initPaperPlateDropzone();
});

// Load project from sessionStorage
function loadProject() {
    try {
        const stored = sessionStorage.getItem('gp-signs-project');
        if (stored) {
            const data = JSON.parse(stored);
            state.swimmers = data.swimmers || [];
            state.meetInfo = data.meetInfo || "Parklawn Sign Generator";
            
            const meetInput = document.getElementById('meet-info-input');
            if (meetInput) {
                meetInput.value = state.meetInfo;
            }
            if (state.swimmers.length > 0) {
                renderSwimmerCards();
                const resumeBtn = document.getElementById('resume-project-btn');
                const resumeBadge = document.getElementById('resume-count-badge');
                if (resumeBtn) resumeBtn.classList.remove('hidden');
                if (resumeBadge) resumeBadge.innerText = state.swimmers.length;
            }
        }
    } catch (e) {
        console.warn("Failed to load project from sessionStorage:", e);
    }
    showScreen('upload-screen');
}

function resumePreviousProject() {
    if (state.swimmers.length > 0) {
        showScreen('editor-screen');
    } else {
        alert("No active session project found.");
    }
}

// Save project to sessionStorage
function saveProject() {
    updateSwimmerCount();
    try {
        sessionStorage.setItem('gp-signs-project', JSON.stringify({
            swimmers: state.swimmers,
            meetInfo: state.meetInfo
        }));
    } catch (e) {
        console.warn("Failed to save project to sessionStorage:", e);
    }
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

// Go to upload/landing screen
function goToUpload() {
    showScreen('upload-screen');
    const container = document.getElementById('swimtopia-progress-container');
    if (container) container.classList.add('hidden');
}

// Update the swimmer count badge in header
function updateSwimmerCount() {
    const badge = document.getElementById('swimmer-count-badge');
    if (badge) {
        badge.innerText = `${state.swimmers.length} Swimmer${state.swimmers.length === 1 ? '' : 's'}`;
    }
}

// --- SwimTopia Authentication & Meets Management ---

function initSwimtopiaUI() {
    const token = getStoredToken();
    const signedOutView = document.getElementById("swimtopia-signed-out-view");
    const signedInView = document.getElementById("swimtopia-signed-in-view");

    if (token) {
        if (signedOutView) signedOutView.classList.add("hidden");
        if (signedInView) signedInView.classList.remove("hidden");
        loadSwimtopiaMeets();
    } else {
        if (signedOutView) signedOutView.classList.remove("hidden");
        if (signedInView) signedInView.classList.add("hidden");
    }
}

async function handleSwimtopiaLogin() {
    const emailEl = document.getElementById("swimtopia-email");
    const passwordEl = document.getElementById("swimtopia-password");
    const statusEl = document.getElementById("swimtopia-login-status");
    const loginBtn = document.getElementById("swimtopia-login-btn");

    const username = emailEl ? emailEl.value.trim() : "";
    const password = passwordEl ? passwordEl.value : "";

    if (!username || !password) {
        showStatus(statusEl, "Please enter your username and password.", "error");
        return;
    }

    if (loginBtn) loginBtn.disabled = true;
    showStatus(statusEl, "Connecting to SwimTopia...", "info");

    try {
        await swimtopiaPasswordLogin({ username, password });
        showStatus(statusEl, "Signed in successfully!", "info");
        if (passwordEl) passwordEl.value = "";
        initSwimtopiaUI();
    } catch (err) {
        console.error("[SwimTopia Sign-In Error]", err);
        showStatus(statusEl, err.message || "Failed to sign in to SwimTopia.", "error");
    } finally {
        if (loginBtn) loginBtn.disabled = false;
    }
}

function handleSwimtopiaLogout() {
    clearToken();
    initSwimtopiaUI();
}

function updateMeetGenerateBtnState() {
    const selectEl = document.getElementById("meet-select");
    const generateBtn = document.getElementById("generate-meet-btn");
    if (generateBtn && selectEl) {
        generateBtn.disabled = !selectEl.value;
    }
}

async function loadSwimtopiaMeets() {
    const selectEl = document.getElementById("meet-select");
    const statusEl = document.getElementById("swimtopia-meet-status");
    if (!selectEl) return;

    selectEl.innerHTML = `<option value="">Loading available meets...</option>`;
    updateMeetGenerateBtnState();

    try {
        const { meets, upcomingMeetId } = await getParklawnSwimtopiaMeets();
        state.availableMeets = meets || [];

        if (meets.length === 0) {
            selectEl.innerHTML = `<option value="">No meets found for Parklawn</option>`;
            updateMeetGenerateBtnState();
            return;
        }

        selectEl.innerHTML = meets.map(m => {
            const dateStr = formatDateLabel(m.startDate || m.startAt);
            const isSelected = String(m.id) === String(upcomingMeetId) ? "selected" : "";
            return `<option value="${m.id}" ${isSelected}>${m.name}${dateStr ? ' (' + dateStr + ')' : ''}</option>`;
        }).join("");

        updateMeetGenerateBtnState();
        if (statusEl) statusEl.classList.add("hidden");
    } catch (err) {
        console.error("[SwimTopia Load Meets Error]", err);
        selectEl.innerHTML = `<option value="">Error loading meets</option>`;
        updateMeetGenerateBtnState();
        if (statusEl) showStatus(statusEl, err.message || "Could not load SwimTopia meets.", "error");
    }
}

async function handleGenerateFromMeet() {
    const selectEl = document.getElementById("meet-select");
    const excludeCheck = document.getElementById("exclude-absent-check");
    const generateBtn = document.getElementById("generate-meet-btn");
    const progressContainer = document.getElementById("swimtopia-progress-container");
    const progressBarFill = document.getElementById("swimtopia-progress-bar-fill");
    const progressText = document.getElementById("swimtopia-progress-text");
    const statusEl = document.getElementById("swimtopia-meet-status");

    const meetId = selectEl ? selectEl.value : "";
    if (!meetId) {
        showStatus(statusEl, "Please select a meet from the list.", "error");
        return;
    }

    const selectedMeet = state.availableMeets.find(m => String(m.id) === String(meetId));
    const meetTitle = selectedMeet ? selectedMeet.name : "Parklawn Swim Meet";
    const dateStr = selectedMeet ? formatDateLabel(selectedMeet.startDate || selectedMeet.startAt) : "";
    const meetInfoStr = dateStr ? `${meetTitle} - ${dateStr}` : meetTitle;

    if (generateBtn) generateBtn.disabled = true;
    if (progressContainer) progressContainer.classList.remove("hidden");
    if (statusEl) statusEl.classList.add("hidden");

    const updateProgress = (message, percentage) => {
        if (progressBarFill) progressBarFill.style.width = `${percentage}%`;
        if (progressText) progressText.innerText = message;
    };

    try {
        const token = getStoredToken();
        const excludeAbsent = excludeCheck ? excludeCheck.checked : true;
        const swimmersTable = await fetchMeetSwimmers({
            token,
            meetId,
            excludeAbsent,
            onProgress: updateProgress
        });

        if (swimmersTable.length === 0) {
            throw new Error("No available swimmers found for this meet.");
        }

        resetProjectState();
        state.swimmers = generateSwimmersFromTable(swimmersTable);
        state.meetInfo = meetInfoStr;

        const meetInput = document.getElementById('meet-info-input');
        if (meetInput) meetInput.value = state.meetInfo;

        saveProject();
        renderSwimmerCards();

        setTimeout(() => {
            if (progressContainer) progressContainer.classList.add("hidden");
            showScreen('editor-screen');
        }, 500);

    } catch (err) {
        console.error("[Generate Signs Error]", err);
        if (statusEl) showStatus(statusEl, err.message || "Failed to generate signs from meet.", "error");
        if (progressContainer) progressContainer.classList.add("hidden");
    } finally {
        if (generateBtn) generateBtn.disabled = false;
    }
}

function showStatus(element, message, type = "info") {
    if (!element) return;
    element.classList.remove("hidden", "error", "info");
    element.classList.add(type);
    element.innerText = message;
}

function formatDateLabel(rawDate) {
    if (!rawDate) return "";
    try {
        const d = new Date(rawDate);
        if (isNaN(d.getTime())) return String(rawDate);
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    } catch {
        return String(rawDate);
    }
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

// Convert extracted swimmers table to active sign objects
function generateSwimmersFromTable(tableRows) {
    return tableRows.map((row, idx) => {
        const firstname = row[0];
        const lastname = row[1];
        
        let strokes = [...row[2]];
        if (strokes.length > 2) {
            strokes = shuffleArray(strokes).slice(0, 2);
        } else if (strokes.length > 0) {
            strokes = shuffleArray(strokes);
        }

        // Random borders, hues, and unique colors matching design system
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

        const nameinputsize = fitFirstNameFontSize(firstname);

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

    const viewport = document.getElementById('editor-viewport');
    if (viewport) {
        setTimeout(() => {
            viewport.scrollTop = viewport.scrollHeight;
        }, 100);
    }
}

// Reset project state completely
function resetProjectState() {
    state.swimmers = [];
    state.meetInfo = "Parklawn Sign Generator";
    const meetInput = document.getElementById('meet-info-input');
    if (meetInput) {
        meetInput.value = state.meetInfo;
    }
    saveProject();
    renderSwimmerCards();
}

function addBlankSignAndOpenEditor() {
    resetProjectState();
    addBlankSign();
    showScreen('editor-screen');
}

// Clear all signs
function clearAllSigns() {
    if (confirm("Are you sure you want to clear all swimmers? This cannot be undone.")) {
        resetProjectState();
        goToUpload();
    }
}

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
        const idx = state.swimmers.findIndex(s => s.id === id);
        state.swimmers.splice(idx + 1, 0, clone);
        saveProject();
        renderSwimmerCards();
    }
}

// Update first name from input — re-renders SVG preview
function updateSwimmerFirstName(id, value) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (swimmer) {
        swimmer.firstname = value;
        swimmer.nameinputsize = fitFirstNameFontSize(value);
        saveProject();
        const frontDiv = document.querySelector(`.swimmer-card[data-id="${id}"] .card-preview.front`);
        if (frontDiv) frontDiv.innerHTML = buildFrontSVG(swimmer, false);
        updateFontFallbackWarning(swimmer);
    }
}

// Update last name
function updateSwimmerLastName(id, value) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (swimmer) {
        swimmer.lastname = value;
        saveProject();
        updateFontFallbackWarning(swimmer);
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
                swimmer.strokes.shift();
            }
            swimmer.strokes.push(stroke);
        }
        saveProject();
        renderSwimmerCards();
    }
}

// Update paper plate award text
function updatePaperPlateAward(id, value) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (swimmer) {
        swimmer.award = value;
        saveProject();
        const frontDiv = document.querySelector(`.swimmer-card[data-id="${id}"] .card-preview.front`);
        if (frontDiv) frontDiv.innerHTML = buildFrontSVG(swimmer, false);
        updateFontFallbackWarning(swimmer);
    }
}

// Update paper plate swimmer name
function updatePaperPlateName(id, value) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (swimmer) {
        swimmer.fullname = value;
        swimmer.firstname = value;
        saveProject();
        const frontDiv = document.querySelector(`.swimmer-card[data-id="${id}"] .card-preview.front`);
        if (frontDiv) frontDiv.innerHTML = buildFrontSVG(swimmer, false);
        updateFontFallbackWarning(swimmer);
    }
}

function formatUnsupportedCharacter(character) {
    if (character === " ") return "space";
    if (character === "\n") return "line break";
    if (character === "\t") return "tab";
    return character;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildFontFallbackWarning(swimmer) {
    const warnings = getFontFallbackWarnings(swimmer);
    const message = warnings.map(({ label, fontName, characters }) =>
        `${label}: ${characters.map(character => `“${formatUnsupportedCharacter(character)}”`).join(", ")} (${fontName})`
    ).join(" · ");

    return `<div class="font-fallback-warning${warnings.length ? "" : " hidden"}" data-font-warning-id="${swimmer.id}" role="alert">
        <span class="font-fallback-warning-icon" aria-hidden="true">⚠</span>
        <span><strong>Fallback font in use.</strong> ${escapeHtml(message)}</span>
    </div>`;
}

function updateFontFallbackWarning(swimmer) {
    const warningEl = document.querySelector(`[data-font-warning-id="${swimmer.id}"]`);
    if (warningEl) warningEl.outerHTML = buildFontFallbackWarning(swimmer);
}

function renderEditorHeaderTabs() {
    const titleGroupEl = document.getElementById('header-title-group');
    const tabsBarEl = document.getElementById('editor-file-tabs-bar');
    const newSignBtn = document.getElementById('new-sign-btn');
    const exportBtn = document.getElementById('export-pdf-btn');
    if (!tabsBarEl) return;

    const paperPlateSwimmers = state.swimmers.filter(s => s.isPaperPlate);
    const hasPaperPlates = paperPlateSwimmers.length > 0 || paperPlateState.uploadedFiles.length > 0;

    if (!hasPaperPlates) {
        if (titleGroupEl) titleGroupEl.classList.remove('hidden');
        if (newSignBtn) newSignBtn.classList.remove('hidden');
        if (exportBtn) exportBtn.innerText = 'Export PDF';
        tabsBarEl.classList.add('hidden');
        tabsBarEl.innerHTML = '';
        return;
    }

    if (titleGroupEl) titleGroupEl.classList.add('hidden');
    if (newSignBtn) newSignBtn.classList.add('hidden');
    if (exportBtn) exportBtn.innerText = 'Export ZIP';
    tabsBarEl.classList.remove('hidden');

    const filesList = paperPlateState.uploadedFiles.map(f => f.name);
    paperPlateSwimmers.forEach(s => {
        if (s.sourceFile && !filesList.includes(s.sourceFile)) {
            filesList.push(s.sourceFile);
        }
    });

    if (!filesList.includes(state.editorActiveFilter)) {
        state.editorActiveFilter = filesList[0] || '';
    }

    let tabsHTML = '';

    filesList.forEach((fileName, i) => {
        const isActive = state.editorActiveFilter === fileName;
        const count = paperPlateSwimmers.filter(s => s.sourceFile === fileName).length;
        tabsHTML += `
            <div class="editor-tab-btn ${isActive ? 'active' : ''}" onclick="setEditorFileFilter('${fileName}')">
                <span class="editor-tab-name">${fileName}</span>
                <span class="editor-tab-count">(${count})</span>
            </div>
        `;
    });

    tabsBarEl.innerHTML = tabsHTML;
}

function setEditorFileFilter(filter) {
    state.editorActiveFilter = filter;
    renderSwimmerCards();
}

// Render all cards inside #editor-viewport
function renderSwimmerCards() {
    const viewport = document.getElementById('editor-viewport');
    if (!viewport) return;
    viewport.innerHTML = '';
    updateSwimmerCount();

    const isPaperPlateMode = state.swimmers.some(s => s.isPaperPlate) || paperPlateState.uploadedFiles.length > 0;

    renderEditorHeaderTabs();

    let displaySwimmers = state.swimmers;
    if (isPaperPlateMode) {
        if (!state.editorActiveFilter && paperPlateState.uploadedFiles.length > 0) {
            state.editorActiveFilter = paperPlateState.uploadedFiles[0].name;
        }
        if (state.editorActiveFilter) {
            displaySwimmers = state.swimmers.filter(s => s.sourceFile === state.editorActiveFilter);
        }
    }

    displaySwimmers.forEach((swimmer, index) => {
        if (swimmer.isHeaderPlate) {
            const dividerEl = document.createElement('div');
            dividerEl.className = 'editor-header-divider';
            dividerEl.innerHTML = `
                <div class="editor-header-divider-line"></div>
                <span class="editor-header-divider-label">${swimmer.award || 'SECTION HEADER'}</span>
                <div class="editor-header-divider-line"></div>
            `;
            viewport.appendChild(dividerEl);
        }

        const cardEl = document.createElement('div');
        cardEl.className = swimmer.isHeaderPlate ? 'swimmer-card header-title-card' : 'swimmer-card';
        cardEl.dataset.id = swimmer.id;

        const shuffleIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="square" stroke-linejoin="miter"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`;

        if (swimmer.isPaperPlate) {
            if (swimmer.isHeaderPlate) {
                cardEl.innerHTML = `
                    <div class="card-header">
                        <span class="card-number">Title Plate (Header)</span>
                        <button class="btn-card-delete" onclick="event.stopPropagation();deleteSwimmer(${swimmer.id})">Delete</button>
                    </div>
                    <div class="card-preview-wrap">
                        <div class="card-preview front">${buildFrontSVG(swimmer, false)}</div>
                        <button class="btn-card-shuffle" onclick="event.stopPropagation();shuffleSign(${swimmer.id})" title="Shuffle colors &amp; borders">${shuffleIcon}</button>
                    </div>
                    <div class="card-controls">
                        <div class="control-row">
                            <div class="input-group">
                                <label>Header Title</label>
                                <input type="text" value="${swimmer.award || ''}" oninput="updatePaperPlateAward(${swimmer.id},this.value)" placeholder="Header Title"/>
                            </div>
                        </div>
                    </div>
                    ${buildFontFallbackWarning(swimmer)}`;
            } else {
                const genderTag = swimmer.gender ? ` (${swimmer.gender})` : '';
                cardEl.innerHTML = `
                    <div class="card-header">
                        <span class="card-number">Paper Plate #${index}${genderTag}</span>
                        <button class="btn-card-delete" onclick="event.stopPropagation();deleteSwimmer(${swimmer.id})">Delete</button>
                    </div>
                    <div class="card-preview-wrap">
                        <div class="card-preview front">${buildFrontSVG(swimmer, false)}</div>
                        <button class="btn-card-shuffle" onclick="event.stopPropagation();shuffleSign(${swimmer.id})" title="Shuffle colors &amp; borders">${shuffleIcon}</button>
                    </div>
                    <div class="card-controls">
                        <div class="control-row">
                            <div class="input-group">
                                <label>Award Title</label>
                                <input type="text" value="${swimmer.award || ''}" oninput="updatePaperPlateAward(${swimmer.id},this.value)" placeholder="Award Title"/>
                            </div>
                            <div class="input-group">
                                <label>Swimmer Name</label>
                                <input type="text" value="${swimmer.fullname || ''}" oninput="updatePaperPlateName(${swimmer.id},this.value)" placeholder="Swimmer Name"/>
                            </div>
                        </div>
                    </div>
                    ${buildFontFallbackWarning(swimmer)}`;
            }
        } else {
            cardEl.innerHTML = `
                <div class="card-header">
                    <span class="card-number">Sign #${index + 1}</span>
                    <button class="btn-card-delete" onclick="event.stopPropagation();deleteSwimmer(${swimmer.id})">Delete</button>
                </div>
                <div class="card-preview-wrap">
                    <div class="card-preview front">${buildFrontSVG(swimmer, false)}</div>
                    <button class="btn-card-shuffle" onclick="event.stopPropagation();shuffleSign(${swimmer.id})" title="Shuffle colors, borders &amp; graphic">${shuffleIcon}</button>
                </div>
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
                </div>
                ${buildFontFallbackWarning(swimmer)}`;
        }
        viewport.appendChild(cardEl);
    });
}

// Cache for border image base64 data, keyed by relative URL
const _borderCache = {};

// Fetch an image URL and return a base64 data URI (cached)
async function fetchAsBase64(url) {
    if (_borderCache[url]) return _borderCache[url];
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(`Failed to fetch ${url}: ${resp.status}`);
    }
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
    const hrefRegex = /href="([^"]+)"/g;
    const matches = [];
    let m;
    while ((m = hrefRegex.exec(svgStr)) !== null) {
        if (!m[1].startsWith('data:')) {
            matches.push(m[1]);
        }
    }
    const unique = [...new Set(matches)];
    const b64map = {};
    await Promise.all(unique.map(async (url) => {
        b64map[url] = await fetchAsBase64(url);
    }));
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

// Show/hide export overlay
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

// Main PDF / ZIP export
async function exportToPDF() {
    if (state.swimmers.length === 0) { alert('No swimmers to export.'); return; }

    const btn = document.getElementById('export-pdf-btn');
    if (btn) btn.disabled = true;

    const PAGE_W_MM = 279.4, PAGE_H_MM = 215.9;
    const MARGIN_MM = 0;
    const FRONT_W_MM = PAGE_W_MM;
    const FRONT_H_MM = PAGE_H_MM;
    const FRONT_TOP_MM = 0;
    const SCALE = 2;
    const FRONT_CANVAS_W = 1100 * SCALE;
    const FRONT_CANVAS_H = 850 * SCALE;

    const isPaperPlateMode = state.swimmers.some(s => s.isPaperPlate);

    try {
        if (isPaperPlateMode) {
            // Each header starts a new PDF. This keeps every age-group/slideshow
            // title plate together with only the paper plates it introduces.
            const headerGroups = [];
            let currentGroup = null;
            state.swimmers.forEach(s => {
                if (s.isHeaderPlate || !currentGroup) {
                    currentGroup = {
                        title: s.isHeaderPlate ? s.award : (s.sourceFile || "Paper Plates"),
                        swimmers: []
                    };
                    headerGroups.push(currentGroup);
                }
                currentGroup.swimmers.push(s);
            });

            const zip = new JSZip();
            const usedPdfNames = new Set();

            for (const { title, swimmers: swimmersInGroup } of headerGroups) {
                const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });

                for (let i = 0; i < swimmersInGroup.length; i++) {
                    const swimmer = swimmersInGroup[i];
                    const displayName = swimmer.fullname || swimmer.award || `Sign ${i + 1}`;
                    showExportOverlay(`Rendering ${title}: ${displayName} (${i + 1} / ${swimmersInGroup.length})…`);

                    const frontSVGRaw = buildFrontSVG(swimmer, true);
                    const frontSVG = await inlineSVGImages(frontSVGRaw);
                    const frontCanvas = await svgToCanvas(frontSVG, FRONT_CANVAS_W, FRONT_CANVAS_H);

                    if (i > 0) doc.addPage('letter', 'landscape');

                    doc.addImage(
                        frontCanvas.toDataURL('image/jpeg', 0.93),
                        'JPEG',
                        MARGIN_MM, FRONT_TOP_MM, FRONT_W_MM, FRONT_H_MM
                    );
                    // Paper plate signs do NOT add a back page.
                }

                // Preserve the visible header title in the ZIP whenever possible,
                // replacing only characters that cannot appear in a file name.
                let baseName = String(title || 'paper_plates')
                    .replace(/[\\/:*?"<>|]/g, '-')
                    .replace(/\s+/g, ' ')
                    .trim() || 'paper_plates';
                let pdfName = `${baseName}.pdf`;
                let counter = 1;
                while (usedPdfNames.has(pdfName)) {
                    counter++;
                    pdfName = `${baseName}_${counter}.pdf`;
                }
                usedPdfNames.add(pdfName);

                zip.file(pdfName, doc.output('arraybuffer'));
            }

            showExportOverlay('Generating ZIP archive…');
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const currentYear = new Date().getFullYear();
            let zipFilename;
            if (state.meetInfo) {
                const meetSlug = state.meetInfo.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                zipFilename = meetSlug.includes(String(currentYear))
                    ? `${meetSlug}_signs.zip`
                    : `${meetSlug}_signs_${currentYear}.zip`;
            } else {
                zipFilename = `paper_plate_signs_${currentYear}.zip`;
            }

            const link = document.createElement('a');
            link.href = URL.createObjectURL(zipBlob);
            link.download = zipFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);

        } else {
            // Standard GP signs PDF export
            const swimmersForExport = state.swimmers
                .map((swimmer, index) => ({ swimmer, index }))
                .sort((a, b) => {
                    const lastNameCompare = a.swimmer.lastname.localeCompare(b.swimmer.lastname, undefined, { sensitivity: 'base' });
                    if (lastNameCompare !== 0) return lastNameCompare;
                    const firstNameCompare = a.swimmer.firstname.localeCompare(b.swimmer.firstname, undefined, { sensitivity: 'base' });
                    if (firstNameCompare !== 0) return firstNameCompare;
                    return a.index - b.index;
                })
                .map(({ swimmer }) => swimmer);

            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });

            let backPageFont = 'helvetica';
            try {
                const fontUrl = resolveAssetUrl(figtreeRegularUrl);
                const fontData = await fetchAsBase64(fontUrl);
                const fontBase64 = fontData.split(',')[1];
                doc.addFileToVFS('Figtree-Regular.ttf', fontBase64);
                doc.addFont('Figtree-Regular.ttf', 'Figtree', 'normal');
                backPageFont = 'Figtree';
            } catch (fontErr) {
                console.warn('Could not load Figtree font for PDF, falling back to Helvetica:', fontErr);
            }

            for (let i = 0; i < swimmersForExport.length; i++) {
                const swimmer = swimmersForExport[i];
                showExportOverlay(`Rendering ${swimmer.firstname} ${swimmer.lastname} (${i + 1} / ${swimmersForExport.length})…`);

                const frontSVGRaw = buildFrontSVG(swimmer, true);
                const frontSVG = await inlineSVGImages(frontSVGRaw);
                const frontCanvas = await svgToCanvas(frontSVG, FRONT_CANVAS_W, FRONT_CANVAS_H);

                if (i > 0) doc.addPage('letter', 'landscape');

                doc.addImage(
                    frontCanvas.toDataURL('image/jpeg', 0.93),
                    'JPEG',
                    MARGIN_MM, FRONT_TOP_MM, FRONT_W_MM, FRONT_H_MM
                );

                if (!swimmer.isPaperPlate) {
                    doc.addPage('letter', 'landscape');
                    doc.setFont(backPageFont, 'normal');
                    doc.setFontSize(20);
                    doc.setTextColor(0, 0, 0);
                    doc.text(swimmer.lastname, 10, 15);
                }
            }

            showExportOverlay('Saving PDF…');
            const pdfFilename = state.meetInfo 
                ? `${state.meetInfo.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_signs.pdf`
                : 'parklawn_signs.pdf';
            doc.save(pdfFilename);
        }

    } catch (err) {
        console.error('Export failed:', err);
        alert('Export failed. See console for details.');
    } finally {
        hideExportOverlay();
        if (btn) btn.disabled = false;
    }
}

// --- Paper Plate Management ---
let paperPlateState = {
    uploadedFiles: [], // Array of { name, headers, rows, nameCol, awardCol }
    activeFileIndex: 0
};

function switchAppMode(mode) {
    const gpBtn = document.getElementById('mode-btn-gp');
    const ppBtn = document.getElementById('mode-btn-pp');
    const gpView = document.getElementById('gp-signs-view');
    const ppView = document.getElementById('paper-plate-view');

    if (mode === 'paper-plate') {
        if (gpBtn) gpBtn.classList.remove('active');
        if (ppBtn) ppBtn.classList.add('active');
        if (gpView) { gpView.classList.remove('active'); gpView.classList.add('hidden'); }
        if (ppView) { ppView.classList.remove('hidden'); ppView.classList.add('active'); }
    } else {
        if (ppBtn) ppBtn.classList.remove('active');
        if (gpBtn) gpBtn.classList.add('active');
        if (ppView) { ppView.classList.remove('active'); ppView.classList.add('hidden'); }
        if (gpView) { gpView.classList.remove('hidden'); gpView.classList.add('active'); }
    }
}

function initPaperPlateDropzone() {
    const dropzone = document.getElementById('csv-dropzone');
    if (!dropzone) return;
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files) {
            handleCSVFilesSelect(e.dataTransfer.files);
        }
    });
}

function parseCSV(text) {
    const lines = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentField += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if ((char === ',' || char === '\t') && !inQuotes) {
            currentRow.push(currentField.trim());
            currentField = '';
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            currentRow.push(currentField.trim());
            if (currentRow.some(cell => cell.length > 0)) {
                lines.push(currentRow);
            }
            currentRow = [];
            currentField = '';
        } else {
            currentField += char;
        }
    }
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        if (currentRow.some(cell => cell.length > 0)) {
            lines.push(currentRow);
        }
    }
    return lines;
}

// Attempt to match name and award columns from first row (headers). If no match, leave blank ("")
function detectFileColumns(headers) {
    let nameCol = "";
    let awardCol = "";

    const nameKeywords = ['name', 'swimmer', 'athlete', 'full name', 'first name', 'student', 'person'];
    const awardKeywords = ['award', 'paper plate', 'superlative', 'title', 'category', 'honor', 'reason', 'description', 'plate'];

    for (const h of headers) {
        const lower = h.toLowerCase().trim();
        if (!nameCol && nameKeywords.some(k => lower.includes(k))) {
            nameCol = h;
        }
        if (!awardCol && awardKeywords.some(k => lower.includes(k))) {
            awardCol = h;
        }
    }

    return { nameCol, awardCol };
}

function updateCSVFileNames() {
    if (!paperPlateState.uploadedFiles || paperPlateState.uploadedFiles.length === 0) return;

    if (paperPlateState.uploadedFiles.length === 1) {
        const file = paperPlateState.uploadedFiles[0];
        if (!file.userRenamed && file.originalName) {
            file.name = file.originalName.replace(/\.csv$/i, '');
        }
        return;
    }

    const baseNames = paperPlateState.uploadedFiles.map(f => {
        return (f.originalName || f.name).replace(/\.csv$/i, '');
    });

    let prefix = baseNames[0] || "";
    for (let i = 1; i < baseNames.length; i++) {
        while (prefix && !baseNames[i].startsWith(prefix)) {
            prefix = prefix.substring(0, prefix.length - 1);
        }
    }

    paperPlateState.uploadedFiles.forEach((file, idx) => {
        if (!file.userRenamed) {
            const oldName = file.name;
            const origBase = (file.originalName || file.name).replace(/\.csv$/i, '');
            const stripped = (prefix && prefix.length < origBase.length) ? origBase.slice(prefix.length) : origBase;
            file.name = stripped;

            if (oldName && oldName !== file.name) {
                state.swimmers.forEach(s => {
                    if (s.sourceFile === oldName) {
                        s.sourceFile = file.name;
                    }
                });
                if (state.editorActiveFilter === oldName) {
                    state.editorActiveFilter = file.name;
                }
            }
        }
    });
}

async function handleCSVFilesSelect(files) {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
        const cleanName = file.name.replace(/\.csv$/i, '');
        if (paperPlateState.uploadedFiles.some(f => (f.originalName || f.name) === cleanName || f.originalName === file.name)) continue;
        try {
            const text = await file.text();
            const parsed = parseCSV(text);
            if (parsed.length > 0) {
                const headers = parsed[0].map(h => h.trim());
                const rows = parsed.slice(1);
                const { nameCol, awardCol } = detectFileColumns(headers);
                paperPlateState.uploadedFiles.push({
                    name: cleanName,
                    originalName: cleanName,
                    rawName: file.name,
                    headers: headers,
                    rows: rows,
                    nameCol: nameCol,
                    awardCol: awardCol
                });
                paperPlateState.activeFileIndex = paperPlateState.uploadedFiles.length - 1;
            }
        } catch (err) {
            console.error("Failed to read CSV file:", file.name, err);
        }
    }
    updateCSVFileNames();
    updatePaperPlateUI();
}

function removeCSVFile(index) {
    paperPlateState.uploadedFiles.splice(index, 1);
    if (paperPlateState.activeFileIndex >= paperPlateState.uploadedFiles.length) {
        paperPlateState.activeFileIndex = Math.max(0, paperPlateState.uploadedFiles.length - 1);
    }
    updateCSVFileNames();
    updatePaperPlateUI();
}

function selectActiveCSVFile(index) {
    if (index >= 0 && index < paperPlateState.uploadedFiles.length) {
        paperPlateState.activeFileIndex = index;
        updatePaperPlateUI();
    }
}

function updateFileColumnMapping(fileIndex, colType, value) {
    const file = paperPlateState.uploadedFiles[fileIndex];
    if (file) {
        if (colType === 'name') file.nameCol = value;
        if (colType === 'award') file.awardCol = value;
        updatePaperPlateUI();
    }
}

function renameCSVFile(index, newName) {
    const file = paperPlateState.uploadedFiles[index];
    const oldName = file ? file.name : null;
    const finalName = newName || "Untitled";

    if (file) {
        file.name = finalName;
        file.userRenamed = true;
        const cardInput = document.querySelector(`.csv-file-card[data-index="${index}"] .file-name-input`);
        if (cardInput && cardInput.value !== file.name) cardInput.value = file.name;
    }

    if (oldName && oldName !== finalName) {
        state.swimmers.forEach(s => {
            if (s.sourceFile === oldName) {
                s.sourceFile = finalName;
            }
        });
        if (state.editorActiveFilter === oldName) {
            state.editorActiveFilter = finalName;
        }
        saveProject();
    }

    renderEditorHeaderTabs();
    renderPaperPlatePreviewTable();
}

function updatePaperPlateUI() {
    const fileListEl = document.getElementById('csv-files-list');
    const generateBtn = document.getElementById('generate-paperplates-btn');

    if (fileListEl) {
        if (paperPlateState.uploadedFiles.length > 0) {
            fileListEl.classList.remove('hidden');
            fileListEl.innerHTML = paperPlateState.uploadedFiles.map((f, i) => {
                const displayName = f.rawName || f.originalName || f.name;
                return `
                    <div class="csv-file-card compact" data-index="${i}" onclick="selectActiveCSVFile(${i})">
                        <div class="csv-file-top-row">
                            <div class="file-title-wrap" style="display: flex; align-items: center; gap: 8px;">
                                <span class="file-name-text" style="font-weight: 800; font-size: 13px; color: var(--text-color);">${displayName}</span>
                                <span class="file-row-count" style="font-size: 11px; font-weight: 700; color: var(--muted-text-color);">(${f.rows.length} rows)</span>
                            </div>
                            <button type="button" class="btn-file-delete" onclick="event.stopPropagation(); removeCSVFile(${i})" title="Remove File" aria-label="Remove File">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <line x1="18" y1="6" x2="6" y2="18"/>
                                    <line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            fileListEl.classList.add('hidden');
            fileListEl.innerHTML = '';
        }
    }

    if (generateBtn) {
        generateBtn.disabled = paperPlateState.uploadedFiles.length === 0;
    }
}

function renderPaperPlatePreviewTable() {
    // Retained for compatibility
}

let paperPlateSplitConfigs = [];
let currentModalFileIndex = 0;

function handleGeneratePaperPlates() {
    if (paperPlateState.uploadedFiles.length === 0) {
        alert("Please upload at least one CSV file.");
        return;
    }

    paperPlateSplitConfigs = paperPlateState.uploadedFiles.map((file, fileIdx) => {
        const nameCol = file.nameCol || '';
        const awardCol = file.awardCol || '';
        const headers = file.headers || [];

        const nameIdx = nameCol ? headers.indexOf(nameCol) : -1;
        const awardIdx = awardCol ? headers.indexOf(awardCol) : -1;

        const records = file.rows.map(row => ({
            name: nameIdx !== -1 && row[nameIdx] ? row[nameIdx] : '',
            award: awardIdx !== -1 && row[awardIdx] ? row[awardIdx] : ''
        })).filter(r => r.name || r.award);

        const defaultGap = Math.ceil(records.length / 2);
        const rawFileName = file.rawName || file.originalName || file.name;
        return {
            fileIndex: fileIdx,
            fileName: file.name,
            rawName: rawFileName,
            headers: headers,
            rows: file.rows,
            nameCol: nameCol,
            awardCol: awardCol,
            records: records,
            gapIndex: defaultGap,
            topGender: 'boy'
        };
    });

    currentModalFileIndex = 0;
    openPaperPlateSplitModal();
}

function openPaperPlateSplitModal() {
    const overlay = document.getElementById('pp-split-modal-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        renderPaperPlateSplitModal();
    }
}

function closePaperPlateSplitModal() {
    const overlay = document.getElementById('pp-split-modal-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

function navigateModalFile(delta) {
    const currentConfig = paperPlateSplitConfigs[currentModalFileIndex];
    if (delta > 0 && currentConfig) {
        if (!currentConfig.nameCol || !currentConfig.awardCol) {
            alert(`Please select both Swimmer Name and Award Title columns for "${currentConfig.fileName}" before moving forward.`);
            return;
        }
    }
    const newIdx = currentModalFileIndex + delta;
    if (newIdx >= 0 && newIdx < paperPlateSplitConfigs.length) {
        currentModalFileIndex = newIdx;
        renderPaperPlateSplitModal();
    }
}

function setFileGapPosition(configIndex, newGap) {
    const config = paperPlateSplitConfigs[configIndex];
    if (!config) return;
    const parsedGap = parseInt(newGap, 10);
    if (isNaN(parsedGap)) return;
    config.gapIndex = Math.max(0, Math.min(config.records.length, parsedGap));
    
    const swimmerListEl = document.querySelector('.pp-split-swimmer-list');
    const savedScrollTop = swimmerListEl ? swimmerListEl.scrollTop : 0;

    renderPaperPlateSplitModal();

    const updatedListEl = document.querySelector('.pp-split-swimmer-list');
    if (updatedListEl) updatedListEl.scrollTop = savedScrollTop;
}

function toggleFileGenderTop(configIndex) {
    const config = paperPlateSplitConfigs[configIndex];
    if (!config) return;
    config.topGender = config.topGender === 'boy' ? 'girl' : 'boy';

    const swimmerListEl = document.querySelector('.pp-split-swimmer-list');
    const savedScrollTop = swimmerListEl ? swimmerListEl.scrollTop : 0;

    renderPaperPlateSplitModal();

    const updatedListEl = document.querySelector('.pp-split-swimmer-list');
    if (updatedListEl) updatedListEl.scrollTop = savedScrollTop;
}

function renameCSVFileFromModal(configIndex, newName) {
    const config = paperPlateSplitConfigs[configIndex];
    if (!config) return;
    config.fileName = newName;
    if (paperPlateState.uploadedFiles[config.fileIndex]) {
        paperPlateState.uploadedFiles[config.fileIndex].name = newName;
    }
    updatePaperPlateUI();
}

function updateModalFileColumnMapping(configIndex, colType, colValue) {
    const config = paperPlateSplitConfigs[configIndex];
    if (!config) return;

    if (colType === 'name') {
        config.nameCol = colValue;
        paperPlateState.uploadedFiles[config.fileIndex].nameCol = colValue;
    } else if (colType === 'award') {
        config.awardCol = colValue;
        paperPlateState.uploadedFiles[config.fileIndex].awardCol = colValue;
    }

    const nameIdx = config.nameCol ? config.headers.indexOf(config.nameCol) : -1;
    const awardIdx = config.awardCol ? config.headers.indexOf(config.awardCol) : -1;

    config.records = config.rows.map(row => ({
        name: nameIdx !== -1 && row[nameIdx] ? row[nameIdx] : '',
        award: awardIdx !== -1 && row[awardIdx] ? row[awardIdx] : ''
    })).filter(r => r.name || r.award);

    config.gapIndex = Math.ceil(config.records.length / 2);

    const swimmerListEl = document.querySelector('.pp-split-swimmer-list');
    const savedScrollTop = swimmerListEl ? swimmerListEl.scrollTop : 0;

    renderPaperPlateSplitModal();

    const updatedListEl = document.querySelector('.pp-split-swimmer-list');
    if (updatedListEl) updatedListEl.scrollTop = savedScrollTop;
}

function renderPaperPlateSplitModal() {
    const bodyEl = document.getElementById('pp-split-modal-body');
    const footerEl = document.getElementById('pp-split-modal-footer');
    const badgeEl = document.getElementById('pp-modal-step-badge');
    const textEl = document.getElementById('pp-modal-step-text');
    const fillEl = document.getElementById('modal-wizard-progress-fill');

    if (!bodyEl || paperPlateSplitConfigs.length === 0) return;

    if (currentModalFileIndex >= paperPlateSplitConfigs.length) {
        currentModalFileIndex = Math.max(0, paperPlateSplitConfigs.length - 1);
    }

    const totalFiles = paperPlateSplitConfigs.length;
    const currentStep = currentModalFileIndex + 1;
    const progressPct = Math.round((currentStep / totalFiles) * 100);

    if (badgeEl) badgeEl.innerText = `STEP ${currentStep} OF ${totalFiles}`;
    if (textEl) textEl.innerText = `File ${currentStep} of ${totalFiles}`;
    if (fillEl) fillEl.style.width = `${progressPct}%`;

    const config = paperPlateSplitConfigs[currentModalFileIndex];
    const cIdx = currentModalFileIndex;

    const topGenderLabel = config.topGender === 'boy' ? 'Boys' : 'Girls';
    const bottomGenderLabel = config.topGender === 'boy' ? 'Girls' : 'Boys';
    const topGenderCode = config.topGender;
    const bottomGenderCode = config.topGender === 'boy' ? 'girl' : 'boy';

    const topCount = config.gapIndex;
    const bottomCount = Math.max(0, config.records.length - config.gapIndex);

    let swimmerListHTML = '';
    const recs = config.records;

    if (recs.length === 0) {
        swimmerListHTML = `
            <div style="padding: 24px; text-align: center; color: var(--muted-text-color); font-size: 13px; font-weight: 700;">
                👈 Please select the <strong>Swimmer Name</strong> and <strong>Award Title</strong> columns on the right to load swimmer rows.
            </div>
        `;
    } else {
        for (let i = 0; i <= recs.length; i++) {
            if (i === config.gapIndex) {
                swimmerListHTML += `
                    <div class="pp-split-gap-divider">
                        <span>Gap Divider: Top ${topCount} (${topGenderLabel}) | Bottom ${bottomCount} (${bottomGenderLabel})</span>
                        <span class="pp-gap-click-hint">Click row to set gap</span>
                    </div>
                `;
            }

            if (i < recs.length) {
                const isTop = i < config.gapIndex;
                const itemGenderCode = isTop ? topGenderCode : bottomGenderCode;
                const itemGenderLabel = isTop ? topGenderLabel.slice(0, -1) : bottomGenderLabel.slice(0, -1);
                const itemClass = itemGenderCode === 'boy' ? 'boy-item' : 'girl-item';
                const badgeClass = itemGenderCode === 'boy' ? 'badge-boy' : 'badge-girl';

                swimmerListHTML += `
                    <div class="pp-split-swimmer-item ${itemClass}" onclick="setFileGapPosition(${cIdx}, ${i})">
                        <div class="swimmer-item-left">
                            <strong style="margin-right: 8px;">#${i + 1}</strong>
                            <span>${config.records[i].name || '<em>Unmapped Swimmer</em>'}</span>
                            <small style="color: var(--muted-text-color); margin-left: 8px;">(${config.records[i].award || 'Award'})</small>
                        </div>
                        <span class="pp-gender-badge ${badgeClass}">${itemGenderLabel}</span>
                    </div>
                `;
            }
        }
    }

    bodyEl.innerHTML = `
        <div class="pp-split-file-card">
            <div class="pp-split-file-header">
                <div class="pp-split-file-title">
                    ${config.rawName || config.fileName} (${config.records.length} swimmers mapped)
                </div>
            </div>

            <div class="pp-split-file-grid">
                <!-- Left Side: Gender Gap & Swimmer Divider List -->
                <div class="pp-modal-left-col">
                    <div class="pp-modal-col-title">1. Gender Gap & Division</div>
                    
                    <div class="pp-split-controls-bar">
                        <button type="button" class="pp-gender-swap-btn" onclick="toggleFileGenderTop(${cIdx})">
                            ⇄ Swap Top/Bottom (Top: ${topGenderLabel})
                        </button>
                        <div class="pp-split-stepper">
                            <label>Gap after row:</label>
                            <input type="number" class="pp-split-input" min="0" max="${config.records.length}" value="${config.gapIndex}" onchange="setFileGapPosition(${cIdx}, this.value)"/>
                            <span>/ ${config.records.length}</span>
                        </div>
                    </div>

                    <div class="pp-split-swimmer-list">
                        ${swimmerListHTML}
                    </div>
                </div>

                <!-- Right Side: File Settings & Column Mapping Selectors -->
                <div class="pp-modal-right-col">
                    <div class="pp-modal-col-title">2. File & Column Options</div>
                    
                    <div class="input-group">
                        <label class="select-label" style="font-weight: 800; font-size: 12px; margin-bottom: 4px; display: block;">File / Event Name</label>
                        <input type="text" class="file-name-input-modal" value="${config.fileName}" oninput="renameCSVFileFromModal(${cIdx}, this.value)" placeholder="File Name" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); font-weight: 700; font-size: 13px; background-color: var(--card-bg, #ffffff); color: var(--text-color);"/>
                    </div>

                    <div class="input-group">
                        <label class="select-label" style="font-weight: 800; font-size: 12px; margin-bottom: 4px; display: block;">Swimmer Name Column</label>
                        <select class="file-col-select" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); font-weight: 700;" onchange="updateModalFileColumnMapping(${cIdx}, 'name', this.value)">
                            <option value="" ${!config.nameCol ? 'selected' : ''}>-- Select Name Column --</option>
                            ${config.headers.map(h => `<option value="${h}" ${h === config.nameCol ? 'selected' : ''}>${h}</option>`).join('')}
                        </select>
                    </div>

                    <div class="input-group">
                        <label class="select-label" style="font-weight: 800; font-size: 12px; margin-bottom: 4px; display: block;">Award Title Column</label>
                        <select class="file-col-select" style="width: 100%; padding: 8px; border: 2px solid var(--border-color); font-weight: 700;" onchange="updateModalFileColumnMapping(${cIdx}, 'award', this.value)">
                            <option value="" ${!config.awardCol ? 'selected' : ''}>-- Select Award Column --</option>
                            ${config.headers.map(h => `<option value="${h}" ${h === config.awardCol ? 'selected' : ''}>${h}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (footerEl) {
        let navButtons = '';
        if (totalFiles > 1) {
            navButtons += `<button type="button" class="btn btn-secondary" onclick="navigateModalFile(-1)" ${cIdx === 0 ? 'disabled' : ''}>← Previous File</button>`;
            if (cIdx < totalFiles - 1) {
                navButtons += `<button type="button" class="btn btn-primary" onclick="navigateModalFile(1)">Next File →</button>`;
            }
        }
        if (cIdx === totalFiles - 1 || totalFiles === 1) {
            navButtons += `<button type="button" class="btn btn-primary" onclick="confirmGeneratePaperPlates()">Confirm & Generate Signs</button>`;
        }

        footerEl.innerHTML = `
            <button type="button" class="btn btn-secondary" onclick="closePaperPlateSplitModal()">Cancel</button>
            <div style="display: flex; gap: 8px;">
                ${navButtons}
            </div>
        `;
    }
}

function confirmGeneratePaperPlates() {
    const unmappedFiles = paperPlateSplitConfigs.filter(c => c.records.length === 0);
    if (unmappedFiles.length > 0) {
        alert(`Please select Swimmer Name and Award Title columns for: ${unmappedFiles.map(f => f.fileName).join(', ')}`);
        return;
    }

    closePaperPlateSplitModal();

    const allRecords = [];

    paperPlateSplitConfigs.forEach(config => {
        const fileTitle = (config.fileName || 'Paper Plates').replace(/\.csv$/i, '').trim();
        const topGenderLabel = config.topGender === 'boy' ? 'Boys' : 'Girls';
        const bottomGenderLabel = config.topGender === 'boy' ? 'Girls' : 'Boys';
        const topGenderCode = config.topGender === 'boy' ? 'Boy' : 'Girl';
        const bottomGenderCode = config.topGender === 'boy' ? 'Girl' : 'Boy';

        const topRecords = config.records.slice(0, config.gapIndex);
        const bottomRecords = config.records.slice(config.gapIndex);

        // 1. Top Section Header Plate & Records
        if (topRecords.length > 0) {
            allRecords.push({
                name: '',
                award: `${fileTitle} ${topGenderLabel}`,
                sourceFile: config.fileName,
                isHeaderPlate: true,
                gender: topGenderCode
            });

            topRecords.forEach(rec => {
                allRecords.push({
                    name: rec.name || 'Swimmer Name',
                    award: rec.award || 'Special Award',
                    sourceFile: config.fileName,
                    isHeaderPlate: false,
                    gender: topGenderCode
                });
            });
        }

        // 2. Bottom Section Header Plate & Records
        if (bottomRecords.length > 0) {
            allRecords.push({
                name: '',
                award: `${fileTitle} ${bottomGenderLabel}`,
                sourceFile: config.fileName,
                isHeaderPlate: true,
                gender: bottomGenderCode
            });

            bottomRecords.forEach(rec => {
                allRecords.push({
                    name: rec.name || 'Swimmer Name',
                    award: rec.award || 'Special Award',
                    sourceFile: config.fileName,
                    isHeaderPlate: false,
                    gender: bottomGenderCode
                });
            });
        }
    });

    if (allRecords.length === 0) {
        alert("No paper plate records to generate.");
        return;
    }

    const paperPlateSwimmers = allRecords.map((rec, idx) => {
        const innerborder = Math.floor(Math.random() * 8) + 1;
        const outerborder = Math.floor(Math.random() * 17) + 1;
        const innerhue = Math.floor(Math.random() * 36) * 10;
        const outerhue = Math.floor(Math.random() * 36) * 10;
        const namecolor = colors[Math.floor(Math.random() * colors.length)];
        const stroketopcolor = colors[Math.floor(Math.random() * colors.length)];

        return {
            id: Date.now() + idx,
            isPaperPlate: true,
            isHeaderPlate: !!rec.isHeaderPlate,
            award: rec.award,
            fullname: rec.name,
            firstname: rec.name,
            lastname: "",
            strokes: [],
            sourceFile: rec.sourceFile,
            gender: rec.gender || "",
            namecolor: namecolor,
            stroketopcolor: stroketopcolor,
            strokebottomcolor: "#000000",
            graphiccolor: "#000000",
            innerborder: innerborder,
            outerborder: outerborder,
            innerhue: innerhue,
            outerhue: outerhue,
            showSignature: true,
            signaturesize: 100
        };
    });

    resetProjectState();
    state.swimmers = paperPlateSwimmers;
    state.meetInfo = "Paper Plate Awards";
    state.editorActiveFilter = paperPlateState.uploadedFiles[0]?.name || '';
    const meetInput = document.getElementById('meet-info-input');
    if (meetInput) meetInput.value = state.meetInfo;

    saveProject();
    renderSwimmerCards();
    showScreen('editor-screen');
}

// Shuffle colors, borders, and graphics for a single swimmer sign
function shuffleSign(id) {
    const swimmer = state.swimmers.find(s => s.id === id);
    if (!swimmer) return;

    swimmer.innerborder = Math.floor(Math.random() * 8) + 1;
    swimmer.outerborder = Math.floor(Math.random() * 17) + 1;
    swimmer.innerhue = Math.floor(Math.random() * 36) * 10;
    swimmer.outerhue = Math.floor(Math.random() * 36) * 10;

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

    if (!swimmer.isPaperPlate) {
        swimmer.strokebottomcolor = strokebottomcolor;
        swimmer.graphiccolor = graphiccolor;
        swimmer.randomgraphic = Math.floor(Math.random() * 6) + 4;
    }

    saveProject();
    // Re-render just the preview for this card without a full re-render
    const frontDiv = document.querySelector(`.swimmer-card[data-id="${id}"] .card-preview.front`);
    if (frontDiv) frontDiv.innerHTML = buildFrontSVG(swimmer, false);
}

Object.assign(window, {
    addBlankSign,
    addBlankSignAndOpenEditor,
    clearAllSigns,
    deleteSwimmer,
    duplicateSwimmer,
    updateSwimmerFirstName,
    updateSwimmerLastName,
    toggleSwimmerStroke,
    exportToPDF,
    updateMeetInfo,
    goToUpload,
    resumePreviousProject,
    handleSwimtopiaLogin,
    handleSwimtopiaLogout,
    handleGenerateFromMeet,
    switchAppMode,
    handleCSVFilesSelect,
    removeCSVFile,
    renameCSVFile,
    renameCSVFileFromModal,
    selectActiveCSVFile,
    updateFileColumnMapping,
    updateModalFileColumnMapping,
    setEditorFileFilter,
    handleGeneratePaperPlates,
    openPaperPlateSplitModal,
    closePaperPlateSplitModal,
    navigateModalFile,
    setFileGapPosition,
    toggleFileGenderTop,
    confirmGeneratePaperPlates,
    updatePaperPlateAward,
    updatePaperPlateName,
    updateMeetGenerateBtnState,
    shuffleSign
});
