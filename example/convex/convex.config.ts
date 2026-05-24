import { defineApp } from "convex/server";
import remit from "@agent-governance/convex/convex.config.js";

const app = defineApp();
app.use(remit);

export default app;
