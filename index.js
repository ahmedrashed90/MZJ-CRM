
import serverless from "serverless-http";
import app from "../server.js";

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

export default serverless(app);
