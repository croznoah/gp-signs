import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { detectMeetSheet } from "../meetSheetParser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "test-outputs");
const tesseractCacheDir = path.join(outputDir, "tesseract-cache");
const fixturePdfFiles = [
    "tests/fixtures/pdfs/Fairfax Heat Sheet with Times.pdf",
    "tests/fixtures/pdfs/Fairfax+Heat+Sheet+No+Times.pdf",
    "tests/fixtures/pdfs/Entry+Sheet.pdf"
];
const pdfFiles = process.argv.length > 2 ? process.argv.slice(2) : fixturePdfFiles;

class NodeCanvasFactory {
    create(width, height) {
        const canvas = createCanvas(width, height);
        return { canvas, context: canvas.getContext("2d") };
    }

    reset(canvasAndContext, width, height) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
    }

    destroy(canvasAndContext) {
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
    }
}

await fs.mkdir(tesseractCacheDir, { recursive: true });

const workers = await Promise.all([
    createOCRWorker(),
    createOCRWorker()
]);

try {
    for (const pdfFile of pdfFiles) {
        const result = await processPdf(path.resolve(repoRoot, pdfFile), workers);
        const base = path.basename(pdfFile, path.extname(pdfFile)).replace(/[^a-z0-9]+/gi, "_");
        const linesPath = path.join(outputDir, `${base}.ocr-lines.txt`);
        const jsonPath = path.join(outputDir, `${base}.parsed.json`);

        await fs.writeFile(linesPath, result.lines.join("\n"), "utf8");
        await fs.writeFile(jsonPath, JSON.stringify(result.summary, null, 2), "utf8");

        console.log(`${pdfFile}: ${result.summary.format}, ${result.summary.count} swimmers`);
        console.log(`  ${path.relative(repoRoot, linesPath)}`);
        console.log(`  ${path.relative(repoRoot, jsonPath)}`);
    }
} finally {
    await Promise.all(workers.map(worker => worker.terminate()));
}

function createOCRWorker() {
    return createWorker("eng", undefined, {
        langPath: path.join(repoRoot, "public/assets"),
        cachePath: tesseractCacheDir,
        gzip: true
    });
}

async function processPdf(pdfPath, [leftWorker, rightWorker]) {
    const fileBuffer = await fs.readFile(pdfPath);
    const data = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
    const pdf = await pdfjsLib.getDocument({ data, disableWorker: true }).promise;
    const lines = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 6 });
        const canvasFactory = new NodeCanvasFactory();
        const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

        await page.render({
            canvasContext: canvasAndContext.context,
            viewport,
            canvasFactory
        }).promise;

        const left = preprocessHalf(canvasAndContext.canvas, "left");
        const right = preprocessHalf(canvasAndContext.canvas, "right");
        const [leftResult, rightResult] = await Promise.all([
            leftWorker.recognize(left.toBuffer("image/png")),
            rightWorker.recognize(right.toBuffer("image/png"))
        ]);

        lines.push(`--- page ${pageNumber} left ---`);
        lines.push(...leftResult.data.text.split("\n"));
        lines.push(`--- page ${pageNumber} right ---`);
        lines.push(...rightResult.data.text.split("\n"));
        canvasFactory.destroy(canvasAndContext);
    }

    const detected = detectMeetSheet(lines, true);
    return {
        lines,
        summary: {
            source: path.basename(pdfPath),
            format: detected.format,
            count: detected.table.length,
            swimmers: detected.table.map(([firstname, lastname, strokes]) => ({ firstname, lastname, strokes }))
        }
    };
}

function preprocessHalf(canvas, half) {
    const width = Math.floor(canvas.width / 2);
    const height = canvas.height;
    const output = createCanvas(width, height);
    const ctx = output.getContext("2d");
    const sourceX = half === "left" ? 0 : width;

    ctx.drawImage(canvas, sourceX, 0, width, height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const contrasted = Math.max(0, Math.min(255, (gray - 128) * 2 + 128));
        data[i] = contrasted;
        data[i + 1] = contrasted;
        data[i + 2] = contrasted;
    }
    ctx.putImageData(imageData, 0, 0);

    return output;
}
