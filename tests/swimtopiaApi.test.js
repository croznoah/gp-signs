import assert from "node:assert/strict";
import test from "node:test";
import {
    SWIMTOPIA_API_BASE,
    PARKLAWN_SWIMTOPIA_ORG_ID,
    getStoredToken,
    saveToken,
    clearToken,
    serializeParams,
    buildFinalMeetSwimmers,
    fetchMeetSwimmers,
} from "../swimtopiaApi.js";

test("swimtopiaApi constants match Parklawn configuration", () => {
    assert.equal(SWIMTOPIA_API_BASE, "https://mobile-api.swimtopia.com");
    assert.equal(PARKLAWN_SWIMTOPIA_ORG_ID, "27626");
});

test("serializeParams correctly formats parameters", () => {
    const params = {
        "filter[best_times_only]": true,
        include: ["affiliations", "organizationUser"],
        empty: "",
        nil: null
    };
    const serialized = serializeParams(params);
    assert.match(serialized, /filter%5Bbest_times_only%5D=true/);
    assert.match(serialized, /include=affiliations&include=organizationUser/);
});

test("buildFinalMeetSwimmers uses finalized individual entries and relay-only swimmers", () => {
    const team = (id, abbreviation) => ({ id, attributes: { abbreviation } });
    const athlete = (id, firstName, teamId, organizationUserId) => ({
        id,
        attributes: { firstName, lastName: "Swimmer" },
        relationships: {
            nirvanaTeam: { data: { id: teamId } },
            organizationUser: { data: { id: organizationUserId } },
        },
    });
    const event = (id, strokeCode, eventType = "individual") => ({
        id,
        attributes: { strokeCode, eventType },
    });
    const entry = (id, athleteId, eventId, teamId, laneNumber = 1) => ({
        id,
        attributes: { laneNumber },
        relationships: {
            nirvanaAthlete: { data: athleteId ? { id: athleteId } : null },
            nirvanaEvent: { data: { id: eventId } },
            nirvanaTeam: { data: { id: teamId } },
            nirvanaHeat: { data: laneNumber === null ? null : { id: `heat-${id}` } },
        },
    });

    const swimmers = buildFinalMeetSwimmers({
        teams: [team("pl", "PL"), team("other", "RH")],
        athletes: [
            athlete("final", "Final", "pl", "user-final"),
            athlete("signup-only", "Signup", "pl", "user-signup"),
            athlete("relay-only", "Relay", "pl", "user-relay"),
        ],
        events: [
            event("back-event", 2),
            event("fly-event", 4),
            event("relay-event", 6, "relay"),
        ],
        entries: [
            entry("final-back", "final", "back-event", "pl"),
            entry("final-fly", "final", "fly-event", "pl"),
            entry("unseeded-signup", "signup-only", "fly-event", "pl", null),
            entry("relay", null, "relay-event", "pl"),
        ],
        relayLegs: [{
            id: "relay-leg",
            attributes: { relayLegStrokeCode: 1 },
            relationships: {
                nirvanaAthlete: { data: { id: "relay-only" } },
                nirvanaEntry: { data: { id: "relay" } },
            },
        }],
    });

    assert.deepEqual(swimmers, [
        ["Final", "Swimmer", ["back", "fly"]],
        ["Relay", "Swimmer", ["free"]],
    ]);
});

test("buildFinalMeetSwimmers offers random graphic choices only for IM-only swimmers", () => {
    const swimmers = buildFinalMeetSwimmers({
        teams: [{ id: "pl", attributes: { abbreviation: "PL" } }],
        athletes: [
            {
                id: "im-only",
                attributes: { firstName: "Only", lastName: "IM" },
                relationships: { nirvanaTeam: { data: { id: "pl" } } },
            },
            {
                id: "im-and-back",
                attributes: { firstName: "Back", lastName: "With IM" },
                relationships: { nirvanaTeam: { data: { id: "pl" } } },
            },
        ],
        events: [
            { id: "im", attributes: { eventType: "individual", strokeCode: 5 } },
            { id: "back", attributes: { eventType: "individual", strokeCode: 2 } },
        ],
        entries: [
            {
                id: "only-im-entry",
                attributes: { laneNumber: 1 },
                relationships: {
                    nirvanaAthlete: { data: { id: "im-only" } },
                    nirvanaEvent: { data: { id: "im" } },
                    nirvanaTeam: { data: { id: "pl" } },
                },
            },
            {
                id: "mixed-im-entry",
                attributes: { laneNumber: 2 },
                relationships: {
                    nirvanaAthlete: { data: { id: "im-and-back" } },
                    nirvanaEvent: { data: { id: "im" } },
                    nirvanaTeam: { data: { id: "pl" } },
                },
            },
            {
                id: "mixed-back-entry",
                attributes: { laneNumber: 3 },
                relationships: {
                    nirvanaAthlete: { data: { id: "im-and-back" } },
                    nirvanaEvent: { data: { id: "back" } },
                    nirvanaTeam: { data: { id: "pl" } },
                },
            },
        ],
    });

    assert.deepEqual(swimmers, [
        ["Only", "IM", ["free", "back", "breast", "fly"]],
        ["Back", "With IM", ["back"]],
    ]);
});

test("fetchMeetSwimmers loads finalized Meet Maestro resources", async (t) => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    globalThis.fetch = async (url) => {
        const pathname = new URL(url).pathname;
        let payload;

        if (pathname === "/mobile/swim-meets/758065") {
            payload = {
                data: {
                    id: "758065",
                    relationships: { nirvanaMeet: { data: { id: "123749" } } },
                },
            };
        } else if (pathname.endsWith("/nirvana-teams")) {
            payload = { data: [{ id: "pl", type: "nirvanaTeam", attributes: { abbreviation: "PL" } }] };
        } else if (pathname.endsWith("/nirvana-athletes")) {
            payload = {
                data: [{
                    id: "athlete-1",
                    type: "nirvanaAthlete",
                    attributes: { firstName: "Entered", lastName: "Swimmer" },
                    relationships: {
                        nirvanaTeam: { data: { id: "pl" } },
                        organizationUser: { data: { id: "user-1" } },
                    },
                }],
            };
        } else if (pathname.endsWith("/nirvana-events")) {
            payload = { data: [{ id: "event-1", type: "nirvanaEvent", attributes: { eventType: "individual", strokeCode: 4 } }] };
        } else if (pathname.endsWith("/nirvana-entries")) {
            payload = {
                data: [{
                    id: "entry-1",
                    type: "nirvanaEntry",
                    attributes: { laneNumber: 2 },
                    relationships: {
                        nirvanaAthlete: { data: { id: "athlete-1" } },
                        nirvanaEvent: { data: { id: "event-1" } },
                        nirvanaTeam: { data: { id: "pl" } },
                        nirvanaHeat: { data: { id: "heat-1" } },
                    },
                }],
            };
        } else if (pathname.endsWith("/nirvana-entry-relay-legs")) {
            payload = { data: [] };
        } else if (pathname.endsWith("/swim-absences")) {
            payload = { data: [] };
        } else {
            throw new Error(`Unexpected request: ${url}`);
        }

        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/vnd.api+json" },
        });
    };

    const swimmers = await fetchMeetSwimmers({ token: "test-token", meetId: "758065" });
    assert.deepEqual(swimmers, [["Entered", "Swimmer", ["fly"]]]);
});
