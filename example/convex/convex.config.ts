import { defineApp } from "convex/server";
import remit from "@agent-governance/convex/convex.config.js";

const app = defineApp();
app.use(remit, { httpPrefix: "/comments/" });

export default app;
