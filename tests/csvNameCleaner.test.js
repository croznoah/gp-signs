import assert from "node:assert/strict";
import test from "node:test";

function updateCSVFileNames(files) {
    if (!files || files.length === 0) return files;

    if (files.length === 1) {
        const file = files[0];
        if (!file.userRenamed && file.originalName) {
            file.name = file.originalName.replace(/\.csv$/i, '');
        }
        return files;
    }

    const baseNames = files.map(f => {
        return (f.originalName || f.name).replace(/\.csv$/i, '');
    });

    let prefix = baseNames[0] || "";
    for (let i = 1; i < baseNames.length; i++) {
        while (prefix && !baseNames[i].startsWith(prefix)) {
            prefix = prefix.substring(0, prefix.length - 1);
        }
    }

    files.forEach((file) => {
        if (!file.userRenamed) {
            const origBase = (file.originalName || file.name).replace(/\.csv$/i, '');
            const stripped = (prefix && prefix.length < origBase.length) ? origBase.slice(prefix.length) : origBase;
            file.name = stripped;
        }
    });

    return files;
}

test("updateCSVFileNames strips exact prefix without .csv extension by default", () => {
    const files = [
        { name: "this is a test - 2124.csv", originalName: "this is a test - 2124.csv" },
        { name: "this is a test - 12#$ 8d.csv", originalName: "this is a test - 12#$ 8d.csv" }
    ];
    updateCSVFileNames(files);
    assert.equal(files[0].name, "2124");
    assert.equal(files[1].name, "12#$ 8d");
});

test("updateCSVFileNames handles standard prefix without altering whitespace or adding .csv", () => {
    const files = [
        { name: "Parklawn_Paper_Plates_8U.csv", originalName: "Parklawn_Paper_Plates_8U.csv" },
        { name: "Parklawn_Paper_Plates_9_10.csv", originalName: "Parklawn_Paper_Plates_9_10.csv" }
    ];
    updateCSVFileNames(files);
    assert.equal(files[0].name, "8U");
    assert.equal(files[1].name, "9_10");
});
