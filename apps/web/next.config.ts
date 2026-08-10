import path from "node:path";

import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const config: NextConfig = {
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
};

export default withWorkflow(config);
