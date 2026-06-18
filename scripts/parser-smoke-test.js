import fs from "node:fs";
import path from "node:path";
import { detectMeetSheet } from "../meetSheetParser.js";

const fixtures = [
    "Fairfax_Heat_Sheet_with_Times",
    "Fairfax_Heat_Sheet_No_Times",
    "Entry_Sheet"
];

const parsed = fixtures.map(name => {
    const linesPath = path.join("test-outputs", `${name}.ocr-lines.txt`);
    const lines = fs.readFileSync(linesPath, "utf8").split("\n");
    const result = detectMeetSheet(lines, true);
    const names = result.table
        .map(([firstname, lastname]) => `${lastname}, ${firstname}`)
        .sort();

    return { name, format: result.format, count: result.table.length, names };
});

const expectedCount = parsed[0].count;
const expectedNames = parsed[0].names.join("\n");

for (const result of parsed) {
    if (result.count !== expectedCount) {
        throw new Error(`${result.name} parsed ${result.count} swimmers, expected ${expectedCount}`);
    }

    if (result.names.join("\n") !== expectedNames) {
        throw new Error(`${result.name} swimmer set does not match ${parsed[0].name}`);
    }
}

console.log(parsed.map(result => `${result.name}: ${result.format}, ${result.count} swimmers`).join("\n"));
