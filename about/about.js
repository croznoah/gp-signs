import "../style.css";
import { buildFrontSVG } from "../svgBuilder.js";

// Initialize About Page
window.addEventListener('DOMContentLoaded', () => {
    renderAboutContent();
});

function renderAboutContent() {
    // Render live interactive mock SVG preview
    const previewContainer = document.getElementById('anatomy-svg-container');
    if (previewContainer) {
        const mockSwimmer = {
            id: 'about_preview',
            firstname: 'Name',
            lastname: 'Piranha',
            strokes: ['free', 'fly'],
            namecolor: '#ff5c60',
            stroketopcolor: '#906cc4',
            strokebottomcolor: '#2ebf83',
            graphiccolor: '#ffae30',
            innerborder: 1,
            outerborder: 3,
            randomgraphic: 6, // Great Piranha mascot icon (code 6)
            innerhue: 120,
            outerhue: 240,
            showSignature: true,
            nameinputsize: 180,
            graphicsize: 130,
            stroketopsize: 50,
            strokebottomsize: 50,
            signaturesize: 100
        };
        previewContainer.innerHTML = buildFrontSVG(mockSwimmer, false, "../");
    }

    // Populate outer borders gallery
    const outerContainer = document.getElementById('outer-borders-container');
    if (outerContainer && outerContainer.children.length === 0) {
        let outerHtml = '';
        for (let i = 1; i <= 17; i++) {
            const startHue = i * 21; // Staggered starting hues for a colorful grid
            outerHtml += `
            <div class="border-card">
                <div class="border-img-container">
                    <img src="../borders/outer/${i}.png" class="border-img" style="filter: hue-rotate(${startHue}deg);" />
                </div>
                <div class="border-card-title">Outer Frame #${i}</div>
            </div>`;
        }
        outerContainer.innerHTML = outerHtml;
    }

    // Populate inner borders gallery
    const innerContainer = document.getElementById('inner-borders-container');
    if (innerContainer && innerContainer.children.length === 0) {
        let innerHtml = '';
        for (let i = 1; i <= 8; i++) {
            const startHue = i * 45;
            innerHtml += `
            <div class="border-card">
                <div class="border-img-container">
                    <img src="../borders/inner/${i}.png" class="border-img" style="filter: hue-rotate(${startHue}deg);" />
                </div>
                <div class="border-card-title">Inner Frame #${i}</div>
            </div>`;
        }
        innerContainer.innerHTML = innerHtml;
    }
}
