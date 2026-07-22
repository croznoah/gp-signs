export const SWIMTOPIA_API_BASE = "https://mobile-api.swimtopia.com";
export const PARKLAWN_SWIMTOPIA_ORG_ID = "27626";
export const PARKLAWN_TEAM_ABBR = "PL";

const STROKE_MAP = {
    1: "free",
    6: "free",
    2: "back",
    12: "back",
    3: "breast",
    13: "breast",
    4: "fly",
    14: "fly",
};

const JSON_API_ACCEPT = "application/vnd.api+json";
const TOKEN_KEY = "gp-signs-swimtopia-token";
const REFRESH_TOKEN_KEY = "gp-signs-swimtopia-refresh-token";

export function getStoredToken() {
    return sessionStorage.getItem(TOKEN_KEY) || "";
}

export function saveToken(accessToken, refreshToken = "") {
    if (accessToken) {
        sessionStorage.setItem(TOKEN_KEY, accessToken);
    }
    if (refreshToken) {
        sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
}

export function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}

function bearerValue(token) {
    const val = String(token || "").trim();
    if (!val) return "";
    return val.toLowerCase().startsWith("bearer ") ? val : `Bearer ${val}`;
}

async function parseResponseBody(response) {
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (!text) return null;
    if (contentType.includes("json")) {
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }
    return text;
}

export function serializeParams(params = {}) {
    const search = new URLSearchParams();
    for (const [key, rawValue] of Object.entries(params)) {
        if (rawValue === undefined || rawValue === null || rawValue === "") continue;
        if (Array.isArray(rawValue)) {
            for (const value of rawValue) {
                search.append(key, value);
            }
        } else {
            search.set(key, rawValue);
        }
    }
    return search.toString();
}

export async function swimtopiaPasswordLogin({ username, password }) {
    if (!username || !password) {
        throw new Error("Username and password are required.");
    }

    const body = new URLSearchParams({
        grant_type: "password",
        username,
        password,
    });

    const response = await fetch(`${SWIMTOPIA_API_BASE}/oauth/token`, {
        method: "POST",
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
    });

    const payload = await parseResponseBody(response);

    if (!response.ok) {
        const message = typeof payload === "object"
            ? (payload.error_description || payload.error || "SwimTopia login failed.")
            : String(payload || "SwimTopia login failed.");
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    saveToken(payload.access_token, payload.refresh_token);
    return payload;
}

export async function swimtopiaApiFetch(pathname, { token, params, method = "GET", body } = {}) {
    const authToken = token || getStoredToken();
    if (!authToken) {
        const error = new Error("SwimTopia sign-in required.");
        error.status = 401;
        throw error;
    }

    const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const url = new URL(normalizedPath, SWIMTOPIA_API_BASE);
    const query = serializeParams(params);
    if (query) url.search = query;

    const response = await fetch(url, {
        method,
        headers: {
            "Accept": JSON_API_ACCEPT,
            "Content-Type": JSON_API_ACCEPT,
            "Authorization": bearerValue(authToken),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = await parseResponseBody(response);

    if (!response.ok) {
        const error = new Error(
            typeof payload === "object" && payload?.error
                ? payload.error
                : `SwimTopia request failed (${response.status})`
        );
        error.status = response.status;
        throw error;
    }

    return payload;
}

async function paginatedSwimtopiaFetch(pathname, { token, params = {}, limit = 100 } = {}) {
    const data = [];
    const included = [];
    let meta = null;

    for (let offset = 0; ; offset += limit) {
        const payload = await swimtopiaApiFetch(pathname, {
            token,
            params: {
                ...params,
                "page[offset]": offset,
                "page[limit]": limit,
            },
        });
        const pageData = Array.isArray(payload.data) ? payload.data : (payload.data ? [payload.data] : []);
        data.push(...pageData);
        if (Array.isArray(payload.included)) included.push(...payload.included);
        meta = payload.meta || meta;

        if (pageData.length < limit || data.length >= (payload.meta?.count || Infinity)) {
            break;
        }
    }

    const dedupeResources = (resources) => [
        ...new Map(resources.map((resource) => [`${resource.type}:${resource.id}`, resource])).values()
    ];

    return {
        data: dedupeResources(data),
        included: dedupeResources(included),
        meta,
    };
}

function relationshipId(resource, relationshipName) {
    const id = resource?.relationships?.[relationshipName]?.data?.id;
    return id === undefined || id === null ? "" : String(id);
}

function isFinalizedEntry(entry) {
    return Boolean(entry?.relationships?.nirvanaHeat?.data) ||
        (entry?.attributes?.laneNumber !== null && entry?.attributes?.laneNumber !== undefined);
}

export function buildFinalMeetSwimmers({
    teams = [],
    athletes = [],
    events = [],
    entries = [],
    relayLegs = [],
    excludedOrganizationUserIds = new Set(),
} = {}) {
    const parklawnTeam = teams.find((team) => team.attributes?.abbreviation === PARKLAWN_TEAM_ABBR);
    if (!parklawnTeam) {
        throw new Error("Parklawn was not found in the finalized meet lineup.");
    }

    const teamId = String(parklawnTeam.id);
    const athletesById = new Map(athletes.map((athlete) => [String(athlete.id), athlete]));
    const eventsById = new Map(events.map((event) => [String(event.id), event]));
    const entriesById = new Map(entries.map((entry) => [String(entry.id), entry]));
    const finalizedTeamEntries = entries.filter((entry) =>
        relationshipId(entry, "nirvanaTeam") === teamId && isFinalizedEntry(entry)
    );

    if (finalizedTeamEntries.length === 0) {
        throw new Error("Finalized Parklawn entries are not published for this meet yet.");
    }

    const swimmersByAthleteId = new Map();
    const getSwimmer = (athleteId) => {
        const athlete = athletesById.get(String(athleteId));
        if (!athlete || relationshipId(athlete, "nirvanaTeam") !== teamId) return null;

        const organizationUserId = relationshipId(athlete, "organizationUser");
        if (organizationUserId && excludedOrganizationUserIds.has(organizationUserId)) return null;

        if (!swimmersByAthleteId.has(String(athlete.id))) {
            const attrs = athlete.attributes || {};
            swimmersByAthleteId.set(String(athlete.id), {
                firstname: String(attrs.preferredFirstName || attrs.firstName || "").trim(),
                lastname: String(attrs.lastName || "").trim(),
                individualStrokes: [],
                relayStrokes: [],
                hasIndividualMedley: false,
            });
        }
        return swimmersByAthleteId.get(String(athlete.id));
    };

    const addStroke = (collection, strokeCode) => {
        const stroke = STROKE_MAP[Number(strokeCode)];
        if (stroke && !collection.includes(stroke)) collection.push(stroke);
    };

    for (const entry of finalizedTeamEntries) {
        const athleteId = relationshipId(entry, "nirvanaAthlete");
        const event = eventsById.get(relationshipId(entry, "nirvanaEvent"));
        if (!athleteId || event?.attributes?.eventType !== "individual") continue;

        const swimmer = getSwimmer(athleteId);
        if (swimmer) {
            if (Number(event.attributes?.strokeCode) === 5) {
                swimmer.hasIndividualMedley = true;
            } else {
                addStroke(swimmer.individualStrokes, event.attributes?.strokeCode);
            }
        }
    }

    for (const relayLeg of relayLegs) {
        const entry = entriesById.get(relationshipId(relayLeg, "nirvanaEntry"));
        if (!entry || relationshipId(entry, "nirvanaTeam") !== teamId || !isFinalizedEntry(entry)) continue;

        const swimmer = getSwimmer(relationshipId(relayLeg, "nirvanaAthlete"));
        if (swimmer) addStroke(swimmer.relayStrokes, relayLeg.attributes?.relayLegStrokeCode);
    }

    return [...swimmersByAthleteId.values()]
        .sort((a, b) => a.lastname.localeCompare(b.lastname) || a.firstname.localeCompare(b.firstname))
        .map((swimmer) => {
            const meetStrokes = [...swimmer.individualStrokes, ...swimmer.relayStrokes]
                .filter((stroke, index, strokes) => strokes.indexOf(stroke) === index)
                .slice(0, 2);
            const graphicStrokes = swimmer.hasIndividualMedley && meetStrokes.length === 0
                ? ["free", "back", "breast", "fly"]
                : meetStrokes;

            return [swimmer.firstname, swimmer.lastname, graphicStrokes];
        });
}

export async function getParklawnSwimtopiaMeets({ token } = {}) {
    const events = await paginatedSwimtopiaFetch(`/mobile/organizations/${PARKLAWN_SWIMTOPIA_ORG_ID}/calendar-events`, { token });
    
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const meets = (events.data || [])
        .filter((event) => event.attributes?.stiType === "SwimMeet")
        .sort((a, b) => new Date(a.attributes?.startAt || a.attributes?.startDate || 0) - new Date(b.attributes?.startAt || b.attributes?.startDate || 0))
        .map((event) => ({
            id: event.id,
            name: event.attributes?.name || "Swim Meet",
            startAt: event.attributes?.startAt,
            startDate: event.attributes?.startDate,
            stage: event.attributes?.stage,
        }));

    const upcoming = meets.find((meet) => new Date(meet.startAt || meet.startDate || 0) >= todayStart) || meets[meets.length - 1] || null;

    return { meets, upcomingMeetId: upcoming?.id || null };
}

export async function fetchMeetSwimmers({ token, meetId, excludeAbsent = true, onProgress = () => {} } = {}) {
    if (!meetId) throw new Error("A swim meet is required.");

    onProgress("Loading finalized Meet Maestro lineup...", 20);
    const meet = await swimtopiaApiFetch(`/mobile/swim-meets/${meetId}`, { token });
    const nirvanaMeetId = relationshipId(meet.data, "nirvanaMeet");
    if (!nirvanaMeetId) {
        throw new Error("This meet does not have a finalized Meet Maestro lineup.");
    }

    const resourcePath = (resource) => `/mobile/nirvana-meets/${nirvanaMeetId}/${resource}`;
    const [teams, athletes, events, entries, relayLegs] = await Promise.all([
        paginatedSwimtopiaFetch(resourcePath("nirvana-teams"), { token }),
        paginatedSwimtopiaFetch(resourcePath("nirvana-athletes"), { token }),
        paginatedSwimtopiaFetch(resourcePath("nirvana-events"), { token }),
        paginatedSwimtopiaFetch(resourcePath("nirvana-entries"), { token }),
        paginatedSwimtopiaFetch(resourcePath("nirvana-entry-relay-legs"), { token }),
    ]);

    onProgress("Matching finalized Parklawn entries and strokes...", 70);
    const excludedOrganizationUserIds = new Set();
    if (excludeAbsent) {
        try {
            const absences = await paginatedSwimtopiaFetch(`/mobile/swim-meets/${meetId}/swim-absences`, { token });
            for (const absence of absences.data || []) {
                if (absence.attributes?.isAttending === false) {
                    const organizationUserId = relationshipId(absence, "athlete");
                    if (organizationUserId) excludedOrganizationUserIds.add(organizationUserId);
                }
            }
        } catch (error) {
            console.warn("Could not fetch absences:", error);
        }
    }

    const swimmers = buildFinalMeetSwimmers({
        teams: teams.data,
        athletes: athletes.data,
        events: events.data,
        entries: entries.data,
        relayLegs: relayLegs.data,
        excludedOrganizationUserIds,
    });

    onProgress(`Finalized entry data ready for ${swimmers.length} swimmers!`, 100);
    return swimmers;
}
