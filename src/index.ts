// Library entrypoint. Consumers `import { buildFixture, scenarios } from "meadow"`.
export { buildFixture, REQUEST_LOG_LIMIT } from "./fixture.js";
// Exported so a consumer's assertions are typed by meadow rather than by a
// hand-copied shape: renaming a field here should break their build, not
// surface as an undefined at 2am.
export type { RecordedRequest, RequestLog } from "./fixture.js";
export { scenarios, type Scenarios } from "./scenarios.js";
