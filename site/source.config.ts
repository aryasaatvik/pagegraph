import { defineConfig, defineDocs, frontmatterSchema } from "fumadocs-mdx/config";
import { z } from "zod";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: { includeProcessedMarkdown: true },
    schema: frontmatterSchema.extend({
      description: z.string(),
      crumb: z.string().optional(),
      related: z.array(z.string()).optional(),
    }),
  },
});

export default defineConfig();
